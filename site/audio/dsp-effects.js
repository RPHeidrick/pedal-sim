/**
 * Digital models: chorus, flanger, delay and reverb.
 *
 * These four effects are not circuit simulations. Their analog versions depend on parts that
 * cannot be solved component by component in real time (bucket brigade delay chips holding
 * thousands of samples, a physical spring), so they are written as signal processing that
 * copies the analog character: darker repeats, a gentle wobble, soft saturation in the loop.
 * The site labels them "Digital model" everywhere so nobody mistakes them for circuit sims.
 *
 * Each effect runs on the audio thread (pedal-worklet.js wraps it like a circuit pedal) and
 * works in volts, like the circuits: unity level with the effect off, guitar level in and out.
 *
 *   const fx = createDsp('chorus', sampleRate); fx.set(0, 0.5); fx.process(buf, n);
 */

/** Knob help and what each effect is, for the library (plain words, checked by ear and by tools/knob-check.js). */
export const DSP_EFFECTS = [
  {
    id: 'chorus', name: 'Chorus', type: 'modulation', category: 'modulation', color: '#4aa3c7',
    sounds: 'A shimmering, doubled sound, like two guitars playing together. Lovely on clean chords.',
    blurb: 'Digital model of an analog chorus: a short, slowly wobbling delay mixed with the dry guitar, with the slightly dark repeats of a bucket brigade chip.',
    controls: [['Rate', 0.35], ['Depth', 0.5], ['Mix', 0.5]],
    knobs: {
      Rate: 'How fast the shimmer moves: from a slow swirl to a quick warble.',
      Depth: 'How far the pitch wobbles. Low is subtle and wide, high is seasick.',
      Mix: 'How much of the effect you hear against the plain guitar. Half way is the classic sound.',
    },
  },
  {
    id: 'flanger', name: 'Flanger', type: 'modulation', category: 'modulation', color: '#7b6cd9',
    sounds: 'A sweeping, jet plane whoosh. Most dramatic on distorted chords.',
    blurb: 'Digital model of an analog flanger: a very short delay swept up and down and fed back into itself, so the notches in the sound move like a jet passing.',
    controls: [['Rate', 0.3], ['Depth', 0.7], ['Feedback', 0.5]],
    knobs: {
      Rate: 'How fast the sweep goes up and down.',
      Depth: 'How wide the sweep is. Low is a gentle shimmer, high is the full jet plane.',
      Feedback: 'How much of the effect is fed back into itself. Up makes the sweep ring and sound metallic.',
    },
  },
  {
    id: 'delay', name: 'Analog Delay', type: 'time', category: 'time', color: '#2f9e8f',
    sounds: 'Echoes that repeat and fade, each one a little darker and softer, like an analog echo.',
    blurb: 'Digital model of an analog delay: every repeat loses some treble, picks up a touch of saturation and wobbles very slightly, the way bucket brigade echoes do.',
    controls: [['Time', 0.55], ['Repeats', 0.4], ['Mix', 0.4]],
    knobs: {
      Time: 'The gap between echoes, from a short slapback (about 60 ms) to a long echo (about 800 ms).',
      Repeats: 'How many echoes you hear before they fade. Near the top they build up and swell.',
      Mix: 'How loud the echoes are against the plain guitar.',
    },
  },
  {
    id: 'reverb', name: 'Reverb', type: 'time', category: 'time', color: '#5f7fa8',
    sounds: 'The sound of a room around your guitar, from a small room to a big hall.',
    blurb: 'Digital model of a room reverb: a network of short echoes that blur into a smooth tail.',
    controls: [['Decay', 0.45], ['Tone', 0.55], ['Mix', 0.3]],
    knobs: {
      Decay: 'How long the sound hangs in the air after you stop: a small room at the bottom, a big hall at the top.',
      Tone: 'Darker to brighter reverb tail.',
      Mix: 'How much reverb you hear against the plain guitar.',
    },
  },
];
export const dspById = (id) => DSP_EFFECTS.find((e) => e.id === id);

/** A circuit-like description the page and the audio thread can pass around (no parts, just knobs). */
export function dspDesc(id) {
  const e = dspById(id);
  return {
    name: e.name, dsp: id, ok: true, elements: [], nodes: [], diagnostics: [],
    controls: e.controls.map(([label, value], i) => ({ id: i, kind: 'pot', name: label, label, taper: 'lin', value })),
  };
}

// --- building blocks ------------------------------------------------------------------------------

/** Circular delay line with a fractional (linear interpolated) read. */
class DelayLine {
  constructor(maxSamples) { this.buf = new Float64Array(Math.ceil(maxSamples) + 4); this.pos = 0; }
  write(x) { this.buf[this.pos] = x; this.pos = this.pos + 1 === this.buf.length ? 0 : this.pos + 1; }
  /** Sample written `d` samples ago (d >= 1). */
  read(d) {
    const len = this.buf.length;
    let r = this.pos - d;
    while (r < 0) r += len;
    const i = Math.floor(r), f = r - i;
    const a = this.buf[i], b = this.buf[i + 1 === len ? 0 : i + 1];
    return a + (b - a) * f;
  }
  clear() { this.buf.fill(0); }
}

/** One pole low pass (the darkening of analog repeats). */
class OnePole {
  constructor(fc, fs) { this.set(fc, fs); this.y = 0; }
  set(fc, fs) { this.a = Math.exp((-2 * Math.PI * fc) / fs); }
  run(x) { this.y = x + this.a * (this.y - x); return this.y; }
}

/** Parameter smoothing, so turning a knob never clicks. */
class Smooth {
  constructor(v, fs, ms = 30) { this.v = v; this.t = v; this.k = 1 - Math.exp(-1 / (fs * ms / 1000)); }
  next() { this.v += (this.t - this.v) * this.k; return this.v; }
}

/** Triangle LFO in -1..1 (bucket brigade chorus and flanger circuits use triangles). */
class Lfo {
  constructor(fs, phase = 0) { this.fs = fs; this.ph = phase; }
  next(hz) { this.ph += hz / this.fs; if (this.ph >= 1) this.ph -= 1; return 4 * Math.abs(this.ph - 0.5) - 1; }
}

const softClip = (x, h) => h * Math.tanh(x / h);
const expMap = (v, lo, hi) => lo * Math.pow(hi / lo, v);

// --- the effects ----------------------------------------------------------------------------------

class Chorus {
  constructor(fs) {
    this.fs = fs;
    this.line = new DelayLine(0.03 * fs);
    this.lfo = new Lfo(fs);
    this.dark = new OnePole(5500, fs); // bucket brigade anti-alias filters make the wet signal a little dark
    this.p = [new Smooth(0.35, fs), new Smooth(0.5, fs), new Smooth(0.5, fs)];
  }
  set(i, v) { this.p[i].t = v; }
  process(buf, n) {
    const fs = this.fs;
    for (let i = 0; i < n; i++) {
      const rate = expMap(this.p[0].next(), 0.12, 6), depth = this.p[1].next(), mix = this.p[2].next();
      const x = buf[i];
      this.line.write(x);
      const d = (0.0075 + 0.0045 * depth * this.lfo.next(rate)) * fs; // 3 to 12 ms around 7.5 ms
      const wet = this.dark.run(this.line.read(d));
      buf[i] = x * (1 - 0.4 * mix) + wet * mix * 0.75;
    }
  }
}

class Flanger {
  constructor(fs) {
    this.fs = fs;
    this.line = new DelayLine(0.012 * fs);
    this.lfo = new Lfo(fs, 0.25);
    this.fb = 0;
    this.p = [new Smooth(0.3, fs), new Smooth(0.7, fs), new Smooth(0.5, fs)];
  }
  set(i, v) { this.p[i].t = v; }
  process(buf, n) {
    const fs = this.fs;
    for (let i = 0; i < n; i++) {
      const rate = expMap(this.p[0].next(), 0.05, 4), depth = this.p[1].next(), fbk = 0.85 * this.p[2].next();
      const x = buf[i];
      // sweep 0.3 ms to 0.3 + 6 ms * depth, on an exponential curve (the way the ear hears pitch)
      const u = 0.5 + 0.5 * this.lfo.next(rate);
      const d = (0.0003 + 0.006 * depth * u * u) * fs + 1;
      const wet = this.line.read(d);
      this.line.write(softClip(x + fbk * wet, 1.5));
      buf[i] = 0.7 * (x + wet);
    }
  }
}

class AnalogDelay {
  constructor(fs) {
    this.fs = fs;
    this.line = new DelayLine(0.85 * fs);
    this.dark = new OnePole(2800, fs);
    this.low = new OnePole(90, fs);    // the echo loop also loses deep bass
    this.wow = new Lfo(fs);
    this.p = [new Smooth(0.4, fs, 250), new Smooth(0.35, fs), new Smooth(0.4, fs)]; // slow Time smoothing = the classic pitch slur when you turn it
  }
  set(i, v) { this.p[i].t = v; }
  process(buf, n) {
    const fs = this.fs;
    for (let i = 0; i < n; i++) {
      const time = expMap(this.p[0].next(), 0.06, 0.8), rep = 0.92 * this.p[1].next(), mix = this.p[2].next();
      const x = buf[i];
      const d = time * fs * (1 + 0.0015 * this.wow.next(0.35));
      let e = this.line.read(d);
      e = this.dark.run(e);
      e -= this.low.run(e);
      this.line.write(softClip(x + rep * e, 0.8));
      buf[i] = x + mix * 1.1 * e;
    }
  }
}

/**
 * Room reverb: 8 parallel damped comb filters into 4 series all-passes (the classic
 * Schroeder / Moorer structure), delay lengths scaled to the sample rate.
 */
class Reverb {
  constructor(fs) {
    this.fs = fs;
    const s = fs / 44100;
    this.combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((l) => ({ line: new DelayLine(l * s + 2), len: Math.round(l * s), lp: 0 }));
    this.aps = [556, 441, 341, 225].map((l) => ({ line: new DelayLine(l * s + 2), len: Math.round(l * s) }));
    this.pre = new DelayLine(0.03 * fs); // 12 ms pre-delay keeps the pick attack clear
    this.preLen = Math.round(0.012 * fs);
    this.hp = new OnePole(120, fs);        // no boomy low end in the tail
    this.p = [new Smooth(0.45, fs, 60), new Smooth(0.55, fs), new Smooth(0.3, fs)];
  }
  set(i, v) { this.p[i].t = v; }
  process(buf, n) {
    for (let i = 0; i < n; i++) {
      const decay = this.p[0].next(), tone = this.p[1].next(), mix = this.p[2].next();
      // comb feedback from the wanted decay time: about 0.4 s (small room) to 5 s (big hall)
      if (decay !== this.lastDecay) { this.lastDecay = decay; this.fb = Math.pow(10, (-3 * 0.031) / (0.4 * Math.pow(12.5, decay))); }
      const fb = this.fb;
      const damp = 0.05 + 0.6 * (1 - tone);   // more damping = darker tail
      const x = buf[i];
      this.pre.write(x);
      let inp = this.pre.read(this.preLen);
      inp -= this.hp.run(inp);
      let y = 0;
      for (const c of this.combs) {
        const o = c.line.read(c.len);
        c.lp = o * (1 - damp) + c.lp * damp;
        c.line.write(inp * 0.03 + c.lp * fb);
        y += o;
      }
      for (const a of this.aps) {
        const o = a.line.read(a.len);
        const v = y + 0.5 * o;
        a.line.write(v);
        y = o - 0.5 * v;
      }
      buf[i] = x + mix * 3 * y;
    }
  }
}

const MAKERS = { chorus: Chorus, flanger: Flanger, delay: AnalogDelay, reverb: Reverb };

/** A running effect for `id` at sample rate `fs`, with its knobs at `controls` (0..1 each). */
export function createDsp(id, fs, controls = null) {
  const Make = MAKERS[id];
  if (!Make) throw new Error(`unknown digital effect ${id}`);
  const fx = new Make(fs);
  const vals = controls || dspById(id).controls.map((c) => c[1]);
  vals.forEach((v, i) => { fx.set(i, v); fx.p[i].v = v; });
  return fx;
}
