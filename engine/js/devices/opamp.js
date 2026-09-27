/**
 * Op amp macromodel: finite gain, single dominant pole (GBW), slew limit,
 * soft rail clipping referenced to the actual supply pins, output resistance.
 *
 *   in+ ── Rin ── in-            vd = V(in+) - V(in-)
 *   gain node "int" (normalised, ground referenced):
 *         I = Imax*tanh(vd/Imax)  into  R1 = AOL  ||  C1 = 1/(2*pi*GBW)
 *         -> small-signal gain AOL, unity-gain frequency GBW,
 *            max dV(int)/dt = Imax/C1 = SR
 *         anti-windup: softplus clamps hold int just beyond the swing
 *   output: Vout = Vmid + sat(V(int)) through ROUT, where
 *         Vmid = (V+ + V-)/2 and sat() limits to V+ - dropHi / V- + dropLo.
 *
 * At DC the transconductance is linear (slew limiting is a dynamic effect and
 * its saturation would starve Newton of loop gain). Supply voltages enter
 * sat() lagged by one Newton iteration (no Jacobian terms); pedal supplies are
 * stiff sources so this converges immediately. Supply current draw is not
 * modelled. 3-pin op amps get fixed +/-15 V rails.
 */

import { Resistor, Capacitor } from './linear.js';

const SAT_K = 4;        // knee sharpness of the rail clipping
const CLAMP_G = 1;      // S, clamp slope beyond the knee
const CLAMP_W = 0.02;   // V, softplus knee width
const CLAMP_SCALE = 1.6; // clamp sits at 1.6x the swing (sat() output is ~96% of the rail there)

/** Smooth saturation y = x/(1+|x/h|^k)^(1/k); writes dy/dx to o[0]. */
export function softSat(x, h, o) {
  // SAT_K = 4, so the powers reduce to multiplies and square roots (Math.pow is slow).
  const u = x / h;
  const u2 = u * u;
  const base = 1 + u2 * u2;
  const inv4 = 1 / Math.sqrt(Math.sqrt(base)); // base^(-1/4)
  o[0] = inv4 / base;                          // base^(-5/4)
  return x * inv4;
}

/** softplus w*ln(1+exp(u/w)) and its derivative (logistic). */
function softplus(u, o) {
  const z = u / CLAMP_W;
  if (z > 40) { o[0] = 1; return u; }
  if (z < -40) { o[0] = 0; return 0; }
  const e = Math.exp(z);
  o[0] = e / (1 + e);
  return CLAMP_W * Math.log1p(e);
}

/** Factory: returns the macromodel as a list of primitive devices. */
export function createOpamp(el, ctx) {
  const p = el.params;
  const intNode = `${el.name}#int`;
  const c1 = 1 / (2 * Math.PI * p.gbw);
  return [
    new Resistor({ name: `${el.name}#rin`, nodes: [el.nodes[0], el.nodes[1]], value: p.rin }, ctx),
    new Resistor({ name: `${el.name}#r1`, nodes: [intNode, '0'], value: p.aol }, ctx),
    new Capacitor({ name: `${el.name}#c1`, nodes: [intNode, '0'], value: c1 }, ctx),
    new OpampCore(el, ctx, intNode, c1),
  ];
}

export class OpampCore {
  constructor(el, ctx, intNode, c1) {
    this.name = el.name;
    const [inp, inn, vp, vn, out] = el.nodes;
    this.inp = ctx.node(inp);
    this.inn = ctx.node(inn);
    this.vp = vp == null ? null : ctx.node(vp);
    this.vn = vn == null ? null : ctx.node(vn);
    this.out = ctx.node(out);
    this.int = ctx.node(intNode);
    const p = el.params;
    this.imax = p.sr * c1; // gm = 1 S, so tanh saturates at the slew-limited current
    this.gout = 1 / p.rout;
    this.dropHi = p.dropHi;
    this.dropLo = p.dropLo;
    this.o = new Float64Array(1);
  }
  bind(ctx) {
    const { inp, inn, out } = this;
    const nt = this.int;
    this.pIntP = ctx.pos(nt, inp);
    this.pIntN = ctx.pos(nt, inn);
    this.pIntInt = ctx.pos(nt, nt);
    this.pOutOut = ctx.pos(out, out);
    this.pOutInt = ctx.pos(out, nt);
    this.rInp = ctx.rhs(inp);
    this.rInn = ctx.rhs(inn);
    this.rInt = ctx.rhs(nt);
    this.rOut = ctx.rhs(out);
    this.rVp = this.vp == null ? -1 : ctx.rhs(this.vp);
    this.rVn = this.vn == null ? -1 : ctx.rhs(this.vn);
  }
  stampStatic(G) {
    G[this.pOutOut] += this.gout;
  }
  rails(x) {
    const vcc = this.rVp < 0 ? 15 : x[this.rVp];
    const vee = this.rVn < 0 ? -15 : x[this.rVn];
    const mid = 0.5 * (vcc + vee);
    const hHi = Math.max(vcc - this.dropHi - mid, 0.05);
    const hLo = Math.max(mid - vee - this.dropLo, 0.05);
    return [mid, hHi, hLo];
  }
  load(x, A, b, ctx) {
    // Transconductance stage into the gain node.
    const vd = x[this.rInp] - x[this.rInn];
    let i, g;
    if (ctx.mode === 'dc') { i = vd; g = 1; }
    else {
      const th = Math.tanh(vd / this.imax);
      i = this.imax * th;
      g = 1 - th * th;
    }
    A[this.pIntP] -= g;
    A[this.pIntN] += g;
    b[this.rInt] += i - g * vd;

    const [mid, hHi, hLo] = this.rails(x);
    const vint = x[this.rInt];
    const o = this.o;

    // Anti-windup: current leaving int = G*(softplus(vint - cHi) - softplus(-cLo - vint))
    const cHi = CLAMP_SCALE * hHi;
    const cLo = CLAMP_SCALE * hLo;
    const sHi = softplus(vint - cHi, o);
    const dHi = o[0];
    const sLo = softplus(-cLo - vint, o);
    const dLo = o[0];
    const ic = CLAMP_G * (sHi - sLo);
    const gc = CLAMP_G * (dHi + dLo);
    A[this.pIntInt] += gc;
    b[this.rInt] -= ic - gc * vint;

    // Output stage: I_out = gout*(Vout - mid - sat(vint)).
    const y = softSat(vint, vint >= 0 ? hHi : hLo, o);
    const dy = o[0];
    A[this.pOutInt] -= this.gout * dy;
    b[this.rOut] += this.gout * (mid + y - dy * vint);
  }
  info(x) {
    const [mid, hHi, hLo] = this.rails(x);
    const vint = x[this.rInt];
    const y = softSat(vint, vint >= 0 ? hHi : hLo, this.o);
    return {
      Vdiff: x[this.rInp] - x[this.rInn], Vout: x[this.rOut], Vtarget: mid + y,
      swing: `${(mid - hLo).toFixed(2)}..${(mid + hHi).toFixed(2)}`,
      region: Math.abs(y) > 0.9 * (vint >= 0 ? hHi : hLo) ? 'clipping' : 'linear',
    };
  }
}
