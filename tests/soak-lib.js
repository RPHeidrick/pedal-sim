/**
 * Shared by tools/soak.js (long run) and tests/robustness.test.js (short run):
 * run one pedal with sweeping knobs and a hot input, and count anything that went wrong.
 */
import fs from 'node:fs';
import { loadNetlist } from '../engine/parsers/elaborate.js';
import { Circuit } from '../engine/js/circuit.js';
import { Oversampler } from '../engine/js/oversample.js';
import { WasmEngine } from '../engine/wasm/wasm-engine.js';

let wasm = null;
const engine = () => wasm || (wasm = new WasmEngine(fs.readFileSync(new URL('../engine/wasm/pedal-engine.wasm', import.meta.url))));

/** A deterministic random number generator, so a failure can be repeated exactly. */
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/**
 * @param {string} netlist
 * @param {{seconds?: number, engine?: 'wasm'|'js', oversample?: number, seed?: number}} opts
 * @returns {{peak: number, nonFinite: number, failures: number, ms: number}}
 */
export function soakPedal(netlist, { seconds = 1, engine: which = 'wasm', oversample = 4, seed = 1 } = {}) {
  const FS = 48000, L = oversample, BLOCK = 128;
  const d = loadNetlist(netlist);
  if (!d.ok) throw new Error(d.diagnostics.map((x) => x.message).join('; '));
  const pots = d.controls.map((c, i) => [c, i]).filter(([c]) => c.kind === 'pot');
  const rand = rng(seed);
  let run, setKnob, failures;
  if (which === 'wasm') {
    const e = engine();
    const h = e.create(d, d.controls.map((c) => c.value), FS, L);
    run = (buf) => e.process(h, buf);
    setKnob = (i, v) => e.setControl(h, i, v);
    failures = () => { const f = e.failures(h); e.destroy(h); return f; };
  } else {
    const c = new Circuit(d, { sampleRate: FS * L });
    d.controls.forEach((x, i) => c.setControl(i, x.value, true));
    c.reset();
    const os = new Oversampler(L), up = new Float64Array(L), hi = new Float64Array(L);
    run = (buf) => { for (let i = 0; i < buf.length; i++) { os.up(buf[i], up); for (let k = 0; k < L; k++) hi[k] = c.step(up[k]); buf[i] = os.down(hi); } };
    setKnob = (i, v) => c.setControl(i, v, false);
    failures = () => c.stats.failures;
  }
  const buf = new Float64Array(BLOCK);
  let peak = 0, nonFinite = 0, t = 0;
  const t0 = performance.now();
  const blocks = Math.ceil((seconds * FS) / BLOCK);
  for (let b = 0; b < blocks; b++) {
    // every ~50 ms a knob jumps somewhere new, sometimes to the very ends
    if (b % 19 === 0 && pots.length) {
      const [, i] = pots[Math.floor(rand() * pots.length)];
      const r = rand();
      setKnob(i, r < 0.15 ? 0 : r > 0.85 ? 1 : rand());
    }
    // a hot guitar: chords and single notes up to about 2 V peak, with sudden silences
    for (let k = 0; k < BLOCK; k++, t++) {
      const s = t / FS, bar = Math.floor(s / 0.5);
      const level = bar % 7 === 6 ? 0 : 0.3 + 1.7 * ((bar * 7919) % 11) / 10;
      const env = Math.exp(-4 * (s % 0.5));
      buf[k] = level * env * (Math.sin(2 * Math.PI * 82.4 * s) + 0.6 * Math.sin(2 * Math.PI * 123.5 * s) + 0.4 * Math.sin(2 * Math.PI * 329.6 * s)) / 2;
    }
    run(buf);
    for (let k = 0; k < BLOCK; k++) {
      const y = buf[k];
      if (!Number.isFinite(y)) nonFinite++;
      else if (Math.abs(y) > peak) peak = Math.abs(y);
    }
  }
  return { peak, nonFinite, failures: failures(), ms: performance.now() - t0 };
}
