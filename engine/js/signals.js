/**
 * Test signals in volts (a passive guitar pickup peaks around 0.1-0.5 V).
 * DOM-free: used by tests, the CLI renderer and the browser bench.
 */

export function sine(sampleRate, seconds, freq, amplitude) {
  const n = Math.round(sampleRate * seconds);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return out;
}

/**
 * Karplus-Strong plucked string: a guitar-like test note with a sharp attack
 * and a decaying, harmonically rich tail. Deterministic (seeded noise).
 */
export function pluck(sampleRate, seconds, freq, amplitude, seed = 1) {
  const n = Math.round(sampleRate * seconds);
  const out = new Float64Array(n);
  const period = Math.max(2, Math.round(sampleRate / freq));
  const buf = new Float64Array(period);
  let s = seed >>> 0;
  for (let i = 0; i < period; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    buf[i] = s / 4294967296 - 0.5;
  }
  // soften the excitation (pick position / finger)
  for (let pass = 0; pass < 2; pass++) for (let i = 1; i < period; i++) buf[i] = 0.5 * (buf[i] + buf[i - 1]);
  let peak = 0;
  let idx = 0;
  for (let i = 0; i < n; i++) {
    const next = (idx + 1) % period;
    const y = buf[idx];
    buf[idx] = 0.996 * 0.5 * (buf[idx] + buf[next]);
    idx = next;
    out[i] = y;
    peak = Math.max(peak, Math.abs(y));
  }
  const g = amplitude / (peak || 1);
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

/** A strummed E major chord built from plucks with small offsets. */
export function chord(sampleRate, seconds, amplitude) {
  const freqs = [82.41, 123.47, 164.81, 207.65, 246.94, 329.63];
  const n = Math.round(sampleRate * seconds);
  const out = new Float64Array(n);
  freqs.forEach((f, k) => {
    const p = pluck(sampleRate, seconds, f, 1, k + 3);
    const off = Math.round(k * 0.012 * sampleRate);
    for (let i = off; i < n; i++) out[i] += p[i - off] / freqs.length;
  });
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < n; i++) out[i] *= amplitude / (peak || 1);
  return out;
}

/**
 * Harmonic analysis of a steady periodic signal: amplitudes of harmonics
 * 1..count (single-bin DFT over whole periods of the second half) and THD.
 */
export function harmonics(signal, sampleRate, freq, count = 10) {
  const per = sampleRate / freq;
  const cycles = Math.floor(signal.length / per / 2);
  const len = Math.round(cycles * per);
  const start = signal.length - len;
  const amps = [];
  for (let h = 1; h <= count; h++) {
    let re = 0;
    let im = 0;
    const w = (2 * Math.PI * freq * h) / sampleRate;
    for (let i = 0; i < len; i++) {
      re += signal[start + i] * Math.cos(w * i);
      im += signal[start + i] * Math.sin(w * i);
    }
    amps.push((2 * Math.hypot(re, im)) / len);
  }
  const thd = Math.sqrt(amps.slice(1).reduce((a, v) => a + v * v, 0)) / (amps[0] || 1e-30);
  return { amps, thd };
}
