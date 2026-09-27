/**
 * Starter boards: finished sounds a beginner can load with one click, then tweak.
 *   pedals: library entry key, variant (Reverse Parallel Fuzz: 0 = Si, 1 = Ge), knob values by label (0..1)
 *   level:  level match in dB, chosen so each board peaks near -6 dBFS (with Volume at 0 dB,
 *           the power chord riff sample and the 1x12 speaker; tools/preset-levels.js measures it).
 *           It is added to the visitor's own Volume, so every board plays about equally loud.
 *           Acoustic boards are measured with the folk strum sample instead (`measure`).
 *   suits:  which sample sounds the board is meant for ('electric', 'acoustic'). Picking a
 *           sample of the other kind suggests (or, for an untouched board, loads) a board that suits it.
 */
export const RECOMMENDED = { electric: 'fuzz60s', acoustic: 'acoustic-sparkle', bass: 'bass-fuzz' };
export const PRESETS = [
  {
    id: 'clean', name: 'Clean and bright', level: 5, suits: ['electric', 'acoustic', 'bass'],
    text: 'No grit at all: a clean boost and an amp style tone stack. Hear what the guitar sounds like first.',
    pedals: [
      { key: 'jfet-boost', values: { Gain: 0.35, Volume: 0.95 } },
      { key: 'tone-stack', values: { Treble: 0.75, Bass: 0.45, Middle: 0.6 } },
    ],
  },
  {
    id: 'blues', name: 'Blues crunch', level: -6, suits: ['electric'],
    text: 'Warm overdrive that stays clear and growls when you dig in. My Blues OD design.',
    pedals: [{ key: 'blues-od', values: { Gain: 0.45, Tone: 0.6 } }],
  },
  {
    id: 'fuzz60s', name: '60s fuzz', level: 6, suits: ['electric'],
    text: 'Thick, buzzy germanium fuzz, the psychedelic sound. My Reverse Parallel Fuzz on its Ge side.',
    pedals: [{ key: 'reverse-parallel-fuzz', variant: 1, values: { Mod: 0.6, Gain: 0.85, Volume: 0.6 } }],
  },
  {
    id: 'lead', name: 'Singing lead', level: -8, suits: ['electric'],
    text: 'One overdrive pushing another: thicker, longer notes for solos. Try it with the single notes.',
    pedals: [
      { key: 'op-amp-drive', values: { Drive: 0.35, Tone: 0.6, Level: 0.7 } },
      { key: 'blues-od', values: { Gain: 0.65, Tone: 0.55 } },
    ],
  },
  {
    id: 'heavy', name: 'Heavy and scooped', level: -1, suits: ['electric'],
    text: 'Full gain silicon fuzz with the middle turned down, for a big, heavy wall of sound.',
    pedals: [
      { key: 'reverse-parallel-fuzz', variant: 0, values: { Mod: 0.8, Gain: 1, Volume: 1 } },
      { key: 'tone-stack', values: { Treble: 0.6, Bass: 0.85, Middle: 0.15 } },
    ],
  },
  // For acoustic guitar and bass. Their levels were measured with the electric riff; re-measure
  // (node tools/preset-levels.js) once an acoustic or bass recording is in samples/mine.
  {
    id: 'acoustic-sparkle', name: 'Acoustic sparkle', level: 6, suits: ['acoustic'],
    text: 'For acoustic guitar: less boom, more shimmer. The tone stack trims the low end and lifts the strings, and a clean boost brings the level back up.',
    pedals: [
      { key: 'tone-stack', values: { Treble: 0.72, Bass: 0.3, Middle: 0.55 } },
      { key: 'jfet-boost', values: { Gain: 0.3, Volume: 0.95 } },
    ],
  },
  {
    id: 'acoustic-warm', name: 'Warm acoustic drive', level: 2, suits: ['acoustic'],
    text: 'A gentle overdrive with a little mid push. Just enough grit to make strummed chords growl.',
    pedals: [{ key: 'op-amp-drive', values: { Drive: 0.12, Tone: 0.5, Level: 0.95 } }],
  },
  {
    id: 'bass-fuzz', name: 'Bass fuzz', level: 6, suits: ['bass'],
    text: 'A thick germanium fuzz with the lows kept big: the classic fuzz bass sound.',
    pedals: [
      { key: 'germanium-fuzz', values: { Fuzz: 0.8, Volume: 1 } },
      { key: 'tone-stack', values: { Treble: 0.45, Bass: 0.8, Middle: 0.6 } },
    ],
  },
];
