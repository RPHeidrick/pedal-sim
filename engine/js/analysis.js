/**
 * Offline analyses built on the Circuit engine: DC operating point table,
 * DC transfer sweep, large-signal (dynamic) transfer, oversampled rendering.
 */

import { Circuit } from './circuit.js';
import { Oversampler } from './oversample.js';

/**
 * DC operating point.
 * @returns {{ok, method, iterations, nodes, currents, devices, ms}}
 */
export function operatingPoint(desc, opts = {}) {
  const t0 = now();
  const c = new Circuit(desc, opts);
  applyControls(c, opts.controls);
  const op = c.dcOperatingPoint();
  return { ...op, ...c.snapshot(), unknowns: c.n, ms: now() - t0 };
}

/**
 * DC transfer curve: sweep the input source and solve the DC operating point
 * at each value (capacitors open). Continuation from the previous point.
 * Note: with a coupling capacitor on the input the output is flat, which is
 * the correct DC answer; use dynamicTransfer() for the large-signal curve.
 */
export function dcSweep(desc, { from = -1, to = 1, points = 201, probe = 'out', controls } = {}) {
  const c = new Circuit(desc);
  applyControls(c, controls);
  const op = c.dcOperatingPoint();
  const vin = new Float64Array(points);
  const vout = new Float64Array(points);
  const ok = new Uint8Array(points);
  if (!op.ok || !c.input) return { vin, vout, ok, opOk: op.ok };
  const pi = c.nodeIndex.get(probe);
  // start at 0 V (the op point) and walk outward in both directions
  const order = [];
  const mid = Math.round(((0 - from) / (to - from)) * (points - 1));
  const start = Math.min(points - 1, Math.max(0, mid));
  for (let i = start; i < points; i++) order.push(i);
  const x0 = Float64Array.from(c.x);
  for (let i = 0; i < points; i++) vin[i] = from + ((to - from) * i) / (points - 1);
  const run = (idx) => {
    c.input.value = vin[idx];
    c.buildRHS();
    const it = c.newton(200);
    ok[idx] = it >= 0 ? 1 : 0;
    vout[idx] = c.x[pi];
  };
  for (const i of order) run(i);
  c.x.set(x0);
  for (let i = start - 1; i >= 0; i--) run(i);
  return { vin, vout, ok, opOk: true };
}

/**
 * Render an input signal through the circuit with oversampling.
 * @param {Object} desc
 * @param {Float32Array|Float64Array} input volts at `sampleRate`
 * @param {{sampleRate?:number, oversample?:number, controls?:number[], method?:string}} opts
 * @returns {{output: Float32Array, stats: Object, op: Object, ms: number, realtime: number}}
 */
export function render(desc, input, opts = {}) {
  const fs = opts.sampleRate || 48000;
  const L = opts.oversample || 2;
  const c = new Circuit(desc, { ...opts, sampleRate: fs * L });
  applyControls(c, opts.controls);
  const op = c.reset();
  const os = new Oversampler(L);
  const vOut0 = c.x[c.outIdx];
  os.reset(0);
  // Pre-fill the decimator with the DC output so the filter does not ramp from 0.
  if (L > 1) os.downHist.fill(vOut0);
  const up = new Float64Array(L);
  const hi = new Float64Array(L);
  const output = new Float32Array(input.length);
  const t0 = now();
  for (let i = 0; i < input.length; i++) {
    os.up(input[i], up);
    for (let k = 0; k < L; k++) hi[k] = c.step(up[k]);
    output[i] = os.down(hi);
  }
  const ms = now() - t0;
  const audioMs = (input.length / fs) * 1000;
  return {
    output, op, ms, realtime: audioMs / ms, latency: os.latency,
    stats: { ...c.stats, avgIterations: c.stats.iterations / Math.max(1, c.stats.steps), unknowns: c.n, fill: c.lu.fillCount, luOps: c.lu.opCount },
    dcOut: vOut0,
  };
}

/**
 * Large-signal transfer: drive a sine and plot Vout against Vin over the
 * final period (output DC removed). Reveals clipping shape and hysteresis.
 */
export function dynamicTransfer(desc, { freq = 200, amplitude = 1, periods = 6, sampleRate = 48000, oversample = 2, controls } = {}) {
  const n = Math.round((periods * sampleRate) / freq);
  const input = new Float64Array(n);
  for (let i = 0; i < n; i++) input[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  const r = render(desc, input, { sampleRate, oversample, controls });
  const per = Math.round(sampleRate / freq);
  const lat = Math.round(r.latency);
  const vin = new Float64Array(per);
  const vout = new Float64Array(per);
  let mean = 0;
  for (let i = 0; i < per; i++) mean += r.output[n - per + i];
  mean /= per;
  for (let i = 0; i < per; i++) {
    const j = n - per + i;
    vin[i] = input[j - lat]; // align for the oversampler's latency
    vout[i] = r.output[j] - mean;
  }
  return { vin, vout, stats: r.stats, realtime: r.realtime };
}

function applyControls(c, controls) {
  if (!controls) return;
  controls.forEach((v, i) => { if (v != null) c.setControl(i, v, true); });
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
