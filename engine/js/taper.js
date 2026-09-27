/**
 * Potentiometer tapers. A taper maps knob rotation (0 = fully CCW, 1 = fully
 * CW) to the fraction of the track resistance between lug 1 and the wiper.
 *
 *   lin  : fraction = rot
 *   log  : audio ("A") taper, exponential curve reaching ~10% at mid rotation
 *   rlog : reverse audio ("C") taper, mirror image of log
 */

export const LOG_BASE = 81; // (B^0.5 - 1)/(B - 1) = 0.1  -> 10% at 12 o'clock

export function taper(kind, rot) {
  const r = rot < 0 ? 0 : rot > 1 ? 1 : rot;
  switch (kind) {
    case 'log': return (Math.pow(LOG_BASE, r) - 1) / (LOG_BASE - 1);
    case 'rlog': return 1 - (Math.pow(LOG_BASE, 1 - r) - 1) / (LOG_BASE - 1);
    default: return r;
  }
}

export function inverseTaper(kind, frac) {
  const f = frac < 0 ? 0 : frac > 1 ? 1 : frac;
  switch (kind) {
    case 'log': return Math.log(1 + f * (LOG_BASE - 1)) / Math.log(LOG_BASE);
    case 'rlog': return 1 - Math.log(1 + (1 - f) * (LOG_BASE - 1)) / Math.log(LOG_BASE);
    default: return f;
  }
}
