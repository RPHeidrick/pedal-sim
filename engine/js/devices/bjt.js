/**
 * Bipolar transistor: simplified Gummel-Poon (DC), NPN and PNP.
 *
 *   Ibf = IS*(exp(Vbe/(NF*Vt)) - 1)      Ibr = IS*(exp(Vbc/(NR*Vt)) - 1)
 *   q1  = 1/(1 - Vbc/VAF - Vbe/VAR)      q2  = Ibf/IKF + Ibr/IKR
 *   qb  = q1*(1 + sqrt(1 + 4*q2))/2      (Early effect + high injection)
 *   Ict = (Ibf - Ibr)/qb
 *   Ib  = Ibf/BF + ISE*(exp(Vbe/(NE*Vt))-1) + Ibr/BR + ISC*(exp(Vbc/(NC*Vt))-1)
 *   Ic  = Ict - Ibr/BR - ISC*(exp(Vbc/(NC*Vt))-1)
 *
 * With VAF=VAR=IKF=IKR=inf and ISE=ISC=0 this reduces to Ebers-Moll
 * (transport form). ISE/NE model base leakage, which is what makes
 * germanium fuzz transistors bias-sensitive. RB, RC, RE add internal nodes.
 * Junction capacitances and temperature terms are not modelled.
 */

import { VT, GMIN, safeExp, safeExpD, pnjlim, vcrit } from './common.js';
import { positions3, stamp3 } from './stamp3.js';

/** Resolved parameter set with SPICE defaults. */
export function bjtParams(m, area = 1) {
  const inv = (v) => (v == null || v === 0 || !Number.isFinite(v) ? 0 : 1 / v);
  return {
    is: (m.is ?? 1e-16) * area,
    bf: m.bf ?? 100,
    br: m.br ?? 1,
    nf: m.nf ?? 1,
    nr: m.nr ?? 1,
    invVaf: inv(m.vaf ?? m.va),
    invVar: inv(m.var ?? m.vb),
    invIkf: inv(m.ikf ?? m.ik) / area,
    invIkr: inv(m.ikr) / area,
    ise: (m.ise ?? 0) * area,
    ne: m.ne ?? 1.5,
    isc: (m.isc ?? 0) * area,
    nc: m.nc ?? 2,
    rb: (m.rb ?? 0) / area,
    rc: (m.rc ?? 0) / area,
    re: (m.re ?? 0) / area,
  };
}

/**
 * Evaluate terminal currents and partials at (vbe, vbc), device polarity.
 * out = [ic, ib, dic/dvbe, dic/dvbc, dib/dvbe, dib/dvbc]
 */
export function bjtEval(p, vbe, vbc, out) {
  const nfvt = p.nf * VT;
  const nrvt = p.nr * VT;
  const ibf = p.is * (safeExp(vbe / nfvt) - 1);
  const gbf = (p.is * safeExpD(vbe / nfvt)) / nfvt;
  const ibr = p.is * (safeExp(vbc / nrvt) - 1);
  const gbr = (p.is * safeExpD(vbc / nrvt)) / nrvt;

  let ile = 0, gle = 0, ilc = 0, glc = 0;
  if (p.ise > 0) {
    const nevt = p.ne * VT;
    ile = p.ise * (safeExp(vbe / nevt) - 1);
    gle = (p.ise * safeExpD(vbe / nevt)) / nevt;
  }
  if (p.isc > 0) {
    const ncvt = p.nc * VT;
    ilc = p.isc * (safeExp(vbc / ncvt) - 1);
    glc = (p.isc * safeExpD(vbc / ncvt)) / ncvt;
  }

  // Base charge
  let q1, dq1be, dq1bc;
  const den = 1 - vbc * p.invVaf - vbe * p.invVar;
  if (den > 1e-2) {
    q1 = 1 / den;
    dq1be = q1 * q1 * p.invVar;
    dq1bc = q1 * q1 * p.invVaf;
  } else {
    q1 = 100; dq1be = 0; dq1bc = 0; // far outside a sane operating region; keep finite
  }
  const q2 = ibf * p.invIkf + ibr * p.invIkr;
  let qb, dqbe, dqbc;
  if (q2 > 0 || q2 < 0) {
    const s = Math.sqrt(Math.max(1 + 4 * q2, 1e-6));
    qb = (q1 * (1 + s)) / 2;
    dqbe = ((1 + s) / 2) * dq1be + (q1 / s) * p.invIkf * gbf;
    dqbc = ((1 + s) / 2) * dq1bc + (q1 / s) * p.invIkr * gbr;
  } else {
    qb = q1; dqbe = dq1be; dqbc = dq1bc;
  }

  const ict = (ibf - ibr) / qb;
  const dictBe = (gbf - ict * dqbe) / qb;
  const dictBc = (-gbr - ict * dqbc) / qb;

  const ib = ibf / p.bf + ile + ibr / p.br + ilc + GMIN * (vbe + vbc);
  const ic = ict - ibr / p.br - ilc - GMIN * vbc;
  out[0] = ic;
  out[1] = ib;
  out[2] = dictBe;
  out[3] = dictBc - gbr / p.br - glc - GMIN;
  out[4] = gbf / p.bf + gle + GMIN;
  out[5] = gbr / p.br + glc + GMIN;
}

export class BJT {
  constructor(el, ctx) {
    this.name = el.name;
    this.pol = el.polarity || 1;
    this.p = bjtParams(el.model, el.area || 1);
    [this.c, this.b, this.e] = el.nodes.map((n) => ctx.node(n));
    this.ci = this.p.rc > 0 ? ctx.internal(`${el.name}#c`) : this.c;
    this.bi = this.p.rb > 0 ? ctx.internal(`${el.name}#b`) : this.b;
    this.ei = this.p.re > 0 ? ctx.internal(`${el.name}#e`) : this.e;
    this.vcBE = vcrit(this.p.is, this.p.nf * VT);
    this.vcBC = vcrit(this.p.is, this.p.nr * VT);
    this.vbeOld = 0;
    this.vbcOld = 0;
    this.out = new Float64Array(6);
  }
  bind(ctx) {
    this.P = positions3(ctx, this.ci, this.bi, this.ei);
    this.R = Int32Array.of(ctx.rhs(this.ci), ctx.rhs(this.bi), ctx.rhs(this.ei));
    const series = [];
    if (this.ci !== this.c) series.push([this.c, this.ci, this.p.rc]);
    if (this.bi !== this.b) series.push([this.b, this.bi, this.p.rb]);
    if (this.ei !== this.e) series.push([this.e, this.ei, this.p.re]);
    this.series = series.map(([a, b, r]) => ({ g: 1 / r, p: Int32Array.of(ctx.pos(a, a), ctx.pos(a, b), ctx.pos(b, a), ctx.pos(b, b)) }));
  }
  stampStatic(G) {
    for (const s of this.series) {
      G[s.p[0]] += s.g; G[s.p[1]] -= s.g; G[s.p[2]] -= s.g; G[s.p[3]] += s.g;
    }
  }
  load(x, A, b, ctx) {
    const pol = this.pol;
    const R = this.R;
    const vB = x[R[1]];
    let vbe = pol * (vB - x[R[2]]);
    let vbc = pol * (vB - x[R[0]]);
    vbe = pnjlim(vbe, this.vbeOld, this.p.nf * VT, this.vcBE, ctx);
    vbc = pnjlim(vbc, this.vbcOld, this.p.nr * VT, this.vcBC, ctx);
    this.vbeOld = vbe;
    this.vbcOld = vbc;
    const o = this.out;
    bjtEval(this.p, vbe, vbc, o);
    stamp3(A, b, this.P, R, pol, o[0], o[1], o[2], o[3], o[4], o[5], vbe, vbc);
  }
  initState(x) {
    const R = this.R;
    this.vbeOld = this.pol * (x[R[1]] - x[R[2]]);
    this.vbcOld = this.pol * (x[R[1]] - x[R[0]]);
  }
  info(x) {
    const R = this.R;
    const pol = this.pol;
    const vbe = pol * (x[R[1]] - x[R[2]]);
    const vbc = pol * (x[R[1]] - x[R[0]]);
    const o = this.out;
    bjtEval(this.p, vbe, vbc, o);
    const vce = vbe - vbc;
    let region = 'active';
    if ((vbe <= 0.05 && vbc <= 0.05) || Math.abs(o[0]) < 1e-9) region = 'cutoff';
    else if (vbc > 0.05) region = vbe > 0.05 ? 'saturation' : 'reverse';
    return {
      Vbe: pol * vbe, Vce: pol * vce, Ic: pol * o[0], Ib: pol * o[1],
      beta: o[1] !== 0 ? o[0] / o[1] : 0, gm: o[2], region,
    };
  }
}
