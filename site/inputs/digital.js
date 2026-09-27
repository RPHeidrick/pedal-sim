/**
 * Digital guitar: play real recorded guitar notes (CC0, see site/inputs/notes.js) through the pedals,
 * for visitors without a guitar. Chord pads strum six strings, the fretboard plays single
 * notes, and Auto strum keeps a rhythm going so both hands are free for the knobs.
 * One note per string at a time, like a real guitar: a new note on a string stops the old one.
 */
import { NOTES, noteUrl, nearestNote } from './notes.js';

export const OPEN_STRINGS = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4, low to high
export const FRETS = 15;
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (m) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;

// low E to high E; null = string not played
export const CHORDS = [
  { id: 'E', name: 'E', notes: [40, 47, 52, 56, 59, 64] },
  { id: 'A', name: 'A', notes: [null, 45, 52, 57, 61, 64] },
  { id: 'D', name: 'D', notes: [null, null, 50, 57, 62, 66] },
  { id: 'G', name: 'G', notes: [43, 47, 50, 55, 59, 67] },
  { id: 'C', name: 'C', notes: [null, 48, 52, 55, 60, 64] },
  { id: 'Em', name: 'Em', notes: [40, 47, 52, 55, 59, 64] },
  { id: 'Am', name: 'Am', notes: [null, 45, 52, 57, 60, 64] },
  { id: 'Dm', name: 'Dm', notes: [null, null, 50, 57, 62, 65] },
  { id: 'E5', name: 'E5', power: true, notes: [40, 47, 52, null, null, null] },
  { id: 'A5', name: 'A5', power: true, notes: [null, 45, 52, 57, null, null] },
  { id: 'D5', name: 'D5', power: true, notes: [null, null, 50, 57, 62, null] },
  { id: 'G5', name: 'G5', power: true, notes: [43, 50, 55, null, null, null] },
];
export const PATTERNS = [
  { id: 'eighths', name: 'Steady eighths', steps: ['D', 'D', 'D', 'D', 'D', 'D', 'D', 'D'] },
  { id: 'pop', name: 'Down, down up', steps: ['D', '-', 'D', 'U', '-', 'U', 'D', 'U'] },
  { id: 'chug', name: 'Palm muted chug', steps: ['m', 'm', 'm', 'm', 'D', '-', 'm', 'm'] },
  { id: 'arp', name: 'Arpeggio', steps: ['1', '2', '3', '4', '5', '4', '3', '2'] },
  { id: 'hits', name: 'Big hits', steps: ['D', '-', '-', '-', 'D', '-', '-', '-'] },
];
export const PROGRESSIONS = [
  { id: 'hold', name: 'Hold the chord I pick', chords: null },
  { id: 'pop', name: 'G · C · D · Em', chords: ['G', 'C', 'D', 'Em'] },
  { id: 'blues', name: 'A5 · D5 · A5 · E5', chords: ['A5', 'D5', 'A5', 'E5'] },
  { id: 'rock', name: 'E5 · G5 · A5 · G5', chords: ['E5', 'G5', 'A5', 'G5'] },
  { id: 'minor', name: 'Am · G · C · Em', chords: ['Am', 'G', 'C', 'Em'] },
];

export class DigitalGuitar {
  constructor(audio) {
    this.audio = audio;
    this.buffers = new Map(); // file -> AudioBuffer
    this.ringing = new Array(6).fill(null); // per string: {src, gain}
    this.loading = null;
    this.onNote = () => {}; // (string, midi) for the fretboard glow
    this.timer = 0;
  }

  get ctx() { return this.audio.ctx; }

  load() {
    if (!this.loading) {
      this.loading = Promise.all(NOTES.map(async (n) => {
        const res = await fetch(noteUrl(n));
        if (!res.ok) throw new Error(`note ${n.file}: HTTP ${res.status}`);
        this.buffers.set(n.file, await this.ctx.decodeAudioData(await res.arrayBuffer()));
      })).catch((e) => { this.loading = null; throw e; });
    }
    return this.loading;
  }

  /** Play one note on one string (0 = low E). `mute` makes it short, like palm muting. */
  pluck(string, midi, { when = 0, vel = 1, mute = false } = {}) {
    if (!this.ctx || midi == null) return;
    const { note, shift } = nearestNote(midi);
    const buf = this.buffers.get(note.file);
    if (!buf) return;
    const t = Math.max(this.ctx.currentTime, when || this.ctx.currentTime);
    this.damp(string, t);
    const src = new AudioBufferSourceNode(this.ctx, { buffer: buf, playbackRate: 2 ** (shift / 12) });
    const g = new GainNode(this.ctx, { gain: 0 });
    const level = 0.9 * vel;
    g.gain.setValueAtTime(level, t);
    if (mute) g.gain.setTargetAtTime(0, t + 0.06, 0.03);
    src.connect(g).connect(this.audio.digitalBus);
    src.start(t);
    src.stop(t + (mute ? 0.4 : buf.duration / src.playbackRate.value));
    this.ringing[string] = { src, g };
    const delay = Math.max(0, (t - this.ctx.currentTime) * 1000);
    setTimeout(() => this.onNote(string, midi), delay);
  }

  /** Stop a ringing string quickly (a new note, or a mute). */
  damp(string, t = this.ctx.currentTime) {
    const r = this.ringing[string];
    if (!r) return;
    r.g.gain.cancelScheduledValues(t);
    r.g.gain.setTargetAtTime(0, t, 0.012);
    try { r.src.stop(t + 0.1); } catch { /* already stopped */ }
    this.ringing[string] = null;
  }

  /** Strum a chord: 'D' down (low to high), 'U' up (high to low, lighter, top strings only). */
  strum(chord, { dir = 'D', when = 0, mute = false, vel = 1 } = {}) {
    const strings = chord.notes.map((m, i) => ({ m, i })).filter((x) => x.m != null);
    const order = dir === 'U' ? strings.slice().reverse().slice(0, 4) : strings;
    const gap = mute ? 0.006 : dir === 'U' ? 0.012 : 0.016;
    const base = when || this.ctx.currentTime + 0.005;
    const v = (dir === 'U' ? 0.6 : 0.75) * vel * (chord.power ? 1.15 : 1);
    order.forEach((x, k) => this.pluck(x.i, x.m, { when: base + k * gap, vel: v * (0.92 + Math.random() * 0.12), mute }));
  }

  /** Auto strum: plays `pattern` over the current chord (or a progression) at `bpm`. */
  startRhythm({ getChord, getPattern, getBpm, onBar }) {
    this.stopRhythm();
    let step = 0, bar = 0;
    let next = this.ctx.currentTime + 0.08;
    const tick = () => {
      const bpm = getBpm(), pat = getPattern();
      const stepDur = 60 / bpm / 2; // eighth notes
      while (next < this.ctx.currentTime + 0.12) {
        if (step % 8 === 0) { onBar && onBar(bar); }
        const chord = getChord(bar);
        const s = pat.steps[step % pat.steps.length];
        if (s === 'D' || s === 'U') this.strum(chord, { dir: s, when: next, vel: step % 2 ? 0.85 : 1 });
        else if (s === 'm') this.strum(chord, { dir: 'D', when: next, mute: true, vel: 0.9 });
        else if (/^\d$/.test(s)) {
          const strings = chord.notes.map((m, i) => ({ m, i })).filter((x) => x.m != null);
          const x = strings[Math.min(strings.length - 1, Number(s) - 1)];
          this.pluck(x.i, x.m, { when: next, vel: 0.8 });
        }
        next += stepDur;
        step++;
        if (step % 8 === 0) bar++;
      }
    };
    tick();
    this.timer = setInterval(tick, 25);
  }

  stopRhythm() {
    if (this.timer) clearInterval(this.timer);
    this.timer = 0;
  }

  get rhythmOn() { return !!this.timer; }

  stopAll() {
    this.stopRhythm();
    if (!this.ctx) return;
    for (let s = 0; s < 6; s++) this.damp(s);
  }
}
