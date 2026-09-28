/**
 * Pedal Workshop templates: textbook circuits with choices a builder would really make
 * (transistor, clipping diodes, op amp, how much low end, how much gain). Each choice set
 * produces a real SPICE netlist that the engine simulates like any library pedal, and that
 * "Build it yourself" turns into a schematic and a parts list.
 *
 * Every template is a generic topology from electronics textbooks, written for this project.
 * Part values are standard E12/E24 values that exist in any parts shop.
 */

const opt = (id, name, choices, def, help) => ({ id, name, choices, def, help });
const ch = (id, name, note = '') => ({ id, name, note });

export const TEMPLATES = [
  {
    id: 'boost', name: 'Clean boost', type: 'boost', color: '#d7b43c',
    blurb: 'One JFET transistor that makes the guitar louder and a little fuller. The simplest pedal to build.',
    options: [
      opt('fet', 'Transistor', [ch('J201', 'J201', 'most gain, warm'), ch('2N5457', '2N5457', 'a bit cleaner'), ch('MPF102', 'MPF102', 'most headroom')], 'J201', 'The JFET that does the boosting.'),
      opt('lows', 'Low end', [ch('full', 'Full', 'all the bass'), ch('tight', 'Tight', 'trims the boom'), ch('treble', 'Treble boost', 'only the highs, a classic trick')], 'full', 'The input capacitor decides how much bass gets boosted.'),
      opt('range', 'Gain range', [ch('low', 'Gentle'), ch('high', 'Hot')], 'high', 'How far the Gain knob goes.'),
    ],
    build: (o) => {
      const cin = { full: '100n', tight: '22n', treble: '4.7n' }[o.lows];
      const rs = o.range === 'high' ? '10k' : '2.2k';
      return `V1 vcc 0 9
Vin in 0 0
C1 in g ${cin}
R1 g 0 1Meg
J1 d g s ${o.fet}
R2 vcc d 10k
R3 s 0 1.5k
XGAIN s s gb pot R=${rs} taper=lin rot=0.5
C2 gb 0 22u
C3 d vo 1u
XVOL 0 out vo pot R=100k taper=log rot=0.6
.end`;
    },
    pots: [['XGAIN', 'Gain'], ['XVOL', 'Volume']],
    knobs: { Gain: 'How hard the boost pushes the next pedal. Most of the lift is in the top half of the turn, with a little grit near the end.', Volume: 'How loud the pedal is when it is on. Match it to the bypassed sound, or turn it up for a lift.' },
  },
  {
    id: 'overdrive', name: 'Overdrive', type: 'overdrive', color: '#3f9a5a',
    blurb: 'An op amp with diodes in its feedback loop: the notes round off smoothly, like a small amp turned up.',
    options: [
      opt('diodes', 'Clipping diodes', [ch('si', 'Silicon', 'classic, smooth'), ch('ge', 'Germanium', 'softer, earlier'), ch('led', 'LED', 'louder, more open'), ch('asym', 'Asymmetric', 'richer, tube-like')], 'si', 'The diodes decide the flavour of the grit.'),
      opt('opamp', 'Op amp', [ch('JRC4558', '4558', 'warm, vintage'), ch('TL072', 'TL072', 'clear, modern'), ch('NE5532', 'NE5532', 'hi-fi')], 'JRC4558', 'The chip that provides the gain.'),
      opt('mids', 'Low end into the clipping', [ch('hump', 'Mid hump', 'tight lows, pushed mids'), ch('fuller', 'Fuller', 'more bass'), ch('full', 'Full range', 'all of it')], 'hump', 'Cutting bass before the diodes keeps chords clear.'),
      opt('gain', 'Maximum drive', [ch('500k', 'Medium'), ch('1M', 'High')], '500k', 'The value of the Drive pot.'),
    ],
    build: (o) => {
      const d = { si: ['1N4148', '1N4148'], ge: ['1N34A', '1N34A'], led: ['LED_RED', 'LED_RED'], asym: ['1N4148', '1N4148'] }[o.diodes];
      const c4 = { hump: '47n', fuller: '100n', full: '1u' }[o.mids];
      const extra = o.diodes === 'asym' ? 'D3 dx m1 1N4148\n' : '';
      const d2 = o.diodes === 'asym' ? `D2 o1 dx ${d[1]}` : `D2 o1 m1 ${d[1]}`;
      return `V1 vcc 0 9
Vin in 0 0
R1 vcc vref 10k
R2 vref 0 10k
C1 vref 0 47u
R3 in n1 1k
C2 n1 b1 22n
R4 b1 vref 470k
Q1 vcc b1 e1 2N3904
R5 e1 0 10k
C3 e1 p1 1u
R6 p1 vref 10k
XU1A p1 m1 vcc 0 o1 ${o.opamp}
R7 m1 m2 4.7k
C4 m2 vref ${c4}
R8 m1 fb 47k
XDRIVE fb o1 o1 pot R=${o.gain} taper=log rot=0.5
C5 m1 o1 47p
D1 m1 o1 ${d[0]}
${d2}
${extra}R9 o1 t1 1k
C6 t1 0 220n
XTONE t1 tw o1 pot R=20k taper=lin rot=0.5
XU1B tw o2 vcc 0 o2 ${o.opamp}
C7 o2 ov 1u
XLEVEL 0 out ov pot R=100k taper=log rot=0.6
.end`;
    },
    pots: [['XDRIVE', 'Drive'], ['XTONE', 'Tone'], ['XLEVEL', 'Level']],
    knobs: { Drive: 'How much overdrive. Low is a light edge, high is a creamy lead tone with more low end.', Tone: 'Darker to brighter: turns the treble down or up.', Level: 'How loud the pedal is when it is on. Match it to the bypassed sound, or turn it up for a lift.' },
  },
  {
    id: 'distortion', name: 'Distortion', type: 'distortion', color: '#b8452e',
    blurb: 'An op amp with lots of gain, then diodes to ground that chop the tops off: thicker and tighter than overdrive.',
    options: [
      opt('diodes', 'Clipping diodes', [ch('si', 'Silicon', 'tight, classic'), ch('ge', 'Germanium', 'loose, vintage'), ch('led', 'LED', 'loud, open'), ch('none', 'None', 'op amp clipping only, brash')], 'si', 'The diodes to ground set how hard it clips.'),
      opt('opamp', 'Op amp', [ch('LM741', '741', 'rough, vintage'), ch('TL072', 'TL072', 'clear'), ch('LM358', 'LM358', 'gritty')], 'TL072', 'The chip that provides the gain.'),
      opt('lows', 'Low end', [ch('tight', 'Tight', 'for chugging'), ch('full', 'Full', 'big and heavy')], 'tight', 'How much bass goes into the gain stage.'),
    ],
    build: (o) => {
      const c4 = o.lows === 'tight' ? '1u' : '4.7u';
      const r7 = o.lows === 'tight' ? '1k' : '560';
      const dm = { si: '1N4148', ge: '1N34A', led: 'LED_RED' }[o.diodes];
      const diodes = o.diodes === 'none' ? '' : `D1 cl 0 ${dm}\nD2 0 cl ${dm}\n`;
      return `V1 vcc 0 9
Vin in 0 0
R1 vcc vref 100k
R2 vref 0 100k
C1 vref 0 10u
C2 in p1 22n
R3 in 0 1Meg
R4 p1 vref 1Meg
XU1 p1 m1 vcc 0 o1 ${o.opamp}
R7 m1 m2 ${r7}
C4 m2 0 ${c4}
XDIST m1 o1 o1 pot R=1Meg taper=log rot=0.5
C5 m1 o1 100p
C6 o1 n2 1u
R8 n2 cl 1k
${diodes}R9 cl t1 10k
C7 t1 0 10n
XTONE t1 tw cl pot R=50k taper=lin rot=0.5
XLEVEL 0 out tw pot R=100k taper=log rot=0.55
.end`;
    },
    pots: [['XDIST', 'Distortion'], ['XTONE', 'Tone'], ['XLEVEL', 'Level']],
    knobs: { Distortion: 'How much distortion. All the way down it is almost silent; from the middle up it is thick and saturated.', Tone: 'Darker to brighter. Down tames the fizz, up adds bite.', Level: 'How loud the pedal is when it is on. Match it to the bypassed sound, or turn it up for a lift.' },
  },
  {
    id: 'fuzz', name: 'Two transistor fuzz', type: 'fuzz', color: '#c9412f',
    blurb: 'Two transistors pushed as hard as they go: the thick, buzzy fuzz of the 1960s.',
    options: [
      opt('tr', 'Transistors', [ch('AC128', 'Germanium AC128', 'warm, woolly'), ch('NKT275', 'Germanium NKT275', 'smooth, vintage'), ch('2N3904', 'Silicon 2N3904', 'brighter, aggressive'), ch('BC109', 'Silicon BC109', 'hottest')], 'AC128', 'Germanium is softer and rounder; silicon is brighter and more cutting.'),
      opt('cin', 'Input capacitor', [ch('2.2u', 'Full', 'big and thick'), ch('100n', 'Tight', 'less flub, more focus')], '2.2u', 'Smaller trims the low end, so the fuzz stays tighter.'),
      opt('cout', 'Brightness', [ch('10n', 'Classic'), ch('100n', 'Darker, fuller')], '10n', 'The output capacitor.'),
    ],
    build: (o) => {
      const si = o.tr === '2N3904' || o.tr === 'BC109';
      const models = si ? '' : '.model AC128 PNP(IS=3u BF=90 NF=1.15 VAF=30 IKF=0.3 ISE=100n NE=1.8 BR=5 NR=1.15 RB=80 RC=2 RE=0.5)\n.model NKT275 PNP(IS=2.5u BF=75 NF=1.15 VAF=25 IKF=0.1 ISE=80n NE=1.8 BR=4 NR=1.15 RB=100 RC=2 RE=0.5)\n';
      return `V1 vcc 0 ${si ? 9 : -9}
Vin in 0 0
C1 in b1 ${o.cin}
Q1 c1 b1 0 ${o.tr}
R1 c1 vcc 33k
Q2 c2 c1 e2 ${o.tr}
R2 e2 b1 100k
R3 vcc n1 470
R4 n1 c2 8.2k
XFUZZ 0 fz e2 pot R=1k taper=lin rot=1
C2 fz 0 20u
C3 n1 vo ${o.cout}
XVOL 0 out vo pot R=500k taper=log rot=0.7
${models}.end`;
    },
    pots: [['XFUZZ', 'Fuzz'], ['XVOL', 'Volume']],
    knobs: { Fuzz: 'Fine tunes the fuzz: up is a little brighter and more aggressive. This circuit is fuzzy at every setting.', Volume: 'How loud the pedal is when it is on. Match it to the bypassed sound, or turn it up for a lift.' },
  },
];

export const templateById = (id) => TEMPLATES.find((t) => t.id === id);
export const defaults = (t) => Object.fromEntries(t.options.map((o) => [o.id, o.def]));

/** A complete netlist with the header the site reads (name and knob labels). */
export function buildNetlist(t, options, name) {
  const o = { ...defaults(t), ...options };
  name = String(name).replace(/[\r\n"]/g, ' ').trim() || t.name; // one line, no quotes: it goes into comment and header lines
  const head = [`* ${name}: ${t.name.toLowerCase()} made in the Pedal Workshop (${t.options.map((x) => `${x.name}: ${x.choices.find((c) => c.id === o[x.id]).name}`).join(', ')})`,
    `*@pedal name="${name.replace(/"/g, "'")}"`,
    ...t.pots.map(([ref, label]) => `*@pot ${ref} label="${label}"`)];
  return `${head.join('\n')}\n${t.build(o)}\n`;
}
