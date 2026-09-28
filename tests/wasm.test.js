import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadNetlist } from '../engine/parsers/elaborate.js';
import { Circuit } from '../engine/js/circuit.js';
import { Oversampler } from '../engine/js/oversample.js';
import { WasmEngine } from '../engine/wasm/wasm-engine.js';
import { pluck, sine } from '../engine/js/signals.js';

const wasmPath = new URL('../engine/wasm/pedal-engine.wasm', import.meta.url);
const pedals = ['rp-fuzz-si', 'rp-fuzz-ge', 'blues-od', 'germanium-fuzz', 'op-amp-drive', 'jfet-boost', 'tone-stack', 'phaser', 'tremolo'];

/** Reference: the JavaScript engine, wired exactly like the C++ Processor (oversampler + 5 Hz DC block). */
function jsRender(desc, controls, input, fs, L) {
  const c = new Circuit(desc, { sampleRate: fs * L });
  controls.forEach((v, i) => c.setControl(i, v, true));
  c.reset();
  const os = new Oversampler(L);
  os.reset(0);
  const dc = c.x[c.outIdx];
  if (L > 1) os.downHist.fill(dc);
  const up = new Float64Array(L), hi = new Float64Array(L);
  let hpX = dc, hpY = 0;
  const a = Math.exp((-2 * Math.PI * 5) / fs);
  const out = new Float64Array(input.length);
  for (let i = 0; i < input.length; i++) {
    os.up(input[i], up);
    for (let k = 0; k < L; k++) hi[k] = c.step(up[k]);
    const y = os.down(hi);
    const hp = a * (hpY + y - hpX); hpX = y; hpY = hp;
    out[i] = hp;
  }
  return out;
}

test('C++ engine matches the JavaScript engine sample for sample on every library pedal', { skip: !fs.existsSync(wasmPath) && 'pedal-engine.wasm not built' }, () => {
  const eng = new WasmEngine(fs.readFileSync(wasmPath));
  const fs0 = 48000;
  const n = 9600; // 0.2 s
  const input = new Float64Array(n);
  const p = pluck(fs0, n / fs0, 110, 0.3);
  const s = sine(fs0, n / fs0, 440, 0.1);
  for (let i = 0; i < n; i++) input[i] = p[i] + s[i];
  for (const id of pedals) {
    const desc = loadNetlist(fs.readFileSync(new URL(`../circuits/${id}.cir`, import.meta.url), 'utf8'));
    const ctl = desc.controls.map((c) => c.value);
    for (const L of [1, 2, 4]) {
      const ref = jsRender(desc, ctl, input, fs0, L);
      const h = eng.create(desc, ctl, fs0, L);
      const got = Float64Array.from(input);
      eng.process(h, got);
      eng.destroy(h);
      let peak = 0, err = 0;
      for (let i = 0; i < n; i++) { peak = Math.max(peak, Math.abs(ref[i])); err = Math.max(err, Math.abs(ref[i] - got[i])); }
      assert.ok(peak > 1e-4, `${id}: silent output`);
      const db = 20 * Math.log10(Math.max(err, 1e-300) / peak);
      if (process.env.VERBOSE) console.log(`${id.padEnd(18)} ${L}x  peak ${peak.toFixed(3)} V  max diff ${err.toExponential(2)} V  (${db.toFixed(0)} dB)`);
      // Newton stops within 0.01% (reltol); last-bit libm differences may shift which iteration it stops on.
      assert.ok(db < -60, `${id} ${L}x: max difference ${err.toExponential(2)} V vs peak ${peak.toFixed(3)} V (${db.toFixed(0)} dB)`);
    }
  }
});
