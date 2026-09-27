/**
 * Junction diode: Shockley equation with emission coefficient N, optional
 * reverse breakdown (BV, IBV) and series resistance RS (internal node).
 *
 *   Id = IS*(exp(Vd/(N*Vt)) - 1) - IBV*exp(-(Vd + BV)/(NBV*Vt)) + GMIN*Vd
 */

import { VT, GMIN, safeExp, safeExpD, pnjlim, vcrit } from './common.js';

/**
 * Pure model evaluation (used by load() and by the Jacobian unit tests).
 * @returns {number} current; writes conductance to out[0]
 */
export function diodeEval(p, vd, out) {
  const nvt = p.n * VT;
  const e = safeExp(vd / nvt);
  let id = p.is * (e - 1);
  let gd = (p.is * safeExpD(vd / nvt)) / nvt;
  if (Number.isFinite(p.bv)) {
    const nbvt = p.nbv * VT;
    const arg = -(vd + p.bv) / nbvt;
    id -= p.ibv * safeExp(arg);
    gd += (p.ibv * safeExpD(arg)) / nbvt;
  }
  id += GMIN * vd;
  gd += GMIN;
  out[0] = gd;
  return id;
}

export class Diode {
  constructor(el, ctx) {
    this.name = el.name;
    const m = el.model;
    const area = el.area || 1;
    this.p = {
      is: (m.is ?? 1e-14) * area,
      n: m.n ?? 1,
      rs: (m.rs ?? 0) / area,
      bv: m.bv ?? Infinity,
      ibv: (m.ibv ?? 1e-3) * area,
      nbv: m.nbv ?? m.n ?? 1,
    };
    this.a = ctx.node(el.nodes[0]);
    this.k = ctx.node(el.nodes[1]);
    this.ai = this.p.rs > 0 ? ctx.internal(`${el.name}#a`) : this.a;
    this.nvt = this.p.n * VT;
    this.vc = vcrit(this.p.is, this.nvt);
    this.vold = 0;
    this.tmp = new Float64Array(1);
  }
  bind(ctx) {
    const { a, ai, k } = this;
    this.pj = Int32Array.of(ctx.pos(ai, ai), ctx.pos(ai, k), ctx.pos(k, ai), ctx.pos(k, k));
    if (ai !== a) this.ps = Int32Array.of(ctx.pos(a, a), ctx.pos(a, ai), ctx.pos(ai, a), ctx.pos(ai, ai));
    this.rai = ctx.rhs(ai); this.rk = ctx.rhs(k);
  }
  stampStatic(G) {
    if (!this.ps) return;
    const g = 1 / this.p.rs;
    const s = this.ps;
    G[s[0]] += g; G[s[1]] -= g; G[s[2]] -= g; G[s[3]] += g;
  }
  load(x, A, b, ctx) {
    let vd = x[this.rai] - x[this.rk];
    const p = this.p;
    if (Number.isFinite(p.bv) && vd < Math.min(0, -p.bv + 10 * this.nvt)) {
      // limit in the breakdown region on the mirrored exponential
      let vt = -(vd + p.bv);
      vt = pnjlim(vt, -(this.vold + p.bv), p.nbv * VT, this.vc, ctx);
      vd = -(vt + p.bv);
    } else {
      vd = pnjlim(vd, this.vold, this.nvt, this.vc, ctx);
    }
    this.vold = vd;
    const id = diodeEval(p, vd, this.tmp);
    const gd = this.tmp[0];
    const j = this.pj;
    A[j[0]] += gd; A[j[1]] -= gd; A[j[2]] -= gd; A[j[3]] += gd;
    const ieq = id - gd * vd;
    b[this.rai] -= ieq;
    b[this.rk] += ieq;
  }
  initState(x) { this.vold = x[this.rai] - x[this.rk]; }
  info(x) {
    const vd = x[this.rai] - x[this.rk];
    const id = diodeEval(this.p, vd, this.tmp);
    return { Vd: vd, Id: id, gd: this.tmp[0] };
  }
}
