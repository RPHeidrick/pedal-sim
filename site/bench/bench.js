/**
 * Engine bench (phase 1): load a netlist, turn its knobs, and inspect the DC
 * operating point, transfer curves and an offline transient render. All
 * simulation runs in site/bench/sim-worker.js.
 */
import { STARTER_PEDALS, starterUrl } from '../../circuits/index.js';
import { Plot } from './plot.js';
import { taper } from '../../engine/js/taper.js';
import { formatEng } from '../../engine/parsers/values.js';
import { ascToNetlist } from '../../engine/parsers/asc.js';

const $ = (id) => document.getElementById(id);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const state = {
  text: '',
  fileName: 'netlist.cir',
  files: {},          // companion files for .include
  controls: {},       // control name -> value (survives rebuilds)
  runId: 0,
  last: null,
};

const worker = new Worker(new URL('./sim-worker.js', import.meta.url), { type: 'module' });
worker.onmessage = (e) => onResult(e.data);
worker.onerror = (e) => setStatus(`worker error: ${e.message}`, 'err');

const plots = {
  dc: new Plot($('plot-dc'), { xlabel: 'Vin', ylabel: 'ΔVout', equal: false }),
  dyn: new Plot($('plot-dyn'), { xlabel: 'Vin', ylabel: 'Vout' }),
  tran: new Plot($('plot-tran'), { xlabel: 'ms', ylabel: 'V' }),
};

// --- source selection -------------------------------------------------------
for (const p of STARTER_PEDALS) {
  const o = document.createElement('option');
  o.value = p.id;
  o.textContent = p.name;
  $('starter').append(o);
}
const custom = document.createElement('option');
custom.value = '';
custom.textContent = '(imported)';
custom.hidden = true;
$('starter').append(custom);

$('starter').addEventListener('change', () => { if ($('starter').value) loadStarter($('starter').value); });

async function loadStarter(id) {
  const p = STARTER_PEDALS.find((x) => x.id === id);
  const res = await fetch(starterUrl(p.file));
  state.text = await res.text();
  state.fileName = p.file;
  state.files = {};
  state.controls = {};
  $('netlist').value = state.text;
  renderCompanions();
  run();
}

$('file').addEventListener('change', async (e) => {
  const list = [...e.target.files];
  if (!list.length) return;
  const isNetlist = (f) => /\.(cir|net|sp|spi|ckt|asc)$/i.test(f.name);
  const main = list.find(isNetlist) || list[0];
  state.fileName = main.name;
  state.text = await main.text();
  if (/\.asc$/i.test(main.name)) {
    // LTspice schematic: convert to a netlist first (engine/parsers/asc.js)
    const { netlist, warnings } = ascToNetlist(state.text, { name: main.name.replace(/\.asc$/i, '') });
    state.text = netlist + (warnings.length ? warnings.map((w) => `* WARNING: ${w}\n`).join('') : '');
    state.fileName = main.name.replace(/\.asc$/i, '.cir');
  }
  state.files = {};
  for (const f of list) if (f !== main) state.files[f.name] = await f.text();
  state.controls = {};
  $('netlist').value = state.text;
  $('starter').value = '';
  renderCompanions();
  run();
  e.target.value = '';
});

function renderCompanions() {
  const names = Object.keys(state.files);
  $('companions').textContent = `${state.fileName}${names.length ? `  + ${names.join(', ')}` : ''}`;
}

$('rebuild').addEventListener('click', () => { state.text = $('netlist').value; run(); });
$('netlist').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); state.text = $('netlist').value; run(); }
});
for (const id of ['sweep', 'sig-kind', 'sig-freq', 'sig-amp', 'sig-dur', 'os']) $(id).addEventListener('change', () => run());

// --- run --------------------------------------------------------------------
let debounce = 0;
function run(delay = 0) {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    const id = ++state.runId;
    setStatus('simulating…', 'busy');
    worker.postMessage({
      id,
      text: state.text,
      fileName: state.fileName,
      files: state.files,
      controls: state.controls,
      sweep: Math.max(0.01, parseFloat($('sweep').value) || 1),
      oversample: parseInt($('os').value, 10),
      signal: {
        kind: $('sig-kind').value,
        freq: parseFloat($('sig-freq').value) || 220,
        amp: parseFloat($('sig-amp').value) || 0.1,
        dur: Math.min(5, Math.max(0.05, parseFloat($('sig-dur').value) || 1)),
      },
    });
  }, delay);
}

function setStatus(text, cls = '') {
  $('status').textContent = text;
  $('status').className = `status ${cls}`;
}

function onResult(r) {
  if (r.id !== state.runId) return; // stale
  if (r.error) { setStatus('engine error', 'err'); renderDiagnostics([{ level: 'error', message: r.error }]); return; }
  const s = r.summary;
  $('pedal-name').textContent = s.name || 'Netlist';
  $('counts').textContent = Object.entries(s.counts).map(([k, v]) => `${v}×${k}`).join(' ');
  renderDiagnostics(s.diagnostics);
  renderControls(s.controls);
  if (!s.ok) {
    setStatus('netlist has errors', 'err');
    clearResults();
    return;
  }
  state.last = r;
  setStatus(`done in ${r.ms.toFixed(0)} ms`);
  renderOp(r.op);
  renderTransfer(r);
  renderTransient(r.tran);
}

// --- diagnostics ------------------------------------------------------------
function renderDiagnostics(list) {
  const ul = $('diagnostics');
  ul.replaceChildren();
  const order = { error: 0, warning: 1, info: 2 };
  const sorted = [...list].sort((a, b) => order[a.level] - order[b.level]);
  for (const d of sorted) {
    const li = document.createElement('li');
    li.className = d.level;
    li.innerHTML = `<span class="lvl"></span><span class="ln"></span><span class="msg"></span>`;
    li.querySelector('.lvl').textContent = d.level;
    li.querySelector('.ln').textContent = d.line ? `L${d.line}` : '';
    li.querySelector('.msg').textContent = d.file && d.file !== state.fileName ? `${d.message} (${d.file})` : d.message;
    ul.append(li);
  }
  const n = (lvl) => list.filter((d) => d.level === lvl).length;
  $('diag-count').textContent = `${n('error')} err · ${n('warning')} warn · ${n('info')} info`;
}

// --- controls ---------------------------------------------------------------
function renderControls(controls) {
  const box = $('controls');
  box.replaceChildren();
  if (!controls.length) { box.innerHTML = '<span class="dim">No pots or switches recognised.</span>'; return; }
  for (const c of controls) {
    const v = state.controls[c.name] ?? c.value;
    const row = document.createElement('div');
    row.className = 'ctl';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = c.label;
    label.title = c.name;
    const val = document.createElement('span');
    val.className = 'val';
    const input = document.createElement('input');
    if (c.kind === 'pot') {
      input.type = 'range';
      input.min = 0; input.max = 1; input.step = 0.005;
      input.value = v;
      const show = () => {
        const f = taper(c.taper, +input.value);
        val.textContent = `${(+input.value * 10).toFixed(1)} · ${formatEng(c.r * f, 3)}/${formatEng(c.r * (1 - f), 3)} ${c.taper}`;
      };
      show();
      input.addEventListener('input', () => { state.controls[c.name] = +input.value; show(); run(80); });
    } else {
      input.type = 'checkbox';
      input.checked = v >= 0.5;
      val.textContent = input.checked ? 'B (1)' : 'A (0)';
      input.addEventListener('change', () => {
        state.controls[c.name] = input.checked ? 1 : 0;
        val.textContent = input.checked ? 'B (1)' : 'A (0)';
        run();
      });
    }
    row.append(label, input, val);
    box.append(row);
  }
}

// --- operating point ----------------------------------------------------------
function renderOp(op) {
  $('op-meta').textContent = op.ok
    ? `${op.unknowns} unknowns · ${op.method} · ${op.iterations} it · ${op.ms.toFixed(1)} ms`
    : 'DID NOT CONVERGE';
  const nt = $('op-nodes');
  nt.innerHTML = '<thead><tr><th>Node</th><th style="text-align:right">V</th></tr></thead>';
  const tb = document.createElement('tbody');
  for (const n of op.nodes) tb.append(tr([n.name, num(n.v, 4)], [null, 'num']));
  for (const c of op.currents) {
    if (c.name.includes('#')) continue;
    tb.append(tr([c.name, `${formatEng(c.i, 4)}A`], [null, 'num']));
  }
  nt.append(tb);

  const dt = $('op-devices');
  dt.innerHTML = '<thead><tr><th>Device</th><th>Region</th><th>Operating point</th></tr></thead>';
  const tb2 = document.createElement('tbody');
  const skip = /^(Resistor|Capacitor|VSource|ISource|Inductor|VCVS|VCCS|CCCS|CCVS)$/;
  for (const d of op.devices) {
    if (skip.test(d.type)) continue;
    const info = { ...d.info };
    const region = info.region || '';
    delete info.region;
    const kv = Object.entries(info).map(([k, v]) => `${k} <b>${typeof v === 'number' ? fmtVal(k, v) : v}</b>`).join('  ');
    const row = tr([d.name, '', ''], [null, null, 'kv']);
    if (region) row.children[1].innerHTML = `<span class="tag ${region}">${region}</span>`;
    row.children[2].innerHTML = kv;
    tb2.append(row);
  }
  dt.append(tb2);
}

function fmtVal(k, v) {
  if (/^V/.test(k)) return `${v.toFixed(4)}`;
  if (/^I/.test(k)) return `${formatEng(v, 4)}A`;
  if (/^g/.test(k)) return `${formatEng(v, 3)}S`;
  if (/^R/.test(k)) return `${formatEng(v, 3)}Ω`;
  return +v.toPrecision(4);
}

function tr(cells, classes = []) {
  const row = document.createElement('tr');
  cells.forEach((c, i) => {
    const td = document.createElement('td');
    if (classes[i]) td.className = classes[i];
    td.textContent = c;
    row.append(td);
  });
  return row;
}
const num = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : String(v));

// --- plots ----------------------------------------------------------------------
function renderTransfer(r) {
  const mid = r.dc.vout[Math.floor(r.dc.vout.length / 2)];
  const rel = Float64Array.from(r.dc.vout, (v) => v - mid);
  plots.dc.draw([{ x: r.dc.vin, y: rel, color: css('--c-accent-2'), label: 'DC' }]);
  plots.dyn.draw([
    { x: r.dyn.vin, y: r.dyn.vin, color: css('--c-text-faint'), width: 1, dash: [3, 3], label: 'unity' },
    { x: r.dyn.vin, y: r.dyn.vout, color: css('--c-accent'), label: 'out vs in' },
  ]);
}

function renderTransient(t) {
  const fs = t.fs;
  const sig = $('sig-kind').value;
  const n = t.output.length;
  const span = sig === 'sine' ? Math.min(n, Math.round((4 * fs) / (parseFloat($('sig-freq').value) || 220))) : Math.min(n, Math.round(0.06 * fs));
  const s0 = sig === 'sine' ? n - span : Math.min(n - span, Math.round(0.004 * fs));
  const lat = Math.round(t.latency);
  const x = Float64Array.from({ length: span }, (_, i) => ((s0 + i) / fs) * 1000);
  const yin = Float64Array.from({ length: span }, (_, i) => t.input[s0 + i - lat] ?? 0);
  const yout = t.output.subarray(s0, s0 + span);
  plots.tran.draw([
    { x, y: yin, color: css('--c-accent-2'), label: 'input', width: 1.2 },
    { x, y: yout, color: css('--c-accent'), label: 'output' },
  ]);
  const s = t.stats;
  const h = t.harmonics;
  const cls = s.failures ? 'style="color:var(--c-err)"' : '';
  $('tran-stats').innerHTML = [
    `<b>${t.realtime.toFixed(1)}×</b> realtime`,
    `${(n / fs).toFixed(2)} s in <b>${t.ms.toFixed(0)}</b> ms`,
    `Newton <b>${s.avgIterations.toFixed(2)}</b> avg / ${s.maxIterations} max`,
    `<span ${cls}>failures <b>${s.failures}</b></span>`,
    `${s.unknowns} unknowns · LU ${s.luOps} ops`,
    `latency <b>${t.latency.toFixed(1)}</b> smp`,
    h ? `gain <b>${(20 * Math.log10(h.amps[0] / (parseFloat($('sig-amp').value) || 1))).toFixed(1)}</b> dB · THD <b>${(100 * h.thd).toFixed(1)}</b>%` : '',
    `V(out)dc ${t.dcOut.toFixed(3)} V`,
  ].filter(Boolean).join(' · ');
}

function clearResults() {
  $('op-nodes').replaceChildren();
  $('op-devices').replaceChildren();
  $('op-meta').textContent = '';
  $('tran-stats').textContent = '';
  for (const p of Object.values(plots)) p.draw([]);
}

// --- audio (offline render playback only in phase 1) --------------------------
let ctx = null;
let src = null;
function play(which) {
  const t = state.last?.tran;
  if (!t) return;
  ctx ??= new AudioContext({ sampleRate: t.fs });
  stop();
  const data = which === 'out' ? t.output : t.input;
  let pk = 0;
  for (const v of data) pk = Math.max(pk, Math.abs(v));
  const buf = ctx.createBuffer(1, data.length, t.fs);
  const ch = buf.getChannelData(0);
  const g = (parseFloat($('gain').value) || 0.5) / (pk || 1);
  for (let i = 0; i < data.length; i++) ch[i] = data[i] * g;
  src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
}
function stop() { try { src?.stop(); } catch { /* already stopped */ } src = null; }
$('play-out').addEventListener('click', () => play('out'));
$('play-in').addEventListener('click', () => play('in'));
$('stop').addEventListener('click', stop);

loadStarter(STARTER_PEDALS[0].id);
