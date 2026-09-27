/**
 * Guitar tuner: finds the pitch of what the pedals receive (autocorrelation with the YIN
 * difference function, good from low E to the top frets) and names the nearest note.
 */
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** @returns {number|null} frequency in Hz, or null when there is no clear note */
export function detectPitch(x, sampleRate, { minHz = 60, maxHz = 1200, threshold = 0.12 } = {}) {
  let rms = 0; for (let i = 0; i < x.length; i++) rms += x[i] * x[i];
  rms = Math.sqrt(rms / x.length);
  if (rms < 0.004) return null; // too quiet
  const maxLag = Math.min(Math.floor(sampleRate / minHz), Math.floor(x.length / 2));
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  const W = x.length - maxLag;
  const d = new Float32Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i < W; i++) { const v = x[i] - x[i + lag]; s += v * v; }
    d[lag] = s;
  }
  // cumulative mean normalised difference
  let run = 0, lag = -1;
  const cm = new Float32Array(maxLag + 1); cm[0] = 1;
  for (let l = 1; l <= maxLag; l++) { run += d[l]; cm[l] = run ? (d[l] * l) / run : 1; }
  for (let l = minLag; l <= maxLag; l++) {
    if (cm[l] < threshold) { while (l + 1 <= maxLag && cm[l + 1] < cm[l]) l++; lag = l; break; }
  }
  if (lag < 0) return null;
  // parabolic interpolation around the dip
  const a = cm[lag - 1] ?? cm[lag], b = cm[lag], c = cm[lag + 1] ?? cm[lag];
  const den = a - 2 * b + c;
  const shift = den ? (0.5 * (a - c)) / den : 0;
  return sampleRate / (lag + shift);
}

export function describePitch(hz) {
  const midi = 69 + 12 * Math.log2(hz / 440);
  const n = Math.round(midi);
  return { hz, midi: n, name: NAMES[((n % 12) + 12) % 12], octave: Math.floor(n / 12) - 1, cents: Math.round((midi - n) * 100) };
}

/** Standard tuning, low to high, for the "which string" hint. */
export const STRINGS = [
  { n: 6, name: 'E', midi: 40 }, { n: 5, name: 'A', midi: 45 }, { n: 4, name: 'D', midi: 50 },
  { n: 3, name: 'G', midi: 55 }, { n: 2, name: 'B', midi: 59 }, { n: 1, name: 'e', midi: 64 },
];
export function nearestString(midiFloat) {
  return STRINGS.reduce((b, s) => (Math.abs(s.midi - midiFloat) < Math.abs(b.midi - midiFloat) ? s : b));
}
