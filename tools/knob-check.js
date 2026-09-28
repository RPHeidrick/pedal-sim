#!/usr/bin/env node
/**
 * Knob check: turns every knob of every library pedal from 0 to 1 (the others at their
 * defaults) and measures what really changes, so the knob descriptions on the site can be
 * checked against the circuit instead of guessed.
 *
 *   node tools/knob-check.js            table for every pedal
 *   node tools/knob-check.js blues-od   one pedal
 *
 * For each knob position it prints, for a 220 Hz note at 0.2 V (a typical pickup):
 *   level   output level in dB (loudness)
 *   dirt    harmonic distortion in % (how much grit)
 *   bright  spectral centroid in Hz (higher = brighter)
 * and, for a quiet three tone test (100 Hz, 700 Hz, 3 kHz), the level of each band
 * (bass, mid, treble) in dB, which is what tone controls change.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadNetlist } from '../engine/parsers/elaborate.js';
import { render } from '../engine/js/analysis.js';
import { STARTER_PEDALS } from '../circuits/index.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FS = 48000;
const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));

/** Amplitude of the component at `f` (single bin DFT over whole periods). */
function tone(x, f) {
  const n = Math.floor(Math.floor((x.length * f) / FS) * (FS / f));
  let re = 0, im = 0;
  for (let i = 0; i < n; i++) { const p = (2 * Math.PI * f * i) / FS; re += x[i] * Math.cos(p); im -= x[i] * Math.sin(p); }
  return (2 * Math.hypot(re, im)) / n;
}

export function measure(desc, controls, amp = 0.2) {
  const N = Math.round(0.25 * FS), skip = Math.round(0.1 * FS);
  // 1. a 220 Hz note: level, distortion, brightness
  const sine = new Float32Array(N);
  for (let i = 0; i < N; i++) sine[i] = amp * Math.sin((2 * Math.PI * 220 * i) / FS);
  const y = render(desc, sine, { sampleRate: FS, oversample: 2, controls }).output.subarray(skip);
  const h = [];
  for (let k = 1; k <= 20; k++) h.push(tone(y, 220 * k));
  const rms = Math.sqrt(h.reduce((a, v) => a + v * v, 0) / 2);
  const thd = Math.sqrt(h.slice(1).reduce((a, v) => a + v * v, 0)) / Math.max(h[0], 1e-12);
  const centroid = h.reduce((a, v, k) => a + v * v * 220 * (k + 1), 0) / Math.max(h.reduce((a, v) => a + v * v, 0), 1e-18);
  // 2. three quiet tones: bass / mid / treble response (quiet, so a drive stays near linear)
  const tri = new Float32Array(N);
  for (let i = 0; i < N; i++) tri[i] = 0.01 * (Math.sin((2 * Math.PI * 100 * i) / FS) + Math.sin((2 * Math.PI * 700 * i) / FS) + Math.sin((2 * Math.PI * 3000 * i) / FS));
  const z = render(desc, tri, { sampleRate: FS, oversample: 2, controls }).output.subarray(skip);
  return { level: db(rms), thd: 100 * thd, bright: centroid, bass: db(tone(z, 100) / 0.01), mid: db(tone(z, 700) / 0.01), treble: db(tone(z, 3000) / 0.01) };
}

function checkPedal(p) {
  const text = fs.readFileSync(path.join(ROOT, 'circuits', p.file), 'utf8');
  const desc = loadNetlist(text, { fileName: p.file });
  if (!desc.ok) { console.log(`${p.id}: does not load`); return; }
  console.log(`\n== ${p.name} (${p.file})`);
  const defaults = desc.controls.map((c) => c.value);
  for (const c of desc.controls.filter((x) => x.kind === 'pot')) {
    console.log(`  ${c.label} (default ${c.value})`);
    console.log('    pos    level dB   dirt %   bright Hz   bass   mid   treble');
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      const ctl = defaults.slice(); ctl[c.id] = v;
      const m = measure(desc, ctl);
      console.log(`    ${v.toFixed(2)}   ${m.level.toFixed(1).padStart(7)}  ${m.thd.toFixed(1).padStart(7)}  ${m.bright.toFixed(0).padStart(9)}  ${m.bass.toFixed(1).padStart(6)} ${m.mid.toFixed(1).padStart(5)} ${m.treble.toFixed(1).padStart(7)}`);
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const only = process.argv[2];
  for (const p of STARTER_PEDALS) if (!only || p.id.includes(only)) checkPedal(p);
}
