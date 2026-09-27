// Audio path checks for the real-time chain (site/audio/pedal-worklet.js),
// run in Node with a stand-in for the browser's AudioWorklet globals.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadNetlist } from '../engine/parsers/elaborate.js';

globalThis.sampleRate = 48000;
globalThis.currentTime = 0;
let Chain;
globalThis.registerProcessor = (name, cls) => { Chain = cls; };
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: (m) => this.sent.push(m) }; this.sent = []; } };
await import('../site/audio/pedal-worklet.js');

const load = (f) => loadNetlist(fs.readFileSync(new URL(`../circuits/${f}`, import.meta.url), 'utf8'), { fileName: f });
function run(chain, input) {
  const out = new Float32Array(input.length);
  for (let i = 0; i + 128 <= input.length; i += 128) {
    const o = [new Float32Array(128), new Float32Array(128)];
    chain.process([[input.subarray(i, i + 128)]], [o]);
    out.set(o[0], i);
    globalThis.currentTime += 128 / 48000;
  }
  return out;
}
const sine = (f, a, n) => Float32Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / 48000));

test('peak limiter keeps the output under full scale even when driven 40 dB too hot', () => {
  const c = new Chain();
  c.onMessage({ type: 'settings', inGain: 1, outGain: 100, cab: 'off' });
  const out = run(c, sine(220, 0.5, 48000));
  const peak = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  assert.ok(peak <= 1, `peak ${peak}`);
  const stats = c.sent.filter((m) => m.type === 'stats');
  assert.ok(stats.some((s) => s.limitDb < -30), 'limiter reports its gain reduction');
});

const LOOKAHEAD = Math.round(0.0015 * 48000); // the limiter delays the audio this many samples

test('limiter is transparent below its ceiling (only a 1.5 ms delay)', () => {
  const c = new Chain();
  c.onMessage({ type: 'settings', inGain: 1, outGain: 1, cab: 'off' });
  const x = sine(440, 0.5, 9600);
  const out = run(c, x);
  for (let i = 0; i + LOOKAHEAD < x.length; i++) assert.ok(Math.abs(out[i + LOOKAHEAD] - x[i]) < 1e-6);
});

test('safety cap: nothing gets past -12 dBFS, and a hard pick attack is eased down, not chopped', () => {
  const c = new Chain();
  c.onMessage({ type: 'settings', inGain: 1, outGain: 1, cab: 'off', ceiling: -12 });
  const x = new Float32Array(9600);
  for (let i = 4800; i < x.length; i++) x[i] = 0.9 * Math.sin((2 * Math.PI * 330 * i) / 48000) * Math.exp(-(i - 4800) / 4000);
  const out = run(c, x);
  const cap = Math.pow(10, -12 / 20);
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  assert.ok(peak <= cap * 1.0001, `peak ${peak} vs cap ${cap}`);
  // with look-ahead the gain is already down when the attack arrives: the first
  // cycle keeps its sine shape (a zero look-ahead limiter would square it off)
  const first = out.subarray(4800 + LOOKAHEAD, 4800 + LOOKAHEAD + 145);
  const top = first.reduce((m, v) => Math.max(m, v), 0);
  const nearTop = first.filter((v) => v > 0.98 * top).length;
  assert.ok(nearTop < 12, `flat-topped: ${nearTop} samples within 2% of the peak`);
});

test('speaker cabinet is level matched at 1 kHz and rolls off fizz above 8 kHz', () => {
  for (const cab of ['1x12', '4x12']) {
    const level = (f) => {
      const c = new Chain();
      c.onMessage({ type: 'settings', inGain: 1, outGain: 1, cab });
      const out = run(c, sine(f, 0.1, 24000)).subarray(12000);
      return Math.sqrt(out.reduce((s, v) => s + v * v, 0) / out.length) / (0.1 / Math.SQRT2);
    };
    assert.ok(Math.abs(20 * Math.log10(level(1000))) < 0.5, `${cab} 1 kHz`);
    assert.ok(20 * Math.log10(level(8000)) < -12, `${cab} 8 kHz`);
  }
});

test('a passive pedal skips oversampling; a fuzz uses the chosen amount', () => {
  const c = new Chain();
  c.onMessage({ type: 'settings', oversample: 4 });
  const stack = load('tone-stack.cir'), fuzz = load('germanium-fuzz.cir');
  c.onMessage({ type: 'add', uid: 1, desc: stack, controls: stack.controls.map((k) => k.value), bypass: false });
  c.onMessage({ type: 'add', uid: 2, desc: fuzz, controls: fuzz.controls.map((k) => k.value), bypass: false });
  assert.equal(c.pedals[0].L, 1);
  assert.equal(c.pedals[1].L, 4);
});

test('live input uses the channel the guitar is on', () => {
  const c = new Chain();
  c.onMessage({ type: 'settings', inGain: 1, outGain: 1, cab: 'off', inputMode: 'loudest' });
  const x = sine(440, 0.3, 128), silent = new Float32Array(128);
  let o;
  for (let k = 0; k < 20; k++) { o = [new Float32Array(128), new Float32Array(128)]; c.process([[silent, x]], [o]); }
  const k = 100; // output lags the input by the limiter's look-ahead; the block repeats
  assert.ok(Math.abs(o[0][k] - x[(k - LOOKAHEAD + 128) % 128]) < 1e-6, 'full level from input 2, not halved');
});
