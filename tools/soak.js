#!/usr/bin/env node
/**
 * Soak test: runs every pedal for a long time with its knobs sweeping and the input
 * pushed hot, the way a visitor twiddling knobs might, and checks the engine never:
 *   - outputs NaN or infinity (would be silence or a pop)
 *   - outputs an absurd voltage (a runaway simulation)
 *   - fails to converge more than a handful of times
 *
 *   node tools/soak.js              (60 s of audio per pedal, C++ engine, 4x oversampling)
 *   node tools/soak.js 10 js        (10 s per pedal, JavaScript engine)
 *
 * A short version of this runs inside `npm test` (tests/robustness.test.js).
 */
import fs from 'node:fs';
import { soakPedal } from '../tests/soak-lib.js';
import { TEMPLATES, buildNetlist } from '../site/workshop/templates.js';

const SECONDS = Number(process.argv[2]) || 60;
const ENGINE = process.argv[3] === 'js' ? 'js' : 'wasm';
const circuits = [
  ...fs.readdirSync(new URL('../circuits/', import.meta.url)).filter((f) => f.endsWith('.cir')).map((f) => [f.replace('.cir', ''), fs.readFileSync(new URL(`../circuits/${f}`, import.meta.url), 'utf8')]),
  // every Workshop pedal, with every combination of choices
  ...TEMPLATES.flatMap((t) => combos(t).map((o, i) => [`workshop ${t.id} #${i + 1}`, buildNetlist(t, o, t.name)])),
];

function combos(t) {
  let list = [{}];
  for (const o of t.options) list = list.flatMap((x) => o.choices.map((c) => ({ ...x, [o.id]: c.id })));
  return list;
}

console.log(`Soak test: ${circuits.length} circuits, ${SECONDS} s of audio each, ${ENGINE === 'js' ? 'JavaScript' : 'C++'} engine\n`);
let bad = 0;
for (const [name, text] of circuits) {
  const perPedal = name.startsWith('workshop') ? Math.max(1, SECONDS / 10) : SECONDS; // many combinations: shorter each
  const r = soakPedal(text, { seconds: perPedal, engine: ENGINE });
  const ok = r.nonFinite === 0 && r.peak < 50 && r.failures <= 10;
  if (!ok) bad++;
  console.log(`${ok ? '  ok  ' : '  BAD '} ${name.padEnd(26)} peak ${r.peak.toFixed(2).padStart(6)} V   NaN ${r.nonFinite}   failed steps ${r.failures}   ${r.ms.toFixed(0)} ms`);
}
console.log(bad ? `\n${bad} circuit(s) misbehaved` : '\nEvery circuit stayed stable');
process.exit(bad ? 1 : 0);
