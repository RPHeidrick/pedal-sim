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
  { id: 'modulation', name: 'Modulation', text: 'Movement: the sound swirls, sweeps or pulses over time. Phaser, chorus, flanger and tremolo.' },
  { id: 'time', name: 'Delay / Reverb', text: 'Space: echoes that repeat after you play, or the sound of a room around the guitar.' },
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
  { id: 'motion', title: 'Movement: Rate, Depth', names: ['Rate', 'Depth', 'Speed', 'Intensity'],
    text: 'On modulation pedals, Rate is how fast the sound moves and Depth is how much it moves. Slow and shallow is subtle; fast and deep is dramatic.' },
  { id: 'space', title: 'Echo and space: Time, Repeats, Decay, Mix', names: ['Time', 'Repeats', 'Feedback', 'Decay', 'Mix'],
    text: 'Time is the gap between echoes, Repeats (or Feedback) how many you hear, Decay how long a reverb hangs on, and Mix how loud the effect is next to the plain guitar.' },
  { id: 'special', title: 'One of a kind: Mod', names: ['Mod'],
    text: 'Some circuits have a knob of their own. Mod on the Reverse Parallel Fuzz changes the texture of the fuzz: down is thick and saturated, up is thinner and cleans up when you play softly.' },
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
    knobs: { Gain: 'How much drive. Low is almost clean, high is a thick bluesy growl, and it gets louder as you turn it up.', Tone: 'How much low end goes into the drive. Up is fuller, warmer and a little cleaner. Down is thinner and tighter, which keeps big chords clear.' } },
  { id: 'germanium-fuzz', file: 'germanium-fuzz.cir', name: 'Germanium Fuzz', category: 'gain', origin: 'classic', color: '#c9412f', type: 'fuzz', blurb: 'Two germanium PNP transistors, classic 60s fuzz.',
    sounds: 'Round, woolly 60s fuzz that cleans up a little when you play softly.',
    knobs: { Fuzz: 'Fine tunes the fuzz: up is a little brighter and more aggressive, down a little smoother. This circuit is fuzzy at every setting, so most players leave it near the top.', Volume: VOLUME } },
  { id: 'op-amp-drive', file: 'op-amp-drive.cir', name: 'Op Amp Drive', category: 'gain', origin: 'classic', color: '#3f9a5a', type: 'overdrive', blurb: 'Op amp soft clipper with a mid hump in its tone.',
    sounds: 'Smooth overdrive with a boost in the middle frequencies that helps a solo stand out.',
    knobs: { Drive: 'How much overdrive. Low is a light edge, high is a creamy lead tone with more low end.', Tone: 'Darker to brighter: turns the treble down or up.', Level: VOLUME } },
  { id: 'jfet-boost', file: 'jfet-boost.cir', name: 'JFET Boost', category: 'gain', origin: 'classic', color: '#d7b43c', type: 'boost', blurb: 'Single J201 common-source clean boost.',
    sounds: 'A clean lift in volume with a touch of warmth. Put it before a dirty pedal to make it dirtier.',
    knobs: { Gain: 'How hard the boost pushes the next pedal, up to about 8 dB. Near the top it adds a little grit of its own.', Volume: VOLUME } },
  { id: 'tone-stack', file: 'tone-stack.cir', name: 'Tone Stack', category: 'filter', origin: 'classic', color: '#3d6fb0', type: 'tone', blurb: 'Passive treble / bass / middle network.',
    sounds: 'The bass, middle and treble controls found on most guitar amps. No grit, just shape.',
    knobs: { Treble: 'The sparkle and bite on top.', Bass: 'The low end and thump. Most of the change is in the lower half of the turn.', Middle: 'The body of the sound. Down scoops it for a metal tone (and takes some treble with it), up helps you cut through a band.' } },
  { id: 'phaser', file: 'phaser.cir', name: 'Phaser', category: 'modulation', origin: 'classic', color: '#a45bc4', type: 'modulation',
    blurb: 'Four JFET all-pass stages swept by a triangle wave LFO, all simulated part by part, oscillator included.',
    sounds: 'A slow, watery swirl as moving notches sweep through the sound. Great on funk rhythm and spacey leads.',
    knobs: { Rate: 'How fast the swirl moves: about one sweep every five seconds at the bottom, five per second at the top.', Depth: 'How far the sweep travels. Down is a still, hollow tone; up is the full, deep swirl.' } },
  { id: 'tremolo', file: 'tremolo.cir', name: 'Tremolo', category: 'modulation', origin: 'classic', color: '#d0853a', type: 'modulation',
    blurb: 'A JFET turned on and off by a triangle wave LFO, shunting the guitar away in pulses. Simulated part by part, oscillator included.',
    sounds: 'The volume pulses in time, like an old amp with tremolo. From a gentle throb to a hard chop.',
    knobs: { Rate: 'How fast the volume pulses, from a slow throb (about 3 seconds) to a fast flutter (about 10 per second).', Depth: 'How deep each pulse cuts. Down is off; up chops the sound almost to silence.', Volume: VOLUME } },
];

export function starterUrl(file) {
  return new URL(file, import.meta.url).href;
}
