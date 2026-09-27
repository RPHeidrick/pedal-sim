/**
 * LTspice schematic (.asc) -> SPICE netlist text.
 *
 * Lets people drop the schematic they already have straight into the app.
 * The output is an ordinary netlist that goes through engine/parsers/netlist.js and
 * engine/parsers/elaborate.js like any other.
 *
 *  1. Read WIRE / FLAG / SYMBOL / SYMATTR / TEXT records.
 *  2. Place each symbol's pins using LTspice's built-in symbol geometry and
 *     the symbol's rotation / mirror (R0..R270, M0..M270).
 *  3. Build nets: wire endpoints, pins and flags that coincide or land on a
 *     wire segment are joined (union-find). Named flags join by name.
 *  4. Apply pedal conventions: INPUT -> in, OUTPUT -> out, VCC -> vcc, 0 -> 0.
 *  5. Turn `.step param X` sweeps into knobs:
 *       R_a = {X} and R_b = {K-X} sharing a node   -> pot R=K, wiper at the shared node
 *       a lone R = {X}                             -> variable resistor (rheostat)
 *
 * Unknown symbols are reported, never silently dropped.
 */

import { parseValue } from './values.js';

// Pin positions for LTspice's built-in symbols at R0, in SPICE node order.
const PINS = {
  res: [[16, 16], [16, 96]],
  res2: [[16, 16], [16, 96]],
  cap: [[16, 0], [16, 64]],
  polcap: [[16, 0], [16, 64]],
  ind: [[16, 16], [16, 96]],
  ind2: [[16, 16], [16, 96]],
  diode: [[16, 0], [16, 64]],
  schottky: [[16, 0], [16, 64]],
  zener: [[16, 0], [16, 64]],
  led: [[16, 0], [16, 64]],
  npn: [[64, 0], [0, 48], [64, 96]],
  pnp: [[64, 0], [0, 48], [64, 96]],
  npn2: [[64, 0], [0, 48], [64, 96]],
  pnp2: [[64, 0], [0, 48], [64, 96]],
  njf: [[48, 0], [0, 64], [48, 96]],
  pjf: [[48, 0], [0, 64], [48, 96]],
  nmos: [[48, 0], [0, 80], [48, 96], [48, 96]],
  pmos: [[48, 0], [0, 80], [48, 96], [48, 96]],
  voltage: [[0, 16], [0, 96]],
  current: [[0, 0], [0, 80]],
  // 5-pin op amp (ADI / TI vendor symbols and opamp2): in+ in- v+ v- out
  opamp5: [[-32, 80], [-32, 48], [0, 32], [0, 96], [32, 64]],
};

const PREFIX = {
  res: 'R', res2: 'R', cap: 'C', polcap: 'C', ind: 'L', ind2: 'L',
  diode: 'D', schottky: 'D', zener: 'D', led: 'D',
  npn: 'Q', pnp: 'Q', npn2: 'Q', pnp2: 'Q', njf: 'J', pjf: 'J', nmos: 'M', pmos: 'M',
  voltage: 'V', current: 'I', opamp5: 'X',
};

/** Map a symbol path such as "OpAmps\\TL072" or "npn" to a pin table key. */
function symbolKind(sym) {
  const base = sym.replace(/\\\\/g, '\\').split('\\').pop().toLowerCase();
  if (PINS[base]) return { kind: base, model: null };
  if (/^opamps?$/i.test(sym.split('\\')[0]) || /^opamp2$/.test(base)) return { kind: 'opamp5', model: base.toUpperCase() };
  return null;
}

/** Rotate, then mirror (LTspice order), a symbol-relative point. */
function transform([x, y], rot) {
  let p;
  switch (parseInt(rot.slice(1), 10)) {
    case 90: p = [-y, x]; break;
    case 180: p = [-x, -y]; break;
    case 270: p = [y, -x]; break;
    default: p = [x, y];
  }
  if (rot[0] === 'M') p[0] = -p[0];
  return p;
}

const NODE_ALIASES = { input: 'in', in: 'in', output: 'out', out: 'out', vcc: 'vcc', '9v': 'vcc', 'v+': 'vcc', gnd: '0', '0': '0' };

/**
 * @param {string} text contents of an .asc file (any line endings)
 * @param {{name?: string}} [opts]
 * @returns {{netlist: string, warnings: string[]}}
 */
export function ascToNetlist(text, opts = {}) {
  // .asc files are Windows-1252 or UTF-16; µ can arrive as U+00B5, U+03BC or a replacement char.
  const src = String(text).replace(/^﻿/, '').replace(/\u0000/g, '');
  const lines = src.split(/\r?\n/);
  const warnings = [];
  const wires = [];
  const flags = [];
  const symbols = [];
  const directives = [];
  let cur = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const [tag, ...rest] = line.split(/\s+/);
    if (tag === 'WIRE') wires.push(rest.slice(0, 4).map(Number));
    else if (tag === 'FLAG') flags.push({ x: +rest[0], y: +rest[1], name: rest.slice(2).join(' ') });
    else if (tag === 'SYMBOL') {
      cur = { sym: rest[0], x: +rest[1], y: +rest[2], rot: rest[3] || 'R0', attrs: {} };
      symbols.push(cur);
    } else if (tag === 'SYMATTR' && cur) cur.attrs[rest[0]] = rest.slice(1).join(' ');
    else if (tag === 'TEXT') {
      const m = line.match(/^TEXT\s+\S+\s+\S+\s+\S+\s+\S+\s+!(.*)$/);
      if (m) directives.push(...m[1].split(/\\n/).map((s) => s.trim()).filter(Boolean));
      cur = null;
    } else if (tag !== 'SYMATTR' && tag !== 'WINDOW') cur = null;
  }

  // --- union-find over grid points ------------------------------------------
  const parent = new Map();
  const key = (x, y) => `${x},${y}`;
  const find = (k) => {
    if (!parent.has(k)) parent.set(k, k);
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r);
    while (parent.get(k) !== r) { const n = parent.get(k); parent.set(k, r); k = n; }
    return r;
  };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  const points = [];
  for (const [x1, y1, x2, y2] of wires) {
    union(key(x1, y1), key(x2, y2));
    points.push([x1, y1], [x2, y2]);
  }

  // --- place symbol pins ------------------------------------------------------
  const parts = [];
  for (const s of symbols) {
    const k = symbolKind(s.sym);
    const name = s.attrs.InstName || `?${s.sym}`;
    if (!k) { warnings.push(`${name}: symbol "${s.sym}" is not supported yet and was skipped`); continue; }
    const pins = PINS[k.kind].map((p) => { const [dx, dy] = transform(p, s.rot); return [s.x + dx, s.y + dy]; });
    pins.forEach((p) => { find(key(...p)); points.push(p); });
    parts.push({ ...s, ...k, name, pins });
  }
  for (const f of flags) { find(key(f.x, f.y)); points.push([f.x, f.y]); }

  // T-junctions: any point lying inside a wire segment joins that wire.
  for (const [x1, y1, x2, y2] of wires) {
    for (const [px, py] of points) {
      const inX = Math.min(x1, x2) <= px && px <= Math.max(x1, x2);
      const inY = Math.min(y1, y2) <= py && py <= Math.max(y1, y2);
      if (!inX || !inY) continue;
      const cross = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1);
      if (cross === 0) union(key(px, py), key(x1, y1));
    }
  }

  // Named flags: same name -> same net. Pick the net's name.
  const netName = new Map();
  const byFlag = new Map();
  for (const f of flags) {
    const lower = f.name.toLowerCase();
    const name = NODE_ALIASES[lower] ?? lower.replace(/[^a-z0-9_]/g, '_');
    const root = find(key(f.x, f.y));
    if (byFlag.has(name)) union(root, byFlag.get(name));
    byFlag.set(name, find(key(f.x, f.y)));
  }
  for (const [name, root] of byFlag) {
    const r = find(root);
    const prev = netName.get(r);
    // ground and the pedal conventions win over arbitrary labels
    if (!prev || name === '0' || (['in', 'out', 'vcc'].includes(name) && prev !== '0')) netName.set(r, name);
  }
  let auto = 0;
  const node = (p) => {
    const r = find(key(...p));
    if (!netName.has(r)) netName.set(r, `n${String(++auto).padStart(3, '0')}`);
    return netName.get(r);
  };

  // --- parameters and sweeps --------------------------------------------------
  const params = new Map();
  const steps = new Map();
  const kept = [];
  for (const d of directives) {
    const low = d.toLowerCase();
    let m;
    if ((m = d.match(/^\.step\s+param\s+(\w+)\s+([^\s]+)\s+([^\s]+)/i))) steps.set(m[1].toLowerCase(), { name: m[1], from: m[2], to: m[3] });
    else if (low.startsWith('.param')) {
      for (const pm of d.slice(6).matchAll(/(\w+)\s*=\s*([^\s]+)/g)) params.set(pm[1].toLowerCase(), pm[2]);
      kept.push(d);
    } else if (/^\.(tran|ac|op|dc|noise|meas|measure|save|backanno|four|step)\b/i.test(d)) continue;
    else kept.push(d);
  }

  // --- emit elements ----------------------------------------------------------
  const val = (s) => String(s || '').replace(/[µμ�]/g, 'u');
  const out = [];
  const usedDefaultDiode = { v: false };
  const resistors = parts.filter((p) => PREFIX[p.kind] === 'R');
  const knobs = new Map(); // param -> {pair?: [rX, rKX], k?: string}

  for (const [pname] of steps) {
    const rx = resistors.find((r) => val(r.attrs.Value).replace(/\s/g, '').toLowerCase() === `{${pname}}`);
    if (!rx) continue;
    const rkx = resistors.find((r) => r !== rx && new RegExp(`^\\{\\s*([^-{}]+?)\\s*-\\s*${pname}\\s*\\}$`, 'i').test(val(r.attrs.Value)));
    if (rkx) knobs.set(pname, { rx, rkx, k: val(rkx.attrs.Value).match(/^\{\s*([^-{}]+?)\s*-/)[1] });
    else knobs.set(pname, { rx });
  }
  const knobParts = new Set([...knobs.values()].flatMap((k) => [k.rx, k.rkx].filter(Boolean)));

  for (const p of parts) {
    if (knobParts.has(p)) continue;
    const pre = PREFIX[p.kind];
    const nm = p.name.toUpperCase().startsWith(pre) ? p.name : `${pre}${p.name}`;
    const nodes = p.pins.map(node);
    let v = val(p.attrs.Value);
    if (pre === 'D' && !v) { v = 'DDEFAULT'; usedDefaultDiode.v = true; }
    if (pre === 'Q' && !v) v = p.kind.startsWith('pnp') ? '2N3906' : '2N3904';
    if (pre === 'X') v = p.model;
    if (pre === 'V' || pre === 'I') {
      v = [p.attrs.Value, p.attrs.Value2].filter(Boolean).map(val).join(' ');
      if (p.attrs.SpiceLine) v += ` ${val(p.attrs.SpiceLine)}`;
      if (!v) v = '0';
    }
    out.push(`${nm} ${nodes.join(' ')} ${v}`.trim());
  }

  // knobs
  const rotOf = (v, total) => { const r = parseValue(val(v)) / parseValue(val(total)); return Number.isFinite(r) ? Math.min(1, Math.max(0, r)).toFixed(3) : '0.5'; };
  const knobLines = [];
  for (const [pname, k] of knobs) {
    const st = steps.get(pname);
    const label = st.name.charAt(0).toUpperCase() + st.name.slice(1);
    const def = params.get(pname) || st.to;
    if (k.rkx) {
      // R_x: a -- w  (value X),  R_kx: w -- b  (value K - X)  ->  pot a w b, R1w = X
      const [a1, a2] = k.rx.pins.map(node);
      const [b1, b2] = k.rkx.pins.map(node);
      const w = [a1, a2].find((n) => n === b1 || n === b2);
      if (!w) { warnings.push(`${pname}: {${pname}} and {${k.k}-${pname}} resistors do not share a node; kept as fixed values`); out.push(`${k.rx.name} ${a1} ${a2} {${pname}}`, `${k.rkx.name} ${b1} ${b2} {${k.k}-${pname}}`); continue; }
      const a = a1 === w ? a2 : a1;
      const b = b1 === w ? b2 : b1;
      out.push(`X${label} ${a} ${w} ${b} pot R=${k.k} taper=lin rot=${rotOf(def, k.k)}`);
    } else {
      const [a, b] = k.rx.pins.map(node);
      out.push(`X${label} ${a} ${b} ${b} pot R=${st.to} taper=lin rot=${rotOf(def, st.to)}`);
    }
    knobLines.push(`*@pot X${label} label="${label}"`);
    if (!params.has(pname)) params.set(pname, def);
  }

  const header = [
    `* ${opts.name || 'Imported LTspice schematic'} (converted from .asc)`,
    `*@pedal name="${(opts.name || 'Imported').replace(/"/g, '')}"`,
    ...knobLines,
  ];
  const paramLine = params.size ? [`.param ${[...params].map(([k, v]) => `${k}=${v}`).join(' ')}`] : [];
  const extra = usedDefaultDiode.v ? ['.model DDEFAULT D(IS=1e-14 N=1 RS=0)'] : [];
  const kept2 = kept.filter((d) => !d.toLowerCase().startsWith('.param'));
  const netlist = [...header, ...paramLine, ...out, ...kept2, ...extra, '.end', ''].join('\n');

  if (!byFlag.has('in')) warnings.push('No net labelled IN or INPUT; label the input net so the audio source can drive it');
  if (!byFlag.has('out')) warnings.push('No net labelled OUT or OUTPUT; label the output net');
  return { netlist, warnings };
}
