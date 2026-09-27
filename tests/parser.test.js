import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseValue, evalExpr, formatEng } from '../engine/parsers/values.js';
import { parseNetlist, tokenize } from '../engine/parsers/netlist.js';
import { loadNetlist, canonNode } from '../engine/parsers/elaborate.js';

const close = (a, b, rel = 1e-9) => assert.ok(Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b), 1e-30), `${a} != ${b}`);

test('parseValue: suffixes, case, units, R-notation', () => {
  close(parseValue('10k'), 1e4);
  close(parseValue('10K'), 1e4);
  close(parseValue('1Meg'), 1e6);
  close(parseValue('1MEG'), 1e6);
  close(parseValue('4.7m'), 4.7e-3); // m is milli in SPICE
  close(parseValue('2.2u'), 2.2e-6);
  close(parseValue('2.2µ'), 2.2e-6);
  close(parseValue('100n'), 1e-7);
  close(parseValue('51p'), 51e-12);
  close(parseValue('1f'), 1e-15);
  close(parseValue('10uF'), 1e-5);
  close(parseValue('9V'), 9);
  close(parseValue('1e3'), 1000);
  close(parseValue('-3.3'), -3.3);
  close(parseValue('4k7'), 4700);
  close(parseValue('2u2'), 2.2e-6);
  close(parseValue('4r7'), 4.7);
  close(parseValue('1mil'), 25.4e-6);
  assert.ok(Number.isNaN(parseValue('abc')));
});

test('evalExpr: arithmetic, params, functions', () => {
  close(evalExpr('{R*wiper}', { r: 1000, wiper: 0.25 }), 250);
  close(evalExpr('1/(2*pi*1k*1u)'), 1 / (2 * Math.PI * 1e-3));
  close(evalExpr('2**3^2'), 512);
  close(evalExpr('max(1, 3, 2) + sqrt(16)'), 7);
  close(evalExpr('-2^2'), -4);
  close(evalExpr('if(1>0, 5, 6)'), 5);
  assert.throws(() => evalExpr('foo+1'));
});

test('formatEng', () => {
  assert.equal(formatEng(4700), '4.7k');
  assert.equal(formatEng(2.2e-6, 3, 'F'), '2.2µF');
  assert.equal(formatEng(0), '0');
});

test('tokenize: parentheses, braces, key = value', () => {
  assert.deepEqual(tokenize('V1 in 0 SINE(0 1 1k)'), ['V1', 'in', '0', 'SINE', '0', '1', '1k']);
  assert.deepEqual(tokenize('.model Q NPN(IS=1e-14, BF = 100)'), ['.model', 'Q', 'NPN', 'IS=1e-14', 'BF=100']);
  assert.deepEqual(tokenize('R1 a b {R * (1 - w)}'), ['R1', 'a', 'b', '{R * (1 - w)}']);
});

test('parseNetlist: title, continuation, comments, directives', () => {
  const src = [
    '* My pedal',
    'R1 in out 10k ; inline comment',
    '+ ',
    'C1 out 0',
    '+ 1u',
    '* a comment line',
    '.model D1N D(IS=1n',
    '+ N=1.8)',
    '.tran 1m',
    '.frob',
    '.end',
    'R99 never parsed 1',
  ].join('\n');
  const ast = parseNetlist(src);
  assert.equal(ast.title, 'My pedal');
  assert.equal(ast.root.cards.length, 2);
  assert.deepEqual(ast.root.cards[1].tokens, ['C1', 'out', '0', '1u']);
  const m = ast.root.models.get('d1n');
  assert.equal(m.type, 'D');
  assert.equal(m.params.n, '1.8');
  assert.ok(ast.diagnostics.some((d) => d.level === 'info' && /\.tran/.test(d.message)));
  assert.ok(ast.diagnostics.some((d) => d.level === 'warning' && /\.frob/.test(d.message)));
});

test('parseNetlist: first-line element is kept, plain title is not', () => {
  assert.equal(parseNetlist('R1 in out 1k\n').root.cards.length, 1);
  const a = parseNetlist('Fuzz pedal v2\nR1 in out 1k\n');
  assert.equal(a.title, 'Fuzz pedal v2');
  assert.equal(a.root.cards.length, 1);
});

test('parseNetlist: .include resolves uploaded files, reports missing ones', () => {
  const ast = parseNetlist('* t\n.include "C:\\\\models\\\\ge.lib"\n.include missing.lib\n.lib opamp.sub\n', {
    files: { 'ge.lib': '.model AC128 PNP(IS=3u BF=90)\n' },
  });
  assert.ok(ast.root.models.has('ac128'));
  assert.ok(ast.diagnostics.some((d) => d.level === 'warning' && /missing\.lib/.test(d.message)));
  assert.ok(ast.diagnostics.some((d) => d.level === 'info' && /opamp\.sub/.test(d.message)));
});

test('parseNetlist: nested subckt scopes and annotations', () => {
  const ast = parseNetlist('* t\n*@pot XG taper=log label="Gain"\n.subckt amp a b params: G=2\nR1 a b {G*1k}\n.ends\nX1 in out amp G=3\n.end\n');
  assert.ok(ast.root.subckts.has('amp'));
  assert.deepEqual(ast.root.subckts.get('amp').pins, ['a', 'b']);
  assert.equal(ast.annotations[0].kind, 'pot');
  assert.equal(ast.annotations[0].params.label, 'Gain');
});

test('canonNode', () => {
  assert.equal(canonNode('GND'), '0');
  assert.equal(canonNode('/IN'), 'in');
  assert.equal(canonNode('Vcc'), 'vcc');
});

test('elaborate: subckt flattening with params and internal nodes', () => {
  const d = loadNetlist('* t\nVin in 0 0\n.subckt div a b params: R=1k\nR1 a mid {R}\nR2 mid b {2*R}\n.ends\nX1 in out div R=10k\nRL out 0 1k\n.end');
  assert.ok(d.ok, JSON.stringify(d.diagnostics));
  const r1 = d.elements.find((e) => e.name === 'X1.R1');
  assert.deepEqual(r1.nodes, ['in', 'x1.mid']);
  close(r1.value, 10e3);
  close(d.elements.find((e) => e.name === 'X1.R2').value, 20e3);
});

test('elaborate: pot subcircuit becomes a knob with taper', () => {
  const d = loadNetlist('* t\nVin in 0 0\nXVOL 0 out in pot R=500k taper=log rot=0.3\n.end');
  assert.ok(d.ok);
  const c = d.controls[0];
  assert.equal(c.kind, 'pot');
  assert.equal(c.label, 'VOL');
  assert.equal(c.taper, 'log');
  close(c.r, 500e3);
  close(c.value, 0.3);
});

test('elaborate: pot taper from subckt name and resistor-pair pots', () => {
  const d = loadNetlist('* t\n*@pot RTONE taper=log label="Tone"\nVin in 0 0\nX1 in out 0 pot_rlog R=10k\nRTONE_A in w 2.5k\nRTONE_B w 0 7.5k\nR3 w out 1k\n.end');
  assert.ok(d.ok, JSON.stringify(d.diagnostics));
  assert.equal(d.controls[0].taper, 'rlog');
  const tone = d.controls.find((c) => c.label === 'Tone');
  assert.ok(tone);
  close(tone.r, 10e3);
  // 25% of the resistance on the A leg under a log taper
  assert.ok(Math.abs(tone.value - Math.log(1 + 0.25 * 80) / Math.log(81)) < 1e-9);
  const pot = d.elements.find((e) => e.type === 'POT' && e.name === 'RTONE');
  assert.deepEqual(pot.nodes, ['in', 'w', '0']);
  assert.ok(!d.elements.some((e) => e.name === 'RTONE_A'));
});

test('elaborate: switches', () => {
  const d = loadNetlist('* t\nVin in 0 0\nXS1 in a b spdt state=1\nXS2 a out b out c d dpdt\nR1 c 0 1k\nR2 d 0 1k\n.end');
  assert.ok(d.ok, JSON.stringify(d.diagnostics));
  assert.equal(d.controls.length, 2);
  assert.equal(d.controls[0].value, 1);
  assert.equal(d.elements.find((e) => e.name === 'XS2').poles.length, 2);
});

test('elaborate: op amp by part name, 5 and 3 pins, param overrides', () => {
  const d = loadNetlist('* t\nV1 vcc 0 9\nVin in 0 0\nXU1 in out vcc 0 out TL072CP\nXU2 in m out2 opamp Aol=100k GBW=10Meg\nR1 m 0 1k\nR2 m out2 1k\nR3 out2 out 1k\n.end');
  assert.ok(d.ok, JSON.stringify(d.diagnostics));
  const u1 = d.elements.find((e) => e.name === 'XU1');
  assert.equal(u1.type, 'OPAMP');
  assert.equal(u1.preset, 'tl072');
  const u2 = d.elements.find((e) => e.name === 'XU2');
  assert.equal(u2.nodes[2], null);
  close(u2.params.gbw, 10e6);
  close(u2.params.aol, 100e3);
});

test('elaborate: vendor op amp subckt with unsupported POLY falls back to macromodel', () => {
  const lib = '.subckt TL072 1 2 3 4 5\nE1 5 0 POLY(2) 1 0 2 0 0 1 -1\n.ends\n';
  const d = loadNetlist('* t\nV1 vcc 0 9\nVin in 0 0\n.include tl072.lib\nXU1 in out vcc 0 out TL072\n.end', { files: { 'tl072.lib': lib } });
  assert.ok(d.ok, JSON.stringify(d.diagnostics));
  assert.equal(d.elements.find((e) => e.name === 'XU1').type, 'OPAMP');
  assert.ok(d.diagnostics.some((x) => x.level === 'warning' && /built-in tl072/.test(x.message)));
});

test('elaborate: conventions and clear errors', () => {
  const noOut = loadNetlist('* t\nVin in 0 0\nR1 in x 1k\nR2 x 0 1k\n.end');
  assert.equal(noOut.ok, false);
  assert.ok(noOut.diagnostics.some((d) => d.level === 'error' && /"out"/.test(d.message)));

  const synth = loadNetlist('* t\nR1 in out 1k\nR2 out 0 1k\n.end');
  assert.ok(synth.ok);
  assert.ok(synth.elements.some((e) => e.type === 'V' && e.role === 'input' && e.synthetic));

  const vcc = loadNetlist('* t\nVin in 0 0\nR1 vcc out 1k\nR2 out in 1k\n.end');
  assert.ok(vcc.elements.some((e) => e.name === 'Vsupply' && e.dc === 9));

  const bad = loadNetlist('* t\nVin in 0 0\nB1 out 0 V=V(in)*2\nS1 in out c 0 SW\nK1 L1 L2 0.9\nR1 out 0 1k\n.end');
  assert.equal(bad.ok, false);
  const errs = bad.diagnostics.filter((d) => d.level === 'error').map((d) => d.message);
  assert.ok(errs.some((m) => /B1/.test(m) && /behavioural/.test(m)));
  assert.ok(errs.some((m) => /S1/.test(m)));
  assert.ok(errs.some((m) => /K1/.test(m)));
  assert.ok(bad.diagnostics.find((d) => /B1/.test(d.message)).line === 3);
});

test('elaborate: models (inline, built-in, ignored params, wrong type)', () => {
  const d = loadNetlist('* t\nVin in 0 0\nD1 in out 1N4148\nD2 out 0 DX\nQ1 out in 0 0 2N3904\n.model DX D(IS=1n N=2 CJO=4p TT=5n)\nR1 out 0 1k\n.end');
  assert.ok(d.ok, JSON.stringify(d.diagnostics));
  const d2 = d.elements.find((e) => e.name === 'D2');
  close(d2.model.is, 1e-9);
  assert.equal(d2.model.cjo, undefined);
  assert.ok(d.diagnostics.some((x) => /ignored parameters CJO TT/.test(x.message)));
  assert.ok(d.diagnostics.some((x) => /built-in model for 1N4148/.test(x.message)));
  assert.equal(d.elements.find((e) => e.name === 'Q1').polarity, 1);

  const wrong = loadNetlist('* t\nVin in 0 0\nQ1 out in 0 DX\n.model DX D\nR1 out 0 1k\n.end');
  assert.equal(wrong.ok, false);
});

test('elaborate: source forms', () => {
  const d = loadNetlist('* t\nVin in 0 SINE(0.5 1 1k)\nV2 a 0 DC 9 AC 1 Rser=0.1\nI1 a b PULSE(0 1m 0 1u 1u 1m 2m)\nR1 in out 1k\nR2 out 0 1k\nR3 b 0 1k\n.end');
  assert.ok(d.ok, JSON.stringify(d.diagnostics));
  const vin = d.elements.find((e) => e.name === 'Vin');
  assert.equal(vin.wave.kind, 'sin');
  close(vin.dc, 0.5);
  const v2 = d.elements.find((e) => e.name === 'V2');
  close(v2.dc, 9);
  close(v2.rser, 0.1);
  assert.equal(d.elements.find((e) => e.name === 'I1').wave.kind, 'pulse');
});
