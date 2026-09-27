/**
 * Pedal library shipped with the app.
 *   category: column on the pedalboard ('gain' | 'modulation' | 'filter')
 *   family:   pedals that are two sides of one build (e.g. the Reverse Parallel Fuzz's Si / Ge switch)
 *   origin:   'original' for Richard Heidrick's own designs (drawn by him in LTspice and KiCad;
 *             design notes in designs/), 'classic' for generic reference circuits written from
 *             public knowledge of the topology
 *   type:     effect family in plain words ('boost' | 'overdrive' | 'distortion' | 'fuzz' | 'tone'), see EFFECT_TYPES
 *   sounds:   one line for beginners: what it sounds like
 *   knobs:    what each knob does, by knob label
 * Paths are relative to this module.
 */

/** Effect families, explained for someone new to guitar effects. */
export const EFFECT_TYPES = [
  { id: 'boost', name: 'Boost', text: 'Makes your guitar louder and a little fuller without much grit. Often used to push the next pedal harder.' },
  { id: 'overdrive', name: 'Overdrive', text: 'A warm, gentle grit, like a small amp turned up loud. Cleans up when you play softly.' },
  { id: 'distortion', name: 'Distortion', text: 'More than overdrive: thicker, tighter and more sustain. The classic rock and metal sound.' },
  { id: 'fuzz', name: 'Fuzz', text: 'The wildest: squashes the guitar into a thick, buzzy, square-edged tone. The 60s psychedelic sound.' },
  { id: 'tone', name: 'Tone / EQ', text: 'Adds no grit. Shapes the sound by turning the bass, middle and treble up or down.' },
];

/**
 * Knob names, decoded. Pedal makers use different words for the same job; the site
 * keeps the real names (the ones printed on actual pedals and in the author's LTspice and
 * KiCad files) and explains them, so visitors will recognise them on real gear.
 */
export const KNOB_ROLES = [
  { id: 'dirt', title: 'How dirty: Gain, Drive, Fuzz', names: ['Gain', 'Drive', 'Fuzz', 'Distortion'],
    text: 'Three names, one job: how hard the pedal pushes your guitar, and so how much grit you get. Low is cleaner, high is dirtier. It changes the sound, not just the loudness.' },
  { id: 'loud', title: 'How loud: Volume, Level', names: ['Volume', 'Level', 'Output'],
    text: 'Two names, one job: how loud the pedal is when it is on. It adds no grit. Set it so the pedal is about as loud as the plain guitar, or a little louder for a solo.' },
  { id: 'tone', title: 'Brightness: Tone, Treble, Middle, Bass', names: ['Tone', 'Treble', 'Middle', 'Bass'],
    text: 'Tone makes the sound darker or brighter. Treble, Middle and Bass split that into highs, mids and lows, like the knobs on an amp.' },
  { id: 'special', title: 'One of a kind: Mod', names: ['Mod'],
    text: 'Some circuits have a knob of their own. Mod on the Reverse Parallel Fuzz changes the texture of the fuzz, from thinner and touchy to thick and saturated.' },
];
/** The role a knob label belongs to, and the other names used for the same job on the site's pedals. */
export function knobRole(label) {
  const l = label.toLowerCase();
  const role = KNOB_ROLES.find((r) => r.names.some((n) => n.toLowerCase() === l));
  if (!role) return null;
  const onSite = new Set(['Gain', 'Drive', 'Fuzz', 'Volume', 'Level']);
  const others = role.names.filter((n) => n.toLowerCase() !== l && onSite.has(n));
  return { ...role, others };
}

const VOLUME = 'How loud the pedal is when it is on. Match it to the bypassed sound, or turn it up for a lift.';
export const STARTER_PEDALS = [
  { id: 'rp-fuzz-si', file: 'rp-fuzz-si.cir', name: 'Reverse Parallel Fuzz · Si', category: 'gain', family: 'reverse-parallel-fuzz', origin: 'original', color: '#d8742b', type: 'fuzz',
    blurb: 'Silicon NPN side of my Reverse Parallel Fuzz. Three 2N3904 stages, from my own LTspice and KiCad design.' },
  { id: 'rp-fuzz-ge', file: 'rp-fuzz-ge.cir', name: 'Reverse Parallel Fuzz · Ge', category: 'gain', family: 'reverse-parallel-fuzz', origin: 'original', color: '#b8892f', type: 'fuzz',
    blurb: 'Germanium PNP side of my Reverse Parallel Fuzz. Three 2N1309 stages, softer and looser than the Si side.' },
  { id: 'blues-od', file: 'blues-od.cir', name: 'Blues OD', category: 'gain', origin: 'original', color: '#3a6fb5', type: 'overdrive',
    blurb: 'My own overdrive design: two TL072 op amp stages into a 1N4148 diode clipper. Converted straight from my LTspice schematic.',
    sounds: 'Warm, open overdrive that stays clear and growls when you dig in. Blues and classic rock.',
    knobs: { Gain: 'How much drive. Low is almost clean, high is a thick bluesy growl.', Tone: 'Darker to brighter. Turn it up if the sound gets muddy.' } },
  { id: 'germanium-fuzz', file: 'germanium-fuzz.cir', name: 'Germanium Fuzz', category: 'gain', origin: 'classic', color: '#c9412f', type: 'fuzz', blurb: 'Two germanium PNP transistors, classic 60s fuzz.',
    sounds: 'Round, woolly 60s fuzz that cleans up a little when you play softly.',
    knobs: { Fuzz: 'How much fuzz. This circuit sounds best near the top.', Volume: VOLUME } },
  { id: 'op-amp-drive', file: 'op-amp-drive.cir', name: 'Op Amp Drive', category: 'gain', origin: 'classic', color: '#3f9a5a', type: 'overdrive', blurb: 'Op amp soft clipper with a mid hump in its tone.',
    sounds: 'Smooth overdrive with a boost in the middle frequencies that helps a solo stand out.',
    knobs: { Drive: 'How much overdrive. Low is a light edge, high is a creamy lead tone.', Tone: 'Darker to brighter.', Level: VOLUME } },
  { id: 'jfet-boost', file: 'jfet-boost.cir', name: 'JFET Boost', category: 'gain', origin: 'classic', color: '#d7b43c', type: 'boost', blurb: 'Single J201 common-source clean boost.',
    sounds: 'A clean lift in volume with a touch of warmth. Put it before a dirty pedal to make it dirtier.',
    knobs: { Gain: 'How hard the boost pushes. Higher adds a little grit of its own.', Volume: VOLUME } },
  { id: 'tone-stack', file: 'tone-stack.cir', name: 'Tone Stack', category: 'filter', origin: 'classic', color: '#3d6fb0', type: 'tone', blurb: 'Passive treble / bass / middle network.',
    sounds: 'The bass, middle and treble controls found on most guitar amps. No grit, just shape.',
    knobs: { Treble: 'The sparkle and bite on top.', Bass: 'The low end and thump.', Middle: 'The body of the sound. Turn it down for a scooped metal tone, up to cut through a band.' } },
];

export function starterUrl(file) {
  return new URL(file, import.meta.url).href;
}
