#!/usr/bin/env node
/**
 * Offline render: netlist -> DC operating point report, waveform SVG,
 * transfer-curve SVG and a WAV of the output.
 *
 *   node tools/render.js circuits/germanium-fuzz.cir [--freq 220] [--amp 0.2]
 *        [--dur 0.5] [--signal sine|pluck|chord] [--os 2] [--out out]
 *        [--set Fuzz=0.8,Volume=0.5]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadNetlist } from '../engine/parsers/elaborate.js';
import { render, operatingPoint, dcSweep, dynamicTransfer } from '../engine/js/analysis.js';
import { sine, pluck, chord, harmonics } from '../engine/js/signals.js';
import { encodeWav } from './wav.js';
import { svgPlot } from './svg-plot.js';

export function renderFile(file, o = {}) {
  const opt = { freq: 220, amp: 0.2, dur: 0.5, signal: 'sine', os: 2, out: 'out', fs: 48000, ...o };
  const dir = path.dirname(file);
  // sibling model files are offered to .include, as the browser does with uploads
  const files = {};
  for (const f of fs.readdirSync(dir)) {
    if (/\.(lib|sub|mod|inc)$/i.test(f)) files[f] = fs.readFileSync(path.join(dir, f), 'utf8');
  }
  const desc = loadNetlist(fs.readFileSync(file, 'utf8'), { fileName: path.basename(file), files });
  const base = path.basename(file).replace(/\.[^.]+$/, '');
  const lines = [];
  const log = (s) => lines.push(s);
  for (const d of desc.diagnostics) if (d.level !== 'info') log(`${d.level}: ${d.message}${d.line ? ` (line ${d.line})` : ''}`);
  if (!desc.ok) return { ok: false, lines };

  const controls = desc.controls.map((c) => c.value);
  if (opt.set) {
    for (const kv of String(opt.set).split(',')) {
      const [k, v] = kv.split('=');
      const c = desc.controls.find((x) => x.label.toLowerCase() === k.toLowerCase() || x.name.toLowerCase() === k.toLowerCase());
      if (c) controls[c.id] = parseFloat(v);
      else log(`warning: no control named ${k}`);
    }
  }

  const op = operatingPoint(desc, { controls });
  log(`${desc.name}: ${op.unknowns} unknowns, DC op ${op.ok ? 'ok' : 'FAILED'} (${op.method}, ${op.iterations} iterations)`);
  log(`  controls: ${desc.controls.map((c) => `${c.label}=${controls[c.id].toFixed(2)}`).join(' ')}`);
  log(`  nodes: ${op.nodes.map((n) => `${n.name}=${n.v.toFixed(3)}`).join(' ')}`);
  for (const d of op.devices) {
    if (!/BJT|JFET|MOSFET|Diode|OpampCore/.test(d.type)) continue;
    log(`  ${d.name}: ${Object.entries(d.info).map(([k, v]) => `${k}=${typeof v === 'number' ? v.toPrecision(4) : v}`).join(' ')}`);
  }

  const gen = {
    sine: () => sine(opt.fs, opt.dur, opt.freq, opt.amp),
    pluck: () => pluck(opt.fs, opt.dur, opt.freq, opt.amp),
    chord: () => chord(opt.fs, opt.dur, opt.amp),
  }[opt.signal];
  const input = gen();
  const r = render(desc, input, { sampleRate: opt.fs, oversample: opt.os, controls });
  const out = r.output;
  for (let i = 0; i < out.length; i++) out[i] -= r.dcOut; // remove bias before display/listening
  log(`  transient: ${(input.length / opt.fs).toFixed(2)} s @ ${opt.fs} Hz x${opt.os} in ${r.ms.toFixed(0)} ms = ${r.realtime.toFixed(1)}x realtime, ` +
    `avg ${r.stats.avgIterations.toFixed(2)} Newton it/sample (max ${r.stats.maxIterations}), failures ${r.stats.failures}`);
  let finite = true;
  for (const v of out) if (!Number.isFinite(v)) { finite = false; break; }
  const h = opt.signal === 'sine' ? harmonics(out, opt.fs, opt.freq, 10) : null;
  if (h) log(`  output fundamental ${h.amps[0].toFixed(4)} V (gain ${(20 * Math.log10(h.amps[0] / opt.amp)).toFixed(1)} dB), THD ${(100 * h.thd).toFixed(1)} %`);

  fs.mkdirSync(opt.out, { recursive: true });
  const isSine = opt.signal === 'sine';
  const show = Math.min(out.length, Math.round(opt.fs * (isSine ? 4 / opt.freq : 0.05)));
  const s0 = isSine ? out.length - show : Math.round(opt.fs * 0.005);
  const lat = Math.round(r.latency);
  const t = Float64Array.from({ length: show }, (_, i) => ((s0 + i) / opt.fs) * 1000);
  const yin = Float64Array.from({ length: show }, (_, i) => input[s0 + i - lat] ?? 0);
  const yout = out.subarray(s0, s0 + show);
  const label = isSine ? `sine ${opt.freq} Hz ${opt.amp} V` : `${opt.signal} ${opt.amp} V`;
  fs.writeFileSync(path.join(opt.out, `${base}-wave.svg`), svgPlot([
    { x: t, y: yin, color: '#6fa8dc', label: 'input' },
    { x: t, y: yout, color: '#f0a64a', label: 'output (DC removed)' },
  ], { title: `${desc.name} - ${label}`, xlabel: 'ms', ylabel: 'V' }));

  const dyn = dynamicTransfer(desc, { freq: 200, amplitude: 1, controls });
  const dc = dcSweep(desc, { from: -1, to: 1, points: 101, controls });
  fs.writeFileSync(path.join(opt.out, `${base}-transfer.svg`), svgPlot([
    { x: dyn.vin, y: dyn.vout, color: '#f0a64a', label: 'large-signal 200 Hz, 1 V' },
    { x: dc.vin, y: dc.vout.map((v) => v - dc.vout[50]), color: '#6fa8dc', label: 'DC sweep (caps open)' },
  ], { title: `${desc.name} - transfer`, xlabel: 'Vin (V)', ylabel: 'Vout - Vout(0) (V)', width: 520, height: 420 }));

  let pk = 0;
  for (const v of out) pk = Math.max(pk, Math.abs(v));
  fs.writeFileSync(path.join(opt.out, `${base}.wav`), encodeWav(out.map((v) => (0.8 * v) / (pk || 1)), opt.fs));
  return { ok: op.ok && finite && r.stats.failures === 0, lines, op, render: r, harmonics: h, finite };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const o = {};
  let file = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const k = args[i].slice(2);
      o[k] = ['freq', 'amp', 'dur', 'os'].includes(k) ? parseFloat(args[i + 1]) : args[i + 1];
      i++;
    } else file = args[i];
  }
  if (!file) {
    console.error('usage: node tools/render.js <netlist> [--freq 220 --amp 0.2 --dur 0.5 --signal sine|pluck|chord --os 2 --set Knob=0.5]');
    process.exit(2);
  }
  const r = renderFile(file, o);
  console.log(r.lines.join('\n'));
  if (r.ok) console.log(`  wrote ${o.out || 'out'}/${path.basename(file).replace(/\.[^.]+$/, '')}{-wave.svg,-transfer.svg,.wav}`);
  process.exit(r.ok ? 0 : 1);
}
