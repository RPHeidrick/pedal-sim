/**
 * Linear elements: R, C, L, independent V/I sources, controlled sources
 * (E, G, F, H), potentiometers and switches.
 *
 * Device protocol (see engine/js/circuit.js):
 *   constructor(el, ctx)      allocate nodes / branches by name
 *   bind(ctx)                 resolve flat matrix positions (ctx.pos)
 *   stampStatic(G, ctx)       time-invariant stamps for ctx.mode ('dc' | 'tran')
 *   stepRHS(b, ctx)           per-timestep right-hand side (sources, history)
 *   load(x, A, b, ctx)        nonlinear stamps, every Newton iteration
 *   initState(x, ctx)         seed history from the DC operating point
 *   accept(x, ctx)            commit a converged timestep
 *   info(x)                   operating point details for display
 */

import { taper } from '../taper.js';

/** Stamp a conductance g between flat positions (aa, ab, ba, bb). */
function stampG(G, p, g) {
  G[p[0]] += g; G[p[1]] -= g; G[p[2]] -= g; G[p[3]] += g;
}
function posPair(ctx, a, b) {
  return Int32Array.of(ctx.pos(a, a), ctx.pos(a, b), ctx.pos(b, a), ctx.pos(b, b));
}

export class Resistor {
  constructor(el, ctx) {
    this.name = el.name;
    this.a = ctx.node(el.nodes[0]);
    this.b = ctx.node(el.nodes[1]);
    this.g = 1 / el.value;
    this.r = el.value;
  }
  bind(ctx) { this.p = posPair(ctx, this.a, this.b); this.ra = ctx.rhs(this.a); this.rb = ctx.rhs(this.b); }
  stampStatic(G) { stampG(G, this.p, this.g); }
  info(x) {
    const v = x[this.ra] - x[this.rb];
    return { V: v, I: v * this.g };
  }
}

export class Capacitor {
  constructor(el, ctx) {
    this.name = el.name;
    this.a = ctx.node(el.nodes[0]);
    this.b = ctx.node(el.nodes[1]);
    this.c = el.value;
    this.gc = 0;
    this.v = 0; // voltage at last accepted step
    this.i = 0; // current at last accepted step
    this.ieq = 0;
  }
  bind(ctx) { this.p = posPair(ctx, this.a, this.b); this.ra = ctx.rhs(this.a); this.rb = ctx.rhs(this.b); }
  stampStatic(G, ctx) {
    if (ctx.mode === 'dc') { this.gc = 0; return; } // open circuit at DC
    this.gc = (ctx.method === 'be' ? 1 : 2) * this.c / ctx.dt;
    stampG(G, this.p, this.gc);
  }
  stepRHS(b, ctx) {
    if (ctx.mode === 'dc') return;
    // Companion model: i = gc*v - ieq
    this.ieq = ctx.method === 'be' ? this.gc * this.v : this.gc * this.v + this.i;
    b[this.ra] += this.ieq;
    b[this.rb] -= this.ieq;
  }
  initState(x) { this.v = x[this.ra] - x[this.rb]; this.i = 0; }
  accept(x) {
    const v = x[this.ra] - x[this.rb];
    this.i = this.gc * v - this.ieq;
    this.v = v;
  }
  info(x) { return { V: x[this.ra] - x[this.rb] }; }
}

export class Inductor {
  constructor(el, ctx) {
    this.name = el.name;
    this.a = ctx.node(el.nodes[0]);
    this.b = ctx.node(el.nodes[1]);
    this.k = ctx.branch(el.name);
    this.l = el.value;
    this.req = 0;
    this.v = 0;
    this.i = 0;
  }
  bind(ctx) {
    const { a, b, k } = this;
    this.p = Int32Array.of(ctx.pos(a, k), ctx.pos(b, k), ctx.pos(k, a), ctx.pos(k, b), ctx.pos(k, k));
    this.ra = ctx.rhs(a); this.rb = ctx.rhs(b); this.rk = ctx.rhs(k);
  }
  stampStatic(G, ctx) {
    const p = this.p;
    G[p[0]] += 1; G[p[1]] -= 1; G[p[2]] += 1; G[p[3]] -= 1;
    if (ctx.mode === 'dc') { this.req = 0; return; } // short at DC
    this.req = (ctx.method === 'be' ? 1 : 2) * this.l / ctx.dt;
    G[p[4]] -= this.req;
  }
  stepRHS(b, ctx) {
    if (ctx.mode === 'dc') return;
    b[this.rk] -= ctx.method === 'be' ? this.req * this.i : this.req * this.i + this.v;
  }
  initState(x) { this.i = x[this.rk]; this.v = 0; }
  accept(x) { this.i = x[this.rk]; this.v = x[this.ra] - x[this.rb]; }
  info(x) { return { I: x[this.rk] }; }
}

/** Evaluate a transient source waveform at time t. */
export function waveValue(w, t, dc) {
  if (!w) return dc;
  switch (w.kind) {
    case 'sin': {
      if (t < w.td) return w.vo + w.va * Math.sin((w.phase * Math.PI) / 180);
      const tt = t - w.td;
      return w.vo + w.va * Math.exp(-tt * w.theta) * Math.sin(2 * Math.PI * w.freq * tt + (w.phase * Math.PI) / 180);
    }
    case 'pulse': {
      if (t < w.td) return w.v1;
      let tt = t - w.td;
      if (Number.isFinite(w.per) && w.per > 0) tt %= w.per;
      if (tt < w.tr) return w.v1 + ((w.v2 - w.v1) * tt) / (w.tr || 1);
      tt -= w.tr;
      if (tt < w.pw) return w.v2;
      tt -= w.pw;
      if (tt < w.tf) return w.v2 + ((w.v1 - w.v2) * tt) / (w.tf || 1);
      return w.v1;
    }
    case 'pwl': {
      const p = w.points;
      if (!p.length) return dc;
      if (t <= p[0][0]) return p[0][1];
      for (let i = 1; i < p.length; i++) {
        if (t <= p[i][0]) {
          const [t0, v0] = p[i - 1];
          const [t1, v1] = p[i];
          return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0 || 1);
        }
      }
      return p[p.length - 1][1];
    }
    default: return dc;
  }
}

export class VSource {
  constructor(el, ctx) {
    this.name = el.name;
    this.role = el.role || null;
    this.a = ctx.node(el.nodes[0]);
    this.b = ctx.node(el.nodes[1]);
    this.k = ctx.branch(el.name);
    this.dc = el.dc ?? 0;
    this.wave = el.wave || null;
    this.value = this.dc; // input sources get their value written by the engine
  }
  bind(ctx) {
    const { a, b, k } = this;
    this.p = Int32Array.of(ctx.pos(a, k), ctx.pos(b, k), ctx.pos(k, a), ctx.pos(k, b));
    this.rk = ctx.rhs(k);
  }
  stampStatic(G) {
    const p = this.p;
    G[p[0]] += 1; G[p[1]] -= 1; G[p[2]] += 1; G[p[3]] -= 1;
  }
  stepRHS(b, ctx) {
    let v;
    if (this.role === 'input' && ctx.externalInput) v = this.value;
    else v = ctx.mode === 'dc' ? this.dc : waveValue(this.wave, ctx.time, this.dc);
    b[this.rk] += v * ctx.srcScale;
  }
  info(x) { return { I: x[this.rk] }; }
}

export class ISource {
  constructor(el, ctx) {
    this.name = el.name;
    this.a = ctx.node(el.nodes[0]);
    this.b = ctx.node(el.nodes[1]);
    this.dc = el.dc ?? 0;
    this.wave = el.wave || null;
  }
  bind(ctx) { this.ra = ctx.rhs(this.a); this.rb = ctx.rhs(this.b); }
  stepRHS(b, ctx) {
    const i = (ctx.mode === 'dc' ? this.dc : waveValue(this.wave, ctx.time, this.dc)) * ctx.srcScale;
    b[this.ra] -= i; // SPICE: current flows from n+ through the source to n-
    b[this.rb] += i;
  }
}

/** E: voltage-controlled voltage source. */
export class VCVS {
  constructor(el, ctx) {
    this.name = el.name;
    [this.a, this.b, this.cp, this.cn] = el.nodes.map((n) => ctx.node(n));
    this.k = ctx.branch(el.name);
    this.gain = el.gain;
  }
  bind(ctx) {
    const { a, b, cp, cn, k } = this;
    this.p = Int32Array.of(ctx.pos(a, k), ctx.pos(b, k), ctx.pos(k, a), ctx.pos(k, b), ctx.pos(k, cp), ctx.pos(k, cn));
  }
  stampStatic(G) {
    const p = this.p;
    G[p[0]] += 1; G[p[1]] -= 1; G[p[2]] += 1; G[p[3]] -= 1; G[p[4]] -= this.gain; G[p[5]] += this.gain;
  }
}

/** G: voltage-controlled current source (current n+ -> n- through the source). */
export class VCCS {
  constructor(el, ctx) {
    this.name = el.name;
    [this.a, this.b, this.cp, this.cn] = el.nodes.map((n) => ctx.node(n));
    this.gm = el.gain;
  }
  bind(ctx) {
    const { a, b, cp, cn } = this;
    this.p = Int32Array.of(ctx.pos(a, cp), ctx.pos(a, cn), ctx.pos(b, cp), ctx.pos(b, cn));
  }
  stampStatic(G) {
    const p = this.p;
    G[p[0]] += this.gm; G[p[1]] -= this.gm; G[p[2]] -= this.gm; G[p[3]] += this.gm;
  }
}

/** F: current-controlled current source. */
export class CCCS {
  constructor(el, ctx) {
    this.name = el.name;
    this.a = ctx.node(el.nodes[0]);
    this.b = ctx.node(el.nodes[1]);
    this.source = el.source;
    this.gain = el.gain;
  }
  bind(ctx) {
    const kc = ctx.branchOf(this.source);
    this.p = Int32Array.of(ctx.pos(this.a, kc), ctx.pos(this.b, kc));
  }
  stampStatic(G) { G[this.p[0]] += this.gain; G[this.p[1]] -= this.gain; }
}

/** H: current-controlled voltage source. */
export class CCVS {
  constructor(el, ctx) {
    this.name = el.name;
    this.a = ctx.node(el.nodes[0]);
    this.b = ctx.node(el.nodes[1]);
    this.k = ctx.branch(el.name);
    this.source = el.source;
    this.r = el.gain;
  }
  bind(ctx) {
    const { a, b, k } = this;
    const kc = ctx.branchOf(this.source);
    this.p = Int32Array.of(ctx.pos(a, k), ctx.pos(b, k), ctx.pos(k, a), ctx.pos(k, b), ctx.pos(k, kc));
  }
  stampStatic(G) {
    const p = this.p;
    G[p[0]] += 1; G[p[1]] -= 1; G[p[2]] += 1; G[p[3]] -= 1; G[p[4]] -= this.r;
  }
}

/**
 * Potentiometer: two resistors lug1-wiper and wiper-lug3 whose split follows
 * the knob through the taper. Knob moves restamp only these two conductances.
 */
export class Pot {
  constructor(el, ctx) {
    this.name = el.name;
    [this.a, this.w, this.c] = el.nodes.map((n) => ctx.node(n));
    this.r = el.r;
    this.taper = el.taper || 'lin';
    this.control = el.control;
    this.rot = el.rot ?? 0.5;
    this.rMin = Math.max(this.r * 1e-4, 0.1); // end resistance keeps both legs finite
    this.g1 = 0; // conductances currently stamped
    this.g2 = 0;
  }
  bind(ctx) {
    this.p1 = posPair(ctx, this.a, this.w);
    this.p2 = posPair(ctx, this.w, this.c);
    this.ra = ctx.rhs(this.a); this.rw = ctx.rhs(this.w); this.rc = ctx.rhs(this.c);
  }
  legs(rot) {
    const f = taper(this.taper, rot);
    return [1 / Math.max(this.r * f, this.rMin), 1 / Math.max(this.r * (1 - f), this.rMin)];
  }
  stampStatic(G) {
    const [g1, g2] = this.legs(this.rot);
    this.g1 = g1; this.g2 = g2;
    stampG(G, this.p1, g1);
    stampG(G, this.p2, g2);
  }
  /** Move the knob: apply only the change in conductance to G. */
  setValue(rot, G) {
    this.rot = rot;
    const [g1, g2] = this.legs(rot);
    stampG(G, this.p1, g1 - this.g1);
    stampG(G, this.p2, g2 - this.g2);
    this.g1 = g1; this.g2 = g2;
  }
  info(x) {
    const f = taper(this.taper, this.rot);
    return { rot: this.rot, R1w: this.r * f, Rw3: this.r * (1 - f), Vw: x[this.rw] };
  }
}

/** Multi-pole switch: state 0 connects common-a, state 1 connects common-b on every pole. */
export class Switch {
  constructor(el, ctx) {
    this.name = el.name;
    this.control = el.control;
    this.state = el.state ? 1 : 0;
    this.gon = 1 / 0.1;
    this.goff = 1e-9;
    this.poles = el.poles.map(([c, a, b]) => ({
      c: ctx.node(c), a: a == null ? null : ctx.node(a), b: b == null ? null : ctx.node(b),
    }));
    this.applied = null;
  }
  bind(ctx) {
    for (const p of this.poles) {
      p.pa = p.a == null ? null : posPair(ctx, p.c, p.a);
      p.pb = p.b == null ? null : posPair(ctx, p.c, p.b);
    }
  }
  gains(state) { return state ? [this.goff, this.gon] : [this.gon, this.goff]; }
  stampStatic(G) {
    const [ga, gb] = this.gains(this.state);
    for (const p of this.poles) {
      if (p.pa) stampG(G, p.pa, ga);
      if (p.pb) stampG(G, p.pb, gb);
    }
  }
  setValue(state, G) {
    state = state >= 0.5 ? 1 : 0;
    if (state === this.state) return;
    const [ga0, gb0] = this.gains(this.state);
    const [ga1, gb1] = this.gains(state);
    for (const p of this.poles) {
      if (p.pa) stampG(G, p.pa, ga1 - ga0);
      if (p.pb) stampG(G, p.pb, gb1 - gb0);
    }
    this.state = state;
  }
  info() { return { state: this.state }; }
}
