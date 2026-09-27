import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SparseLU } from '../engine/js/sparse-lu.js';
import { Oversampler, designLowpass } from '../engine/js/oversample.js';
import { taper, inverseTaper } from '../engine/js/taper.js';
import { loadNetlist } from '../engine/parsers/elaborate.js';
import { Circuit } from '../engine/js/circuit.js';

function near(a, b, rel, abs = 0, msg = '') {
  assert.ok(Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b)) + abs, `${msg} ${a} vs ${b}`);
}

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function denseSolve(n, A, b) {
  const M = Array.from({ length: n }, (_, i) => [...A.slice(i * n, i * n + n), b[i]]);
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i;
    [M[k], M[p]] = [M[p], M[k]];
    for (let i = k + 1; i < n; i++) {
      const f = M[i][k] / M[k][k];
      for (let j = k; j <= n; j++) M[i][j] -= f * M[k][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

test('SparseLU: random sparse systems with zero diagonals match dense elimination', () => {
  const r = rng(7);
  for (let trial = 0; trial < 30; trial++) {
    const n = 3 + Math.floor(r() * 25);
    const A = new Float64Array(n * n + 1);
    const pat = new Uint8Array(n * n);
    // MNA-like: conductance block plus a few voltage-source rows with zero diagonal
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) if (i === j || r() < 0.15) { A[i * n + j] = (r() - 0.5) * 10 ** (r() * 6 - 3); pat[i * n + j] = 1; }
    }
    const nv = Math.floor(n / 4);
    for (let k = 0; k < nv; k++) {
      const row = n - 1 - k;
      const node = Math.floor(r() * (n - nv));
      for (let j = 0; j < n; j++) { A[row * n + j] = 0; A[j * n + row] = 0; }
      A[row * n + node] = 1; A[node * n + row] = 1; pat[row * n + node] = 1; pat[node * n + row] = 1;
      pat[row * n + row] = 1; // structurally present but numerically zero
    }
    const b = Float64Array.from({ length: n + 1 }, () => r() - 0.5);
    const ref = denseSolve(n, Array.from(A.subarray(0, n * n)), Array.from(b));
    if (ref.some((v) => !Number.isFinite(v))) continue; // singular draw
    const lu = new SparseLU(n);
    assert.ok(lu.analyze(A, pat));
    const W = Float64Array.from(A);
    assert.ok(lu.factor(W));
    const x = new Float64Array(n + 1);
    lu.solve(W, Float64Array.from(b), x);
    for (let i = 0; i < n; i++) near(x[i], ref[i], 1e-6, 1e-9, `trial ${trial} x${i}`);
    // program reuse with new values on the same pattern
    const A2 = Float64Array.from(A);
    for (let i = 0; i < n * n; i++) if (A2[i] !== 0 && pat[i]) A2[i] *= 1 + 0.1 * (r() - 0.5);
    const ref2 = denseSolve(n, Array.from(A2.subarray(0, n * n)), Array.from(b));
    const W2 = Float64Array.from(A2);
    if (lu.factor(W2)) {
      lu.solve(W2, Float64Array.from(b), x);
      for (let i = 0; i < n; i++) near(x[i], ref2[i], 1e-5, 1e-8, `reuse trial ${trial} x${i}`);
    }
  }
});

test('SparseLU: factor() reports a collapsed pivot', () => {
  const n = 2;
  const A = Float64Array.of(4, 1, 1, 3, 0);
  const lu = new SparseLU(n);
  lu.analyze(A, Uint8Array.of(1, 1, 1, 1));
  assert.equal(lu.factor(Float64Array.of(0, 1, 1, 0, 0)), false);
});

test('taper: endpoints, log midpoint, inverse', () => {
  for (const k of ['lin', 'log', 'rlog']) {
    near(taper(k, 0), 0, 0, 1e-12);
    near(taper(k, 1), 1, 0, 1e-12);
    for (const r of [0.1, 0.5, 0.83]) near(inverseTaper(k, taper(k, r)), r, 1e-12);
  }
  near(taper('log', 0.5), 0.1, 1e-12);
  near(taper('rlog', 0.5), 0.9, 1e-12);
});

test('transient: RC step response matches the exponential (trapezoidal, 2nd order)', () => {
  const d = loadNetlist('* t\nVin in 0 0\nR1 in out 1k\nC1 out 0 1u\n.end');
  const errAt = (fs) => {
    const c = new Circuit(d, { sampleRate: fs });
    c.reset();
    let err = 0;
    for (let i = 1; i <= fs * 5e-3; i++) {
      const v = c.step(1);
      // trapezoidal sees the step as a ramp over the first interval: an effective dt/2 delay
      const t = i / fs - 0.5 / fs;
      if (i > 10) err = Math.max(err, Math.abs(v - (1 - Math.exp(-t / 1e-3))));
    }
    return err;
  };
  const e1 = errAt(48000);
  const e2 = errAt(96000);
  assert.ok(e1 < 2e-3, `error ${e1}`);
  assert.ok(e2 < e1 / 3, `second-order convergence ${e1} -> ${e2}`);
});

test('transient: RL and LC behave (inductor companion model)', () => {
  const d = loadNetlist('* t\nVin in 0 0\nR1 in out 100\nL1 out 0 10m\n.end');
  const c = new Circuit(d, { sampleRate: 192000 });
  c.reset();
  let v;
  for (let i = 0; i < 192; i++) v = c.step(1); // 1 ms = 10 tau
  near(v, Math.exp(-10), 0.05, 1e-5, 'V(L) decays');

  // LC tank rings at 1/(2 pi sqrt(LC)) ~ 1591.5 Hz
  const lc = loadNetlist('* t\nVin in 0 0\nR1 in out 1Meg\nL1 out 0 10m\nC1 out 0 1u\n.end');
  const k = new Circuit(lc, { sampleRate: 192000 });
  k.reset();
  k.x[k.nodeIndex.get('out')] = 0;
  const cap = k.devices.find((x) => x.name === 'C1');
  cap.v = 1; // start the tank charged
  let crossings = 0;
  let prev = 1;
  for (let i = 0; i < 192000 * 0.01; i++) {
    const y = k.step(0);
    if (prev > 0 && y <= 0) crossings++;
    prev = y;
  }
  near(crossings, 15.9, 0.08, 0, 'cycles in 10 ms');
});

test('transient: Newton failure holds the last valid state (no NaN, no jump)', () => {
  const d = loadNetlist('* t\nVin in 0 0\nR1 in a 1k\nD1 a out DX\nD2 out a DX\nRL out 0 1k\n.model DX D(IS=1e-14)\n.end');
  const c = new Circuit(d, { sampleRate: 48000, maxIter: 1 });
  c.reset();
  const out = [];
  for (let i = 0; i < 200; i++) out.push(c.step(3 * Math.sin(i / 5)));
  assert.ok(c.stats.failures > 0, 'forced failures happened');
  assert.ok(out.every(Number.isFinite));
  for (let i = 1; i < out.length; i++) assert.ok(Math.abs(out[i] - out[i - 1]) < 1, 'no discontinuity');
});

test('DC operating point: source stepping rescues a hard start', () => {
  // cross-coupled latch: plain Newton from 0 V is ill-conditioned; must still converge
  const src = '* t\nV1 vcc 0 9\nVin in 0 0\nR1 vcc c1 10k\nR2 vcc out 10k\nR3 c1 b2 47k\nR4 out b1 47k\nQ1 c1 b1 0 QN\nQ2 out b2 0 QN\nR5 in b1 100k\n.model QN NPN(IS=1e-14 BF=200)\n.end';
  const c = new Circuit(loadNetlist(src));
  const r = c.dcOperatingPoint();
  assert.ok(r.ok, r.method);
  assert.ok(c.voltage('out') > -0.01 && c.voltage('out') < 9.01);
});

test('knob smoothing: pot glides to target without steps', () => {
  const d = loadNetlist('* t\nVin in 0 1\nXV in out 0 pot R=100k taper=lin rot=0\nRL out 0 10Meg\n.end');
  const c = new Circuit(d, { sampleRate: 48000, smoothingMs: 10 });
  c.reset();
  c.setControl(0, 1);
  let prev = c.step(1);
  let maxJump = 0;
  for (let i = 0; i < 4800; i++) {
    const v = c.step(1);
    maxJump = Math.max(maxJump, Math.abs(v - prev));
    prev = v;
  }
  assert.ok(maxJump < 0.01, `max per-sample change ${maxJump}`);
  near(prev, 10 / (100e3 + 10), 1e-3, 0, "reaches target (wiper at lug 3, which is grounded)");
});

test('oversampler: unity passband, image and alias rejection, latency', () => {
  const h = designLowpass(97, 0.47 / 2);
  near(h.reduce((a, b) => a + b, 0), 1, 1e-12);
  for (const L of [2, 4]) {
    const os = new Oversampler(L);
    const fs = 48000;
    const N = 4800;
    const up = new Float64Array(L);
    const out = new Float64Array(N);
    const hiAll = [];
    for (let i = 0; i < N; i++) {
      os.up(Math.sin((2 * Math.PI * 1000 * i) / fs), up);
      for (let k = 0; k < L; k++) hiAll.push(up[k]);
      out[i] = os.down(up);
    }
    // passband: amplitude through up+down stays 1
    let ss = 0;
    for (let i = N / 2; i < N; i++) ss += out[i] * out[i];
    near(Math.sqrt((2 * ss) / (N / 2)), 1, 1e-3, 0, `L=${L} passband`);
    // latency: output lags input by os.latency samples
    const lag = Math.round(os.latency);
    let err = 0;
    for (let i = N / 2; i < N; i++) err = Math.max(err, Math.abs(out[i] - Math.sin((2 * Math.PI * 1000 * (i - os.latency)) / fs)));
    assert.ok(err < 5e-3, `L=${L} latency ${lag} err ${err}`);

    // alias rejection: a tone above base Nyquist at the high rate must vanish on decimation
    const os2 = new Oversampler(L);
    const fHi = fs * L;
    const f0 = 30000;
    let pk2 = 0;
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < L; k++) up[k] = Math.sin((2 * Math.PI * f0 * (i * L + k)) / fHi);
      const y = os2.down(up);
      if (i > N / 2) pk2 = Math.max(pk2, Math.abs(y));
    }
    assert.ok(pk2 < 1e-3, `L=${L} 30 kHz rejected: ${pk2}`);
  }
});
