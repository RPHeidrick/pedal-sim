/**
 * Richard Heidrick's own guitar recordings: up to 16 slots.
 *
 * Do not edit by hand unless you want to: tools/add-recording.js (or drag a WAV onto
 * add-recording.cmd) measures the file, levels it and adds it here. See samples/mine/README.md.
 *
 *   slot:  1 to 16 (order in the picker)
 *   group: 'electric', 'acoustic' or 'bass'
 *   file:  the WAV in this folder
 *   name, good: what visitors see
 *   default: true on one recording makes it the first sound visitors hear
 */
export const MY_RECORDINGS = [
  { slot: 1, group: "electric", name: "Power chord riff", file: "01-power-chord-riff.wav", good: "How a riff breaks up into crunch, distortion and fuzz", default: true, seconds: 11.1 },
  { slot: 2, group: "electric", name: "Driving riff", file: "02-driving-riff.wav", good: "Fast picking through overdrive and the phaser", seconds: 10.6 },
  { slot: 3, group: "electric", name: "Chord riff", file: "03-chord-riff.wav", good: "Chords through chorus, tremolo and reverb", seconds: 11 },
  { slot: 4, group: "electric", name: "Single note riff", file: "04-single-note-riff.wav", good: "Single notes through delay and the fuzzes", seconds: 6.5 },
  { slot: 5, group: "electric", name: "Riff with a lead fill", file: "05-riff-with-a-lead-fill.wav", good: "Low riff and higher notes: hear the whole range of a pedal", seconds: 9.1 },
  { slot: 6, group: "electric", name: "Slow power chords", file: "06-slow-power-chords.wav", good: "Big sustained chords: fuzz, flanger and long reverb", seconds: 4.6 },
];
