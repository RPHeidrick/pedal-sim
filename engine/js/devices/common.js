/**
 * Shared constants and helpers for device models.
 */

/** Thermal voltage kT/q at 27 C (SPICE nominal temperature). */
export const VT = 0.025864186;

/** Minimum conductance added across every junction, as in SPICE. */
export const GMIN = 1e-12;

/** Largest exponent argument before linear continuation (prevents overflow). */
const EXP_LIM = 80;
const EXP_LIM_VAL = Math.exp(EXP_LIM);

/**
 * exp() with linear continuation above EXP_LIM so Newton never sees Infinity.
 * Returns [value, derivative] packed via the out array to avoid allocation.
 */
export function safeExp(x) {
  return x < EXP_LIM ? Math.exp(x) : EXP_LIM_VAL * (1 + x - EXP_LIM);
}
export function safeExpD(x) {
  return x < EXP_LIM ? Math.exp(x) : EXP_LIM_VAL;
}

/** Critical voltage used by pnjlim: the point where the junction's exponential gets steep. */
export function vcrit(is, nvt) {
  return nvt * Math.log(nvt / (Math.SQRT2 * is));
}

/**
 * SPICE3 pn-junction voltage limiting. Keeps Newton from stepping far up the
 * exponential in a single iteration. Returns the limited voltage; sets
 * state.limited = true when it had to intervene.
 */
export function pnjlim(vnew, vold, nvt, vc, state) {
  if (vnew > vc && Math.abs(vnew - vold) > 2 * nvt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / nvt;
      vnew = arg > 0 ? vold + nvt * Math.log(arg) : vc;
    } else {
      vnew = nvt * Math.log(vnew / nvt);
    }
    state.limited = true;
  }
  return vnew;
}

/** Simple step limiter for FET gate voltages (SPICE fetlim, simplified). */
export function fetlim(vnew, vold, vto, state) {
  const vtstlo = Math.abs(vold - vto) + 1;
  const delta = vnew - vold;
  const max = Math.max(vtstlo, 0.5);
  if (Math.abs(delta) > max) {
    state.limited = true;
    return vold + Math.sign(delta) * max;
  }
  return vnew;
}

/** Limit a drain-source step (SPICE limvds, simplified). */
export function limvds(vnew, vold, state) {
  if (vold >= 3.5) {
    if (vnew > vold) { if (vnew > 3 * vold + 2) { state.limited = true; return 3 * vold + 2; } }
    else if (vnew < 3.5) { const v = Math.max(vnew, 2); if (v !== vnew) state.limited = true; return v; }
  } else {
    if (vnew > vold) { if (vnew > 4) { state.limited = true; return 4; } }
    else if (vnew < -0.5) { state.limited = true; return -0.5; }
  }
  return vnew;
}
