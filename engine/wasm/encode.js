/**
 * Circuit description -> flat Float64Array for the C++ engine (engine/cpp/src/circuit.cpp).
 *
 * The WebAssembly boundary only passes numbers, so the circuit is "compiled"
 * here into a list of records. All the one-time work stays in JavaScript
 * (parsing, model lookup, SPICE default parameters); the C++ side only has to
 * build the matrix and run it.
 *
 *   header: 1 (format version), nNames, outNameId, nControls, ...controlValues, nElements
 *   node ids: named nodes are numbered in first-use order; ground = -1; "no node" = -2
 *   element records (type code first):
 *     1 R  a b value            2 C  a b value            3 L  a b branchKey value
 *     4 V  a b branchKey dc isInput WAVE                  5 I  a b dc WAVE
 *     6 E  a b cp cn branchKey gain                       7 G  a b cp cn gm
 *     8 F  a b srcKey gain      9 H  a b branchKey srcKey r
 *    10 POT a w c r taper(0 lin,1 log,2 rlog) rot control
 *    11 SW control state nPoles (c a b)*
 *    12 D  a k is n rs bv ibv nbv
 *    13 Q  c b e pol is bf br nf nr invVaf invVar invIkf invIkr ise ne isc nc rb rc re
 *    14 FET d g s pol k vto lambda is n rd rs          (JFET and MOSFET)
 *    15 OPAMP inp inn vp vn out int imax gout dropHi dropLo
 *   WAVE: 0 | 1 vo va freq td theta phase | 2 v1 v2 td tr tf pw per | 3 count (t v)*
 *
 * The order of records and of node ids matches the JavaScript engine's device
 * construction order exactly, so both engines number their unknowns the same way.
 */
import { bjtParams } from '../js/devices/bjt.js';
import { jfetParams, mosParams } from '../js/devices/fet.js';

export function encodeCircuit(desc) {
  const names = new Map();
  const id = (name) => {
    if (name == null) return -2;
    const k = String(name).toLowerCase();
    if (k === '0') return -1;
    if (!names.has(k)) names.set(k, names.size);
    return names.get(k);
  };
  const branchKeys = new Map();
  const branchKey = (label) => {
    const k = String(label).toLowerCase();
    if (!branchKeys.has(k)) branchKeys.set(k, branchKeys.size);
    return branchKeys.get(k);
  };
  const wave = (w, out) => {
    if (!w) { out.push(0); return; }
    if (w.kind === 'sin') out.push(1, w.vo, w.va, w.freq, w.td, w.theta, w.phase);
    else if (w.kind === 'pulse') out.push(2, w.v1, w.v2, w.td, w.tr, w.tf, w.pw, w.per);
    else if (w.kind === 'pwl') { out.push(3, w.points.length); for (const [t, v] of w.points) out.push(t, v); }
    else out.push(0);
  };
  const TAPER = { lin: 0, log: 1, rlog: 2 };

  const body = [];
  let count = 0;
  const rec = (...xs) => { body.push(...xs); count++; };

  for (const raw of desc.elements) {
    let el = raw;
    if (el.type === 'V' && el.rser > 0) {
      // source series resistance: V n+ n- Rser=r  ->  R n+ mid, V mid n-
      const mid = `${el.name}#rser`;
      rec(1, id(el.nodes[0]), id(mid), el.rser);
      el = { ...el, nodes: [mid, el.nodes[1]] };
    }
    const n = el.nodes || [];
    switch (el.type) {
      case 'R': rec(1, id(n[0]), id(n[1]), el.value); break;
      case 'C': rec(2, id(n[0]), id(n[1]), el.value); break;
      case 'L': { const a = id(n[0]), b = id(n[1]); rec(3, a, b, branchKey(el.name), el.value); break; }
      case 'V': {
        const a = id(n[0]), b = id(n[1]);
        const r = [4, a, b, branchKey(el.name), el.dc ?? 0, el.role === 'input' ? 1 : 0];
        wave(el.wave, r);
        rec(...r);
        break;
      }
      case 'I': { const r = [5, id(n[0]), id(n[1]), el.dc ?? 0]; wave(el.wave, r); rec(...r); break; }
      case 'E': { const [a, b, cp, cn] = n.map(id); rec(6, a, b, cp, cn, branchKey(el.name), el.gain); break; }
      case 'G': { const [a, b, cp, cn] = n.map(id); rec(7, a, b, cp, cn, el.gain); break; }
      case 'F': { const a = id(n[0]), b = id(n[1]); rec(8, a, b, branchKey(el.source), el.gain); break; }
      case 'H': { const a = id(n[0]), b = id(n[1]); const k = branchKey(el.name); rec(9, a, b, k, branchKey(el.source), el.gain); break; }
      case 'POT': { const [a, w, c] = n.map(id); rec(10, a, w, c, el.r, TAPER[el.taper] ?? 0, el.rot ?? 0.5, el.control ?? -1); break; }
      case 'SW': {
        const r = [11, el.control ?? -1, el.state ? 1 : 0, el.poles.length];
        for (const [c, a, b] of el.poles) { const ic = id(c); const ia = id(a); const ib = id(b); r.push(ic, ia, ib); }
        rec(...r);
        break;
      }
      case 'D': {
        const m = el.model, area = el.area || 1;
        const a = id(n[0]), k = id(n[1]);
        rec(12, a, k, (m.is ?? 1e-14) * area, m.n ?? 1, (m.rs ?? 0) / area, m.bv ?? Infinity, (m.ibv ?? 1e-3) * area, m.nbv ?? m.n ?? 1);
        break;
      }
      case 'Q': {
        const p = bjtParams(el.model, el.area || 1);
        const [c, b, e] = n.map(id);
        rec(13, c, b, e, el.polarity || 1, p.is, p.bf, p.br, p.nf, p.nr, p.invVaf, p.invVar, p.invIkf, p.invIkr, p.ise, p.ne, p.isc, p.nc, p.rb, p.rc, p.re);
        break;
      }
      case 'J': case 'M': {
        const pol = el.polarity || 1;
        const p = el.type === 'J' ? jfetParams(el.model, el.area || 1) : mosParams(el.model, el.w ?? 1, el.l ?? 1, pol);
        const [d, g, s] = n.slice(0, 3).map(id);
        rec(14, d, g, s, pol, p.k, p.vto, p.lambda, p.is, p.n, p.rd, p.rs);
        break;
      }
      case 'OPAMP': {
        // Same decomposition as engine/js/devices/opamp.js createOpamp(): Rin, R1, C1, core.
        const p = el.params;
        const intNode = `${el.name}#int`;
        const c1 = 1 / (2 * Math.PI * p.gbw);
        rec(1, id(n[0]), id(n[1]), p.rin);
        rec(1, id(intNode), -1, p.aol);
        rec(2, id(intNode), -1, c1);
        const [inp, inn, vp, vn, out] = n;
        rec(15, id(inp), id(inn), id(vp), id(vn), id(out), id(intNode), p.sr * c1, 1 / p.rout, p.dropHi, p.dropLo);
        break;
      }
      default: throw new Error(`C++ engine: element type ${el.type} (${el.name}) is not supported`);
    }
  }

  const controls = (desc.controls || []).map((c) => c.value);
  const outId = names.has('out') ? names.get('out') : -1;
  const header = [1, names.size, outId, controls.length, ...controls, count];
  return Float64Array.from([...header, ...body]);
}
