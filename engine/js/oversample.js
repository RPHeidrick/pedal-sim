/**
 * Polyphase FIR oversampling (interpolate by L, decimate by L).
 *
 * One linear-phase lowpass (Kaiser-windowed sinc) is used for both
 * directions. Cutoff sits just under the base-rate Nyquist so the circuit's
 * aliasing products above it are removed before decimation. Latency is
 * (taps-1)/L base-rate samples in total (half each way).
 *
 * Plain typed arrays, no allocation per sample.
 */

function besselI0(x) {
  let sum = 1;
  let term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 50; k++) {
    term *= q / (k * k);
    sum += term;
    if (term < sum * 1e-16) break;
  }
  return sum;
}

/**
 * Design a lowpass FIR (normalised to the high rate).
 * @param {number} taps odd count
 * @param {number} cutoff cycles/sample at the high rate (0..0.5)
 * @param {number} beta Kaiser beta (8 ~ -80 dB stopband)
 */
export function designLowpass(taps, cutoff, beta = 8) {
  const h = new Float64Array(taps);
  const m = (taps - 1) / 2;
  const i0b = besselI0(beta);
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const t = i - m;
    const sinc = t === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * t) / (Math.PI * t);
    const r = t / m;
    const w = besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / i0b;
    h[i] = sinc * w;
    sum += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum;
  return h;
}

export class Oversampler {
  /**
   * @param {number} factor 1, 2, 3 or 4 (any integer works)
   * @param {number} [tapsPerPhase] filter length per polyphase branch
   */
  constructor(factor, tapsPerPhase = 24) {
    this.L = Math.max(1, factor | 0);
    const L = this.L;
    if (L === 1) { this.latency = 0; return; }
    let taps = L * tapsPerPhase;
    if (taps % 2 === 0) taps += 1;
    this.taps = taps;
    // passband edge at 0.45 of the base rate (e.g. 21.6 kHz at 48k)
    this.h = designLowpass(taps, 0.47 / L, 9);
    this.P = Math.ceil(taps / L); // taps per phase
    // polyphase table for interpolation: phase p uses h[p + L*k]
    this.poly = new Float64Array(L * this.P);
    for (let p = 0; p < L; p++) {
      for (let k = 0; k < this.P; k++) {
        const idx = p + L * k;
        this.poly[p * this.P + k] = idx < taps ? this.h[idx] * L : 0;
      }
    }
    this.upHist = new Float64Array(this.P * 2);
    this.upPos = 0;
    this.downHist = new Float64Array(taps * 2);
    this.downPos = 0;
    // base-rate samples, up + down; decimation keeps the last sample of each block
    this.latency = (taps - 1) / L - (L - 1) / L;
  }

  /** Interpolate one base-rate sample into L high-rate samples (out[0..L-1]). */
  up(x, out) {
    const L = this.L;
    if (L === 1) { out[0] = x; return; }
    const P = this.P;
    // circular buffer mirrored so a contiguous read of P values is always valid
    this.upPos = (this.upPos + P - 1) % P;
    this.upHist[this.upPos] = x;
    this.upHist[this.upPos + P] = x;
    const hist = this.upHist;
    const base = this.upPos;
    const poly = this.poly;
    for (let p = 0; p < L; p++) {
      let acc = 0;
      const o = p * P;
      for (let k = 0; k < P; k++) acc += poly[o + k] * hist[base + k];
      out[p] = acc;
    }
  }

  /** Decimate L high-rate samples (in[0..L-1]) to one base-rate sample. */
  down(inp) {
    const L = this.L;
    if (L === 1) return inp[0];
    const N = this.taps;
    const hist = this.downHist;
    for (let p = 0; p < L; p++) {
      this.downPos = (this.downPos + N - 1) % N;
      hist[this.downPos] = inp[p];
      hist[this.downPos + N] = inp[p];
    }
    const h = this.h;
    const base = this.downPos;
    let acc = 0;
    for (let k = 0; k < N; k++) acc += h[k] * hist[base + k];
    return acc;
  }

  reset(value = 0) {
    if (this.L === 1) return;
    this.upHist.fill(value);
    this.downHist.fill(value);
  }
}
