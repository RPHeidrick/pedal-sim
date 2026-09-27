/**
 * Input cleanup for a live guitar: runs on the audio thread, on the raw signal from the
 * interface or cable, BEFORE the pedals. (Samples and files are clean already and skip it.)
 *
 *   raw input ─► high pass ─► hum canceller ─► hiss low pass ─► noise gate ─► pedals
 *
 * 1. High pass, 25 Hz (2nd order): removes DC offset and rumble below the lowest bass
 *    note (41 Hz), which would otherwise push fuzz circuits off their bias point.
 *
 * 2. Hum canceller: single coil pickups are antennas for the mains field (60 Hz in the
 *    US, 50 Hz in Europe) and its harmonics (120, 180, 240 ... Hz: the "buzz"). A plain
 *    notch filter would also carve a hole in any guitar note near those frequencies.
 *    Instead this is an adaptive canceller (LMS, the same idea as noise cancelling
 *    headphones): for each harmonic it generates a clean sine and cosine at exactly that
 *    frequency, learns how much of each is in the signal, and subtracts only that. It
 *    behaves like a notch about 0.5 Hz wide that follows the hum's phase and level, so a
 *    guitar note even 2 Hz away passes untouched. The mains frequency and which harmonics
 *    are present are measured in the guitar setup (site/inputs/input-check.js).
 *
 * 3. Hiss low pass, 10 kHz (2nd order): a guitar pickup puts out almost nothing above
 *    about 6 kHz (a real guitar cable rolls it off too), but a cheap converter's hiss is
 *    spread evenly up to 24 kHz. Cutting there removes hiss without dulling the guitar.
 *
 * 4. Noise gate (a downward expander): when you stop playing, the remaining noise is
 *    turned down smoothly instead of chopped. Threshold = measured noise floor + a margin,
 *    so it opens on the softest pick attack. Hold 60 ms and a slow release keep note tails
 *    natural. This matters most before a fuzz, which amplifies noise as much as the guitar.
 *
 * Cost: about 60 multiply-adds per sample with 12 hum harmonics, well under 1% of a core.
 * No latency: every stage works sample by sample.
 */

/** Second order filter (RBJ cookbook), transposed direct form II. */
class Biquad {
  constructor(type, f, Q, fs) {
    const w = (2 * Math.PI * f) / fs, cw = Math.cos(w), al = Math.sin(w) / (2 * Q);
    let b0, b1, b2;
    if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; } else { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
    const a0 = 1 + al;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = (-2 * cw) / a0; this.a2 = (1 - al) / a0;
    this.z1 = 0; this.z2 = 0;
  }
  run(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

/** Gate strengths: how far the noise is turned down when you are not playing. */
export const GATE_RANGES = { off: 0, light: -12, medium: -24, strong: -48 };

export const DEFAULT_CLEANUP = {
  enabled: true,
  hpHz: 25,              // high pass corner
  lpHz: 10000,           // hiss low pass corner (0 = off)
  humHz: 0,              // measured mains frequency, 0 = no hum canceller
  harmonics: [],         // which multiples of humHz to cancel, e.g. [1, 2, 3, 5]
  humWidthHz: 0.5,       // width of each "notch"
  gate: 'medium',        // off | light | medium | strong
  gateDb: -60,           // gate threshold in dBFS of the raw input (set by the setup)
};

export class InputCleanup {
  constructor(fs) {
    this.fs = fs;
    this.configure(DEFAULT_CLEANUP);
  }

  /** Apply new settings (from the guitar setup or the Input panel). Filter memory is kept where it can be. */
  configure(opts) {
    const o = this.opts = { ...DEFAULT_CLEANUP, ...(this.opts || {}), ...opts };
    const fs = this.fs;
    this.hp = new Biquad('hp', o.hpHz, Math.SQRT1_2, fs);
    this.lp = o.lpHz > 0 && o.lpHz < fs * 0.45 ? new Biquad('lp', o.lpHz, Math.SQRT1_2, fs) : null;

    // hum canceller: one oscillator + two learned weights per harmonic
    const hs = o.humHz > 0 ? o.harmonics.filter((k) => k >= 1 && k * o.humHz < fs * 0.45) : [];
    const m = hs.length;
    this.nh = m;
    this.cs = new Float64Array(m); this.sn = new Float64Array(m);   // current cos / sin of each reference
    this.rc = new Float64Array(m); this.rs = new Float64Array(m);   // rotation per sample (cos, sin of the step)
    this.w1 = new Float64Array(m); this.w2 = new Float64Array(m);   // learned amplitude of cos / sin
    for (let i = 0; i < m; i++) {
      const step = (2 * Math.PI * hs[i] * o.humHz) / fs;
      this.rc[i] = Math.cos(step); this.rs[i] = Math.sin(step);
      this.cs[i] = 1; this.sn[i] = 0;
    }
    // LMS step size from the notch width: width (Hz) ≈ mu * fs / pi for unit references
    this.mu = (Math.PI * o.humWidthHz) / fs;
    this.renorm = 0;

    // gate / expander
    this.gateRange = Math.pow(10, (GATE_RANGES[o.gate] ?? 0) / 20); // gain when fully closed
    this.thresh = Math.pow(10, o.gateDb / 20);
    this.env = 0; this.g = 1; this.hold = 0;
    this.envRel = Math.exp(-1 / (0.05 * fs));   // envelope follower release, 50 ms
    this.gAtt = Math.exp(-1 / (0.001 * fs));    // gate opens in about 1 ms
    this.gRel = Math.exp(-1 / (0.15 * fs));     // and closes over about 150 ms
    this.holdN = Math.round(0.06 * fs);         // stays open 60 ms after the signal drops
  }

  /** Clean `n` samples of `buf` in place. Returns nothing; `gateOpen` says whether you were heard. */
  process(buf, n) {
    const o = this.opts;
    if (!o.enabled) { this.gateOpen = true; return; }
    const hp = this.hp, lp = this.lp, m = this.nh, mu2 = 2 * this.mu;
    const cs = this.cs, sn = this.sn, rc = this.rc, rs = this.rs, w1 = this.w1, w2 = this.w2;
    const useGate = this.gateRange < 1;
    let env = this.env, g = this.g, hold = this.hold;
    for (let i = 0; i < n; i++) {
      // A converter delivers -1..+1. Anything wilder (a glitch, a broken driver) is clamped,
      // so it cannot knock the filters and the hum canceller off for seconds afterwards.
      let x = buf[i];
      x = x > 2 ? 2 : x < -2 ? -2 : x === x ? x : 0;
      x = hp.run(x);

      // hum: estimate = sum of learned sine/cosine mixes; subtract it; learn from what is left
      if (m) {
        let est = 0;
        for (let k = 0; k < m; k++) est += w1[k] * cs[k] + w2[k] * sn[k];
        const e = x - est;
        for (let k = 0; k < m; k++) {
          // learn, but never more hum than a quarter of full scale (real hum is far below)
          w1[k] = Math.max(-0.25, Math.min(0.25, w1[k] + mu2 * e * cs[k]));
          w2[k] = Math.max(-0.25, Math.min(0.25, w2[k] + mu2 * e * sn[k]));
          // advance the reference oscillator by one sample (a rotation, no sin() calls)
          const c = cs[k] * rc[k] - sn[k] * rs[k];
          sn[k] = sn[k] * rc[k] + cs[k] * rs[k];
          cs[k] = c;
        }
        x = e;
      }

      if (lp) x = lp.run(x);

      if (useGate) {
        // envelope: instant attack, 50 ms release
        const a = x < 0 ? -x : x;
        env = a > env ? a : env * this.envRel;
        let target;
        if (env >= this.thresh) { target = 1; hold = this.holdN; }
        else if (hold > 0) { target = 1; hold--; }
        else {
          // below threshold: 1:4 downward expansion, never below the chosen range
          const r = env / this.thresh;
          target = Math.max(this.gateRange, r * r * r);
        }
        g = target > g ? target + (g - target) * this.gAtt : target + (g - target) * this.gRel;
        x *= g;
      }
      buf[i] = x;
    }
    this.env = env; this.g = g; this.hold = hold;
    this.gateOpen = g > 0.5;
    // Rounding slowly changes an oscillator's amplitude; pull it back to exactly 1 now and then.
    if (m && ++this.renorm >= 64) {
      this.renorm = 0;
      for (let k = 0; k < m; k++) { const r = 1 / Math.hypot(cs[k], sn[k]); cs[k] *= r; sn[k] *= r; }
    }
  }
}
