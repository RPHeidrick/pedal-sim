/**
 * Build it yourself: for every library pedal and every Workshop template, the parts list,
 * schematic and drill template must cover every part and knob of the simulated circuit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readNetlist, partsList, partsCsv, nearestE24, nearestPot, parseValue } from '../site/build/parts.js';
import { schematicSvg } from '../site/build/schematic.js';
import { drillSvg, layout, wiringSteps, buildSteps } from '../site/build/drill.js';
import { loadNetlist } from '../engine/parsers/elaborate.js';
import { TEMPLATES, buildNetlist } from '../site/workshop/templates.js';

const lib = fs.readdirSync(new URL('../circuits/', import.meta.url)).filter((f) => f.endsWith('.cir'))
  .map((f) => [f, fs.readFileSync(new URL(`../circuits/${f}`, import.meta.url), 'utf8')]);
const tpl = TEMPLATES.map((t) => [`template ${t.id}`, buildNetlist(t, {}, `My ${t.name}`)]);

for (const [name, text] of [...lib, ...tpl]) {
  test(`build sheet: ${name}`, () => {
    const net = readNetlist(text);
    const desc = loadNetlist(text);
    assert.ok(desc.ok, name);
    // every knob the site shows is a pot on the parts list and a hole on the drill template
    assert.equal(net.pots.length, desc.controls.filter((c) => c.kind === 'pot').length, `${name}: pots`);
    const rows = partsList(net);
    for (const p of net.parts) {
      if (p.kind === 'opamp') assert.ok(rows.some((r) => r.group === 'Chips' && r.refs.includes(p.ref)), `${name}: ${p.ref} on the list`);
      else assert.ok(rows.some((r) => r.refs.split(', ').some((x) => x === p.ref || x.endsWith(`(${p.ref})`))), `${name}: ${p.ref} on the list`);
    }
    for (const must of ['3PDT footswitch', '2.1 mm DC jack']) assert.ok(rows.some((r) => r.value === must), `${name}: ${must}`);
    assert.equal(partsCsv(net).split('\r\n').length, rows.length + 1);
    const svg = schematicSvg(net);
    for (const p of net.parts) assert.ok(svg.includes(`data-ref="${p.ref}"`), `${name}: ${p.ref} drawn`);
    assert.ok(!/NaN|undefined/.test(svg), `${name}: schematic has no NaN`);
    const drill = drillSvg(net);
    assert.ok(!/NaN|undefined/.test(drill), `${name}: drill template has no NaN`);
    const { box, pots, sw } = layout(net);
    for (const p of pots) {
      assert.ok(p.x > 6 && p.x < box.w - 6 && p.y > 6 && p.y < box.l - 6, `${name}: ${p.label} inside the face`);
      assert.ok(Math.abs(p.y - sw.y) > 20, `${name}: ${p.label} clear of the footswitch`);
    }
    for (let i = 0; i < pots.length; i++) for (let j = i + 1; j < pots.length; j++) assert.ok(Math.hypot(pots[i].x - pots[j].x, pots[i].y - pots[j].y) >= 17, `${name}: knobs ${i} and ${j} at least 17 mm apart`);
    assert.ok(wiringSteps(net).length >= 5 && buildSteps(net).length >= 8);
  });
}

test('build sheet: values are rounded to parts you can buy', () => {
  assert.equal(nearestE24(3200), 3300);
  assert.equal(nearestE24(6900), 6800);
  assert.equal(nearestE24(47000), 47000);
  assert.equal(nearestPot(101e3), 100e3);
  assert.equal(nearestPot(1.1e3), 1e3);
  assert.equal(parseValue('4.7u'), 4.7e-6);
  assert.equal(parseValue('1Meg'), 1e6);
});
