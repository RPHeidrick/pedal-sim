/**
 * Pedal Workshop: every template, with every choice, must build a netlist that parses,
 * biases and renders a clean waveform (no Newton failures, no NaN), with its knobs labelled,
 * and each kind of pedal must behave like its kind. The "describe your sound" parser must
 * turn plain words into boards that use real library pedals.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadNetlist } from '../engine/parsers/elaborate.js';
import { render } from '../engine/js/analysis.js';
import { sine, harmonics } from '../engine/js/signals.js';
import { TEMPLATES, buildNetlist, defaults } from '../site/workshop/templates.js';

const FS = 48000;
const input = sine(FS, 0.12, 220, 0.2);
const run = (t, o, controls) => {
  const d = loadNetlist(buildNetlist(t, o, 'Test pedal'));
  assert.ok(d.ok, `${t.id} ${JSON.stringify(o)}: ${d.diagnostics.filter((x) => x.level === 'error').map((x) => x.message).join('; ')}`);
  assert.deepEqual(d.controls.map((c) => c.label), t.pots.map((p) => p[1]), `${t.id} knob labels`);
  const r = render(d, input, { sampleRate: FS, oversample: 1, controls });
  assert.equal(r.stats.failures, 0, `${t.id} ${JSON.stringify(o)}: Newton failures`);
  assert.ok(r.output.every(Number.isFinite), `${t.id}: finite output`);
  return harmonics(r.output.slice(FS * 0.05), FS, 220, 6);
};

for (const t of TEMPLATES) {
  test(`workshop template ${t.id}: every single choice builds a working pedal`, () => {
    for (const o of t.options) {
      for (const c of o.choices) {
        const h = run(t, { ...defaults(t), [o.id]: c.id });
        assert.ok(h.amps[0] > 1e-4, `${t.id} ${o.id}=${c.id}: passes signal (${h.amps[0]})`);
      }
    }
  });
}

test('workshop: each kind sounds like its kind', () => {
  const thd = (id, controls) => run(TEMPLATES.find((t) => t.id === id), {}, controls).thd;
  assert.ok(thd('boost', [0.5, 0.6]) < 0.1, 'boost stays fairly clean');
  assert.ok(thd('overdrive', [1, 0.5, 0.6]) > 0.05, 'overdrive distorts');
  assert.ok(thd('distortion', [1, 0.5, 0.6]) > thd('overdrive', [0.2, 0.5, 0.6]), 'distortion is dirtier than light overdrive');
  assert.ok(thd('fuzz', [1, 0.7]) > 0.3, 'fuzz is very dirty');
});

test('describe your sound: words become sensible boards', async () => {
  const { describeSound } = await import('../site/workshop/describe.js');
  const { STARTER_PEDALS } = await import('../circuits/index.js');
  const keys = new Set(STARTER_PEDALS.map((p) => p.family || p.id));
  const cases = [
    ['warm bluesy crunch', (r) => r.pedals.some((p) => p.key === 'blues-od')],
    ['thick fuzzy 60s fuzz', (r) => r.pedals.some((p) => /fuzz/.test(p.key))],
    ['heavy scooped metal distortion with lots of bass', (r) => r.pedals.some((p) => p.key === 'tone-stack' && p.values.Middle < 0.35 && p.values.Bass > 0.6)],
    ['clean and bright', (r) => r.pedals.every((p) => ['jfet-boost', 'tone-stack'].includes(p.key))],
    ['singing lead with sustain for solos', (r) => r.pedals.length >= 2],
    ['a little dark overdrive', (r) => r.pedals.some((p) => (p.values.Tone ?? 1) < 0.5)],
    ['aggressive silicon fuzz', (r) => r.pedals.some((p) => p.key === 'reverse-parallel-fuzz' && p.variant === 0)],
    ['vintage germanium fuzz', (r) => r.pedals.some((p) => (p.key === 'reverse-parallel-fuzz' && p.variant === 1) || p.key === 'germanium-fuzz')],
    ['asdfgh', (r) => r.pedals.length >= 1 && r.guess],
  ];
  for (const [text, ok] of cases) {
    const r = describeSound(text);
    assert.ok(r.pedals.length >= 1 && r.pedals.length <= 4, text);
    for (const p of r.pedals) {
      assert.ok(keys.has(p.key), `${text}: unknown pedal ${p.key}`);
      for (const v of Object.values(p.values)) assert.ok(v >= 0 && v <= 1, `${text}: knob ${v}`);
    }
    assert.ok(r.why.length >= 1, `${text}: explains itself`);
    assert.ok(ok(r), `${text}: ${JSON.stringify(r.pedals)}`);
  }
});
