/**
 * Robustness: feed the code things it was never meant to get, and check it answers with a
 * clear error instead of crashing or hanging.
 *   - random and damaged netlists and LTspice files (a visitor can load any file on the bench)
 *   - random and damaged share links
 *   - every pedal with knobs slammed to the ends and a hot input, on both engines
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadNetlist } from '../engine/parsers/elaborate.js';
import { ascToNetlist } from '../engine/parsers/asc.js';
import { parseValue } from '../engine/parsers/values.js';
import { soakPedal } from './soak-lib.js';
import { Circuit } from '../engine/js/circuit.js';
import { WasmEngine } from '../engine/wasm/wasm-engine.js';

const wasm = new WasmEngine(fs.readFileSync(new URL('../engine/wasm/pedal-engine.wasm', import.meta.url)));

const CIRCUITS = fs.readdirSync(new URL('../circuits/', import.meta.url)).filter((f) => f.endsWith('.cir'));
const read = (f) => fs.readFileSync(new URL(`../circuits/${f}`, import.meta.url), 'utf8');
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** Damage a text: delete, duplicate, swap or corrupt random pieces. */
function mutate(text, rand) {
  const lines = text.split('\n');
  const n = 1 + Math.floor(rand() * 4);
  for (let k = 0; k < n; k++) {
    const i = Math.floor(rand() * lines.length);
    const r = rand();
    if (r < 0.2) lines.splice(i, 1);                                       // delete a line
    else if (r < 0.4) lines.splice(i, 0, lines[Math.floor(rand() * lines.length)]); // duplicate one
    else if (r < 0.6) lines[i] = (lines[i] || '').split(/\s+/).slice(0, Math.floor(rand() * 4)).join(' '); // cut it short
    else if (r < 0.8) lines[i] = (lines[i] || '').replace(/\d+(\.\d+)?/, ['0', '-1', '1e308', 'abc', '', '1e-300'][Math.floor(rand() * 6)]); // bad number
    else lines[i] = String.fromCharCode(...Array.from({ length: 20 }, () => 32 + Math.floor(rand() * 95))); // garbage
  }
  return lines.join('\n');
}

test('damaged netlists give diagnostics, never a crash', () => {
  const rand = rng(42);
  let rejected = 0;
  for (let round = 0; round < 60; round++) {
    for (const f of CIRCUITS) {
      const text = mutate(read(f), rand);
      let d;
      assert.doesNotThrow(() => { d = loadNetlist(text, { fileName: f }); }, `${f} round ${round} threw`);
      assert.equal(typeof d.ok, 'boolean');
      assert.ok(Array.isArray(d.diagnostics));
      if (!d.ok) { rejected++; assert.ok(d.diagnostics.some((x) => x.level === 'error'), 'rejected without saying why'); continue; }
      // accepted: both engines must build it (or refuse with an Error) and never output NaN
      const ctl = d.controls.map((c) => c.value);
      const input = Float64Array.from({ length: 256 }, (_, i) => 0.5 * Math.sin(i / 5));
      try {
        const c = new Circuit(d, { sampleRate: 96000 });
        ctl.forEach((v, i) => c.setControl(i, v, true));
        c.reset();
        for (const x of input) assert.ok(Number.isFinite(c.step(x)), `${f} round ${round}: JS engine output NaN`);
      } catch (e) { assert.ok(e instanceof Error, `${f} round ${round}: JS engine threw a non-error`); if (e.code === 'ERR_ASSERTION') throw e; }
      let h = -1;
      try { h = wasm.create(d, ctl, 48000, 2); } catch { continue; } // refused cleanly
      const buf = input.slice();
      wasm.process(h, buf);
      wasm.destroy(h);
      assert.ok(buf.every(Number.isFinite), `${f} round ${round}: C++ engine output NaN`);
    }
  }
  assert.ok(rejected > 0, 'the damage never caused a rejection: the test is not biting');
});

test('pure garbage and empty input are rejected cleanly', () => {
  const rand = rng(7);
  const inputs = ['', ' ', '\n\n', '.end', '*', 'R1', 'R1 a', 'R1 a b', 'X1 a b c nosuchsub', '.model', '.subckt x a\n.ends', 'V1 a 0 SIN(', '\u0000\u0001\u0002'];
  for (let i = 0; i < 40; i++) inputs.push(String.fromCharCode(...Array.from({ length: 200 }, () => Math.floor(rand() * 256))));
  for (const t of inputs) assert.doesNotThrow(() => loadNetlist(t), JSON.stringify(t.slice(0, 30)));
});

test('damaged LTspice files do not crash the converter', () => {
  const dir = new URL('../circuits/ltspice/', import.meta.url);
  const rand = rng(99);
  for (const f of fs.readdirSync(dir)) {
    const text = fs.readFileSync(new URL(f, dir), 'utf8');
    for (let round = 0; round < 30; round++) {
      const bad = mutate(text, rand);
      try { const net = ascToNetlist(bad); if (typeof net === 'string') loadNetlist(net); }
      catch (e) { assert.ok(e instanceof Error && e.message, `${f}: threw something that is not a readable error`); }
    }
  }
});

test('part values: odd spellings never become NaN silently', () => {
  for (const s of ['4k7', '4.7k', '10u', '10uF', '1Meg', '1M', '100n', '2.2', '1e3', '0']) assert.ok(Number.isFinite(parseValue(s)), s);
  for (const s of ['', 'abc', 'k', '--1']) {
    let v; try { v = parseValue(s); } catch { v = null; }
    assert.ok(v === null || Number.isNaN(v) || v === undefined, `${s} was read as ${v}`);
  }
});

test('damaged share links throw a readable error or decode to something safe', async () => {
  const { decodeBoard, encodeBoard } = await import('../site/board/share.js');
  const good = encodeBoard([{ key: 'blues-od', variant: 0, labels: ['DRIVE'], values: [0.5], bypass: false }], 0, [], 'x');
  const rand = rng(5);
  const tries = ['', 'x', '!!!', good.slice(0, 5), good.slice(0, -3), good + 'AAAA', btoa('{"v":1,"p":"no"}'), btoa('{"v":1,"p":[[1,2,3]]}'), btoa('{"v":1,"p":[["blues-od",99,null,[9,-9,"x"]]],"t":1e9}')];
  for (let i = 0; i < 200; i++) { const a = good.split(''); a[Math.floor(rand() * a.length)] = 'ABCxyz_-09'[Math.floor(rand() * 10)]; tries.push(a.join('')); }
  for (const t of tries) {
    let b;
    try { b = decodeBoard(t); } catch (e) { assert.ok(e instanceof Error); continue; }
    assert.ok(Array.isArray(b.board) && b.board.length <= 16);
    for (const p of b.board) {
      assert.equal(typeof p.key, 'string');
      if (p.values) for (const v of p.values) assert.ok(v >= 0 && v <= 1, `knob value ${v}`);
      if (p.label) assert.ok(!/[\r\n"]/.test(p.label));
    }
    if (b.trim != null) assert.ok(b.trim >= -30 && b.trim <= 24);
  }
});

test('every pedal stays stable with knobs slammed and a hot input (C++ and JavaScript)', () => {
  for (const f of CIRCUITS) {
    for (const engine of ['wasm', 'js']) {
      const r = soakPedal(read(f), { seconds: engine === 'wasm' ? 1 : 0.25, engine, seed: 3 });
      assert.equal(r.nonFinite, 0, `${f} (${engine}) output NaN`);
      assert.ok(r.peak < 50, `${f} (${engine}) ran away to ${r.peak} V`);
      assert.ok(r.failures <= 10, `${f} (${engine}) failed to converge ${r.failures} times`);
    }
  }
});
