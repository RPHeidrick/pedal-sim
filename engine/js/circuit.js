/**
 * MNA circuit engine.
 *
 * Builds a modified-nodal-analysis system from a circuit description
 * (engine/parsers/elaborate.js) and simulates it sample by sample:
 *
 *   G   static matrix: resistors, pots, switches, companion conductances of
 *       C and L for the current timestep, source incidence, gshunt.
 *   bStep  per-timestep RHS: sources and reactive history currents.
 *   each Newton iteration:  A = G + J_nl(x),  b = bStep + i_nl(x),
 *       factor A (compiled sparse LU), solve A*xNew = b.
 *
 * Unknowns: node voltages then branch currents (V sources, inductors, E/H).
 * Ground maps to index n: x[n] is always 0, and matrix stamps involving ground
 * land in a trash slot (index n*n) so devices never branch on ground.
 *
 * No DOM access and only typed arrays in the hot path, so this runs inside an
 * AudioWorklet and can be ported to WebAssembly behind the same interface.
 */

import { SparseLU } from './sparse-lu.js';
import { Resistor, Capacitor, Inductor, VSource, ISource, VCVS, VCCS, CCCS, CCVS, Pot, Switch } from './devices/linear.js';
import { Diode } from './devices/diode.js';
import { BJT } from './devices/bjt.js';
import { JFET, MOSFET } from './devices/fet.js';
import { createOpamp } from './devices/opamp.js';

const FACTORY = {
  R: (el, c) => [new Resistor(el, c)],
  C: (el, c) => [new Capacitor(el, c)],
  L: (el, c) => [new Inductor(el, c)],
  V: (el, c) => [new VSource(el, c)],
  I: (el, c) => [new ISource(el, c)],
  E: (el, c) => [new VCVS(el, c)],
  G: (el, c) => [new VCCS(el, c)],
  F: (el, c) => [new CCCS(el, c)],
  H: (el, c) => [new CCVS(el, c)],
  POT: (el, c) => [new Pot(el, c)],
  SW: (el, c) => [new Switch(el, c)],
  D: (el, c) => [new Diode(el, c)],
  Q: (el, c) => [new BJT(el, c)],
  J: (el, c) => [new JFET(el, c)],
  M: (el, c) => [new MOSFET(el, c)],
  OPAMP: (el, c) => createOpamp(el, c),
};

export const DEFAULTS = {
  sampleRate: 96000,
  method: 'trap',     // 'trap' (trapezoidal) or 'be' (backward Euler)
  maxIter: 40,        // Newton iterations per sample before the fallback
  reltol: 1e-4,
  vntol: 1e-6,        // volts
  abstol: 1e-9,       // amps
  gshunt: 1e-12,      // conductance from every node to ground (keeps floating nodes solvable)
  smoothingMs: 20,    // knob smoothing time constant
};

export class Circuit {
  /**
   * @param {Object} desc circuit description from elaborate()
   * @param {Partial<typeof DEFAULTS>} [opts]
   */
  constructor(desc, opts = {}) {
    if (!desc || !desc.elements) throw new Error('Circuit: missing description');
    if (desc.ok === false) {
      const errs = desc.diagnostics.filter((d) => d.level === 'error').map((d) => d.message);
      throw new Error(`Circuit has errors:\n${errs.join('\n')}`);
    }
    this.desc = desc;
    this.opts = { ...DEFAULTS, ...opts };
    this.method = this.opts.method;
    this.dt = 1 / this.opts.sampleRate;

    // --- allocation phase ---------------------------------------------------
    this.nodeIndex = new Map();
    this.unknowns = []; // {name, kind: 'v' | 'i'}
    this.branches = new Map();
    this.n = 0;
    this.devices = [];
    for (const raw of desc.elements) {
      let el = raw;
      if (el.type === 'V' && el.rser > 0) {
        // Source series resistance: V n+ n- Rser=r  ->  R n+ int, V int n-
        const mid = `${el.name}#rser`;
        this.devices.push(new Resistor({ name: `${el.name}#r`, nodes: [el.nodes[0], mid], value: el.rser }, this));
        el = { ...el, nodes: [mid, el.nodes[1]] };
      }
      const make = FACTORY[el.type];
      if (!make) throw new Error(`Circuit: element type ${el.type} (${el.name}) not supported by the engine`);
      this.devices.push(...make(el, this));
    }
    const n = (this.n = this.unknowns.length);
    this.TRASH = n * n;

    // --- binding phase -------------------------------------------------------
    this.pattern = new Uint8Array(n * n);
    for (const d of this.devices) d.bind(this);
    const diag = [];
    this.tol = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const isV = this.unknowns[i].kind === 'v';
      this.tol[i] = isV ? this.opts.vntol : this.opts.abstol;
      if (isV) diag.push(this.pos(i, i));
    }
    this.diagIdx = Int32Array.from(diag);

    this.staticDevs = this.devices.filter((d) => d.stampStatic);
    this.rhsDevs = this.devices.filter((d) => d.stepRHS);
    this.nlDevs = this.devices.filter((d) => d.load);
    this.stateDevs = this.devices.filter((d) => d.accept);
    this.initDevs = this.devices.filter((d) => d.initState);
    this.linear = this.nlDevs.length === 0;

    this.G = new Float64Array(n * n + 1);
    this.A = new Float64Array(n * n + 1);
    this.b = new Float64Array(n + 1);
    this.bStep = new Float64Array(n + 1);
    this.x = new Float64Array(n + 1);
    this.xNew = new Float64Array(n + 1);
    this.xPrev = new Float64Array(n + 1);
    this.xPrev2 = new Float64Array(n + 1);
    this.predict = true; // linear extrapolation of the Newton starting point
    this.lu = new SparseLU(n);
    this.needAnalyze = true;
    this.factored = false;

    this.mode = 'dc';
    this.time = 0;
    this.srcScale = 1;
    this.gminExtra = 0;
    this.externalInput = true;
    this.limited = false;

    this.input = this.devices.find((d) => d.role === 'input') || null;
    this.outIdx = this.rhs(this.nodeIndex.get('out') ?? -1);

    // controls (pots / switches)
    const nc = desc.controls ? desc.controls.length : 0;
    this.controlDevs = new Array(nc).fill(null);
    for (const d of this.devices) if (d.control != null) this.controlDevs[d.control] = d;
    this.ctlCur = new Float64Array(nc);
    this.ctlTarget = new Float64Array(nc);
    for (let i = 0; i < nc; i++) this.ctlCur[i] = this.ctlTarget[i] = desc.controls[i].value;
    this.setSmoothing(this.opts.smoothingMs);

    this.stats = { steps: 0, iterations: 0, maxIterations: 0, failures: 0, reanalyses: 0 };
  }

  // --- allocation API used by devices ---------------------------------------
  /** Index of a named node, allocating it on first use. Ground is -1. */
  node(name) {
    const key = String(name).toLowerCase();
    if (key === '0') return -1;
    let i = this.nodeIndex.get(key);
    if (i == null) {
      i = this.unknowns.length;
      this.unknowns.push({ name: key, kind: 'v' });
      this.nodeIndex.set(key, i);
    }
    return i;
  }
  /** New internal node (device-private). */
  internal(label) { return this.node(label); }
  /** New branch-current unknown. */
  branch(label) {
    const i = this.unknowns.length;
    this.unknowns.push({ name: `I(${label})`, kind: 'i' });
    this.branches.set(String(label).toLowerCase(), i);
    return i;
  }
  branchOf(label) {
    const i = this.branches.get(String(label).toLowerCase());
    if (i == null) throw new Error(`no branch current for ${label}`);
    return i;
  }
  /** Flat matrix position of (row, col); ground rows/cols map to the trash slot. */
  pos(r, c) {
    if (r < 0 || c < 0) return this.TRASH;
    const p = r * this.n + c;
    this.pattern[p] = 1;
    return p;
  }
  /** Vector index for a node/branch; ground maps to n (always 0 in x). */
  rhs(r) { return r < 0 ? this.n : r; }

  // --- system assembly ----------------------------------------------------------
  buildStatic(mode) {
    this.mode = mode;
    const G = this.G;
    G.fill(0);
    for (const d of this.staticDevs) d.stampStatic(G, this);
    const gs = this.opts.gshunt;
    for (let k = 0; k < this.diagIdx.length; k++) G[this.diagIdx[k]] += gs;
    this.factored = false;
  }

  buildRHS() {
    const b = this.bStep;
    b.fill(0);
    for (const d of this.rhsDevs) d.stepRHS(b, this);
  }

  /** Assemble A,b at the current x (nonlinear devices linearise here). */
  assemble() {
    const A = this.A;
    const G = this.G;
    if (this.needAnalyze) A.set(G);
    else {
      // Only entries the LU programs touch need refreshing (fill positions are 0 in G).
      const act = this.lu.active;
      for (let k = 0; k < act.length; k++) { const p = act[k]; A[p] = G[p]; }
    }
    this.b.set(this.bStep);
    this.limited = false;
    const nl = this.nlDevs;
    for (let k = 0; k < nl.length; k++) nl[k].load(this.x, A, this.b, this);
    if (this.gminExtra > 0) {
      const d = this.diagIdx;
      for (let k = 0; k < d.length; k++) A[d[k]] += this.gminExtra;
    }
  }

  /** Factor this.A, re-running pivot selection if needed. */
  factor() {
    if (this.needAnalyze) {
      if (!this.lu.analyze(this.A, this.pattern)) return false;
      this.needAnalyze = false;
      this.stats.reanalyses++;
    }
    if (this.lu.factor(this.A)) return true;
    // A pivot collapsed: re-assemble and choose a new ordering for these values.
    this.needAnalyze = true;
    this.assemble();
    this.needAnalyze = false;
    this.stats.reanalyses++;
    if (!this.lu.analyze(this.A, this.pattern)) return false;
    return this.lu.factor(this.A);
  }

  /**
   * Newton-Raphson on the current bStep, starting from this.x.
   * @param {number} maxIter
   * @param {boolean} [damped] halve every update (last-resort robustness)
   * @returns {number} iterations used, or -1 on failure (x left at last iterate)
   */
  newton(maxIter, damped = false) {
    const n = this.n;
    const x = this.x;
    const xn = this.xNew;
    const tol = this.tol;
    const rel = this.opts.reltol;
    for (let it = 1; it <= maxIter; it++) {
      this.assemble();
      if (!this.factor()) return -1;
      this.lu.solve(this.A, this.b, xn);
      let conv = !this.limited;
      const alpha = damped || it > 20 ? 0.5 : 1;
      for (let i = 0; i < n; i++) {
        const v = xn[i];
        if (v !== v || v === Infinity || v === -Infinity) return -1;
        const old = x[i];
        const d = v - old;
        const ad = d < 0 ? -d : d;
        const mag = Math.max(v < 0 ? -v : v, old < 0 ? -old : old);
        if (ad > rel * mag + tol[i]) conv = false;
        x[i] = alpha === 1 ? v : old + alpha * d;
      }
      if (conv) return it;
    }
    return -1;
  }

  // --- analyses -----------------------------------------------------------------
  /**
   * DC operating point: capacitors open, inductors short, input at its DC value.
   * Plain Newton, then gmin stepping, then source stepping.
   * @returns {{ok:boolean, method:string, iterations:number}}
   */
  dcOperatingPoint() {
    this.buildStatic('dc');
    this.time = 0;
    this.srcScale = 1;
    this.gminExtra = 0;
    if (this.input) this.input.value = this.input.dc;
    this.x.fill(0);
    for (const d of this.initDevs) d.initState(this.x, this);
    this.buildRHS();
    let it = this.newton(200);
    if (it >= 0) return this.finishOp('newton', it);

    // gmin stepping
    this.x.fill(0);
    let ok = true;
    let total = 0;
    for (let g = 1e-2; g >= 1e-12; g /= 10) {
      this.gminExtra = g;
      const r = this.newton(100);
      if (r < 0) { ok = false; break; }
      total += r;
    }
    this.gminExtra = 0;
    if (ok) {
      it = this.newton(100);
      if (it >= 0) return this.finishOp('gmin stepping', total + it);
    }

    // source stepping
    this.x.fill(0);
    for (const d of this.initDevs) d.initState(this.x, this);
    let s = 0;
    let step = 0.1;
    total = 0;
    const save = new Float64Array(this.n + 1);
    while (s < 1) {
      const sTry = Math.min(1, s + step);
      this.srcScale = sTry;
      this.buildRHS();
      save.set(this.x);
      const r = this.newton(100);
      if (r >= 0) { s = sTry; step *= 1.5; total += r; }
      else {
        this.x.set(save);
        step /= 4;
        if (step < 1e-5) break;
      }
    }
    this.srcScale = 1;
    this.buildRHS();
    if (s >= 1) return this.finishOp('source stepping', total);
    return { ok: false, method: 'failed', iterations: total };
  }

  finishOp(method, iterations) {
    this.needAnalyze = true; // re-pick pivots with realistic values next time
    return { ok: true, method, iterations };
  }

  /** Switch to transient mode from the current (DC) solution. */
  startTransient() {
    this.buildStatic('tran');
    for (const d of this.initDevs) d.initState(this.x, this);
    this.time = 0;
    this.needAnalyze = true;
  }

  /** DC operating point followed by transient start. Returns the op result. */
  reset() {
    const op = this.dcOperatingPoint();
    this.startTransient();
    return op;
  }

  setSampleRate(fs) {
    this.opts.sampleRate = fs;
    this.dt = 1 / fs;
    this.setSmoothing(this.opts.smoothingMs);
    if (this.mode === 'tran') this.buildStatic('tran');
  }

  setSmoothing(ms) {
    this.opts.smoothingMs = ms;
    this.ctlAlpha = ms > 0 ? 1 - Math.exp(-1 / ((ms / 1000) * this.opts.sampleRate)) : 1;
  }

  // --- controls -------------------------------------------------------------------
  /**
   * Set a pot rotation (0..1) or switch state (0/1). Pots glide to the target
   * over the smoothing time; switches (and `immediate`) apply at once.
   */
  setControl(id, value, immediate = false) {
    const d = this.controlDevs[id];
    if (!d) return;
    this.ctlTarget[id] = value;
    if (immediate || d instanceof Switch) {
      this.ctlCur[id] = value;
      d.setValue(value, this.G);
      this.factored = false;
    }
  }

  /** Advance knob smoothing by one sample. Returns true if the matrix changed. */
  smoothControls() {
    const cur = this.ctlCur;
    const tgt = this.ctlTarget;
    let changed = false;
    for (let i = 0; i < cur.length; i++) {
      const c = cur[i];
      const t = tgt[i];
      if (c === t) continue;
      let v = c + (t - c) * this.ctlAlpha;
      if (Math.abs(t - v) < 1e-5) v = t;
      cur[i] = v;
      this.controlDevs[i].setValue(v, this.G);
      changed = true;
    }
    if (changed) this.factored = false;
    return changed;
  }

  // --- transient --------------------------------------------------------------------
  /**
   * Advance one sample with input voltage vin. Returns V(out).
   * On Newton failure the previous state is held (no NaN, no click).
   */
  step(vin) {
    if (this.input) this.input.value = vin;
    this.smoothControls();
    this.time += this.dt;
    this.buildRHS();
    const st = this.stats;
    st.steps++;

    if (this.linear) {
      if (!this.factored) {
        this.A.set(this.G);
        if (!this.factor()) { st.failures++; return this.x[this.outIdx]; }
        this.factored = true;
      }
      this.b.set(this.bStep);
      this.lu.solve(this.A, this.b, this.x);
      for (let k = 0; k < this.stateDevs.length; k++) this.stateDevs[k].accept(this.x, this);
      st.iterations++;
      return this.x[this.outIdx];
    }

    this.xPrev2.set(this.xPrev);
    this.xPrev.set(this.x);
    if (this.predict && this.stats.steps > 2) {
      const x = this.x, p1 = this.xPrev, p2 = this.xPrev2;
      for (let i = 0; i < this.n; i++) x[i] = 2 * p1[i] - p2[i];
    }
    let it = this.newton(this.opts.maxIter);
    if (it < 0) {
      this.x.set(this.xPrev);
      for (const d of this.initDevs) d.initState(this.x, this);
      it = this.newton(this.opts.maxIter * 2, true);
      if (it < 0) {
        // Hold the last valid state: skip accept so histories stay consistent.
        this.x.set(this.xPrev);
        for (const d of this.initDevs) d.initState(this.x, this);
        st.failures++;
        st.iterations += this.opts.maxIter * 3;
        return this.x[this.outIdx];
      }
      it += this.opts.maxIter;
    }
    st.iterations += it;
    if (it > st.maxIterations) st.maxIterations = it;
    for (let k = 0; k < this.stateDevs.length; k++) this.stateDevs[k].accept(this.x, this);
    return this.x[this.outIdx];
  }

  /** Process a block of input samples (volts) into output samples (volts). */
  process(input, output, count = input.length) {
    for (let i = 0; i < count; i++) output[i] = this.step(input[i]);
  }

  // --- inspection ---------------------------------------------------------------------
  voltage(name) {
    const i = this.nodeIndex.get(String(name).toLowerCase());
    return i == null ? NaN : this.x[i];
  }

  /** Snapshot of the operating point: nodes, branch currents, per-device info. */
  snapshot() {
    const nodes = [];
    const currents = [];
    this.unknowns.forEach((u, i) => {
      if (u.kind === 'v') { if (!u.name.includes('#')) nodes.push({ name: u.name, v: this.x[i] }); }
      else currents.push({ name: u.name, i: this.x[i] });
    });
    const devices = [];
    for (const d of this.devices) {
      if (!d.info || d.name.includes('#')) continue;
      devices.push({ name: d.name, type: d.constructor.name, info: d.info(this.x) });
    }
    return { nodes, currents, devices };
  }
}
