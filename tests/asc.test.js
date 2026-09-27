import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ascToNetlist } from '../engine/parsers/asc.js';
import { loadNetlist } from '../engine/parsers/elaborate.js';
import { operatingPoint } from '../engine/js/analysis.js';
import fs from 'node:fs';

const read = (f) => new TextDecoder('latin1').decode(fs.readFileSync(new URL(`../circuits/ltspice/${f}`, import.meta.url)));

test('asc: rotations R90 / R270 place pins like LTspice', () => {
  // two resistors in series between IN and OUT, one rotated each way
  const asc = [
    'Version 4', 'SHEET 1 880 680',
    'WIRE 96 96 32 96', 'WIRE 256 96 176 96', 'WIRE 336 96 320 96',
    'FLAG 32 96 IN', 'FLAG 336 96 OUT',
    'SYMBOL res 192 80 R90', 'SYMATTR InstName R1', 'SYMATTR Value 1k',
    'SYMBOL res 240 112 R270', 'SYMATTR InstName R2', 'SYMATTR Value 2k',
  ].join('\n');
  const { netlist } = ascToNetlist(asc);
  assert.match(netlist, /^R1 \S+ in 1k$/m);
  assert.match(netlist, /^R2 \S+ out 2k$/m);
  const n1 = netlist.match(/^R1 (\S+)/m)[1];
  const n2 = netlist.match(/^R2 (\S+)/m)[1];
  assert.equal(n1, n2, 'R1 and R2 share the middle node');
});

// A small schematic written for this test: a volume pot made from a {Vol} / {100k-Vol}
// resistor pair between IN and ground, with its wiper as OUT, swept by .step param.
const DIVIDER = [
  'Version 4', 'SHEET 1 880 680',
  'FLAG 32 16 IN', 'FLAG 32 96 OUT', 'FLAG 32 176 0',
  'SYMBOL res 16 0 R0', 'SYMATTR InstName R1', 'SYMATTR Value {100k-Vol}',
  'SYMBOL res 16 80 R0', 'SYMATTR InstName R2', 'SYMATTR Value {Vol}',
  'TEXT 100 40 Left 2 !.step param Vol 1k 100k 10k',
].join('\n');

test('asc: a hand-written schematic converts with no warnings and elaborates cleanly', () => {
  const { netlist, warnings } = ascToNetlist(DIVIDER, { name: 'divider.asc' });
  assert.deepEqual(warnings, []);
  const d = loadNetlist(netlist);
  assert.ok(d.ok, d.diagnostics.filter((x) => x.level === 'error').map((x) => x.message).join('; '));
});

test('asc: .step param sweeps become knobs ({X} + {K-X} pair -> pot)', () => {
  const d = loadNetlist(ascToNetlist(DIVIDER).netlist);
  assert.deepEqual(d.controls.map((c) => c.label), ['Vol']);
  assert.ok(Math.abs(d.controls[0].r - 100e3) < 1e-6, 'pot total = 100k from {100k-Vol}');
});

test('asc: the author\'s three schematics convert with no warnings and elaborate cleanly', () => {
  for (const f of ['rp-fuzz-si.asc', 'rp-fuzz-ge.asc', 'blues-od.asc']) {
    const { netlist, warnings } = ascToNetlist(read(f), { name: f });
    assert.deepEqual(warnings, [], f);
    const d = loadNetlist(netlist);
    assert.ok(d.ok, `${f}: ${d.diagnostics.filter((x) => x.level === 'error').map((x) => x.message).join('; ')}`);
    assert.equal(d.diagnostics.filter((x) => x.level === 'warning').length, 0, `${f} has no dangling nodes`);
  }
});

test('asc: .step param sweeps on the author\'s fuzz become Gain and Mod knobs', () => {
  const d = loadNetlist(ascToNetlist(read('rp-fuzz-si.asc')).netlist);
  const labels = d.controls.map((c) => c.label).sort();
  assert.deepEqual(labels, ['Gain', 'Mod']);
  const gain = d.controls.find((c) => c.label === 'Gain');
  assert.ok(Math.abs(gain.r - 1100) < 1e-9, 'pot total = 1.1k from {1.1k-Gain}');
});

test('asc: engine matches the LTspice operating point of the author\'s Reverse Parallel Fuzz sims', () => {
  // Ic values read from the LTspice .op.raw files (first .step: Gain=100, Mod=500)
  const cases = [
    ['rp-fuzz-si.asc', 1100, { Q1: 8.464e-4, Q2: 1.618e-4, Q3: 5.999e-4 }, 0.2],
    ['rp-fuzz-ge.asc', 1010, { Q1: -4.383e-4, Q2: -1.447e-4, Q3: -8.312e-4 }, 0.02],
  ];
  for (const [f, gTotal, ic, tol] of cases) {
    const d = loadNetlist(ascToNetlist(read(f)).netlist);
    const ctl = d.controls.map((c) => (c.label === 'Gain' ? 100 / gTotal : 500 / 5000));
    const op = operatingPoint(d, { controls: ctl });
    assert.ok(op.ok);
    for (const [q, want] of Object.entries(ic)) {
      const got = op.devices.find((x) => x.name.toUpperCase() === q).info.Ic;
      assert.ok(Math.abs(got / want - 1) < tol, `${f} ${q}: Ic ${got.toExponential(3)} vs LTspice ${want.toExponential(3)}`);
    }
  }
});
