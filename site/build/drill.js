/**
 * Build it yourself: a printable drilling template for the enclosure, drawn to real size
 * (SVG in millimetres), and the standard true bypass wiring for the footswitch and jacks.
 * Print at 100% ("actual size"), check the 50 mm ruler, tape it on the box, centre punch, drill.
 */
import { enclosureFor } from './parts.js';

const HOLES = { pot: 7.5, switch: 12, led: 5, jack: 10, dc: 12 };

/** Where things go on the box, in mm from the face's top left corner (face = the lid, top view). */
export function layout(net) {
  const box = enclosureFor(net.pots.length);
  const n = net.pots.length;
  const pots = [];
  if (n <= 3) {
    // 12 mm from each side leaves room for 16 mm pots and their knobs
    net.pots.forEach((p, i) => pots.push({ x: n === 1 ? box.w / 2 : 12 + ((box.w - 24) / (n - 1)) * i, y: 24, label: p.label }));
  } else {
    const top = Math.ceil(n / 2), bot = n - top;
    net.pots.forEach((p, i) => {
      const row = i < top ? 0 : 1, k = row ? i - top : i, m = row ? bot : top;
      pots.push({ x: m === 1 ? box.w / 2 : 14 + ((box.w - 28) / (m - 1)) * k, y: row ? 46 : 22, label: p.label });
    });
  }
  return { box, pots, led: { x: box.w / 2, y: n > 3 ? 64 : 48 }, sw: { x: box.w / 2, y: box.l - 26 } };
}

export function drillSvg(net, title = net.name) {
  const { box, pots, led, sw } = layout(net);
  const M = 14, H = box.h, W = box.w, L = box.l;
  // unfolded box: top edge above the face, left and right sides beside it
  const fx = M + H, fy = M + H; // face origin
  const totalW = M * 2 + H * 2 + W + 70, totalH = M * 2 + H + L + 34;
  const hole = (x, y, d, label) => `<circle cx="${x}" cy="${y}" r="${d / 2}" class="h"/><path d="M${x - d / 2 - 2} ${y}h${d + 4}M${x} ${y - d / 2 - 2}v${d + 4}" class="x"/><text x="${x}" y="${y + d / 2 + 4}" class="t" text-anchor="middle">${label} · ${d} mm</text>`;
  let s = '';
  // face (lid)
  s += `<rect x="${fx}" y="${fy}" width="${W}" height="${L}" rx="3" class="f"/>`;
  s += `<text x="${fx + W / 2}" y="${fy + L - 6}" class="c" text-anchor="middle">FACE (top of the box)</text>`;
  for (const p of pots) s += hole(fx + p.x, fy + p.y, HOLES.pot, p.label);
  s += hole(fx + led.x, fy + led.y, HOLES.led, 'LED');
  s += hole(fx + sw.x, fy + sw.y, HOLES.switch, 'Footswitch');
  // top edge (DC jack), side edges (jacks: input on the right, output on the left, as pedals usually are)
  s += `<rect x="${fx}" y="${M}" width="${W}" height="${H}" class="f"/><text x="${fx + W / 2}" y="${M + 9}" class="c" text-anchor="middle">TOP EDGE</text>`;
  s += hole(fx + W / 2, M + H / 2 + 2, HOLES.dc, 'DC 9V');
  s += `<rect x="${M}" y="${fy}" width="${H}" height="${L}" class="f"/><text x="${M + H / 2}" y="${fy + L - 6}" class="c" text-anchor="middle">LEFT: OUT</text>`;
  s += hole(M + H / 2, fy + 30, HOLES.jack, 'Output');
  s += `<rect x="${fx + W}" y="${fy}" width="${H}" height="${L}" class="f"/><text x="${fx + W + H / 2}" y="${fy + L - 6}" class="c" text-anchor="middle">RIGHT: IN</text>`;
  s += hole(fx + W + H / 2, fy + 30, HOLES.jack, 'Input');
  // 50 mm ruler to check the print scale
  const rx = fx + W + H + 12, ry = fy + 10;
  s += `<path d="M${rx} ${ry}v50" class="r"/>${[0, 10, 20, 30, 40, 50].map((k) => `<path d="M${rx} ${ry + k}h${k % 50 ? 3 : 6}" class="r"/>`).join('')}<text x="${rx + 8}" y="${ry + 27}" class="t">50 mm</text><text x="${rx + 8}" y="${ry + 33}" class="t">check with a ruler</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}mm" height="${totalH}mm" viewBox="0 0 ${totalW} ${totalH}" font-family="Inter, Arial, sans-serif">
<style>.f{fill:#fafafa;stroke:#222;stroke-width:.35}.h{fill:#fff;stroke:#e05a00;stroke-width:.4}.x{stroke:#222;stroke-width:.2}.t{font-size:2.6px;fill:#333}.c{font-size:2.8px;font-weight:700;fill:#888}.r{stroke:#222;stroke-width:.3;fill:none}</style>
<rect width="100%" height="100%" fill="#fff"/>
<text x="${M}" y="${totalH - 14}" font-size="4.2" font-weight="800">${title.replace(/[<&]/g, '')}: drill template, enclosure ${box.name} (${L} × ${W} × ${H} mm)</text>
<text x="${M}" y="${totalH - 8}" font-size="2.8" fill="#555">Print at 100% (actual size). Tape it on, centre punch each cross, drill small first, then step up to the size shown.</text>
${s}
</svg>`;
}

/** Standard true bypass wiring with a 3PDT footswitch, LED and DC jack, as steps. */
export function wiringSteps(net) {
  const neg = net.supply < 0;
  return [
    'The 3PDT footswitch has 9 lugs: 3 columns of 3. Each column is its own switch: the middle lug connects to the top lug in one position and to the bottom lug in the other. Hold it with the lugs facing you, as in the drawing.',
    'Column 1 (input): middle to the INPUT jack tip, top to the circuit\'s IN, bottom to the bottom lug of column 2 (a short wire: the bypass path).',
    'Column 2 (output): middle to the OUTPUT jack tip, top to the circuit\'s OUT, bottom already linked to column 1.',
    'Column 3 (LED): middle to ground, top to the LED\'s short leg (cathode). The LED\'s long leg (anode) goes through the LED resistor to +9V.',
    'Both jack sleeves (the big lug) to ground, and the circuit\'s ground to the DC jack\'s ground.',
    neg
      ? 'Power: this germanium PNP circuit needs a negative supply. The simple way: build it "positive ground" and power it only from its own adapter or battery, never on a shared daisy chain with other pedals.'
      : 'Power: DC jack centre pin (negative) to ground; the outer sleeve (positive) through the 1N5817 diode (stripe towards the circuit) to +9V, with the 100µF capacitor from +9V to ground (+ leg to +9V).',
    'If the LED lights when the pedal is bypassed, your switch is the other way round: swap the top and bottom wires on all three columns.',
    'Before powering up: look for solder bridges, and measure between +9V and ground: it should read more than 1 kΩ, never 0.',
  ];
}

/** Wiring drawing: footswitch lugs, jacks, DC jack and LED. */
export function wiringSvg() {
  const lug = (x, y, t, c = '#222') => `<circle cx="${x}" cy="${y}" r="9" fill="#fff" stroke="${c}" stroke-width="2"/><text x="${x + 14}" y="${y + 4}" font-size="11" fill="#333">${t}</text>`;
  const wire = (d, c) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  const X = [90, 250, 410], Y = [70, 130, 190];
  let s = '<rect x="50" y="36" width="490" height="190" rx="14" fill="#f4f4f4" stroke="#999"/>';
  s += wire(`M${X[0]} ${Y[2]} v40 H${X[1]} v-40`, '#8a8a8a');
  s += lug(X[0], Y[0], 'to circuit IN', '#e05a00') + lug(X[0], Y[1], 'INPUT jack tip', '#2a7') + lug(X[0], Y[2], 'bypass link');
  s += lug(X[1], Y[0], 'to circuit OUT', '#e05a00') + lug(X[1], Y[1], 'OUTPUT jack tip', '#2a7') + lug(X[1], Y[2], 'bypass link');
  s += lug(X[2], Y[0], 'LED cathode (short leg)', '#c33') + lug(X[2], Y[1], 'ground', '#222') + lug(X[2], Y[2], '(not used)', '#bbb');
  s += '<text x="70" y="26" font-size="12" font-weight="700">3PDT footswitch, lugs facing you</text>';
  s += '<text x="70" y="262" font-size="11" fill="#555">Column 1: input · Column 2: output · Column 3: LED. Middle row = the common lugs.</text>';
  s += '<text x="70" y="280" font-size="11" fill="#555">LED long leg (anode) → LED resistor → +9V. Jack sleeves → ground. DC jack: centre = ground (negative), sleeve → 1N5817 → +9V.</text>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300" width="600" height="300" font-family="Inter, Arial, sans-serif"><rect width="100%" height="100%" fill="#fff"/>${s}</svg>`;
}

export function buildSteps(net) {
  const has = (k) => net.parts.some((p) => p.kind === k);
  return [
    'Read the whole sheet first and gather every part on the parts list. Sort resistors by value (a multimeter confirms each one).',
    'Plan the board: copy the schematic onto stripboard or perfboard, one net name tag at a time. Every pin with the same tag must end up connected.',
    'Solder the lowest parts first: resistors and diodes (diodes have a stripe on the cathode, the end the triangle points to in the schematic).',
    has('opamp') ? 'Solder the DIP-8 socket, not the chip. Put the chip in last, with its notch matching the socket.' : 'Solder the small capacitors next.',
    'Then the film capacitors, then the electrolytic ones: their long leg (+) goes where the schematic shows +.',
    has('bjt') || has('jfet') ? 'Transistors last (they dislike heat): check which leg is which on the datasheet, since the same part can come in different pin orders.' : 'Check the board against the schematic, tag by tag.',
    'Drill the box with the drill template, then fit the pots, footswitch, jacks, DC jack and LED.',
    'Wire the footswitch, jacks and power (see Wiring).',
    'Test: plug in guitar and amp at low volume, power up, and switch on. No sound? Check the LED, then the supply voltage, then the wiring at the footswitch.',
    'Safety: only ever power a pedal from a regulated 9 V DC pedal adapter or a 9 V battery, never from mains. Solder in a ventilated room, keep the hot iron in its stand, wear eye protection when clipping leads, and wash your hands after handling solder.',
  ];
}
