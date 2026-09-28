/**
 * "Describe your sound": plain words in, a pedal board out. Built in (no AI service): it
 * knows the words guitar players use for tone ("warm", "crunchy", "scooped", "60s fuzz",
 * "more bass", "a little brighter") and turns them into pedals, knob settings and a short
 * explanation of why. Works offline, costs nothing, and never sends what you type anywhere.
 */
const WORDS = {
  clean: ['clean', 'pristine', 'glassy', 'jangle', 'jangly', 'chime', 'chimey', 'jazz', 'jazzy', 'funk', 'funky', 'country'],
  boost: ['boost', 'louder', 'push', 'kick', 'lift', 'volume', 'punch'],
  crunch: ['crunch', 'crunchy', 'blues', 'bluesy', 'breakup', 'break up', 'grit', 'gritty', 'overdrive', 'drive', 'od', 'classic rock', 'rock', 'edge of breakup', 'hairy', 'dirty', 'dirt', 'rhythm'],
  mids: ['mid', 'mids', 'midrange', 'mid hump', 'honk', 'honky', 'punchy', 'focused', 'cut through', 'vocal'],
  heavy: ['heavy', 'metal', 'distortion', 'distorted', 'chug', 'chugging', 'djent', 'high gain', 'saturated', 'crushing', 'brutal', 'grunge', 'punk', 'hard rock', 'thrash', 'wall of sound', 'aggressive distortion'],
  fuzz: ['fuzz', 'fuzzy', 'buzzy', 'buzz', '60s', "60's", 'sixties', 'psychedelic', 'psych', 'woolly', 'wooly', 'velcro', 'sputter', 'sputtery', 'stoner', 'doom', 'garage', 'fuzzed'],
  lead: ['lead', 'solo', 'solos', 'sustain', 'singing', 'sing', 'soaring', 'legato', 'shred'],
  bright: ['bright', 'brighter', 'sparkle', 'sparkly', 'treble', 'cutting', 'crisp', 'twang', 'twangy', 'sharp', 'airy', 'shimmer', 'presence', 'clarity', 'clear'],
  dark: ['dark', 'darker', 'warm', 'warmer', 'mellow', 'smooth', 'round', 'rounder', 'woody', 'muted', 'soft', 'vintage', 'creamy', 'thick'],
  bass: ['bass', 'bassy', 'low end', 'lows', 'fat', 'fatter', 'big', 'deep', 'bottom', 'boom', 'full', 'fuller', 'huge', 'massive', 'thick'],
  thin: ['thin', 'tight', 'tighter', 'less bass', 'lean', 'focused'],
  scoop: ['scoop', 'scooped', 'scoopy', 'less mids', 'no mids', 'hollow', 'v shaped'],
  silicon: ['silicon', 'aggressive', 'harsh', 'raw', 'nasty', 'gnarly', 'biting', 'bite', 'modern'],
  germanium: ['germanium', 'vintage', 'woolly', 'wooly', 'warm fuzz', 'smooth fuzz', 'soft', 'round', 'old school'],
};
const LESS = ['a little', 'a bit', 'slight', 'slightly', 'subtle', 'light', 'lightly', 'gentle', 'mild', 'touch of', 'hint of', 'some', 'low gain', 'just'];
const MORE = ['very', 'super', 'really', 'tons', 'lots', 'lot of', 'max', 'maximum', 'extreme', 'huge', 'massive', 'crazy', 'insane', 'full on', 'cranked', 'so much', 'more', 'extra'];

const has = (t, list) => list.filter((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(t)).length;
const clamp = (x) => Math.round(Math.min(1, Math.max(0, x)) * 100) / 100;

export const EXAMPLES = ['Warm bluesy crunch', 'Thick 60s fuzz', 'Heavy scooped metal with lots of bass', 'Clean and bright', 'Singing lead with sustain', 'A little dark overdrive', 'Aggressive silicon fuzz', 'Punchy mid hump drive'];

/** @returns {{name:string, pedals:{key:string, variant?:number, values:Object}[], why:string[], level:number, guess:boolean}} */
export function describeSound(input) {
  const t = ` ${String(input || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ')} `;
  const n = Object.fromEntries(Object.entries(WORDS).map(([k, v]) => [k, has(t, v)]));
  const amt = has(t, MORE) - has(t, LESS); // how hard to push everything
  const push = (x, step = 0.15) => clamp(x + amt * step);
  const pedals = [], why = [];
  let level = 0;
  const guess = Object.values(n).every((c) => !c);

  // tone words first: they decide knob positions on the drive pedals
  const bright = n.bright > n.dark ? 1 : n.dark > n.bright ? -1 : 0;
  const tone = clamp(0.55 + bright * (0.22 + Math.abs(amt) * 0.05));
  // the Blues OD's Tone sets how much low end reaches the drive (up = fuller and warmer), so it turns the other way
  const body = clamp(0.55 - bright * (0.22 + Math.abs(amt) * 0.05));

  const kind = n.fuzz ? 'fuzz' : n.heavy ? 'heavy' : n.crunch || n.mids || n.lead ? 'crunch' : n.clean ? 'clean' : guess ? 'crunch' : n.boost ? 'clean' : 'crunch';

  if (kind === 'fuzz') {
    const si = n.silicon > n.germanium;
    pedals.push({ key: 'reverse-parallel-fuzz', variant: si ? 0 : 1, values: { Mod: push(si ? 0.75 : 0.55), Gain: push(0.85, 0.1), Volume: 0.65 } });
    why.push(si ? 'Fuzz with bite: my Reverse Parallel Fuzz on its silicon side, brighter and more aggressive.' : 'Fuzz: my Reverse Parallel Fuzz on its germanium side, the soft, woolly 60s sound.');
    level = si ? -1 : 6;
  } else if (kind === 'heavy') {
    pedals.push({ key: 'op-amp-drive', values: { Drive: push(0.85, 0.1), Tone: tone, Level: 0.6 } });
    pedals.push({ key: 'blues-od', values: { Gain: push(0.75, 0.1), Tone: body } });
    why.push('High gain: one overdrive pushing another stacks up into thick distortion with long sustain.');
    level = -9;
  } else if (kind === 'crunch') {
    if (n.mids > 0 && !n.crunch) {
      pedals.push({ key: 'op-amp-drive', values: { Drive: push(0.45), Tone: tone, Level: 0.7 } });
      why.push('Mid focused drive: the Op Amp Drive trims the lows before clipping, so notes cut through.');
      level = 8;
    } else {
      pedals.push({ key: 'blues-od', values: { Gain: push(n.lead ? 0.6 : 0.42), Tone: body } });
      why.push('Crunch: my Blues OD, a warm overdrive that stays clear and cleans up when you play softly.');
      level = -6;
    }
    if (n.lead) {
      pedals.unshift({ key: 'jfet-boost', values: { Gain: 0.7, Volume: 0.65 } });
      why.push('For leads: a clean boost in front drives the overdrive harder for more sustain.');
      level -= 4;
    }
    if (guess) why.unshift(`I did not recognise those words, so here is a good all round starting point. Try words like warm, crunchy, fuzzy, heavy, bright or more bass.`);
  } else {
    pedals.push({ key: 'jfet-boost', values: { Gain: clamp(0.3 + (n.boost ? 0.25 : 0) + amt * 0.1), Volume: 0.9 } });
    why.push(n.boost ? 'A clean boost: louder and a little fuller, with no grit.' : 'Clean: a gentle boost keeps the guitar clear and lively.');
    level = 5;
  }

  // EQ: add the tone stack when the words ask for bass, mids or brightness changes it can make
  const wantsStack = n.bass || n.thin || n.scoop || kind === 'clean' || (kind === 'heavy' && (n.bass || n.scoop || /metal|djent|thrash/.test(t)));
  if (wantsStack) {
    const bass = clamp(0.5 + (n.bass ? 0.3 : 0) - (n.thin ? 0.25 : 0) + (n.bass ? amt * 0.05 : 0));
    const middle = clamp(n.scoop || /metal|djent|thrash/.test(t) ? 0.15 : n.mids ? 0.8 : 0.55);
    const treble = clamp(0.55 + bright * 0.22);
    pedals.push({ key: 'tone-stack', values: { Treble: treble, Bass: bass, Middle: middle } });
    const bits = [];
    if (n.bass) bits.push('more bass'); if (n.thin) bits.push('tighter lows');
    if (middle < 0.3) bits.push('the mids scooped out'); if (n.mids && middle > 0.7) bits.push('the mids pushed');
    if (bright > 0) bits.push('extra treble'); if (bright < 0) bits.push('softer highs');
    why.push(`Tone stack at the end for ${bits.length ? bits.join(', ') : 'an amp style shape'}.`);
    level += middle < 0.3 ? 4 : 0;
  } else if (bright) {
    why.push(bright > 0 ? 'Tone knob turned up for a brighter, more cutting sound.' : 'Tone knob turned down for a darker, smoother sound.');
  }
  if (amt > 0) why.push('Turned up, because you asked for more.');
  if (amt < 0) why.push('Kept gentle, because you asked for a little.');

  let name = String(input || '').trim().replace(/\s+/g, ' ') || 'My sound';
  if (name.length > 48) name = `${name.slice(0, 48).replace(/\s+\S*$/, '')}…`; // cut at a word
  return { name: name.charAt(0).toUpperCase() + name.slice(1), pedals, why, level: Math.max(-20, Math.min(12, level)), guess };
}
