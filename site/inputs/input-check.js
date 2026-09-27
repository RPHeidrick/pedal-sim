/**
 * Input check: measures a live guitar signal and works out how to clean it up.
 * Used by the guitar setup's "Level and noise" step (site/inputs/guitar-setup.js).
 * Pure functions on arrays of samples, so the tests can run them in Node.
 *
 * The protocol:
 *   1. Quiet: 3 seconds with the strings muted. Everything recorded is noise, so we can
 *      measure it: its overall level, whether there is mains hum (50 or 60 Hz, and at
 *      exactly what frequency), which hum harmonics stand out, and how much hiss.
 *   2. Loud: 4 seconds of your loudest playing. Gives the peak level.
 *   3. Recommend: input gain so your loudest playing peaks where the samples do,
 *      a hum canceller tuned to the hum that was found, and a noise gate threshold
 *      just above the noise that is left after the cleanup.
 */
import { InputCleanup } from '../audio/input-cleanup.js';

const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const rms = (x) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, x.length)); };

/**
 * Amplitude of the component at frequency f (Goertzel algorithm: one bin of a Fourier
 * transform, at any frequency, without computing all the others). A sine of amplitude A
 * gives A back.
 */
export function toneAmplitude(x, f, fs) {
  const w = (2 * Math.PI * f) / fs, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < x.length; i++) { const s0 = x[i] + c * s1 - s2; s2 = s1; s1 = s0; }
  const re = s1 - s2 * Math.cos(w), im = s2 * Math.sin(w);
  return (2 * Math.hypot(re, im)) / x.length;
}

/** Remove DC and rumble so the measurements are not thrown off by an offset. */
function highpassed(x, fs) {
  const c = new InputCleanup(fs);
  c.configure({ humHz: 0, harmonics: [], lpHz: 0, gate: 'off' });
  const y = Float64Array.from(x);
  c.process(y, y.length);
  return y;
}

const MAX_HARMONIC = 16;

/**
 * Find mains hum in a recording of silence.
 * @returns {{hz:number, harmonics:number[], levelDb:number} | null}
 */
export function findHum(x, fs) {
  const best = { score: 0 };
  for (const base of [50, 60]) {
    // mains is never exactly 50/60: search ±0.3 Hz, using the first 8 harmonics together
    for (let f0 = base - 0.3; f0 <= base + 0.3001; f0 += 0.02) {
      let score = 0;
      for (let k = 1; k <= 8; k++) { const a = toneAmplitude(x, k * f0, fs); score += a * a; }
      if (score > best.score) Object.assign(best, { score, f0 });
    }
  }
  if (!best.f0) return null;
  const f0 = best.f0;
  // a harmonic counts when it stands at least 12 dB above the noise right next to it
  const harmonics = [];
  let power = 0;
  for (let k = 1; k <= MAX_HARMONIC; k++) {
    const f = k * f0;
    if (f > fs * 0.45) break;
    const a = toneAmplitude(x, f, fs);
    const around = [-9, -7, -5, -3.5, 3.5, 5, 7, 9].map((d) => toneAmplitude(x, f + d, fs)).sort((p, q) => p - q);
    const floor = (around[3] + around[4]) / 2 || 1e-12; // median of the neighbours
    if (a > floor * 4) { harmonics.push(k); power += a * a; } // 4x amplitude = 12 dB
  }
  if (!harmonics.length) return null;
  return { hz: Math.round(f0 * 100) / 100, harmonics, levelDb: db(Math.sqrt(power / 2)) };
}

/**
 * Measure the quiet recording.
 * @returns {{noiseDb, hum, cleanNoiseDb, cleanPeakDb, hissDb}}
 *   noiseDb       RMS of everything, dBFS
 *   hum           what findHum found (or null)
 *   cleanNoiseDb  RMS left after the hum canceller and hiss filter
 *   cleanPeakDb   loudest noise peak left (what the gate must stay closed for)
 *   hissDb        RMS above 5 kHz (converter hiss)
 */
export function analyzeQuiet(raw, fs) {
  const x = highpassed(raw, fs);
  const hum = findHum(x, fs);
  const c = new InputCleanup(fs);
  c.configure({ humHz: hum ? hum.hz : 0, harmonics: hum ? hum.harmonics : [], gate: 'off' });
  const y = Float64Array.from(raw);
  c.process(y, y.length);
  // A string still ringing (or a tap on the guitar) is not noise. Split the recording into
  // 50 ms pieces and measure the noise only in the quietest third of them. The first half
  // second is skipped: the hum canceller needs a moment to lock on.
  const win = Math.round(0.05 * fs), skip = Math.round(0.5 * fs);
  const pieces = [];
  for (let o = skip; o + win <= y.length; o += win) pieces.push({ o, e: rms(y.subarray(o, o + win)) });
  pieces.sort((a, b) => a.e - b.e);
  const quietest = pieces.slice(0, Math.max(1, Math.floor(pieces.length / 3)));
  const pick = (arr) => { const out = []; for (const p of quietest) out.push(...arr.subarray(p.o, p.o + win)); return Float64Array.from(out); };
  const before = pick(x), after = pick(y);
  const sorted = Float64Array.from(after, Math.abs).sort();
  const p999 = sorted[Math.floor(sorted.length * 0.999)] || 0;
  // hiss: what is left above 5 kHz
  const hi = new InputCleanup(fs);
  hi.configure({ hpHz: 5000, humHz: 0, harmonics: [], lpHz: 0, gate: 'off' });
  const h = Float64Array.from(raw); hi.process(h, h.length);
  // a quiet part that was not quiet at all (strings ringing throughout) is worth a warning
  const ringing = rms(y.subarray(skip)) > 4 * rms(after);
  return { noiseDb: db(rms(before)), hum, cleanNoiseDb: db(rms(after)), cleanPeakDb: db(p999), hissDb: db(rms(h)), ringing };
}

/** Measure the loud recording: the peak (after the high pass, so an offset does not count). */
export function analyzeLoud(raw, fs) {
  const x = highpassed(raw, fs);
  let peak = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; }
  let rawPeak = 0;
  for (let i = 0; i < raw.length; i++) { const a = Math.abs(raw[i]); if (a > rawPeak) rawPeak = a; }
  return { peakDb: db(peak), clipped: rawPeak > 0.98 };
}

/**
 * Loudest playing should peak where the samples do: about -4 dBFS after the input gain
 * (the samples peak at up to 0.8 of full scale, which the input stage turns into a few
 * hundred millivolts, like a real pickup).
 */
export const TARGET_PEAK_DB = -4;
export const GAIN_LIMITS = [-18, 40];

/**
 * Turn the two measurements into settings and plain-words advice.
 * @returns {{inGainDb, cleanup, snrDb, humReductionDb, advice: string[]}}
 */
export function recommend(quiet, loud) {
  const advice = [];
  const inGainDb = Math.max(GAIN_LIMITS[0], Math.min(GAIN_LIMITS[1], Math.round((TARGET_PEAK_DB - loud.peakDb) * 2) / 2));
  // gate threshold: 4 dB above the loudest noise that is left, but always at least 30 dB
  // below your loudest playing so soft notes and long tails still get through
  const gateDb = Math.min(quiet.cleanPeakDb + 4, loud.peakDb - 30);
  const snrDb = loud.peakDb - quiet.noiseDb;
  const cleanSnrDb = loud.peakDb - quiet.cleanNoiseDb;
  const humReductionDb = quiet.noiseDb - quiet.cleanNoiseDb;
  const cleanup = {
    enabled: true,
    humHz: quiet.hum ? quiet.hum.hz : 0,
    harmonics: quiet.hum ? quiet.hum.harmonics : [],
    gateDb: Number.isFinite(gateDb) ? Math.round(gateDb * 10) / 10 : -70,
    gate: cleanSnrDb > 60 ? 'light' : 'medium',
  };

  if (quiet.ringing) advice.push('The strings were ringing during the quiet part, so the measurement used only its quietest moments. For the best result, rest your hand on the strings and check again.');
  if (loud.clipped) advice.push('Your loudest playing hit the top of the converter (clipping). Turn the input volume in your computer\'s sound settings down a little and check again.');
  if (loud.peakDb < -40) advice.push('The guitar is very quiet. Turn the guitar\'s volume knob all the way up, and raise the input volume in your computer\'s sound settings (a USB guitar cable: try 100).');
  else if (inGainDb >= GAIN_LIMITS[1]) advice.push('The signal needed the maximum boost. Raising the input volume in your computer\'s sound settings will lower the noise.');
  if (quiet.hum) {
    advice.push(`Mains hum found at ${quiet.hum.hz.toFixed(2)} Hz (${quiet.hum.harmonics.length} harmonic${quiet.hum.harmonics.length === 1 ? '' : 's'}). The hum canceller removes it${humReductionDb > 1 ? `: about ${Math.round(humReductionDb)} dB quieter` : ''}.`);
    if (snrDb < 45) advice.push('Single coil pickups pick up hum from screens, lights and chargers. Face away from the monitor, try the in-between pickup positions (2 or 4 on a five way switch: they cancel hum), and try the laptop unplugged from its charger.');
  }
  if (cleanSnrDb < 40) advice.push('There is still a lot of noise compared with your playing. The noise gate will hide it between notes; a proper audio interface will be much quieter than a USB cable.');
  return { inGainDb, cleanup, snrDb: Math.round(snrDb), cleanSnrDb: Math.round(cleanSnrDb), humReductionDb: Math.round(humReductionDb), advice };
}
