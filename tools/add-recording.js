#!/usr/bin/env node
/**
 * Add one of your own guitar recordings to the site (up to 16).
 *
 *   node tools/add-recording.js <file.wav> --name "Crunchy riff" [--kind electric|acoustic|bass]
 *        [--good "What it is good for hearing"] [--slot 1..16] [--default]
 *   node tools/add-recording.js --list
 *   node tools/add-recording.js --remove <slot>
 *
 * What it does to the file (the original is left untouched):
 *   - mixes to mono (if one channel is nearly silent, as many interfaces record, it keeps the other)
 *   - trims silence at the start and after the last note has rung out
 *   - levels it like the other samples: -21 dBFS average, peaks no higher than 0.8
 *   - writes samples/mine/NN-name.wav (24-bit) and lists it in samples/mine/recordings.js
 * Windows: drag a WAV onto add-recording.cmd instead of typing this.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'samples', 'mine');
const LIST = path.join(DIR, 'recordings.js');
const MAX = 16;

export function readWav(buf) {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') throw new Error('Not a WAV file. Export as WAV (not MP3).');
  let o = 12, fmt = null, data = null;
  while (o + 8 <= buf.length) {
    const id = buf.toString('latin1', o, o + 4), size = buf.readUInt32LE(o + 4);
    if (id === 'fmt ') {
      let format = buf.readUInt16LE(o + 8);
      if (format === 0xfffe) format = buf.readUInt16LE(o + 32); // WAVE_FORMAT_EXTENSIBLE
      fmt = { format, ch: buf.readUInt16LE(o + 10), rate: buf.readUInt32LE(o + 12), bits: buf.readUInt16LE(o + 22) };
    }
    if (id === 'data') data = buf.subarray(o + 8, Math.min(buf.length, o + 8 + size));
    o += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('WAV file has no audio data.');
  const { format, ch, bits } = fmt, bytes = bits / 8, n = Math.floor(data.length / bytes / ch);
  const read = format === 3
    ? (at) => (bits === 64 ? data.readDoubleLE(at) : data.readFloatLE(at))
    : bits === 16 ? (at) => data.readInt16LE(at) / 32768
      : bits === 24 ? (at) => data.readIntLE(at, 3) / 8388608
        : bits === 32 ? (at) => data.readInt32LE(at) / 2147483648
          : bits === 8 ? (at) => (data.readUInt8(at) - 128) / 128 : null;
  if (!read) throw new Error(`Unsupported WAV format (${bits}-bit). Use 16 or 24-bit.`);
  const chans = Array.from({ length: ch }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) chans[c][i] = read((i * ch + c) * bytes);
  return { rate: fmt.rate, chans };
}

export function encodeWav24(x, rate) {
  const n = x.length, buf = Buffer.alloc(44 + n * 3);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 3, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 3, 28); buf.writeUInt16LE(3, 32); buf.writeUInt16LE(24, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 3, 40);
  for (let i = 0; i < n; i++) buf.writeIntLE(Math.max(-8388608, Math.min(8388607, Math.round(x[i] * 8388607))), 44 + i * 3, 3);
  return buf;
}

const rms = (x) => { let s = 0; for (const v of x) s += v * v; return Math.sqrt(s / Math.max(1, x.length)); };

/** Mono, trimmed and levelled. Returns the new samples and a short report. */
export function prepare({ rate, chans }) {
  let x;
  const levels = chans.map(rms), loud = Math.max(...levels);
  const used = chans.filter((c, i) => levels[i] > loud * 0.1);
  if (used.length === 1) x = used[0];
  else { x = new Float32Array(chans[0].length); for (const c of used) for (let i = 0; i < x.length; i++) x[i] += c[i] / used.length; }
  // remove any DC offset
  let mean = 0; for (const v of x) mean += v; mean /= x.length;
  let peak = 0; for (let i = 0; i < x.length; i++) { x[i] -= mean; peak = Math.max(peak, Math.abs(x[i])); }
  if (peak < 1e-4) throw new Error('The recording is silent. Check the interface input and try again.');
  // trim: start 5 ms before the first sound (-50 dB below the peak), end 0.3 s after the last (-60 dB)
  const on = peak * 10 ** (-50 / 20), off = peak * 10 ** (-60 / 20);
  let a = 0; while (a < x.length && Math.abs(x[a]) < on) a++;
  let b = x.length - 1; while (b > a && Math.abs(x[b]) < off) b--;
  a = Math.max(0, a - Math.round(0.005 * rate)); b = Math.min(x.length, b + Math.round(0.3 * rate));
  const y = x.slice(a, b);
  // level like the other samples: -21 dBFS average, peak no higher than 0.8
  const g = Math.min(10 ** (-21 / 20) / rms(y), 0.8 / peak);
  for (let i = 0; i < y.length; i++) y[i] *= g;
  const clipped = peak >= 0.999;
  return { y, report: { seconds: y.length / rate, gainDb: 20 * Math.log10(g), inputPeakDb: 20 * Math.log10(peak), clipped, channels: chans.length, usedChannels: used.length } };
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'recording';

async function loadList() {
  const mod = await import(`${pathToFileURL(LIST).href}?t=${Date.now()}`);
  return mod.MY_RECORDINGS.map((r) => ({ ...r }));
}
function writeList(list) {
  const src = fs.readFileSync(LIST, 'utf8');
  const head = src.slice(0, src.indexOf('export const MY_RECORDINGS'));
  const body = list.sort((p, q) => p.slot - q.slot).map((r) => `  { ${Object.entries(r).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')} },`).join('\n');
  fs.writeFileSync(LIST, `${head}export const MY_RECORDINGS = [\n${body}${body ? '\n' : ''}];\n`);
}

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const nx = argv[i + 1]; if (nx == null || nx.startsWith('--')) o[k] = true; else { o[k] = nx; i++; } }
    else o._.push(a);
  }
  return o;
}

async function main() {
  const o = args(process.argv.slice(2));
  const list = await loadList();
  if (o.list) {
    console.log(`Your recordings (${list.length} of ${MAX} slots used):`);
    for (let s = 1; s <= MAX; s++) { const r = list.find((x) => x.slot === s); console.log(`  ${String(s).padStart(2)}  ${r ? `${r.name}  (${r.group}, ${r.file})${r.default ? '  [first sound]' : ''}` : '-- empty --'}`); }
    return;
  }
  if (o.remove) {
    const s = Number(o.remove), r = list.find((x) => x.slot === s);
    if (!r) throw new Error(`Slot ${s} is already empty.`);
    writeList(list.filter((x) => x !== r));
    console.log(`Removed "${r.name}" from slot ${s}. The file samples/mine/${r.file} is still there; delete it if you no longer want it.`);
    return;
  }
  const file = o._[0];
  if (!file) throw new Error('Give a WAV file: node tools/add-recording.js my-riff.wav --name "My riff"');
  const name = String(o.name || '').trim() || path.basename(file).replace(/\.[^.]+$/, '');
  const group = String(o.kind || 'electric').toLowerCase().trim() || 'electric';
  if (!['electric', 'acoustic', 'bass'].includes(group)) throw new Error('--kind must be electric, acoustic or bass.');
  let slot = o.slot ? Number(o.slot) : 0;
  if (!slot) { slot = 1; while (list.some((r) => r.slot === slot)) slot++; }
  if (!(slot >= 1 && slot <= MAX)) throw new Error(o.slot ? `Slots go from 1 to ${MAX}.` : `All ${MAX} slots are full. Remove one first: node tools/add-recording.js --remove <slot>`);
  const { rate, chans } = readWav(fs.readFileSync(file));
  const { y, report } = prepare({ rate, chans });
  if (report.seconds < 2) throw new Error('That recording is shorter than 2 seconds after trimming the silence.');
  const out = `${String(slot).padStart(2, '0')}-${slug(name)}.wav`;
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, out), encodeWav24(y, rate));
  const entry = { slot, group, name, file: out, good: String(o.good || '').trim() || undefined, default: o.default ? true : undefined, seconds: Math.round(report.seconds * 10) / 10 };
  Object.keys(entry).forEach((k) => entry[k] === undefined && delete entry[k]);
  let next = list.filter((r) => r.slot !== slot);
  if (entry.default) next = next.map((r) => { const c = { ...r }; delete c.default; return c; });
  next.push(entry);
  writeList(next);
  console.log(`Added "${name}" to slot ${slot} as samples/mine/${out}`);
  console.log(`  ${report.seconds.toFixed(1)} s, ${group}, levelled by ${report.gainDb >= 0 ? '+' : ''}${report.gainDb.toFixed(1)} dB${report.usedChannels < report.channels ? ', used the one channel with guitar on it' : ''}`);
  if (report.clipped) console.log('  WARNING: the recording touches 0 dB (clipping). Record again with the interface gain a little lower for the cleanest sound.');
  else if (report.inputPeakDb < -30) console.log('  Note: the recording was very quiet. It has been levelled, but turning the interface gain up gives less hiss.');
  console.log('Refresh the site (Ctrl+Shift+R) to hear it in the sample list.');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { console.error(`\n  ${e.message}\n`); process.exitCode = 1; });
}
