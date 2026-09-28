// Beginner content: starter boards, sample sounds and help text all point at real things.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STARTER_PEDALS, EFFECT_TYPES } from '../circuits/index.js';
import { loadNetlist } from '../engine/parsers/elaborate.js';
import { PRESETS } from '../site/board/presets.js';

const { SAMPLES, DEFAULT_SAMPLE, sampleById } = await import('../site/inputs/samples.js');

import { dspById, dspDesc } from '../site/audio/dsp-effects.js';
const lib = (f) => loadNetlist(fs.readFileSync(new URL(`../circuits/${f}`, import.meta.url), 'utf8'), { fileName: f });

test('every starter board uses library pedals and real knob labels, with a sane volume', () => {
  for (const pr of PRESETS) {
    assert.ok(pr.name && pr.text, pr.id);
    assert.ok(pr.level >= -30 && pr.level <= 18, `${pr.id} volume`);
    for (const pp of pr.pedals) {
      const variants = STARTER_PEDALS.filter((p) => p.family === pp.key || p.id === pp.key);
      const digital = dspById(pp.key);
      assert.ok(variants.length || digital, `${pr.id}: no pedal ${pp.key}`);
      const v = digital ? { id: pp.key } : variants[pp.variant || 0];
      assert.ok(v, `${pr.id}: ${pp.key} has no variant ${pp.variant}`);
      const labels = (digital ? dspDesc(pp.key) : lib(v.file)).controls.map((c) => c.label);
      for (const [k, val] of Object.entries(pp.values)) {
        assert.ok(labels.includes(k), `${pr.id}: ${v.id} has no knob "${k}" (has ${labels.join(', ')})`);
        assert.ok(val >= 0 && val <= 1, `${pr.id}: ${k}=${val}`);
      }
    }
  }
});

test('every pedal says what it is and what each knob does', () => {
  const types = new Set(EFFECT_TYPES.map((t) => t.id));
  for (const p of STARTER_PEDALS) {
    assert.ok(types.has(p.type), `${p.id}: type ${p.type}`);
    if (p.family) continue; // family text lives with the family (site/board/library.js FAMILIES)
    assert.ok(p.sounds, `${p.id}: sounds`);
    for (const c of lib(p.file).controls.filter((c) => c.kind === 'pot')) {
      assert.ok(p.knobs && p.knobs[c.label], `${p.id}: no help for knob ${c.label}`);
    }
  }
});

test('sample sounds are real guitar recordings, and the files are there', () => {
  assert.ok(sampleById(DEFAULT_SAMPLE));
  for (const s of SAMPLES) {
    assert.ok(s.name && s.good && s.kind, s.id);
    assert.ok(s.file && !s.make, `${s.id}: only real recordings ship`);
    assert.ok(['electric', 'acoustic'].includes(s.group), `${s.id}: group`);
    assert.ok(s.gain > 0.2 && s.gain < 4, `${s.id}: gain`);
    const b = fs.readFileSync(new URL(s.file, new URL('../site/inputs/samples.js', import.meta.url)));
    assert.ok(b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WAVE', `${s.id}: not a WAV`);
    assert.equal(b.readUInt16LE(22), 1, `${s.id}: should be mono (stereo loops cancel when summed)`);
  }
});

test('listening profiles start quiet and explain themselves', async () => {
  const { OUTPUT_PROFILES, DEFAULT_PROFILE, profileById } = await import('../site/audio/output-profiles.js');
  assert.ok(profileById(DEFAULT_PROFILE).safety, 'default (headphones) starts with the safety cap on');
  for (const p of OUTPUT_PROFILES) {
    assert.ok(p.short && p.name && p.tip && p.tips.length >= 2, p.id);
    assert.ok(p.start <= -12, `${p.id} starts too loud: ${p.start} dB`);
  }
});

test('every knob on the site has a plain-words role, and synonyms point both ways', async () => {
  const { KNOB_ROLES, knobRole } = await import('../circuits/index.js');
  for (const p of STARTER_PEDALS) {
    for (const c of lib(p.file).controls.filter((c) => c.kind === 'pot')) assert.ok(knobRole(c.label), `${p.id}: knob ${c.label} is not explained`);
  }
  assert.deepEqual(knobRole('Drive').others, ['Gain', 'Fuzz']);
  assert.deepEqual(knobRole('Level').others, ['Volume']);
  assert.ok(KNOB_ROLES.every((r) => r.title && r.text));
});

test('starter boards say which guitar they suit, and each kind has a recommended board', async () => {
  const { RECOMMENDED } = await import('../site/board/presets.js');
  for (const pr of PRESETS) assert.ok(Array.isArray(pr.suits) && pr.suits.length, `${pr.id}: suits`);
  for (const [group, id] of Object.entries(RECOMMENDED)) {
    const pr = PRESETS.find((x) => x.id === id);
    assert.ok(pr && pr.suits.includes(group), `${group}: recommended board ${id}`);
    assert.ok(PRESETS.filter((x) => x.suits.includes(group)).length >= 2, `${group}: at least two boards`);
  }
});

test('every audio file in a samples/ subfolder is listed with its source', async () => {
  // samples/mine: Richard's own recordings (listed in samples/mine/recordings.js, max 16)
  // samples/notes: the Digital guitar's CC0 notes (listed in site/inputs/notes.js)
  const { MY_RECORDINGS } = await import('../samples/mine/recordings.js');
  const { NOTES, NOTES_LICENSE, nearestNote } = await import('../site/inputs/notes.js');
  const audioIn = (d) => fs.readdirSync(new URL(`../samples/${d}/`, import.meta.url)).filter((f) => /\.(wav|mp3|flac|ogg|m4a|aiff?)$/i.test(f));
  for (const f of audioIn('mine')) assert.ok(MY_RECORDINGS.some((r) => r.file === f), `samples/mine/${f} is not listed in samples/mine/recordings.js`);
  assert.ok(MY_RECORDINGS.length <= 16, 'at most 16 recordings');
  const slots = MY_RECORDINGS.map((r) => r.slot);
  assert.equal(new Set(slots).size, slots.length, 'each recording has its own slot');
  for (const r of MY_RECORDINGS) assert.ok(r.slot >= 1 && r.slot <= 16 && ['electric', 'acoustic', 'bass'].includes(r.group) && r.name, `recording ${r.file}`);
  assert.equal(MY_RECORDINGS.filter((r) => r.default).length <= 1, true, 'only one first sound');
  assert.equal(NOTES_LICENSE.license, 'CC0');
  const noteFiles = (n) => [n.file, ...(n.takes || []), ...(n.soft ? [n.soft] : [])];
  for (const f of audioIn('notes')) assert.ok(NOTES.some((n) => noteFiles(n).includes(f)), `samples/notes/${f} is not listed in site/inputs/notes.js`);
  for (const n of NOTES) for (const f of noteFiles(n)) assert.ok(fs.existsSync(new URL(`../samples/notes/${f}`, import.meta.url)), `missing note ${f}`);
  // every note a guitar in standard tuning can play (open E2 to the 15th fret on the high E) is within 2 semitones of a recording
  for (let m = 40; m <= 79; m++) assert.ok(Math.abs(nearestNote(m).shift) <= 2, `MIDI ${m}`);
  // no stray folders: only mine/ and notes/ may hold audio besides the listed samples
  const dirs = fs.readdirSync(new URL('../samples/', import.meta.url), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  assert.deepEqual(dirs, ['mine', 'notes']);
});

test('every audio file served from samples/ is ours to publish', () => {
  // The folder is public (site and GitHub). A file may only be here if it is listed with
  // who recorded it (`by`) or an explicit public-domain / CC0 licence (`license`).
  const dir = new URL('../samples/', import.meta.url);
  const files = fs.readdirSync(dir).filter((f) => /\.(wav|mp3|flac|ogg|m4a|aiff?)$/i.test(f));
  for (const f of files) {
    const s = SAMPLES.find((x) => x.file.endsWith(`/${f}`));
    assert.ok(s, `samples/${f} is not listed in site/inputs/samples.js: remove it or add it with its source`);
    assert.ok(s.by || /^(CC0|public domain)$/i.test(s.license || ''), `samples/${f}: no owner (by) or CC0 licence recorded`);
  }
});

test('index.html preloads every script the page imports (and nothing that is gone)', () => {
  const root = new URL('../', import.meta.url);
  const seen = new Set();
  const walk = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const src = fs.readFileSync(new URL(rel, root), 'utf8');
    for (const m of src.matchAll(/^\s*import\s(?:[^'"]*?from\s)?['"](\.[^'"]+)['"]/gm)) {
      walk(new URL(m[1], new URL(rel, root)).href.slice(root.href.length));
    }
  };
  walk('site/main.js');
  seen.delete('site/main.js');
  const html = fs.readFileSync(new URL('index.html', root), 'utf8');
  const listed = new Set([...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]));
  const missing = [...seen].filter((f) => !listed.has(f));
  const extra = [...listed].filter((f) => !seen.has(f));
  assert.deepEqual(missing, [], `add these to the modulepreload list in index.html: ${missing.join(', ')}`);
  assert.deepEqual(extra, [], `remove these from the modulepreload list in index.html: ${extra.join(', ')}`);
});
