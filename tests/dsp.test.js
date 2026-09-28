// Digital models (chorus, flanger, delay, reverb): stable at every knob setting, never louder
// than a sensible limit, silent after silence, and described for the visitor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DSP_EFFECTS, createDsp, dspDesc } from '../site/audio/dsp-effects.js';
import { knobRole } from '../circuits/index.js';

const FS = 48000;
const run = (fx, input) => { const b = Float64Array.from(input); for (let k = 0; k < b.length; k += 128) fx.process(b.subarray(k, k + 128), Math.min(128, b.length - k)); return b; };
const pluckAt = (n) => Float64Array.from({ length: n }, (_, i) => { const t = i / FS; return t < 0.5 ? 0.5 * Math.exp(-5 * t) * Math.sin(2 * Math.PI * 147 * t) : 0; });

for (const e of DSP_EFFECTS) {
  test(`${e.id}: stable and bounded with every knob at 0, middle and full`, () => {
    for (const v of [0, 0.5, 1]) {
      const fx = createDsp(e.id, FS, e.controls.map(() => v));
      const y = run(fx, pluckAt(FS * 6));
      let pk = 0;
      for (const s of y) { assert.ok(Number.isFinite(s), `${e.id} at ${v}: not a number`); pk = Math.max(pk, Math.abs(s)); }
      assert.ok(pk < 2.5, `${e.id} at ${v}: peak ${pk.toFixed(2)} V`);
      // with the knobs full, the delay and reverb may still ring after 6 s, but never grow
      const tail = Math.max(...y.subarray(y.length - FS / 2).map(Math.abs));
      assert.ok(tail < 0.5, `${e.id} at ${v}: still ${tail.toFixed(2)} V at the end`);
    }
  });
  test(`${e.id}: every knob is explained, and the description matches the controls`, () => {
    const d = dspDesc(e.id);
    assert.equal(d.controls.length, e.controls.length);
    for (const c of d.controls) {
      assert.ok(knobRole(c.label), `${e.id}: ${c.label} has no role card`);
      const label = c.label.charAt(0) + c.label.slice(1).toLowerCase();
      assert.ok(e.knobs[label], `${e.id}: ${label} has no help text`);
    }
    assert.ok(/Digital model/.test(e.blurb), `${e.id}: the blurb must say it is a digital model`);
  });
}

test('delay: the Time knob sets the echo gap (60 ms to 800 ms)', () => {
  for (const [v, ms] of [[0, 60], [1, 800]]) {
    const fx = createDsp('delay', FS, [v, 0, 1]);
    const x = new Float64Array(FS); x[0] = 1;
    const y = run(fx, x);
    let at = 0, best = 0;
    for (let i = 10; i < y.length; i++) if (Math.abs(y[i]) > best) { best = Math.abs(y[i]); at = i; }
    assert.ok(Math.abs((1000 * at) / FS - ms) < ms * 0.05, `echo at ${((1000 * at) / FS).toFixed(0)} ms, expected about ${ms}`);
  }
});
