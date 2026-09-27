#!/usr/bin/env node
/**
 * Measures the level match each starter board needs so it peaks near -6 dBFS
 * with the power chord riff sample and the 1x12 speaker, the way the site plays it.
 * Prints a suggested `level` for each board in site/board/presets.js.
 *
 *   node tools/preset-levels.js
 */
import fs from 'node:fs';
import { loadNetlist } from '../engine/parsers/elaborate.js';
import { STARTER_PEDALS } from '../circuits/index.js';
import { PRESETS } from '../site/board/presets.js';
import { SAMPLES } from '../site/inputs/samples.js';

globalThis.sampleRate = 48000;
globalThis.currentTime = 0;
let Chain;
globalThis.registerProcessor = (n, c) => { Chain = c; };
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: () => {} }; } };
await import('../site/audio/pedal-worklet.js');

/** 16 or 24-bit PCM WAV -> Float32Array (first channel), linearly resampled to 48 kHz. */
function readWav(file) {
  const b = fs.readFileSync(file);
  let o = 12, fmt = null, data = null;
  while (o < b.length) {
    const id = b.toString('ascii', o, o + 4), size = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(o + 10), rate: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === 'data') data = b.subarray(o + 8, o + 8 + size);
    o += 8 + size + (size & 1);
  }
  if (!fmt || (fmt.bits !== 16 && fmt.bits !== 24)) throw new Error(`${file}: expected 16 or 24-bit PCM`);
  const bytes = fmt.bits / 8, n = data.length / bytes / fmt.ch, x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const at = i * bytes * fmt.ch;
    x[i] = bytes === 2 ? data.readInt16LE(at) / 32768 : data.readIntLE(at, 3) / 8388608;
  }
  const r = fmt.rate / 48000, m = Math.floor(n / r), y = new Float32Array(m);
  for (let i = 0; i < m; i++) { const p = i * r, k = Math.floor(p), f = p - k; y[i] = x[k] * (1 - f) + (x[Math.min(n - 1, k + 1)] || 0) * f; }
  return y;
}

const inputs = {};
const inputFor = (id) => {
  if (!inputs[id]) {
    const smp = SAMPLES.find((s) => s.id === id);
    inputs[id] = readWav(new URL(`../samples/${smp.file.split('/').pop()}`, import.meta.url)).map((v) => v * smp.gain);
  }
  return inputs[id];
};

for (const preset of PRESETS) {
  const input = inputFor(preset.measure || 'power-chords');
  const c = new Chain();
  const probe = 0.01; // tiny output gain keeps the limiter out of the measurement
  c.onMessage({ type: 'settings', inGain: 0.5, outGain: probe, oversample: 2, cab: '1x12' });
  preset.pedals.forEach((pp, uid) => {
    const variants = STARTER_PEDALS.filter((p) => p.family === pp.key || p.id === pp.key);
    const v = variants[pp.variant || 0];
    const desc = loadNetlist(fs.readFileSync(new URL(`../circuits/${v.file}`, import.meta.url), 'utf8'), { fileName: v.file });
    c.onMessage({ type: 'add', uid, desc, controls: desc.controls.map((k) => (pp.values[k.label] ?? k.value)), bypass: false });
  });
  let peak = 0;
  for (let i = 0; i + 128 <= input.length; i += 128) {
    const o = [new Float32Array(128), new Float32Array(128)];
    c.process([[input.subarray(i, i + 128)]], [o]);
    if (i > 48000 * 0.3) for (const s of o[0]) peak = Math.max(peak, Math.abs(s));
  }
  const vol = Math.max(-30, Math.min(18, Math.round(-6 - 20 * Math.log10(peak / probe))));
  console.log(`${preset.id.padEnd(8)} peak ${(peak / probe).toFixed(3)} V  ->  level: ${vol}   (now ${preset.level})`);
}
