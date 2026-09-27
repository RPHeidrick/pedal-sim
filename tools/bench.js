#!/usr/bin/env node
/**
 * Engine speed test: how much of one CPU core each pedal needs in real time, for the
 * C++ (WebAssembly) engine the site uses and the JavaScript fallback.
 *
 *   node tools/bench.js            (every library pedal and Workshop template, 4x oversampling)
 *
 * "Load" is processing time divided by the length of the audio: 25% means one second of
 * guitar takes a quarter of a second to compute, so four such pedals fill one core.
 */
import fs from 'node:fs';
import { loadNetlist } from '../engine/parsers/elaborate.js';
import { Circuit } from '../engine/js/circuit.js';
import { Oversampler } from '../engine/js/oversample.js';
import { WasmEngine } from '../engine/wasm/wasm-engine.js';
import { TEMPLATES, buildNetlist } from '../site/workshop/templates.js';

const FS = 48000, L = Number(process.argv[2]) || 4, SECONDS = 2;
const input = new Float64Array(FS * SECONDS);
for (let i = 0; i < input.length; i++) { // a plucked chord shape: several decaying partials, 0.3 V peak
  const t = i / FS, env = Math.exp(-3 * (t % 1));
  input[i] = 0.3 * env * (Math.sin(2 * Math.PI * 110 * t) + 0.5 * Math.sin(2 * Math.PI * 165 * t) + 0.3 * Math.sin(2 * Math.PI * 247 * t)) / 1.8;
}
const eng = new WasmEngine(fs.readFileSync(new URL('../engine/wasm/pedal-engine.wasm', import.meta.url)));
const circuits = [
  ...fs.readdirSync(new URL('../circuits/', import.meta.url)).filter((f) => f.endsWith('.cir')).map((f) => [f.replace('.cir', ''), fs.readFileSync(new URL(`../circuits/${f}`, import.meta.url), 'utf8')]),
  ...TEMPLATES.map((t) => [`workshop ${t.id}`, buildNetlist(t, {}, t.name)]),
];
console.log(`${L}x oversampling, ${SECONDS} s of audio at ${FS} Hz\n`);
console.log('pedal'.padEnd(22), 'C++ load', ' JS load', ' speed-up', ' Newton iter/step');
for (const [name, text] of circuits) {
  const d = loadNetlist(text);
  const ctl = d.controls.map((c) => c.value);
  // C++
  const h = eng.create(d, ctl, FS, L);
  const buf = Float64Array.from(input);
  let t0 = performance.now(); eng.process(h, buf); const tw = performance.now() - t0;
  const iters = eng.iterations(h) / (input.length * L);
  eng.destroy(h);
  // JavaScript
  const c = new Circuit(d, { sampleRate: FS * L }); ctl.forEach((v, i) => c.setControl(i, v, true)); c.reset();
  const os = new Oversampler(L); const up = new Float64Array(L), hi = new Float64Array(L);
  t0 = performance.now();
  for (let i = 0; i < input.length; i++) { os.up(input[i], up); for (let k = 0; k < L; k++) hi[k] = c.step(up[k]); os.down(hi); }
  const tj = performance.now() - t0;
  const pct = (ms) => `${((ms / 1000 / SECONDS) * 100).toFixed(1)}%`.padStart(8);
  console.log(name.padEnd(22), pct(tw), pct(tj), `${(tj / tw).toFixed(1)}x`.padStart(9), iters.toFixed(2).padStart(10));
}
