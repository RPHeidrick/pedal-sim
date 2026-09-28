/**
 * Real recorded guitar notes for the Digital guitar: three hard picked takes of each sampled note
 * (plus a soft picked take where the bank has one) from
 * the FreePats "Electric Guitar FSBS (direct)" bank (a single coil electric guitar, bridge pickup, straight into an
 * audio interface). CC0 1.0 public domain: https://freepats.zenvoid.org/ElectricGuitar/clean-electric-guitar.html
 * Built by tools/build-cc0-notes.py into samples/notes/. Notes in between are played by
 * shifting the nearest recording by at most 2 semitones, like the sample riffs.
 */
export const NOTES_LICENSE = { license: 'CC0', source: 'https://freepats.zenvoid.org/ElectricGuitar/clean-electric-guitar.html' };
export const NOTES = [
  { midi: 36, file: 'C2.wav', takes: ['C2.wav', 'C2-2.wav', 'C2-3.wav'], soft: 'C2-soft.wav' },
  { midi: 40, file: 'E2.wav', takes: ['E2.wav', 'E2-2.wav', 'E2-3.wav'], soft: 'E2-soft.wav' },
  { midi: 41, file: 'F2.wav', takes: ['F2.wav', 'F2-2.wav', 'F2-3.wav'], soft: 'F2-soft.wav' },
  { midi: 45, file: 'A2.wav', takes: ['A2.wav', 'A2-2.wav', 'A2-3.wav'], soft: 'A2-soft.wav' },
  { midi: 48, file: 'C3.wav', takes: ['C3.wav', 'C3-2.wav', 'C3-3.wav'], soft: 'C3-soft.wav' },
  { midi: 50, file: 'D3.wav', takes: ['D3.wav', 'D3-2.wav', 'D3-3.wav'], soft: 'D3-soft.wav' },
  { midi: 52, file: 'E3.wav', takes: ['E3.wav', 'E3-2.wav', 'E3-3.wav'], soft: 'E3-soft.wav' },
  { midi: 55, file: 'G3.wav', takes: ['G3.wav', 'G3-2.wav', 'G3-3.wav'], soft: 'G3-soft.wav' },
  { midi: 59, file: 'B3.wav', takes: ['B3.wav', 'B3-2.wav', 'B3-3.wav'], soft: 'B3-soft.wav' },
  { midi: 61, file: 'Cs4.wav', takes: ['Cs4.wav', 'Cs4-2.wav', 'Cs4-3.wav'], soft: 'Cs4-soft.wav' },
  { midi: 64, file: 'E4.wav', takes: ['E4.wav', 'E4-2.wav', 'E4-3.wav'], soft: 'E4-soft.wav' },
  { midi: 67, file: 'G4.wav', takes: ['G4.wav', 'G4-2.wav', 'G4-3.wav'] },
  { midi: 71, file: 'B4.wav', takes: ['B4.wav', 'B4-2.wav', 'B4-3.wav'] },
  { midi: 72, file: 'C5.wav', takes: ['C5.wav', 'C5-2.wav', 'C5-3.wav'], soft: 'C5-soft.wav' },
  { midi: 74, file: 'D5.wav', takes: ['D5.wav', 'D5-2.wav', 'D5-3.wav'], soft: 'D5-soft.wav' },
  { midi: 77, file: 'F5.wav', takes: ['F5.wav', 'F5-2.wav', 'F5-3.wav'] },
  { midi: 80, file: 'Gs5.wav', takes: ['Gs5.wav', 'Gs5-2.wav', 'Gs5-3.wav'] },
  { midi: 82, file: 'As5.wav', takes: ['As5.wav', 'As5-2.wav', 'As5-3.wav'] },
  { midi: 85, file: 'Cs6.wav', takes: ['Cs6.wav', 'Cs6-2.wav', 'Cs6-3.wav'] },
];
export const noteUrl = (n) => new URL(`../../samples/notes/${n.file}`, import.meta.url);
/** The recording to use for a MIDI note and how far to shift it (semitones). */
export function nearestNote(midi) {
  let best = NOTES[0];
  for (const n of NOTES) if (Math.abs(n.midi - midi) < Math.abs(best.midi - midi) || (Math.abs(n.midi - midi) === Math.abs(best.midi - midi) && n.midi > midi)) best = n;
  return { note: best, shift: midi - best.midi };
}
