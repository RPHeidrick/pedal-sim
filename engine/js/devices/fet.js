/**
 * Field effect transistors.
 *
 * JFET (Shichman-Hodges, SPICE level 1), N and P channel:
 *   Vgs <= VTO                   Id = 0
 *   0 < Vds < Vgs-VTO (linear)   Id = BETA*Vds*(2(Vgs-VTO) - Vds)*(1 + LAMBDA*Vds)
 *   Vds >= Vgs-VTO (saturation)  Id = BETA*(Vgs-VTO)^2*(1 + LAMBDA*Vds)
 *   Gate-source and gate-drain junctions are diodes with IS, N.
 *
 * MOSFET level 1 (Shichman-Hodges), N and P channel, KP*W/L = beta:
 *   linear      Id = beta*Vds*(Vgs-VTO - Vds/2)*(1 + LAMBDA*Vds)
 *   saturation  Id = beta/2*(Vgs-VTO)^2*(1 + LAMBDA*Vds)
 *   Body effect is ignored (bulk assumed tied to source). No gate current.
 *
 * Both are symmetric: for Vds < 0 drain and source swap roles.
 * RD and RS add internal nodes. Capacitances are not modelled.
 */

import { VT, GMIN, safeExp, safeExpD, pnjlim, vcrit, fetlim } from './common.js';
import { positions3, stamp3 } from './stamp3.js';

/**
 * Drain current in normal mode. Returns id, writes [gm, gds] to o.
 * @param {number} k  JFET: beta; MOSFET: beta/2 (so both share "k*vov^2" in saturation)
 * @param {boolean} mos use the MOSFET linear-region expression
 */
function channel(k, vto, lambda, vgs, vds, mos, o) {
  const vov = vgs - vto;
  if (vov <= 0) { o[0] = 0; o[1] = 0; return 0; }
  const cl = 1 + lambda * vds;
  if (vds >= vov) {
    o[0] = 2 * k * vov * cl;
    o[1] = k * vov * vov * lambda;
    return k * vov * vov * cl;
  }
  // linear region: k*vds*(2*vov - vds) (both JFET and MOS once k = beta or beta/2)
  const f = vds * (2 * vov - vds);
  o[0] = 2 * k * vds * cl;
  o[1] = k * (2 * vov - 2 * vds) * cl + k * f * lambda;
  return k * f * cl;
}

/**
 * Evaluate a FET at control voltages (vgs, vgd), device polarity.
 * out = [id, ig, did/dvgs, did/dvgd, dig/dvgs, dig/dvgd]
 * id is current into the drain terminal, ig into the gate.
 */
export function fetEval(p, vgs, vgd, out, tmp) {
  const vds = vgs - vgd;
  let ids, dvgs, dvgd;
  if (vds >= 0) {
    ids = channel(p.k, p.vto, p.lambda, vgs, vds, p.mos, tmp);
    dvgs = tmp[0] + tmp[1];
    dvgd = -tmp[1];
  } else {
    ids = -channel(p.k, p.vto, p.lambda, vgd, -vds, p.mos, tmp);
    dvgs = tmp[1];
    dvgd = -tmp[0] - tmp[1];
  }
  // tiny drain-source conductance keeps Newton well-posed in cutoff
  ids += GMIN * vds;
  dvgs += GMIN;
  dvgd -= GMIN;

  let igs = 0, ggs = 0, igd = 0, ggd = 0;
  if (p.is > 0) {
    const nvt = p.n * VT;
    igs = p.is * (safeExp(vgs / nvt) - 1) + GMIN * vgs;
    ggs = (p.is * safeExpD(vgs / nvt)) / nvt + GMIN;
    igd = p.is * (safeExp(vgd / nvt) - 1) + GMIN * vgd;
    ggd = (p.is * safeExpD(vgd / nvt)) / nvt + GMIN;
  }
  out[0] = ids - igd;
  out[1] = igs + igd;
  out[2] = dvgs;
  out[3] = dvgd - ggd;
  out[4] = ggs;
  out[5] = ggd;
}

export function jfetParams(m, area = 1) {
  return {
    k: (m.beta ?? 1e-4) * area, vto: m.vto ?? -2, lambda: m.lambda ?? 0,
    is: (m.is ?? 1e-14) * area, n: m.n ?? 1,
    rd: (m.rd ?? 0) / area, rs: (m.rs ?? 0) / area, mos: false,
  };
}

export function mosParams(m, w = 1, l = 1, pol = 1) {
  const kp = m.kp ?? 2e-5;
  return {
    k: (kp * (w / l)) / 2, vto: pol * (m.vto ?? 0), lambda: m.lambda ?? 0,
    is: 0, n: 1, rd: m.rd ?? 0, rs: m.rs ?? 0, mos: true,
  };
}

class FET {
  constructor(el, ctx, p) {
    this.name = el.name;
    this.pol = el.polarity || 1;
    this.p = p;
    [this.d, this.g, this.s] = el.nodes.slice(0, 3).map((n) => ctx.node(n));
    this.di = p.rd > 0 ? ctx.internal(`${el.name}#d`) : this.d;
    this.si = p.rs > 0 ? ctx.internal(`${el.name}#s`) : this.s;
    this.vc = p.is > 0 ? vcrit(p.is, p.n * VT) : Infinity;
    this.vgsOld = 0;
    this.vgdOld = 0;
    this.out = new Float64Array(6);
    this.tmp = new Float64Array(2);
  }
  bind(ctx) {
    this.P = positions3(ctx, this.di, this.g, this.si);
    this.R = Int32Array.of(ctx.rhs(this.di), ctx.rhs(this.g), ctx.rhs(this.si));
    const series = [];
    if (this.di !== this.d) series.push([this.d, this.di, this.p.rd]);
    if (this.si !== this.s) series.push([this.s, this.si, this.p.rs]);
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
    const vG = x[R[1]];
    let vgs = pol * (vG - x[R[2]]);
    let vgd = pol * (vG - x[R[0]]);
    vgs = fetlim(vgs, this.vgsOld, this.p.vto, ctx);
    vgd = fetlim(vgd, this.vgdOld, this.p.vto, ctx);
    if (this.p.is > 0) {
      const nvt = this.p.n * VT;
      vgs = pnjlim(vgs, this.vgsOld, nvt, this.vc, ctx);
      vgd = pnjlim(vgd, this.vgdOld, nvt, this.vc, ctx);
    }
    this.vgsOld = vgs;
    this.vgdOld = vgd;
    const o = this.out;
    fetEval(this.p, vgs, vgd, o, this.tmp);
    stamp3(A, b, this.P, R, pol, o[0], o[1], o[2], o[3], o[4], o[5], vgs, vgd);
  }
  initState(x) {
    const R = this.R;
    this.vgsOld = this.pol * (x[R[1]] - x[R[2]]);
    this.vgdOld = this.pol * (x[R[1]] - x[R[0]]);
  }
  info(x) {
    const R = this.R;
    const pol = this.pol;
    const vgs = pol * (x[R[1]] - x[R[2]]);
    const vgd = pol * (x[R[1]] - x[R[0]]);
    const o = this.out;
    fetEval(this.p, vgs, vgd, o, this.tmp);
    const vds = vgs - vgd;
    const vov = (vds >= 0 ? vgs : vgd) - this.p.vto;
    const region = vov <= 0 ? 'cutoff' : Math.abs(vds) >= vov ? 'saturation' : 'linear';
    return { Vgs: pol * vgs, Vds: pol * vds, Id: pol * o[0], Ig: pol * o[1], gm: o[2] + o[3] + o[5], region };
  }
}

export class JFET extends FET {
  constructor(el, ctx) { super(el, ctx, jfetParams(el.model, el.area || 1)); }
}

export class MOSFET extends FET {
  constructor(el, ctx) {
    super(el, ctx, mosParams(el.model, el.w ?? 1, el.l ?? 1, el.polarity || 1));
  }
}
