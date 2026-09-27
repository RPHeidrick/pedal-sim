/**
 * Sample sounds for visitors without a guitar plugged in. Every one is real guitar audio.
 *
 *   group:    'electric' or 'acoustic' (shown as a heading in the picker; empty groups are hidden)
 *   kind:     what it is, e.g. "Electric · DI"
 *   badge:    small tag in the picker (e.g. "CC0")
 *   gain:     brings each to the same loudness (-21 dBFS average, peaks at most 0.8), which with
 *             the input stage is a few hundred mV, like a typical pickup
 *   seamless: the file is a bar-exact loop, so it repeats without fades at the loop point
 *   license / by / source / credit: where it came from and why we may publish it
 *
 * PUBLISHING RULE: this folder is public (site and GitHub). Only recordings the site owner
 * made, or explicitly public domain (CC0), may be here. A test enforces it. See samples/README.md.
 *
 * The current three riffs are built by tools/build-cc0-riffs.py from the FreePats "Electric Guitar
 * FSBS (direct)" note recordings: a single coil electric guitar, bridge pickup, recorded straight into an audio
 * interface. Every note is one of those recordings (shifted by at most 2 semitones where the exact
 * note was not sampled). CC0 1.0: https://freepats.zenvoid.org/ElectricGuitar/clean-electric-guitar.html
 */
import { MY_RECORDINGS } from '../../samples/mine/recordings.js';

const FREEPATS = {
  license: 'CC0', badge: 'CC0',
  source: 'https://freepats.zenvoid.org/ElectricGuitar/clean-electric-guitar.html',
  credit: 'Single coil electric guitar, DI, from the FreePats project (CC0 public domain)',
};

const KIND = { electric: 'Electric · DI', acoustic: 'Acoustic', bass: 'Bass · DI' };
/** Richard's own recordings (up to 16), from samples/mine/recordings.js. Listed first. */
const MINE = MY_RECORDINGS.slice().sort((a, b) => a.slot - b.slot).map((r) => ({
  id: `mine-${r.slot}`, group: r.group, name: r.name, kind: KIND[r.group] || 'Guitar', file: `../../samples/mine/${r.file}`, gain: 1,
  by: 'Recorded by Ricky', badge: 'Ricky', credit: 'Recorded by Richard Heidrick', good: r.good || 'Real playing, straight from the guitar.', mine: true, isDefault: !!r.default,
}));

export const MY_SLOTS = 16;
export const SAMPLES = [
  ...MINE,
  { id: 'power-chords', group: 'electric', name: 'Power chord riff', kind: 'Electric · DI', file: '../../samples/cc0-power-chords.wav', gain: 1, seamless: true, ...FREEPATS,
    good: 'How chords break up into crunch, distortion and fuzz.' },
  { id: 'single-notes', group: 'electric', name: 'Slow single notes', kind: 'Electric · DI', file: '../../samples/cc0-single-notes.wav', gain: 1, seamless: true, ...FREEPATS,
    good: 'Single ringing notes: the easiest way to hear what one knob changes.' },
  { id: 'open-chords', group: 'electric', name: 'Open chords', kind: 'Electric · DI', file: '../../samples/cc0-open-chords.wav', gain: 1, seamless: true, ...FREEPATS,
    good: 'Strummed chords: tone controls, and clean versus dirty.' },
];

export const SAMPLE_GROUPS = [
  { id: 'electric', name: 'Electric guitar', note: 'What pedals are made for.' },
  { id: 'acoustic', name: 'Acoustic guitar', note: 'Recorded with a microphone, for contrast.' },
  { id: 'bass', name: 'Bass guitar', note: 'Low end: fuzz and drive on bass.' },
];

export const DEFAULT_SAMPLE = (MINE.find((s) => s.isDefault) || { id: 'power-chords' }).id;
export const sampleById = (id) => SAMPLES.find((s) => s.id === id) || SAMPLES.find((s) => s.id === DEFAULT_SAMPLE);

const downloads = new Map(); // sample id -> Promise<ArrayBuffer>
/**
 * Download a sample's file (once). Called while the page is idle, so pressing Power on
 * does not have to wait for a 1 MB download first.
 */
export function prefetchSample(id) {
  const s = sampleById(id);
  if (!downloads.has(s.id)) {
    const p = fetch(new URL(s.file, import.meta.url)).then((res) => {
      if (!res.ok) throw new Error(`${s.name}: HTTP ${res.status}`);
      return res.arrayBuffer();
    });
    p.catch(() => downloads.delete(s.id)); // a failed download is tried again next time
    downloads.set(s.id, p);
  }
  return downloads.get(s.id);
}

/**
 * Decode a sample at the context's rate, level-matched.
 * @param {BaseAudioContext} ctx
 * @returns {Promise<AudioBuffer>}
 */
export async function loadSample(ctx, id) {
  const s = sampleById(id);
  // decodeAudioData uses up the bytes it is given, so decode a copy and keep the download
  const buf = await ctx.decodeAudioData((await prefetchSample(s.id)).slice(0)); // resampled to the context rate by the browser
  // level match; recordings that are not bar-exact loops get 10 ms fades so the loop point never clicks
  const g = s.gain || 1, fade = s.seamless ? 0 : Math.round(0.01 * buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c), n = d.length;
    if (!fade) { for (let i = 0; i < n; i++) d[i] *= g; continue; }
    for (let i = 0; i < n; i++) d[i] *= g * Math.min(1, i / fade, (n - 1 - i) / fade);
  }
  return buf;
}
