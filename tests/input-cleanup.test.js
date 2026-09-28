/**
 * Live guitar input cleanup (site/audio/input-cleanup.js) and the noise check that sets it
 * up (site/inputs/input-check.js), tested on a realistic bad signal: a real DI guitar
 * recording at a quiet USB cable level, plus single coil style mains hum (60.03 Hz and odd
 * and even harmonics), converter hiss and a DC offset.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { InputCleanup } from '../site/audio/input-cleanup.js';
import { analyzeQuiet, analyzeLoud, recommend, findHum, toneAmplitude, TARGET_PEAK_DB } from '../site/inputs/input-check.js';
import { encodeWavFloat } from '../site/inputs/wav-file.js';

const FS = 48000;
const rmsDb = (x) => { let s = 0; for (const v of x) s += v * v; return 20 * Math.log10(Math.sqrt(s / x.length)); };
const seg = (x, a, b) => x.subarray(Math.floor(a * FS), Math.floor(b * FS));

function readWav24(url) {
  const b = fs.readFileSync(url);
  let o = 12, data;
  while (o < b.length) { const id = b.toString('ascii', o, o + 4), size = b.readUInt32LE(o + 4); if (id === 'data') data = b.subarray(o + 8, o + 8 + size); o += 8 + size + (size & 1); }
  const x = new Float64Array(data.length / 3);
  for (let i = 0; i < x.length; i++) x[i] = data.readIntLE(i * 3, 3) / 8388608;
  return x;
}

// the guitar: 6 s of the CC0 riff, peaking at -26 dBFS like a quiet USB cable
const riff = readWav24(new URL('../samples/cc0-power-chords.wav', import.meta.url)).subarray(0, FS * 6);
const riffPeak = riff.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const guitar = riff.map((v) => (v * 0.05) / riffPeak);

// the noise: hum with harmonics, hiss and an offset
const HUM = 60.03;
const HARMONICS = [[1, 3e-3], [2, 1e-3], [3, 1.5e-3], [5, 8e-4], [7, 4e-4], [9, 2e-4]];
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5);
const noiseAt = (i) => { const t = i / FS; let h = 0; for (const [k, a] of HARMONICS) h += a * Math.sin(2 * Math.PI * k * HUM * t + k); return h + rnd() * 6e-4 + 0.002; };

// a 12 s take: 3 s silence, 6 s playing, 3 s silence
const clean = new Float64Array(FS * 12), take = new Float64Array(FS * 12);
for (let i = 0; i < take.length; i++) { const g = i - FS * 3; clean[i] = g >= 0 && g < guitar.length ? guitar[g] : 0; take[i] = clean[i] + noiseAt(i); }

const quiet = analyzeQuiet(take.subarray(0, FS * 3), FS);
const loud = analyzeLoud(take.subarray(FS * 3, FS * 7), FS);
const rec = recommend(quiet, loud);

test('the noise check finds the hum: frequency and which harmonics', () => {
  assert.ok(quiet.hum, 'no hum found');
  assert.ok(Math.abs(quiet.hum.hz - HUM) < 0.05, `hum at ${quiet.hum.hz} Hz`);
  assert.deepEqual(quiet.hum.harmonics, HARMONICS.map(([k]) => k));
});

test('50 Hz hum (Europe) is told apart from 60 Hz', () => {
  const x = Float64Array.from({ length: FS * 3 }, (_, i) => 2e-3 * Math.sin(2 * Math.PI * 49.97 * i / FS) + 1e-3 * Math.sin(2 * Math.PI * 3 * 49.97 * i / FS) + rnd() * 3e-4);
  const h = findHum(x, FS);
  assert.ok(h && Math.abs(h.hz - 49.97) < 0.05, JSON.stringify(h));
  assert.deepEqual(h.harmonics, [1, 3]);
});

test('no hum is reported for plain hiss', () => {
  const x = Float64Array.from({ length: FS * 3 }, () => rnd() * 1e-3);
  assert.equal(findHum(x, FS), null);
});

test('the recommended input level makes the loudest playing peak where the samples do', () => {
  assert.ok(Math.abs(loud.peakDb + rec.inGainDb - TARGET_PEAK_DB) <= 0.5, `peak ${loud.peakDb} + gain ${rec.inGainDb}`);
  assert.equal(loud.clipped, false);
  assert.ok(rec.cleanup.gateDb < loud.peakDb - 29, 'gate threshold too close to the playing');
  assert.ok(rec.cleanup.gateDb > quiet.cleanPeakDb, 'gate threshold below the leftover noise');
});

// run the recommended cleanup over the whole take, in 128 sample blocks like the audio thread
const out = Float64Array.from(take);
const cleaner = new InputCleanup(FS);
cleaner.configure(rec.cleanup);
for (let o = 0; o < out.length; o += 128) cleaner.process(out.subarray(o, o + 128), Math.min(128, out.length - o));
// the reference: the clean guitar through the same filters, but no hum canceller and no gate
const ref = Float64Array.from(clean);
const refCleaner = new InputCleanup(FS);
refCleaner.configure({ ...rec.cleanup, humHz: 0, harmonics: [], gate: 'off' });
refCleaner.process(ref, ref.length);

test('between notes: the noise is at least 30 dB quieter', () => {
  const before = rmsDb(seg(take, 1.5, 2.9)), after = rmsDb(seg(out, 1.5, 2.9));
  assert.ok(before - after >= 30, `silence ${before.toFixed(1)} -> ${after.toFixed(1)} dB`);
  const tailBefore = rmsDb(seg(take, 10.5, 11.9)), tailAfter = rmsDb(seg(out, 10.5, 11.9));
  assert.ok(tailBefore - tailAfter >= 25, `after playing ${tailBefore.toFixed(1)} -> ${tailAfter.toFixed(1)} dB`);
});

test('while playing: noise at least 15 dB lower, and the guitar itself unchanged', () => {
  const rawNoise = rmsDb(seg(take, 4, 8).map((v, i) => v - clean[4 * FS + i]));
  const err = rmsDb(seg(out, 4, 8).map((v, i) => v - ref[4 * FS + i]));
  assert.ok(rawNoise - err >= 15, `noise while playing ${rawNoise.toFixed(1)} -> ${err.toFixed(1)} dB`);
  assert.ok(rmsDb(seg(ref, 4, 8)) - err >= 25, 'what is left is not far enough below the guitar');
});

test('guitar notes right next to the hum frequencies pass (the canceller is narrow)', () => {
  for (const f of [58, 59, 61, 62, 82.41, 110, 118, 123.47, 185, 246.9]) {
    const s = Float64Array.from({ length: FS * 4 }, (_, i) => 0.01 * Math.sin(2 * Math.PI * f * i / FS));
    const c = new InputCleanup(FS);
    c.configure({ ...rec.cleanup, gate: 'off', lpHz: 0 });
    c.process(s, s.length);
    const loss = 20 * Math.log10(0.01 / toneAmplitude(s.subarray(FS * 2), f, FS));
    assert.ok(loss < 0.6, `${f} Hz lost ${loss.toFixed(2)} dB`);
  }
});

test('the gate opens within a millisecond and adds no delay', () => {
  const c = new InputCleanup(FS);
  c.configure({ humHz: 0, harmonics: [], gate: 'strong', gateDb: -50 });
  const x = new Float64Array(FS);
  for (let i = FS / 2; i < FS; i++) x[i] = 0.05 * Math.sin(2 * Math.PI * 196 * i / FS);
  c.process(x, x.length);
  const at = FS / 2 + Math.round(0.002 * FS); // 2 ms after the pick attack
  const peak = x.subarray(at, at + 250).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  assert.ok(peak > 0.045, `only ${peak.toFixed(3)} of 0.05 after 2 ms`);
});

test('turned off, the cleanup leaves the signal exactly alone', () => {
  const c = new InputCleanup(FS);
  c.configure({ enabled: false });
  const x = take.slice(0, 4800), y = Float64Array.from(x);
  c.process(y, y.length);
  assert.deepEqual(y, x);
});

test('the cleanup never produces NaN, even from silence, a full scale square wave or huge values', () => {
  const c = new InputCleanup(FS);
  c.configure(rec.cleanup);
  const x = new Float64Array(FS * 2);
  for (let i = 0; i < x.length; i++) x[i] = i < FS / 2 ? 0 : i < FS ? (Math.floor(i / 50) % 2 ? 1 : -1) : i < 1.5 * FS ? 1e6 * Math.sin(i) : 0;
  for (let o = 0; o < x.length; o += 128) c.process(x.subarray(o, o + 128), 128);
  assert.ok(x.every(Number.isFinite));
  assert.ok(Math.abs(x[x.length - 1]) < 1, 'did not settle after the huge input');
});

test('test clip WAV: valid 32-bit float header and the exact samples', () => {
  const x = Float32Array.from([0, 0.5, -0.25, 1]);
  const v = new DataView(encodeWavFloat(x, 48000));
  assert.equal(String.fromCharCode(...[0, 1, 2, 3].map((i) => v.getUint8(i))), 'RIFF');
  assert.equal(v.getUint16(20, true), 3);
  assert.equal(v.getUint32(24, true), 48000);
  assert.deepEqual([0, 1, 2, 3].map((i) => v.getFloat32(44 + i * 4, true)), [0, 0.5, -0.25, 1]);
});

test('hiss reducer: treble hiss under quiet playing drops, bright playing passes', () => {
  const hissy = Float64Array.from({ length: FS * 2 }, () => rnd() * 6e-4);
  const run = (x, hiss) => { const c = new InputCleanup(FS); c.configure({ humHz: 0, harmonics: [], gate: 'off', gateDb: rec.cleanup.gateDb, hiss }); const y = Float64Array.from(x); c.process(y, y.length); return y; };
  const hp = (x) => { let lo = 0; const a = Math.exp((-2 * Math.PI * 4000) / FS); return x.map((v) => { lo = v + (lo - v) * a; return v - lo; }); };
  const off = rmsDb(hp(run(hissy, false)).subarray(FS)), on = rmsDb(hp(run(hissy, true)).subarray(FS));
  assert.ok(off - on >= 6, `treble hiss ${off.toFixed(1)} -> ${on.toFixed(1)} dB`);
  const bright = Float64Array.from({ length: FS }, (_, i) => 0.05 * Math.sin(2 * Math.PI * 4000 * i / FS));
  const a = toneAmplitude(run(bright, true).subarray(FS / 2), 4000, FS), b = toneAmplitude(run(bright, false).subarray(FS / 2), 4000, FS);
  assert.ok(Math.abs(20 * Math.log10(a / b)) < 0.3, `a bright note changed by ${(20 * Math.log10(a / b)).toFixed(2)} dB`);
});
