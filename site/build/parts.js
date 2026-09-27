/**
 * Build it yourself: read a pedal's netlist into real parts, and make a parts list (BOM).
 * The netlist is the same one the engine simulates, so the parts list always matches the sound.
 */

/** @typedef {{ref:string, kind:string, nodes:string[], value:string, model?:string, taper?:string, label?:string}} Part */

const SI = { f: 1e-15, p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, m: 1e-3, k: 1e3, meg: 1e6, g: 1e9 };
export function parseValue(v) {
  const s = String(v).trim().toLowerCase();
  const rkm = s.match(/^(\d+)(meg|[fpnuµmkgr])(\d+)$/); // "4k7" style: the letter is the decimal point
  if (rkm) return parseFloat(`${rkm[1]}.${rkm[3]}`) * (rkm[2] === 'r' ? 1 : SI[rkm[2]]);
  const m = s.match(/^([0-9.]+(?:e-?\d+)?)(meg|[fpnuµmkg])?/);
  if (!m) return NaN;
  return parseFloat(m[1]) * (m[2] ? SI[m[2]] : 1);
}
/** 4700 -> "4.7k", 1e-7 -> "100nF" style (unit added by caller). */
export function fmt(x) {
  const units = [[1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']];
  for (const [u, s] of units) {
    if (Math.abs(x) >= u * 0.999) { const v = x / u; return `${+v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)}${s}`; }
  }
  return String(x);
}

/** @returns {{name:string, parts:Part[], supply:number, pots:Part[]}} */
export function readNetlist(text) {
  const lines = text.split(/\r?\n/);
  const labels = {};
  let name = 'Pedal', supply = 9;
  for (const l of lines) {
    const pm = l.match(/^\*@pot\s+(\S+)\s+label="([^"]+)"/i); if (pm) labels[pm[1].toUpperCase()] = pm[2];
    const nm = l.match(/^\*@pedal\s+name="([^"]+)"/i); if (nm) name = nm[1];
  }
  const parts = [];
  for (const raw of lines) {
    const l = raw.trim();
    if (!l || l.startsWith('*') || l.startsWith('.') || l.startsWith('+')) continue;
    const t = l.split(/\s+/);
    const ref = t[0].toUpperCase(), k = ref[0];
    if (k === 'V') { if (ref !== 'VIN' && t[1] !== 'in') { const v = parseFloat(t[3]); if (Number.isFinite(v)) supply = v; } continue; }
    if (k === 'R') parts.push({ ref, kind: 'resistor', nodes: [t[1], t[2]], value: t[3] });
    else if (k === 'C') parts.push({ ref, kind: 'capacitor', nodes: [t[1], t[2]], value: t[3] });
    else if (k === 'L') parts.push({ ref, kind: 'inductor', nodes: [t[1], t[2]], value: t[3] });
    else if (k === 'D') parts.push({ ref, kind: /^led/i.test(t[3]) ? 'led' : 'diode', nodes: [t[1], t[2]], value: t[3].toUpperCase().replace('LED_RED', 'LED (red)'), model: t[3] });
    else if (k === 'Q') parts.push({ ref, kind: 'bjt', nodes: [t[1], t[2], t[3]], value: t[4].toUpperCase(), model: t[4] });
    else if (k === 'J') parts.push({ ref, kind: 'jfet', nodes: [t[1], t[2], t[3]], value: t[4].toUpperCase(), model: t[4] });
    else if (k === 'M') parts.push({ ref, kind: 'mosfet', nodes: [t[1], t[2], t[3]], value: t[t.length - 1].toUpperCase() });
    else if (k === 'X') {
      if (t.some((x) => x.toLowerCase() === 'pot')) {
        const kv = Object.fromEntries(t.filter((x) => x.includes('=')).map((x) => x.toLowerCase().split('=')));
        parts.push({ ref, kind: 'pot', nodes: [t[1], t[2], t[3]], value: kv.r || '100k', taper: kv.taper || 'lin', label: labels[ref] || ref.slice(1) });
      } else {
        parts.push({ ref, kind: 'opamp', nodes: t.slice(1, 6), value: t[6].toUpperCase() });
      }
    }
  }
  return { name, parts, supply, pots: parts.filter((p) => p.kind === 'pot') };
}

const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];
/** Nearest value you can buy (E24 series). */
export function nearestE24(x) {
  const d = 10 ** Math.floor(Math.log10(x)); const m = x / d;
  const best = E24.concat(10).reduce((a, b) => (Math.abs(Math.log(b / m)) < Math.abs(Math.log(a / m)) ? b : a));
  return best * d;
}
const POTS = [1e3, 2e3, 5e3, 10e3, 20e3, 25e3, 50e3, 100e3, 250e3, 500e3, 1e6];
/** Nearest pot value sold (a schematic may use 101k so a sweep never hits 0 Ω; you buy 100k). */
export const nearestPot = (x) => POTS.reduce((a, b) => (Math.abs(Math.log(b / x)) < Math.abs(Math.log(a / x)) ? b : a));
const DUAL = /^(JRC4558|RC4558|TL072|TL082|NE5532|LM358|LF353|OPA2134|TL062)/;

const CAP_NOTE = (f) => (f >= 1e-6 ? 'electrolytic, 25 V or more (mind the + leg)' : f >= 1e-9 ? 'film (box) capacitor' : 'ceramic (C0G/NP0)');
const DIODE_NOTE = { '1N4148': 'small signal silicon diode', '1N914': 'small signal silicon diode', '1N34A': 'germanium diode', 'LED (red)': 'red LED, 3 mm or 5 mm, used as a clipping diode', '1N4007': 'rectifier diode', '1N5817': 'Schottky diode' };
const TR_NOTE = {
  J201: 'N channel JFET, TO-92', '2N5457': 'N channel JFET, TO-92', MPF102: 'N channel JFET, TO-92',
  '2N3904': 'NPN silicon, TO-92', BC109: 'NPN silicon, TO-18 metal can', '2N5088': 'NPN silicon, TO-92', '2SC1815': 'NPN silicon, TO-92',
  AC128: 'PNP germanium, TO-1 metal can. Test gain (hFE 70 to 100) and leakage before using', NKT275: 'PNP germanium, metal can. Rare: any germanium PNP with hFE 70 to 110 works',
  '2N1309': 'PNP germanium, TO-5 metal can', '2N3906': 'PNP silicon, TO-92',
};
const OPAMP_NOTE = { JRC4558: 'dual op amp, DIP-8 (use a socket)', TL072: 'dual op amp, DIP-8 (use a socket)', NE5532: 'dual op amp, DIP-8 (use a socket)', LM741: 'single op amp, DIP-8 (use a socket)', LM358: 'dual op amp, DIP-8 (use a socket)' };

/** Enclosure by knob count (Hammond style sizes most DIY shops sell). */
export function enclosureFor(nPots) {
  return nPots <= 2 ? { name: '1590B', w: 60, l: 112, h: 31 } : nPots <= 4 ? { name: '125B', w: 66, l: 122, h: 39 } : { name: '1590BB', w: 94, l: 119, h: 34 };
}

/**
 * The parts list: the circuit's parts grouped by value, then everything a real pedal needs
 * around the circuit (switch, jacks, power, LED, box).
 * @returns {{group:string, value:string, qty:number, refs:string, note:string}[]}
 */
export function partsList(net) {
  const rows = [];
  const add = (group, value, ref, note) => {
    const r = rows.find((x) => x.group === group && x.value === value);
    if (r) { r.qty++; r.refs += `, ${ref}`; } else rows.push({ group, value, qty: 1, refs: ref, note });
  };
  // op amps: two halves of one dual chip count once (XU1A / XU1B)
  const chips = {};
  for (const p of net.parts) {
    if (p.kind === 'resistor') {
      const v = parseValue(p.value), e = nearestE24(v);
      add('Resistors', `${fmt(e)}Ω`, p.ref, Math.abs(e / v - 1) > 0.01 ? `1/4 W metal film, 1% (drawn as ${fmt(v)}Ω; ${fmt(e)}Ω is the nearest you can buy)` : '1/4 W metal film, 1%');
    }
    else if (p.kind === 'capacitor') { const f = parseValue(p.value); add('Capacitors', `${fmt(f)}F`, p.ref, CAP_NOTE(f)); }
    else if (p.kind === 'pot') add('Pots', `${fmt(nearestPot(parseValue(p.value)))}Ω ${p.taper === 'log' ? 'A (log)' : 'B (linear)'}`, `${p.label} (${p.ref})`, '16 mm, PCB or solder lugs, with a knob');
    else if (p.kind === 'diode' || p.kind === 'led') add('Diodes', p.value, p.ref, DIODE_NOTE[p.value] || 'diode');
    else if (p.kind === 'bjt' || p.kind === 'jfet' || p.kind === 'mosfet') add('Transistors', p.value, p.ref, TR_NOTE[p.value] || 'transistor');
    else if (p.kind === 'opamp') (chips[p.value] = chips[p.value] || []).push(p.ref);
  }
  // op amps: a dual chip (TL072, 4558 …) holds two, so U1A/U1B or U1/U2 share one chip
  for (const [model, refs] of Object.entries(chips)) {
    const n = DUAL.test(model) ? Math.ceil(refs.length / 2) : refs.length;
    for (let i = 0; i < n; i++) {
      const these = DUAL.test(model) ? refs.slice(i * 2, i * 2 + 2).join(' + ') : refs[i];
      add('Chips', model, these, `${OPAMP_NOTE[model] || 'op amp, DIP-8'}${DUAL.test(model) && refs.length > 1 ? '; one chip has two op amps' : ''}`);
      add('Chips', 'DIP-8 socket', these, 'so the chip can be swapped without soldering');
    }
  }
  const box = enclosureFor(net.pots.length);
  const pnp = net.supply < 0;
  const extra = [
    ['Hardware', '3PDT footswitch', 'SW1', 'true bypass, switches the LED too'],
    ['Hardware', '1/4" mono jack', 'IN', 'open frame or enclosed'],
    ['Hardware', '1/4" mono jack', 'OUT', 'open frame or enclosed'],
    ['Hardware', '2.1 mm DC jack', 'DC', 'panel mount, centre negative (the pedal standard)'],
    ['Power', '1N5817', 'DP', 'reverse polarity protection: stops a wrong adapter from damaging the pedal'],
    ['Power', '100µF', 'CP', 'electrolytic, 25 V: smooths the supply'],
    ['Hardware', 'LED, 3 mm', 'LED', 'status light, with a bezel'],
    ['Hardware', `${pnp ? '2.2kΩ' : '4.7kΩ'}`, 'RLED', 'LED resistor (higher = dimmer)'],
    ['Hardware', `Enclosure ${box.name}`, 'BOX', `${box.l} × ${box.w} × ${box.h} mm aluminium`],
    ['Hardware', 'Stripboard or perfboard', 'PCB', 'about 50 × 40 mm'],
    ['Hardware', 'Hook up wire', 'W', '22 or 24 AWG, a few colours'],
  ];
  // the circuit may already have its own supply protection and filter (drawn in the schematic)
  const onRails = (p) => p.nodes.includes('vcc') && p.nodes.includes('0');
  const hasProt = net.parts.some((p) => p.kind === 'diode' && onRails(p));
  const hasFilt = net.parts.some((p) => p.kind === 'capacitor' && onRails(p) && parseValue(p.value) >= 10e-6);
  for (const [g, v, r, n] of extra) { if ((r === 'DP' && hasProt) || (r === 'CP' && hasFilt)) continue; add(g, v, r, n); }
  if (pnp) rows.push({ group: 'Power', value: 'Note', qty: 0, refs: '', note: 'This germanium PNP circuit runs on a negative supply. With a normal centre negative adapter, build it "positive ground" (swap the supply wires) or use a charge pump. It cannot share a daisy chain with other pedals.' });
  const order = ['Resistors', 'Capacitors', 'Pots', 'Diodes', 'Transistors', 'Chips', 'Power', 'Hardware'];
  return rows.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
}

export function partsCsv(net) {
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  return ['Group,Value,Qty,Parts,Notes', ...partsList(net).map((r) => [r.group, r.value, r.qty, r.refs, r.note].map(q).join(','))].join('\r\n');
}
