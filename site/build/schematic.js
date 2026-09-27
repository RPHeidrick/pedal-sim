/**
 * Build it yourself: draw a schematic (SVG) straight from the pedal's netlist.
 * Parts are placed left to right in the order the signal reaches them. Instead of long wires,
 * every pin carries a net name tag: pins with the same name are connected, the way many
 * professional schematics are drawn. Ground and the 9 V supply use their usual symbols.
 */
import { fmt, parseValue, nearestE24, nearestPot } from './parts.js';

const CW = 150, CH = 150, PAD = 30, HEAD = 70;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const isRail = (n) => n === '0' || n === 'vcc' || /^vref|^bias|^vb$/i.test(n);

/** Signal order: breadth first from the input, through signal nets only. */
function columns(net) {
  const dist = new Map([['in', 0]]);
  const partCol = new Map();
  let frontier = ['in'];
  for (let d = 0; frontier.length && d < 50; d++) {
    const next = [];
    for (const p of net.parts) {
      if (partCol.has(p)) continue;
      if (p.nodes.some((n) => frontier.includes(n))) {
        partCol.set(p, d);
        for (const n of p.nodes) if (!isRail(n) && !dist.has(n)) { dist.set(n, d + 1); next.push(n); }
      }
    }
    frontier = next;
  }
  const last = Math.max(0, ...partCol.values()) + 1;
  for (const p of net.parts) if (!partCol.has(p)) partCol.set(p, last);
  const cols = [];
  for (const p of net.parts) (cols[partCol.get(p)] = cols[partCol.get(p)] || []).push(p);
  // keep the drawing compact: at most 3 parts stacked, the rest go into the next column
  const out = [];
  for (const c of cols.filter(Boolean)) for (let i = 0; i < c.length; i += 3) out.push(c.slice(i, i + 3));
  return out;
}

function label(net, supply) {
  if (net === 'in') return 'IN';
  if (net === 'out') return 'OUT';
  if (/^vref/i.test(net)) return 'VREF 4.5V';
  return net.toUpperCase();
}

/** A pin end: a ground symbol, a supply flag, or a net name tag. */
function pinEnd(x, y, net, dir, supply) {
  // dir: direction the lead leaves the part: 'up' | 'down' | 'left' | 'right'
  const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
  const ex = x + d[0] * 16, ey = y + d[1] * 16;
  let s = `<line x1="${x}" y1="${y}" x2="${ex}" y2="${ey}" class="w"/>`;
  if (net === '0') {
    // ground: always drawn pointing down from the lead end
    s += `<line x1="${ex - 9}" y1="${ey}" x2="${ex + 9}" y2="${ey}" class="w"/><line x1="${ex - 6}" y1="${ey + 4}" x2="${ex + 6}" y2="${ey + 4}" class="w"/><line x1="${ex - 3}" y1="${ey + 8}" x2="${ex + 3}" y2="${ey + 8}" class="w"/>`;
  } else if (net === 'vcc') {
    const t = supply < 0 ? `−${Math.abs(supply)}V` : `+${supply}V`;
    s += `<line x1="${ex - 9}" y1="${ey}" x2="${ex + 9}" y2="${ey}" class="w"/><text x="${ex}" y="${dir === 'down' ? ey + 13 : ey - 5}" class="rail" text-anchor="middle">${t}</text>`;
  } else {
    const t = label(net, supply);
    const w = t.length * 6.4 + 10;
    const tx = dir === 'left' ? ex - w : dir === 'right' ? ex : ex - w / 2;
    const ty = dir === 'up' ? ey - 16 : dir === 'down' ? ey : ey - 8;
    const cls = net === 'in' || net === 'out' ? 'tag io' : isRail(net) ? 'tag rail-tag' : 'tag';
    s += `<rect x="${tx}" y="${ty}" width="${w}" height="16" rx="8" class="${cls}"/><text x="${tx + w / 2}" y="${ty + 12}" text-anchor="middle" class="tagt">${esc(t)}</text>`;
  }
  return s;
}

function sym(p, cx, cy, supply) {
  const val = p.kind === 'resistor' ? `${fmt(nearestE24(parseValue(p.value)))}` : p.kind === 'capacitor' ? `${fmt(parseValue(p.value))}F` : p.kind === 'pot' ? `${fmt(nearestPot(parseValue(p.value)))} ${p.taper === 'log' ? 'A' : 'B'}` : p.value;
  const name = p.kind === 'pot' ? `${p.label.toUpperCase()}` : p.ref.replace(/^X/, '');
  const txt = (x, anchor = 'start') => `<text x="${x}" y="${cy - 4}" class="ref" text-anchor="${anchor}">${esc(name)}</text><text x="${x}" y="${cy + 12}" class="val" text-anchor="${anchor}">${esc(val)}</text>`;
  const top = cy - 38, bot = cy + 38;
  const lead = (y1, y2) => `<line x1="${cx}" y1="${y1}" x2="${cx}" y2="${y2}" class="w"/>`;
  let s = '';
  if (p.kind === 'resistor' || p.kind === 'pot') {
    s += lead(top, cy - 22) + lead(cy + 22, bot);
    s += `<polyline points="${cx},${cy - 22} ${cx + 7},${cy - 18} ${cx - 7},${cy - 11} ${cx + 7},${cy - 4} ${cx - 7},${cy + 4} ${cx + 7},${cy + 11} ${cx - 7},${cy + 18} ${cx},${cy + 22}" class="w" fill="none"/>`;
    s += pinEnd(cx, top, p.nodes[0], 'up', supply) + pinEnd(cx, bot, p.nodes[p.kind === 'pot' ? 2 : 1], 'down', supply);
    if (p.kind === 'pot') {
      s += `<line x1="${cx + 26}" y1="${cy}" x2="${cx + 10}" y2="${cy}" class="w"/><polygon points="${cx + 9},${cy} ${cx + 16},${cy - 4} ${cx + 16},${cy + 4}" class="fill"/>`;
      s += pinEnd(cx + 26, cy, p.nodes[1], 'right', supply);
      s += txt(cx - 12, 'end');
    } else s += txt(cx + 14);
  } else if (p.kind === 'capacitor') {
    const pol = parseValue(p.value) >= 1e-6;
    s += lead(top, cy - 5) + lead(cy + 5, bot);
    s += `<line x1="${cx - 12}" y1="${cy - 5}" x2="${cx + 12}" y2="${cy - 5}" class="w"/>`;
    s += pol ? `<path d="M${cx - 12},${cy + 8} Q${cx},${cy + 2} ${cx + 12},${cy + 8}" class="w" fill="none"/><text x="${cx - 16}" y="${cy - 8}" class="val">+</text>` : `<line x1="${cx - 12}" y1="${cy + 5}" x2="${cx + 12}" y2="${cy + 5}" class="w"/>`;
    s += pinEnd(cx, top, p.nodes[0], 'up', supply) + pinEnd(cx, bot, p.nodes[1], 'down', supply);
    s += txt(cx + 16);
  } else if (p.kind === 'diode' || p.kind === 'led') {
    // SPICE: anode first. Drawn anode on top, current flowing down.
    s += lead(top, cy - 8) + lead(cy + 8, bot);
    s += `<polygon points="${cx - 9},${cy - 8} ${cx + 9},${cy - 8} ${cx},${cy + 7}" class="fill"/><line x1="${cx - 9}" y1="${cy + 8}" x2="${cx + 9}" y2="${cy + 8}" class="w"/>`;
    if (p.kind === 'led') s += `<path d="M${cx + 11},${cy - 4} l8,-6 M${cx + 13},${cy + 2} l8,-6" class="w"/>`;
    s += pinEnd(cx, top, p.nodes[0], 'up', supply) + pinEnd(cx, bot, p.nodes[1], 'down', supply);
    s += txt(cx + 16);
  } else if (p.kind === 'bjt' || p.kind === 'jfet' || p.kind === 'mosfet') {
    // BJT nodes: C B E. JFET/MOSFET nodes: D G S.
    const pnp = /^(AC|NKT|OC|2N1309|2N3906|2N5087|GE)/i.test(p.value) || p.model === 'pnp';
    s += `<circle cx="${cx}" cy="${cy}" r="18" class="w" fill="none"/>`;
    s += `<line x1="${cx - 6}" y1="${cy - 11}" x2="${cx - 6}" y2="${cy + 11}" class="w"/>`;
    s += `<line x1="${cx - 30}" y1="${cy}" x2="${cx - 6}" y2="${cy}" class="w"/>`;
    s += `<line x1="${cx - 6}" y1="${cy - 5}" x2="${cx + 8}" y2="${cy - 15}" class="w"/><line x1="${cx - 6}" y1="${cy + 5}" x2="${cx + 8}" y2="${cy + 15}" class="w"/>`;
    s += lead(top, cy - 15).replace(`x1="${cx}"`, `x1="${cx + 8}"`).replace(`x2="${cx}"`, `x2="${cx + 8}"`);
    s += lead(cy + 15, bot).replace(`x1="${cx}"`, `x1="${cx + 8}"`).replace(`x2="${cx}"`, `x2="${cx + 8}"`);
    if (p.kind === 'bjt') s += pnp ? `<polygon points="${cx - 4},${cy + 6} ${cx + 3},${cy + 7} ${cx},${cy + 12}" class="fill"/>` : `<polygon points="${cx + 8},${cy + 15} ${cx + 1},${cy + 14} ${cx + 5},${cy + 9}" class="fill"/>`;
    else s += `<polygon points="${cx - 12},${cy} ${cx - 18},${cy - 4} ${cx - 18},${cy + 4}" class="fill"/>`;
    s += pinEnd(cx + 8, top, p.nodes[0], 'up', supply) + pinEnd(cx - 30, cy, p.nodes[1], 'left', supply) + pinEnd(cx + 8, bot, p.nodes[2], 'down', supply);
    s += `<text x="${cx + 12}" y="${cy - 22}" class="pin">${p.kind === 'bjt' ? 'C' : 'D'}</text><text x="${cx + 12}" y="${cy + 30}" class="pin">${p.kind === 'bjt' ? 'E' : 'S'}</text>`;
    s += txt(cx + 24);
  } else if (p.kind === 'opamp') {
    // nodes: + in, − in, V+, V−, out
    s += `<polygon points="${cx - 24},${cy - 26} ${cx - 24},${cy + 26} ${cx + 22},${cy}" class="w" fill="none"/>`;
    s += `<text x="${cx - 20}" y="${cy - 8}" class="pin">+</text><text x="${cx - 20}" y="${cy + 16}" class="pin">−</text>`;
    s += `<line x1="${cx - 40}" y1="${cy - 12}" x2="${cx - 24}" y2="${cy - 12}" class="w"/><line x1="${cx - 40}" y1="${cy + 12}" x2="${cx - 24}" y2="${cy + 12}" class="w"/>`;
    s += `<line x1="${cx + 22}" y1="${cy}" x2="${cx + 34}" y2="${cy}" class="w"/>`;
    s += `<line x1="${cx - 2}" y1="${cy - 16}" x2="${cx - 2}" y2="${top}" class="w"/><line x1="${cx - 2}" y1="${cy + 16}" x2="${cx - 2}" y2="${bot}" class="w"/>`;
    s += pinEnd(cx - 40, cy - 12, p.nodes[0], 'left', supply) + pinEnd(cx - 40, cy + 12, p.nodes[1], 'left', supply) + pinEnd(cx + 34, cy, p.nodes[4], 'right', supply);
    s += pinEnd(cx - 2, top, p.nodes[2], 'up', supply) + pinEnd(cx - 2, bot, p.nodes[3], 'down', supply);
    s += `<text x="${cx + 8}" y="${cy - 30}" class="ref">${esc(p.ref.replace(/^X/, ''))}</text><text x="${cx + 8}" y="${cy + 42}" class="val">${esc(p.value)}</text>`;
  } else {
    s += `<rect x="${cx - 14}" y="${cy - 14}" width="28" height="28" class="w" fill="none"/>` + txt(cx + 18);
  }
  return s;
}

/** @returns {string} standalone SVG */
export function schematicSvg(net, { title = net.name, colors = {} } = {}) {
  const cols = columns(net);
  const rows = Math.max(...cols.map((c) => c.length));
  const W = PAD * 2 + cols.length * CW + 40, H = HEAD + PAD + rows * CH + 30;
  const c = { bg: '#ffffff', ink: '#1b1b1b', accent: '#e05a00', tag: '#fff3e8', ...colors };
  let body = '';
  cols.forEach((col, i) => col.forEach((p, j) => { body += `<g data-ref="${p.ref}">${sym(p, PAD + 40 + i * CW + CW / 2 - 20, HEAD + PAD + j * CH + CH / 2, net.supply)}</g>`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Inter, Arial, sans-serif">
<style>.w{stroke:${c.ink};stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}.fill{fill:${c.ink}}.ref{font-size:11px;font-weight:700;fill:${c.ink}}.val{font-size:11px;fill:#555}.pin{font-size:9px;fill:#777}.rail{font-size:11px;font-weight:700;fill:${c.accent}}.tag{fill:${c.tag};stroke:${c.accent};stroke-width:1}.tag.io{fill:${c.accent}}.tag.io+.tagt{fill:#fff}.rail-tag{fill:#eef3ff;stroke:#4a6fb5}.tagt{font-size:10px;font-weight:600;fill:${c.ink};font-family:"JetBrains Mono",Consolas,monospace}</style>
<rect width="100%" height="100%" fill="${c.bg}"/>
<text x="${PAD}" y="34" font-size="20" font-weight="800" fill="${c.ink}">${esc(title)}</text>
<text x="${PAD}" y="54" font-size="11" fill="#666">Drawn from the circuit Pedal Sim simulates. Pins with the same name tag are connected. Signal flows left to right.</text>
${body}
</svg>`;
}
