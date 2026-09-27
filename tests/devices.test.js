/**
 * Device model tests: analytic Jacobians checked against finite differences
 * in every operating region, then each device in a small circuit checked
 * against a hand/closed-form result.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diodeEval } from '../engine/js/devices/diode.js';
import { bjtEval, bjtParams } from '../engine/js/devices/bjt.js';
import { fetEval, jfetParams, mosParams } from '../engine/js/devices/fet.js';
import { softSat } from '../engine/js/devices/opamp.js';
import { VT } from '../engine/js/devices/common.js';
import { loadNetlist } from '../engine/parsers/elaborate.js';
import { Circuit } from '../engine/js/circuit.js';

function near(a, b, rel, abs = 0, msg = '') {
  const ok = Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b)) + abs;
  assert.ok(ok, `${msg} ${a} vs ${b}`);
}

/** Central-difference check of a scalar partial. */
function fd(f, x, h) {
  return (f(x + h) - f(x - h)) / (2 * h);
}

function op(src, opts) {
  const d = loadNetlist(src);
  assert.ok(d.ok, JSON.stringify(d.diagnostics.filter((x) => x.level === 'error')));
  const c = new Circuit(d, opts);
  const r = c.dcOperatingPoint();
  assert.ok(r.ok, 'DC operating point failed');
  return c;
}

// ---------------------------------------------------------------------------
test('diode: Jacobian matches finite difference (forward, reverse, breakdown)', () => {
  const p = { is: 2.52e-9, n: 1.752, rs: 0, bv: 5.1, ibv: 5e-3, nbv: 1 };
  const o = new Float64Array(1);
  for (const v of [-6, -5.2, -5.0, -1, -0.1, 0, 0.3, 0.6, 0.75]) {
    diodeEval(p, v, o);
    const num = fd((vv) => diodeEval(p, vv, new Float64Array(1)), v, 1e-7);
    near(o[0], num, 1e-4, 1e-12, `gd at ${v}`);
  }
});

test('diode circuit: Shockley + series resistance satisfied at the operating point', () => {
  const c = op('* t\nV1 in 0 5\nR1 in a 1k\nD1 a 0 DX\nRL out 0 1k\n.model DX D(IS=2.52n N=1.752 RS=0.568)\n.end');
  const va = c.voltage('a');
  const id = (5 - va) / 1000;
  const vd = 1.752 * VT * Math.log(id / 2.52e-9 + 1) + id * 0.568;
  near(va, vd, 1e-6, 0, 'Vd');
  near(va, 0.67, 0.08, 0, 'plausible silicon drop');
});

test('diode circuit: zener breakdown clamps near BV', () => {
  const c = op('* t\nV1 in 0 12\nR1 in out 1k\nD1 0 out DZ\n.model DZ D(IS=1e-14 BV=5.1 IBV=5m)\n.end');
  near(c.voltage('out'), 5.1, 0.03, 0, 'zener voltage');
});

// ---------------------------------------------------------------------------
test('BJT: Gummel-Poon Jacobian matches finite difference in all regions', () => {
  const p = bjtParams({ is: 6.7e-15, bf: 416, br: 0.74, nf: 1, nr: 1, vaf: 74, var: 20, ikf: 0.067, ikr: 0.1, ise: 6.7e-15, ne: 1.26, isc: 1e-14, nc: 2 });
  const o = new Float64Array(6);
  const pts = [[0.65, -4], [0.72, -0.2], [0.7, 0.6], [-0.5, 0.6], [-1, -1], [0.3, -2], [0.8, 0.75]];
  for (const [vbe, vbc] of pts) {
    bjtEval(p, vbe, vbc, o);
    const f = (i) => (a, b) => { const t = new Float64Array(6); bjtEval(p, a, b, t); return t[i]; };
    const h = 1e-7;
    near(o[2], fd((v) => f(0)(v, vbc), vbe, h), 1e-4, 1e-12, `dIc/dVbe @${vbe},${vbc}`);
    near(o[3], fd((v) => f(0)(vbe, v), vbc, h), 1e-4, 1e-12, `dIc/dVbc @${vbe},${vbc}`);
    near(o[4], fd((v) => f(1)(v, vbc), vbe, h), 1e-4, 1e-12, `dIb/dVbe @${vbe},${vbc}`);
    near(o[5], fd((v) => f(1)(vbe, v), vbc, h), 1e-4, 1e-12, `dIb/dVbc @${vbe},${vbc}`);
  }
});

test('BJT: Ebers-Moll limit gives Ic = BF*Ib in forward active', () => {
  const p = bjtParams({ is: 1e-14, bf: 150 });
  const o = new Float64Array(6);
  bjtEval(p, 0.65, -3, o);
  near(o[0] / o[1], 150, 1e-6, 0, 'beta');
  near(o[0], 1e-14 * (Math.exp(0.65 / VT) - Math.exp(-3 / VT)) - 1e-14 * (Math.exp(-3 / VT) - 1), 1e-6, 1e-12, 'Ic');
});

test('BJT circuit: NPN common emitter bias matches hand analysis', () => {
  // Fixed base current: Ib = (9 - Vbe)/820k, Ic = BF*Ib, Vce = 9 - Ic*4.7k
  const c = op('* t\nV1 vcc 0 9\nVin in 0 0\nRB vcc b 820k\nRC vcc out 4.7k\nQ1 out b 0 QN\nR9 in 0 1k\n.model QN NPN(IS=1e-14 BF=100)\n.end');
  const vbe = c.voltage('b');
  const ib = (9 - vbe) / 820e3;
  near(9 - c.voltage('out'), 100 * ib * 4.7e3, 1e-3, 0, 'Vrc');
  near(vbe, VT * Math.log((100 * ib) / 1e-14), 1e-3, 0, 'Vbe');
});

test('BJT circuit: PNP mirrors NPN', () => {
  const n = op('* t\nV1 vcc 0 9\nVin in 0 0\nRB vcc b 820k\nRC vcc out 4.7k\nQ1 out b 0 QN\n.model QN NPN(IS=1e-14 BF=100 VAF=50)\n.end');
  const p = op('* t\nV1 vcc 0 -9\nVin in 0 0\nRB vcc b 820k\nRC vcc out 4.7k\nQ1 out b 0 QP\n.model QP PNP(IS=1e-14 BF=100 VAF=50)\n.end');
  near(p.voltage('out'), -n.voltage('out'), 1e-6, 1e-9, 'mirror');
});

test('BJT circuit: germanium germanium fuzz biases into the active region', async () => {
  const fs = await import('node:fs');
  const d = loadNetlist(fs.readFileSync(new URL('../circuits/germanium-fuzz.cir', import.meta.url), 'utf8'));
  const c = new Circuit(d);
  assert.ok(c.dcOperatingPoint().ok);
  const q2 = c.snapshot().devices.find((x) => x.name === 'Q2').info;
  assert.equal(q2.region, 'active');
  assert.ok(c.voltage('c2') < -3 && c.voltage('c2') > -7, `Q2 collector ${c.voltage('c2')}`);
});

// ---------------------------------------------------------------------------
test('FET: Jacobian matches finite difference (JFET + MOSFET, all regions, both modes)', () => {
  const tmp = new Float64Array(2);
  const models = [
    ['JFET', jfetParams({ vto: -2, beta: 1.3e-3, lambda: 0.02, is: 1e-14 })],
    ['MOS', mosParams({ vto: 1.8, kp: 0.1, lambda: 0.01 }, 2, 1)],
  ];
  for (const [label, p] of models) {
    const o = new Float64Array(6);
    const pts = label === 'JFET'
      ? [[-0.5, -6], [-0.5, -0.8], [-1, -1.3], [-0.5, 0.2], [-1.5, -0.7], [-3, -8], [0.2, -4]]
      : [[3, -3], [3, 2.5], [2.5, 2.9], [1, -3], [4, 4.3], [3.2, 0.5]];
    for (const [vgs, vgd] of pts) {
      fetEval(p, vgs, vgd, o, tmp);
      const f = (i) => (a, b) => { const t = new Float64Array(6); fetEval(p, a, b, t, new Float64Array(2)); return t[i]; };
      const h = 1e-7;
      near(o[2], fd((v) => f(0)(v, vgd), vgs, h), 1e-4, 1e-10, `${label} dId/dVgs @${vgs},${vgd}`);
      near(o[3], fd((v) => f(0)(vgs, v), vgd, h), 1e-4, 1e-10, `${label} dId/dVgd @${vgs},${vgd}`);
      near(o[4], fd((v) => f(1)(v, vgd), vgs, h), 1e-4, 1e-12, `${label} dIg/dVgs`);
      near(o[5], fd((v) => f(1)(vgs, v), vgd, h), 1e-4, 1e-12, `${label} dIg/dVgd`);
    }
  }
});

test('JFET: saturation current matches Shichman-Hodges', () => {
  const p = jfetParams({ vto: -2, beta: 1e-3, lambda: 0.01, is: 0 });
  const o = new Float64Array(6);
  fetEval(p, -1, -6, o, new Float64Array(2)); // vds = 5
  near(o[0], 1e-3 * 1 * (1 + 0.05), 1e-9, 1e-10, 'Idss-ish');
});

test('JFET circuit: self-biased common source matches the closed-form solution', () => {
  // Id = B*(Vgs - Vto)^2 with Vgs = -Id*Rs  (lambda = 0) -> solve quadratic
  const c = op('* t\nV1 vcc 0 9\nVin in 0 0\nR1 in g 1Meg\nJ1 out g s JX\nRD vcc out 10k\nRS s 0 1.5k\n.model JX NJF(VTO=-0.8 BETA=1.3m IS=1e-16)\n.end');
  const B = 1.3e-3, vto = -0.8, rs = 1.5e3;
  // B*(-Id*rs - vto)^2 = Id  ->  B*rs^2*Id^2 + (2*B*rs*vto - 1)*Id + B*vto^2 = 0
  const a = B * rs * rs, b = 2 * B * rs * vto - 1, cc = B * vto * vto;
  const id = (-b - Math.sqrt(b * b - 4 * a * cc)) / (2 * a);
  near(c.voltage('s'), id * rs, 1e-4, 0, 'Vs');
  near(9 - c.voltage('out'), id * 10e3, 1e-4, 0, 'Vrd');
});

test('MOSFET circuit: level 1 saturation with P-channel mirror', () => {
  const src = (t, v) => `* t\nV1 vcc 0 ${v}\nVin in 0 0\nVG g 0 ${v > 0 ? 3 : -3}\nRD vcc out 1k\nM1 out g 0 0 MX W=2 L=1\nR9 in 0 1k\n.model MX ${t}(VTO=${v > 0 ? 1.8 : -1.8} KP=1m)\n.end`;
  const n = op(src('NMOS', 9));
  const id = (1e-3 * 2) / 2 * (3 - 1.8) ** 2;
  near(9 - n.voltage('out'), id * 1e3, 1e-6, 0, 'NMOS drop');
  const p = op(src('PMOS', -9));
  near(p.voltage('out'), -n.voltage('out'), 1e-6, 0, 'PMOS mirror');
});

// ---------------------------------------------------------------------------
test('op amp: softSat derivative', () => {
  const o = new Float64Array(1);
  for (const x of [-10, -3.5, -1, 0, 0.4, 3.49, 7]) {
    softSat(x, 3.5, o);
    near(o[0], fd((v) => softSat(v, 3.5, new Float64Array(1)), x, 1e-6), 1e-5, 1e-12, `sat' @${x}`);
  }
});

test('op amp circuit: non-inverting gain 1 + Rf/Rg and rail clipping', () => {
  const src = (vin) => `* t\nV1 vcc 0 9\nVin in 0 ${vin}\nVR ref 0 4.5\nR0 in p 1k\nR9 p ref 1Meg\nXU1 p m vcc 0 out TL072\nRG m ref 1k\nRF m out 9k\n.end`;
  const c = op(src(4.6));
  near(c.voltage('out') - 4.5, 10 * (c.voltage('p') - 4.5), 1e-3, 0, 'gain 10');
  const hi = op(src(5.5));
  assert.ok(hi.voltage('out') > 7.2 && hi.voltage('out') <= 7.51, `clips below V+ - 1.5 V: ${hi.voltage('out')}`);
  const lo = op(src(3.5));
  assert.ok(lo.voltage('out') < 1.8 && lo.voltage('out') >= 1.49, `clips above V- + 1.5 V: ${lo.voltage('out')}`);
});

test('op amp transient: slew rate limit', () => {
  // unity follower, 2 V step, JRC4558 SR = 1 V/us -> ~2 us rise
  const d = loadNetlist('* t\nV1 vcc 0 15\nV2 vee 0 -15\nVin in 0 0\nXU1 in out vcc vee out JRC4558\n.end');
  const c = new Circuit(d, { sampleRate: 20e6 });
  c.reset();
  let t50 = -1;
  for (let i = 0; i < 200; i++) {
    const v = c.step(2);
    if (t50 < 0 && v >= 1) t50 = (i + 1) / 20e6;
  }
  near(t50, 1e-6, 0.2, 0, 'time to 1 V at 1 V/us');
  near(c.voltage('out'), 2, 1e-3, 0, 'settles');
});

// ---------------------------------------------------------------------------
test('linear: controlled sources E, G, F, H', () => {
  const c = op('* t\nVin in 0 1\nE1 e 0 in 0 3\nRE e 0 1k\nG1 0 g in 0 2m\nRG g 0 1k\nVS in s 0\nRS s 0 500\nF1 0 f VS 2\nRF f 0 100\nH1 h 0 VS 1k\nRH h 0 1k\nRO out 0 1k\nRX in out 1k\n.end');
  near(c.voltage('e'), 3, 1e-9, 0, 'E');
  near(c.voltage('g'), 2, 1e-9, 0, 'G');
  near(c.voltage('f'), 2 * (1 / 500) * 100, 1e-9, 0, 'F');
  near(c.voltage('h'), 1e3 * (1 / 500), 1e-9, 0, 'H');
});

test('pot: taper, knob restamp matches a fresh build', () => {
  const src = '* t\nVin in 0 1\nXV in out 0 pot R=100k taper=log rot=0.5\nRL out 0 1Meg\n.end';
  const c = op(src);
  // log taper at 50%: 10% of R on lug1-wiper
  const r1 = 10e3, r2 = 90e3, rl = 1e6;
  near(c.voltage('out'), (r2 * rl / (r2 + rl)) / (r1 + r2 * rl / (r2 + rl)), 1e-6, 0, 'divider');
  c.setControl(0, 0.9, true);
  c.buildRHS();
  c.newton(10);
  const fresh = op(src.replace('rot=0.5', 'rot=0.9'));
  near(c.voltage('out'), fresh.voltage('out'), 1e-9, 0, 'incremental restamp');
});

test('switch: toggles route the signal', () => {
  const c = op('* t\nVin in 0 1\nXS in a b spdt\nRA a out 1k\nRB b 0 1k\nRL out 0 1k\nRX b out 1Meg\n.end');
  near(c.voltage('out'), 0.5, 1e-3, 0, 'state 0: in-a-out divider');
  c.setControl(0, 1);
  c.buildRHS();
  c.newton(10);
  assert.ok(c.voltage('out') < 0.01, 'state 1: a floats');
});
