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

// low E to high E; null = string not played. `set` groups them into pages of pads (at most 12,
// so the number keys always reach every pad on the page); `kind` is the small label on the pad.
export const CHORD_SETS = [
  { id: 'open', name: 'Open' },
  { id: 'sevenths', name: '7ths' },
  { id: 'color', name: 'Sus & add' },
  { id: 'barre', name: 'Barre & power' },
];
export const CHORDS = [
  // open: the everyday shapes
  { id: 'E', name: 'E', set: 'open', kind: 'major', notes: [40, 47, 52, 56, 59, 64] },
  { id: 'A', name: 'A', set: 'open', kind: 'major', notes: [null, 45, 52, 57, 61, 64] },
  { id: 'D', name: 'D', set: 'open', kind: 'major', notes: [null, null, 50, 57, 62, 66] },
  { id: 'G', name: 'G', set: 'open', kind: 'major', notes: [43, 47, 50, 55, 59, 67] },
  { id: 'C', name: 'C', set: 'open', kind: 'major', notes: [null, 48, 52, 55, 60, 64] },
  { id: 'Em', name: 'Em', set: 'open', kind: 'minor', notes: [40, 47, 52, 55, 59, 64] },
  { id: 'Am', name: 'Am', set: 'open', kind: 'minor', notes: [null, 45, 52, 57, 60, 64] },
  { id: 'Dm', name: 'Dm', set: 'open', kind: 'minor', notes: [null, null, 50, 57, 62, 65] },
  { id: 'E5', name: 'E5', set: 'open', kind: 'power', power: true, notes: [40, 47, 52, null, null, null] },
  { id: 'A5', name: 'A5', set: 'open', kind: 'power', power: true, notes: [null, 45, 52, 57, null, null] },
  { id: 'D5', name: 'D5', set: 'open', kind: 'power', power: true, notes: [null, null, 50, 57, 62, null] },
  { id: 'G5', name: 'G5', set: 'open', kind: 'power', power: true, notes: [43, 50, 55, null, null, null] },
  // sevenths: blues, jazz and soul
  { id: 'E7', name: 'E7', set: 'sevenths', kind: '7th', notes: [40, 47, 50, 56, 59, 64] },
  { id: 'A7', name: 'A7', set: 'sevenths', kind: '7th', notes: [null, 45, 52, 55, 61, 64] },
  { id: 'D7', name: 'D7', set: 'sevenths', kind: '7th', notes: [null, null, 50, 57, 60, 66] },
  { id: 'G7', name: 'G7', set: 'sevenths', kind: '7th', notes: [43, 47, 50, 55, 59, 65] },
  { id: 'C7', name: 'C7', set: 'sevenths', kind: '7th', notes: [null, 48, 52, 58, 60, 64] },
  { id: 'B7', name: 'B7', set: 'sevenths', kind: '7th', notes: [null, 47, 51, 57, 59, 66] },
  { id: 'Am7', name: 'Am7', set: 'sevenths', kind: 'minor 7', notes: [null, 45, 52, 55, 60, 64] },
  { id: 'Em7', name: 'Em7', set: 'sevenths', kind: 'minor 7', notes: [40, 47, 52, 55, 62, 64] },
  { id: 'Cmaj7', name: 'Cmaj7', set: 'sevenths', kind: 'major 7', notes: [null, 48, 52, 55, 59, 64] },
  { id: 'Fmaj7', name: 'Fmaj7', set: 'sevenths', kind: 'major 7', notes: [null, null, 53, 57, 60, 64] },
  { id: 'Dmaj7', name: 'Dmaj7', set: 'sevenths', kind: 'major 7', notes: [null, null, 50, 57, 61, 66] },
  // suspended and added notes: open, ringing colours
  { id: 'Dsus2', name: 'Dsus2', set: 'color', kind: 'sus2', notes: [null, null, 50, 57, 62, 64] },
  { id: 'Dsus4', name: 'Dsus4', set: 'color', kind: 'sus4', notes: [null, null, 50, 57, 62, 67] },
  { id: 'Asus2', name: 'Asus2', set: 'color', kind: 'sus2', notes: [null, 45, 52, 57, 59, 64] },
  { id: 'Asus4', name: 'Asus4', set: 'color', kind: 'sus4', notes: [null, 45, 52, 57, 62, 64] },
  { id: 'Esus4', name: 'Esus4', set: 'color', kind: 'sus4', notes: [40, 47, 52, 57, 59, 64] },
  { id: 'Cadd9', name: 'Cadd9', set: 'color', kind: 'add9', notes: [null, 48, 52, 55, 62, 67] },
  { id: 'G6', name: 'G6', set: 'color', kind: '6th', notes: [43, 47, 50, 55, 59, 64] },
  // barre shapes and more power chords
  { id: 'F', name: 'F', set: 'barre', kind: 'major', notes: [41, 48, 53, 57, 60, 65] },
  { id: 'Bb', name: 'B♭', set: 'barre', kind: 'major', notes: [null, 46, 53, 58, 62, 65] },
  { id: 'B', name: 'B', set: 'barre', kind: 'major', notes: [null, 47, 54, 59, 63, 66] },
  { id: 'Bm', name: 'Bm', set: 'barre', kind: 'minor', notes: [null, 47, 54, 59, 62, 66] },
  { id: 'Fsm', name: 'F♯m', set: 'barre', kind: 'minor', notes: [42, 49, 54, 57, 61, 66] },
  { id: 'Cm', name: 'Cm', set: 'barre', kind: 'minor', notes: [null, 48, 55, 60, 63, 67] },
  { id: 'F5', name: 'F5', set: 'barre', kind: 'power', power: true, notes: [41, 48, 53, null, null, null] },
  { id: 'C5', name: 'C5', set: 'barre', kind: 'power', power: true, notes: [null, 48, 55, 60, null, null] },
  { id: 'B5', name: 'B5', set: 'barre', kind: 'power', power: true, notes: [null, 47, 54, 59, null, null] },
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
  { id: 'ballad', name: 'C · G · Am · F', chords: ['C', 'G', 'Am', 'F'] },
  { id: 'eblues', name: 'E7 · A7 · E7 · B7', chords: ['E7', 'A7', 'E7', 'B7'] },
  { id: 'soul', name: 'Cmaj7 · Fmaj7', chords: ['Cmaj7', 'Fmaj7'] },
  { id: 'folk', name: 'D · Dsus4 · D · Dsus2', chords: ['D', 'Dsus4', 'D', 'Dsus2'] },
  { id: 'jangle', name: 'G · Cadd9 · Em7 · Dsus4', chords: ['G', 'Cadd9', 'Em7', 'Dsus4'] },
  { id: 'grunge', name: 'F5 · B♭ · C5 · G5', chords: ['F5', 'Bb', 'C5', 'G5'] },
];

export class DigitalGuitar {
  constructor(audio) {
    this.audio = audio;
    this.buffers = new Map(); // file -> AudioBuffer
    this.ringing = new Array(6).fill(null); // per string: {src, gain}
    this.lastTake = new Map(); // note file -> index of the take played last (never the same twice running)
    this.loading = null;
    this.onNote = () => {}; // (string, midi) for the fretboard glow
    this.timer = 0;
  }

  get ctx() { return this.audio.ctx; }

  /**
   * Download the notes. Resolves once the first take of every note is in, so playing starts
   * quickly; the other takes and the soft picked ones follow in the background.
   */
  load() {
    if (!this.loading) {
      const get = async (file) => {
        const res = await fetch(noteUrl({ file }));
        if (!res.ok) throw new Error(`note ${file}: HTTP ${res.status}`);
        this.buffers.set(file, await this.ctx.decodeAudioData(await res.arrayBuffer()));
      };
      this.loading = Promise.all(NOTES.map((n) => get(n.file))).then(() => {
        const extra = NOTES.flatMap((n) => [...(n.takes || []).slice(1), ...(n.soft ? [n.soft] : [])]);
        (async () => { for (const f of extra) { try { await get(f); } catch { /* the first take still plays */ } } })();
      }).catch((e) => { this.loading = null; throw e; });
    }
    return this.loading;
  }

  /** A recording of `note`: soft picked for light playing, otherwise one of the hard takes (not the last one used). */
  take(note, vel) {
    if (vel < 0.62 && note.soft && this.buffers.has(note.soft)) return this.buffers.get(note.soft);
    const takes = (note.takes || [note.file]).filter((f) => this.buffers.has(f));
    if (takes.length < 2) return this.buffers.get(note.file);
    const last = this.lastTake.get(note.file);
    let i = Math.floor(Math.random() * takes.length);
    if (i === last) i = (i + 1) % takes.length;
    this.lastTake.set(note.file, i);
    return this.buffers.get(takes[i]);
  }

  /**
   * Play one note on one string (0 = low E). `mute` makes it short and dark, like palm muting.
   * Small random differences on every note (which recording, a few cents of tuning, level and
   * brightness from how hard it is picked) keep it sounding like hands, not a machine.
   */
  pluck(string, midi, { when = 0, vel = 1, mute = false } = {}) {
    if (!this.ctx || midi == null) return;
    const { note, shift } = nearestNote(midi);
    const buf = this.take(note, vel);
    if (!buf) return;
    const t = Math.max(this.ctx.currentTime, when || this.ctx.currentTime);
    this.damp(string, t);
    const cents = (Math.random() - 0.5) * 6; // strings are never perfectly in tune with each other
    const rate = 2 ** ((shift + cents / 100) / 12);
    const src = new AudioBufferSourceNode(this.ctx, { buffer: buf, playbackRate: rate });
    // pick attack: harder picking is brighter; a palm mute is dark and thumpy
    const tone = new BiquadFilterNode(this.ctx, { type: 'lowpass', Q: 0.5,
      frequency: mute ? 1400 : 2600 + 9000 * Math.min(1, vel) ** 2 });
    const g = new GainNode(this.ctx, { gain: 0 });
    const level = 0.9 * vel;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.002); // no click at the very start
    if (mute) g.gain.setTargetAtTime(0, t + 0.07, 0.035);
    src.connect(tone).connect(g).connect(this.audio.digitalBus);
    src.start(t);
    src.stop(t + (mute ? 0.45 : buf.duration / rate));
    this.ringing[string] = { src, g };
    const delay = Math.max(0, (t - this.ctx.currentTime) * 1000);
    setTimeout(() => this.onNote(string, midi), delay);
  }

  /** Stop a ringing string quickly (a new note, or a mute). */
  damp(string, t = this.ctx.currentTime, speed = 0.012) {
    const r = this.ringing[string];
    if (!r) return;
    r.g.gain.cancelScheduledValues(t);
    r.g.gain.setTargetAtTime(0, t, speed);
    try { r.src.stop(t + 10 * speed + 0.05); } catch { /* already stopped */ }
    this.ringing[string] = null;
  }

  /**
   * Strum a chord: 'D' down (low to high), 'U' up (high to low, lighter, only the top three to
   * five strings, like a real up strum). Strings the chord does not use are muted by the fretting
   * hand, and the spacing between strings varies a little each time.
   */
  strum(chord, { dir = 'D', when = 0, mute = false, vel = 1 } = {}) {
    const strings = chord.notes.map((m, i) => ({ m, i })).filter((x) => x.m != null);
    const upCount = 3 + Math.floor(Math.random() * 3);
    const order = dir === 'U' ? strings.slice().reverse().slice(0, upCount) : strings;
    const gap = (mute ? 0.006 : dir === 'U' ? 0.011 : 0.015) * (0.8 + Math.random() * 0.45);
    const base = (when || this.ctx.currentTime + 0.005) + Math.random() * 0.006; // human timing
    const v = (dir === 'U' ? 0.6 : 0.78) * vel * (chord.power ? 1.15 : 1);
    if (dir === 'D') chord.notes.forEach((m, i) => { if (m == null) this.damp(i, base, 0.02); });
    order.forEach((x, k) => {
      // a down strum loses a little force as it crosses the strings
      const fall = dir === 'D' ? 1 - 0.04 * k : 1;
      this.pluck(x.i, x.m, { when: base + k * gap, vel: v * fall * (0.9 + Math.random() * 0.16), mute });
    });
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
        if (s === 'D' || s === 'U') this.strum(chord, { dir: s, when: next, vel: step % 4 === 0 ? 1 : step % 2 ? 0.8 : 0.92 });
        else if (s === 'm') this.strum(chord, { dir: 'D', when: next, mute: true, vel: 0.9 });
        else if (/^\d$/.test(s)) {
          const strings = chord.notes.map((m, i) => ({ m, i })).filter((x) => x.m != null);
          const x = strings[Math.min(strings.length - 1, Number(s) - 1)];
          this.pluck(x.i, x.m, { when: next + Math.random() * 0.004, vel: 0.72 + Math.random() * 0.12 });
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
