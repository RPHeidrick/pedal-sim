/**
 * Real recorded guitar notes for the Digital guitar: one picked take of each sampled note from
 * the FreePats "Electric Guitar FSBS (direct)" bank (a single coil electric guitar, bridge pickup, straight into an
 * audio interface). CC0 1.0 public domain: https://freepats.zenvoid.org/ElectricGuitar/clean-electric-guitar.html
 * Built by tools/build-cc0-notes.py into samples/notes/. Notes in between are played by
 * shifting the nearest recording by at most 2 semitones, like the sample riffs.
 */
export const NOTES_LICENSE = { license: 'CC0', source: 'https://freepats.zenvoid.org/ElectricGuitar/clean-electric-guitar.html' };
export const NOTES = [
  { midi: 36, file: 'C2.wav' }, { midi: 40, file: 'E2.wav' }, { midi: 41, file: 'F2.wav' }, { midi: 45, file: 'A2.wav' },
  { midi: 48, file: 'C3.wav' }, { midi: 50, file: 'D3.wav' }, { midi: 52, file: 'E3.wav' }, { midi: 55, file: 'G3.wav' },
  { midi: 59, file: 'B3.wav' }, { midi: 61, file: 'Cs4.wav' }, { midi: 64, file: 'E4.wav' }, { midi: 67, file: 'G4.wav' },
  { midi: 71, file: 'B4.wav' }, { midi: 72, file: 'C5.wav' }, { midi: 74, file: 'D5.wav' }, { midi: 77, file: 'F5.wav' },
  { midi: 80, file: 'Gs5.wav' }, { midi: 82, file: 'As5.wav' }, { midi: 85, file: 'Cs6.wav' },
];
export const noteUrl = (n) => new URL(`../../samples/notes/${n.file}`, import.meta.url);
/** The recording to use for a MIDI note and how far to shift it (semitones). */
export function nearestNote(midi) {
  let best = NOTES[0];
  for (const n of NOTES) if (Math.abs(n.midi - midi) < Math.abs(best.midi - midi) || (Math.abs(n.midi - midi) === Math.abs(best.midi - midi) && n.midi > midi)) best = n;
  return { note: best, shift: midi - best.midi };
}
