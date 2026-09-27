/**
 * Offline transient test on the starter library: every pedal must parse,
 * bias, and render a waveform (written to out/test/) without Newton failures,
 * and each should show its expected character.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderFile } from '../tools/render.js';
import { loadNetlist } from '../engine/parsers/elaborate.js';
import { render } from '../engine/js/analysis.js';
import { sine, harmonics } from '../engine/js/signals.js';

const OUT = 'out/test';
const lib = (f) => new URL(`../circuits/${f}`, import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

const expectations = {
  'germanium-fuzz.cir': (h) => h.thd > 0.3,      // hard clipping
  'op-amp-drive.cir': (h) => h.thd > 0.03,      // soft diode clipping
  'jfet-boost.cir': (h) => h.thd < 0.05,    // clean boost
  'tone-stack.cir': (h) => h.thd < 1e-3,    // passive linear network
};

for (const [file, check] of Object.entries(expectations)) {
  test(`starter library: ${file} biases and renders`, () => {
    const r = renderFile(lib(file), { out: OUT, freq: 220, amp: 0.1, dur: 0.3 });
    assert.ok(r.ok, r.lines.join('\n'));
    assert.ok(r.finite);
    assert.equal(r.render.stats.failures, 0);
    assert.ok(check(r.harmonics), `THD ${r.harmonics.thd}`);
    assert.ok(fs.existsSync(`${OUT}/${file.replace('.cir', '-wave.svg')}`));
    assert.ok(fs.existsSync(`${OUT}/${file.replace('.cir', '.wav')}`));
  });
}

test('germanium fuzz: more fuzz means more distortion, volume scales output', () => {
  const d = loadNetlist(fs.readFileSync(lib('germanium-fuzz.cir'), 'utf8'));
  const input = sine(48000, 0.2, 220, 0.005); // small signal: at 20 mV both settings already saturate
  const thdAt = (fuzz, vol = 0.7) => {
    const r = render(d, input, { sampleRate: 48000, oversample: 2, controls: [fuzz, vol] });
    return harmonics(r.output, 48000, 220, 8);
  };
  const low = thdAt(0.05);
  const high = thdAt(1);
  assert.ok(high.thd > low.thd, `THD fuzz=1 ${high.thd} vs fuzz=0.05 ${low.thd}`);
  const quiet = thdAt(1, 0.3);
  assert.ok(quiet.amps[0] < high.amps[0] / 2, 'volume knob attenuates');
});

test('tone stack: treble knob changes high-frequency response only', () => {
  const d = loadNetlist(fs.readFileSync(lib('tone-stack.cir'), 'utf8'));
  const amp = (f, treble) => {
    const r = render(d, sine(48000, 0.1, f, 0.1), { sampleRate: 48000, oversample: 1, controls: [treble, 0.5, 0.5] });
    return harmonics(r.output, 48000, f, 1).amps[0];
  };
  const hiRatio = amp(4000, 1) / amp(4000, 0.1);
  const loRatio = amp(60, 1) / amp(60, 0.1);
  assert.ok(hiRatio > 2, `treble boosts 4 kHz: x${hiRatio}`);
  assert.ok(hiRatio > 1.5 * loRatio, `more at 4 kHz than at 60 Hz (${hiRatio} vs ${loRatio})`);
});

test('oversampling: 4x output matches 2x within tolerance on the op amp drive', () => {
  const d = loadNetlist(fs.readFileSync(lib('op-amp-drive.cir'), 'utf8'));
  const input = sine(48000, 0.1, 440, 0.1);
  const h2 = harmonics(render(d, input, { sampleRate: 48000, oversample: 2 }).output, 48000, 440, 5);
  const h4 = harmonics(render(d, input, { sampleRate: 48000, oversample: 4 }).output, 48000, 440, 5);
  assert.ok(Math.abs(h2.amps[0] - h4.amps[0]) / h4.amps[0] < 0.01, `fundamental ${h2.amps[0]} vs ${h4.amps[0]}`);
  assert.ok(Math.abs(h2.amps[2] - h4.amps[2]) / h4.amps[0] < 0.01, '3rd harmonic');
});
