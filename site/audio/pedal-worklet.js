/**
 * Real-time pedal chain, running on the browser's audio thread (AudioWorklet).
 *
 * Each pedal is the same MNA Circuit the engine bench uses, stepped once per
 * oversampled sample. Circuit descriptions are elaborated on the main thread
 * (parsers are not needed here) and posted in as plain JSON.
 *
 * Digital models (chorus, flanger, delay, reverb) sit in the same chain as DspPedal slots.
 *
 * Signal flow per 128-sample block:
 *   input (digital) -> input cleanup (live guitar only: see input-cleanup.js) x inGain -> volts
 *     -> [pedal 1] -> [pedal 2] ... -> volts x outGain -> DC block -> output
 *
 * Messages in (port.onmessage):
 *   {type:'add', uid, desc, controls, bypass, index}   insert a pedal
 *   {type:'replace', uid, desc, controls}              swap circuit (e.g. Si <-> Ge), same slot
 *   {type:'remove', uid}
 *   {type:'order', uids}
 *   {type:'control', uid, index, value}
 *   {type:'bypass', uid, on}
 *   {type:'settings', inGain?, outGain?, oversample?, compare?, engine?: 'wasm'|'js',
 *                     cab?: 'off'|'1x12'|'4x12', inputMode?: 'mix'|'loudest', ceiling?: dBFS,
 *                     cleanup?: {...see input-cleanup.js}, cleanupActive?: boolean}
 *   {type:'capture', id, seconds, stage?}              record the input: 'raw' (for the input check) or
 *                                                      'clean' (after the cleanup, for Record a riff)
 *   {type:'captureStop', id}                            end a capture early and send what was recorded
 *   {type:'wasm', bytes}                                the compiled C++ engine (engine/wasm/pedal-engine.wasm)
 * Messages out: {type:'stats', inPeak, outPeak, inVolts, load, failures, limitDb, gateOpen} about 10x per second,
 *               {type:'capture', id, samples} when a capture is complete.
 *
 * After the pedals: speaker cabinet filter (the "Amp" jack), output volume, then a
 * look-ahead peak limiter (ceiling -1 dBFS, or -12 dBFS with the safety cap) that
 * protects ears and speakers.
 */
import { Circuit } from '../../engine/js/circuit.js';
import { Oversampler } from '../../engine/js/oversample.js';
import { WasmEngine } from '../../engine/wasm/wasm-engine.js';
import { InputCleanup } from './input-cleanup.js';
import { createDsp } from './dsp-effects.js';

const FADE_SAMPLES = 256; // bypass crossfade (about 5 ms at 48 kHz)

// Element types with no nonlinearity. A pedal made only of these (a passive tone
// stack, say) produces no new harmonics, so it gains nothing from oversampling.
const LINEAR_TYPES = new Set(['V', 'I', 'R', 'C', 'L', 'POT', 'SW', 'E', 'G', 'F', 'H']);
const isLinear = (desc) => desc.elements.every((e) => LINEAR_TYPES.has(e.type));

/** Second-order IIR filter (RBJ audio EQ cookbook), transposed direct form II. */
class Biquad {
  constructor(type, f, Q, gainDb, fs) {
    const A = Math.pow(10, (gainDb || 0) / 40), w = (2 * Math.PI * f) / fs;
    const cw = Math.cos(w), al = Math.sin(w) / (2 * Q);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
    else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
    else { b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; } // peaking
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    this.z1 = 0; this.z2 = 0;
  }
  run(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
  /** |H| at frequency f */
  mag(f, fs) {
    const w = (2 * Math.PI * f) / fs, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    const nr = this.b0 + this.b1 * c1 + this.b2 * c2, ni = -(this.b1 * s1 + this.b2 * s2);
    const dr = 1 + this.a1 * c1 + this.a2 * c2, di = -(this.a1 * s1 + this.a2 * s2);
    return Math.hypot(nr, ni) / Math.hypot(dr, di);
  }
}

/**
 * Guitar speaker cabinets. A pedal is never heard straight: the amp's speaker rolls
 * off everything above about 5 kHz, which is what turns raw fuzz fizz into a tone.
 * Each is a low cut, the cabinet's low resonance, a midrange dip, the cone's
 * presence peak, and a steep 4th order high cut (two Butterworth sections).
 */
const CABS = {
  '1x12': [['hp', 75, 0.7], ['peak', 115, 1.3, 3], ['peak', 450, 1.0, -2], ['peak', 2400, 1.5, 3], ['lp', 5500, 0.54], ['lp', 5500, 1.31]],
  '4x12': [['hp', 60, 0.9], ['peak', 95, 1.6, 5], ['peak', 400, 1.0, -3], ['peak', 2000, 1.4, 3.5], ['lp', 4600, 0.54], ['lp', 4600, 1.31]],
};
function makeCab(kind, fs) {
  const spec = CABS[kind];
  if (!spec) return null;
  const f = spec.map(([t, fc, Q, g]) => new Biquad(t, fc, Q, g, fs));
  // level-match at 1 kHz so switching the cabinet does not jump in volume
  const g1k = f.reduce((m, b) => m * b.mag(1000, fs), 1);
  return { f, gain: 1 / g1k };
}

/**
 * Look-ahead peak limiter. The audio is delayed 0.6 ms so the gain can ease down
 * *before* a peak arrives instead of chopping it (which a zero-lookahead limiter
 * does, and which you hear as a click or crackle on hard pick attacks):
 *   1. needed gain per sample = ceiling / |x| (1 when below the ceiling)
 *   2. the minimum of that over the look-ahead window (peak hold)
 *   3. a 150 ms release so the gain recovers smoothly after a peak
 *   4. a moving average over the window, so every change is a gentle ramp
 * Step 4 never overshoots: the average of values that are all <= the needed gain.
 * A soft clip after it only acts if something unexpected gets through.
 */
class Limiter {
  constructor(fs, ceilingDb = -1) {
    this.W = Math.max(8, Math.round(0.0006 * fs)); // keep in step with LIMITER_LOOKAHEAD in audio.js
    this.delay = new Float64Array(this.W);   // audio delay line
    this.hold = new Float64Array(this.W + 1).fill(1); // needed-gain history for the peak hold
    this.box = new Float64Array(this.W).fill(1);      // smoothed gain history for the average
    this.boxSum = this.W;
    this.pos = 0; this.hpos = 0; this.bpos = 0;
    this.env = 1;
    this.rel = 1 - Math.exp(-1 / (0.15 * fs));
    this.min = 1;                            // lowest gain since the last report
    this.setCeiling(ceilingDb);
  }
  setCeiling(db) { this.T = Math.pow(10, db / 20); }
  run(x) {
    const T = this.T, a = Math.abs(x);
    const need = a > T ? T / a : 1;
    const hold = this.hold;
    hold[this.hpos] = need;
    this.hpos = this.hpos + 1 === hold.length ? 0 : this.hpos + 1;
    let m = 1;
    for (let k = 0; k < hold.length; k++) if (hold[k] < m) m = hold[k]; // short window: a plain scan is cheapest
    this.env = m < this.env ? m : this.env + (m - this.env) * this.rel;
    this.boxSum += this.env - this.box[this.bpos];
    this.box[this.bpos] = this.env;
    this.bpos = this.bpos + 1 === this.W ? 0 : this.bpos + 1;
    const g = Math.min(1, this.boxSum / this.W);
    if (g < this.min) this.min = g;
    const d = this.delay[this.pos];
    this.delay[this.pos] = x;
    this.pos = this.pos + 1 === this.W ? 0 : this.pos + 1;
    let y = d * g;
    const b = Math.abs(y);
    if (b > T) y = Math.sign(y) * (T + (1 - T) * Math.tanh((b - T) / (1 - T)));
    return y;
  }
}

/**
 * One pedal. Runs on either backend with identical results:
 *   'wasm' the C++ engine compiled to WebAssembly (about 2x faster)
 *   'js'   the JavaScript engine (fallback, and for comparison)
 */
class Pedal {
  constructor(uid, desc, controls, bypass, fs, L, wasm) {
    this.uid = uid;
    this.desc = desc;
    this.controls = controls.slice();
    this.mix = bypass ? 0 : 1;          // 0 = bypassed (dry), 1 = circuit
    this.target = this.mix;
    this.dry = new Float64Array(128);
    this.linear = isLinear(desc);
    this.build(fs, L, wasm);
  }

  build(fs, L, wasm) {
    this.free();
    if (this.linear) L = 1; // no harmonics generated, so no aliasing to remove
    if (this.desc.maxOversample) L = Math.min(L, this.desc.maxOversample); // e.g. a phaser: sweeps, but barely distorts
    this.L = L;
    this.wasm = null;
    if (wasm) {
      try {
        this.handle = wasm.create(this.desc, this.controls, fs, L);
        this.wasm = wasm;
        return;
      } catch { /* fall through to the JavaScript engine for this pedal */ }
    }
    this.circuit = new Circuit(this.desc, { sampleRate: fs * L });
    this.controls.forEach((v, i) => this.circuit.setControl(i, v, true));
    this.circuit.reset();
    this.os = new Oversampler(L);
    this.os.reset(0);
    this.dcOut = this.circuit.x[this.circuit.outIdx];
    if (L > 1) this.os.downHist.fill(this.dcOut);
    this.up = new Float64Array(L);
    this.hi = new Float64Array(L);
    // output DC removal (1-pole high pass ~5 Hz) so pedals chain cleanly
    this.hpX = this.dcOut; this.hpY = 0;
    this.hpA = Math.exp((-2 * Math.PI * 5) / fs);
  }

  free() {
    if (this.wasm && this.handle != null) this.wasm.destroy(this.handle);
    this.handle = null;
    this.circuit = null;
  }

  get failures() { return this.wasm ? this.wasm.failures(this.handle) : this.circuit.stats.failures; }

  setControl(i, v) {
    this.controls[i] = v;
    if (this.wasm) this.wasm.setControl(this.handle, i, v);
    else this.circuit.setControl(i, v);
  }

  /** Process one block in place (volts). */
  process(buf, n) {
    if (this.mix === 0 && this.target === 0) return; // true bypass, costs nothing
    const fading = this.mix !== this.target || this.mix !== 1;
    if (fading) {
      if (this.dry.length < n) this.dry = new Float64Array(n); // browsers may one day use blocks other than 128
      this.dry.set(buf.subarray(0, n));
    }
    if (this.wasm) this.wasm.process(this.handle, buf, n);
    else this.processJS(buf, n);
    if (!fading) return;
    const step = 1 / FADE_SAMPLES, dry = this.dry;
    for (let i = 0; i < n; i++) {
      if (this.mix !== this.target) {
        this.mix += this.mix < this.target ? step : -step;
        if (Math.abs(this.mix - this.target) < step) this.mix = this.target;
      }
      buf[i] = dry[i] + (buf[i] - dry[i]) * this.mix;
    }
  }

  processJS(buf, n) {
    const c = this.circuit, os = this.os, up = this.up, hi = this.hi, L = this.L;
    for (let i = 0; i < n; i++) {
      os.up(buf[i], up);
      for (let k = 0; k < L; k++) hi[k] = c.step(up[k]);
      let y = os.down(hi);
      const hp = this.hpA * (this.hpY + y - this.hpX);
      this.hpX = y; this.hpY = hp; y = hp;
      if (!Number.isFinite(y)) { this.build(sampleRate, L, null); y = 0; }
      buf[i] = y;
    }
  }
}

/**
 * A digital model (chorus, flanger, delay, reverb: see dsp-effects.js) in a pedal slot. Same
 * outside as a circuit Pedal: knobs, bypass with the same crossfade, and nothing to oversample.
 * Bypass cuts the echoes and the reverb tail at once, like a true bypass pedal.
 */
class DspPedal {
  constructor(uid, desc, controls, bypass, fs) {
    this.uid = uid;
    this.desc = desc;
    this.controls = controls.slice();
    this.mix = bypass ? 0 : 1;
    this.target = this.mix;
    this.dry = new Float64Array(128);
    this.fx = createDsp(desc.dsp, fs, this.controls);
  }
  build() { /* no circuit and no oversampling: nothing to rebuild */ }
  free() {}
  get failures() { return 0; }
  setControl(i, v) { this.controls[i] = v; this.fx.set(i, v); }
  process(buf, n) {
    if (this.mix === 0 && this.target === 0) return;
    const fading = this.mix !== this.target || this.mix !== 1;
    if (fading) {
      if (this.dry.length < n) this.dry = new Float64Array(n);
      this.dry.set(buf.subarray(0, n));
    }
    this.fx.process(buf, n);
    if (!fading) return;
    const step = 1 / FADE_SAMPLES, dry = this.dry;
    for (let i = 0; i < n; i++) {
      if (this.mix !== this.target) {
        this.mix += this.mix < this.target ? step : -step;
        if (Math.abs(this.mix - this.target) < step) this.mix = this.target;
      }
      buf[i] = dry[i] + (buf[i] - dry[i]) * this.mix;
    }
  }
}
const makePedal = (uid, desc, controls, bypass, fs, L, wasm) => (desc.dsp ? new DspPedal(uid, desc, controls, bypass, fs) : new Pedal(uid, desc, controls, bypass, fs, L, wasm));

class PedalChain extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pedals = [];
    this.L = 2;
    this.inGain = 1;      // volts per digital full scale
    this.outGain = 1;     // digital full scale per volt
    this.compare = false; // A/B: true = hear the dry input
    this.wasmEngine = null;   // compiled C++ engine, once the main thread sends it
    this.useWasm = true;
    this.buf = new Float64Array(128);
    this.cabKind = '1x12';
    this.cab = makeCab(this.cabKind, sampleRate);
    this.inputMode = 'mix';                 // 'loudest': use the livelier channel (a guitar in input 1 or 2)
    this.chEnergy = [0, 0]; this.chPick = 0;
    this.cleanup = new InputCleanup(sampleRate); // hum, hiss and noise removal for a live guitar
    this.cleanupActive = false;                  // only while the input is a live guitar
    this.capture = null;                         // { id, buf, pos } while recording for the input check
    this.limiter = new Limiter(sampleRate, -1); // ceiling -1 dBFS, or lower with the safety cap
    this.inPeak = 0; this.outPeak = 0;
    this.busyMs = 0; this.blocks = 0; this.lastReport = currentTime;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  find(uid) { return this.pedals.find((p) => p.uid === uid); }

  /** Record one block into the running capture (if it is for this stage). */
  captureBlock(buf, n, stage) {
    const cap = this.capture;
    if (!cap || cap.stage !== stage) return;
    const k = Math.min(n, cap.buf.length - cap.pos);
    cap.buf.set(buf.subarray(0, k), cap.pos);
    cap.pos += k;
    if (cap.pos >= cap.buf.length) this.finishCapture();
  }

  /** Send the recorded samples to the page (only the part that was filled). */
  finishCapture() {
    const cap = this.capture;
    this.capture = null;
    const samples = cap.pos < cap.buf.length ? cap.buf.slice(0, cap.pos) : cap.buf;
    this.port.postMessage({ type: 'capture', id: cap.id, samples }, [samples.buffer]);
  }

  get backend() { return this.useWasm ? this.wasmEngine : null; }

  rebuildAll() {
    for (const p of this.pedals) p.build(sampleRate, this.L, this.backend);
    this.port.postMessage({ type: 'engine', engine: this.backend ? 'wasm' : 'js' });
  }

  onMessage(m) {
    try {
      switch (m.type) {
        case 'add': {
          const p = makePedal(m.uid, m.desc, m.controls, m.bypass, sampleRate, this.L, this.backend);
          const i = m.index == null ? this.pedals.length : m.index;
          this.pedals.splice(i, 0, p);
          break;
        }
        case 'replace': {
          const old = this.find(m.uid);
          if (!old) break;
          const p = makePedal(m.uid, m.desc, m.controls, old.target === 0, sampleRate, this.L, this.backend);
          this.pedals[this.pedals.indexOf(old)] = p;
          old.free();
          break;
        }
        case 'remove': { const p = this.find(m.uid); if (p) p.free(); this.pedals = this.pedals.filter((x) => x !== p); break; }
        case 'wasm':
          this.wasmEngine = new WasmEngine(m.bytes);
          this.rebuildAll();
          break;
        case 'order': {
          const next = m.uids.map((u) => this.find(u)).filter(Boolean);
          for (const p of this.pedals) if (!next.includes(p)) p.free(); // a pedal left out is gone: release its memory
          this.pedals = next;
          break;
        }
        case 'control': { const p = this.find(m.uid); if (p) p.setControl(m.index, m.value); break; }
        case 'bypass': { const p = this.find(m.uid); if (p) p.target = m.on ? 0 : 1; break; }
        case 'capture':
          this.capture = { id: m.id, stage: m.stage || 'raw', buf: new Float32Array(Math.round(Math.min(60, m.seconds) * sampleRate)), pos: 0 };
          break;
        case 'captureStop':
          if (this.capture && this.capture.id === m.id) this.finishCapture();
          break;
        case 'settings':
          if (m.inGain != null) this.inGain = m.inGain;
          if (m.outGain != null) this.outGain = m.outGain;
          if (m.compare != null) this.compare = m.compare;
          if (m.cab != null && m.cab !== this.cabKind) { this.cabKind = m.cab; this.cab = makeCab(m.cab, sampleRate); }
          if (m.inputMode != null) this.inputMode = m.inputMode;
          if (m.cleanup != null) this.cleanup.configure(m.cleanup);
          if (m.cleanupActive != null) this.cleanupActive = m.cleanupActive;
          if (m.ceiling != null) this.limiter.setCeiling(m.ceiling);
          if (m.engine != null && (m.engine === 'wasm') !== this.useWasm) {
            this.useWasm = m.engine === 'wasm';
            this.rebuildAll();
          }
          if (m.oversample != null && m.oversample !== this.L) {
            this.L = m.oversample;
            for (const p of this.pedals) p.build(sampleRate, this.L, this.backend);
          }
          break;
      }
      this.port.postMessage({ type: 'ack', of: m.type, uid: m.uid });
    } catch (err) {
      this.port.postMessage({ type: 'error', of: m.type, uid: m.uid, message: String(err && err.message || err) });
    }
  }

  process(inputs, outputs) {
    const t0 = Date.now();
    const input = inputs[0];
    const out = outputs[0];
    const n = out[0].length;
    if (this.buf.length < n) this.buf = new Float64Array(n);
    const buf = this.buf;

    // 1. raw input, mono: a mix of the channels (samples, files), or for a live interface the
    //    channel the guitar is actually on, so an empty second input does not halve the level
    if (input && input.length) {
      const ch = input.length;
      if (this.inputMode === 'loudest' && ch > 1) {
        for (let c = 0; c < 2; c++) {
          let e = 0; const x = input[c];
          for (let i = 0; i < n; i++) e += x[i] * x[i];
          this.chEnergy[c] = 0.95 * this.chEnergy[c] + 0.05 * e;
        }
        const other = 1 - this.chPick;
        if (this.chEnergy[other] > 4 * this.chEnergy[this.chPick] + 1e-9) this.chPick = other; // switch only when clearly louder (6 dB)
        const x = input[this.chPick];
        for (let i = 0; i < n; i++) buf[i] = x[i];
      } else {
        for (let i = 0; i < n; i++) {
          let s = 0;
          for (let c = 0; c < ch; c++) s += input[c][i];
          buf[i] = s / ch;
        }
      }
    } else buf.fill(0, 0, n);

    // 2. the input check records the raw signal, before any cleanup
    this.captureBlock(buf, n, 'raw');

    // 3. live guitar: remove rumble, hum, hiss and the noise between notes
    if (this.cleanupActive) this.cleanup.process(buf, n);
    this.captureBlock(buf, n, 'clean'); // Record a riff: the cleaned guitar, before the level and the pedals

    // 4. digital level -> volts at the first pedal
    const gIn = this.inGain;
    for (let i = 0; i < n; i++) buf[i] *= gIn;

    let ip = 0;
    for (let i = 0; i < n; i++) { const a = Math.abs(buf[i]); if (a > ip) ip = a; }

    if (!this.compare) {
      for (const p of this.pedals) {
        try { p.process(buf, n); }
        catch (err) {
          // An exception here would stop ALL sound for the rest of the visit (the browser
          // shuts down a worklet that throws). Instead, rebuild just this pedal on the
          // JavaScript engine and tell the page.
          try { p.build(sampleRate, this.L, null); } catch { p.target = 0; p.mix = 0; }
          this.port.postMessage({ type: 'error', of: 'process', uid: p.uid, message: `A pedal hit a problem and was restarted (${err && err.message || err})` });
        }
      }
    }

    // speaker cabinet (also on the dry A/B signal: both go through the same "amp")
    const cab = this.cab;
    if (cab) {
      const f = cab.f, nf = f.length;
      for (let i = 0; i < n; i++) {
        let y = buf[i] * cab.gain;
        for (let k = 0; k < nf; k++) y = f[k].run(y);
        buf[i] = y;
      }
    }

    // volume, then the look-ahead peak limiter (transparent below its ceiling)
    let op = 0;
    const g = this.outGain, lim = this.limiter;
    const o0 = out[0];
    for (let i = 0; i < n; i++) {
      const y = buf[i] * g;
      const a = Math.abs(y);
      if (a > op) op = a;
      const z = lim.run(y);
      o0[i] = Number.isFinite(z) ? z : 0;
    }
    for (let c = 1; c < out.length; c++) out[c].set(o0);

    this.inPeak = Math.max(this.inPeak, ip);
    this.outPeak = Math.max(this.outPeak, op);
    this.busyMs += Date.now() - t0;
    this.blocks++;
    if (currentTime - this.lastReport > 0.1) {
      const blockMs = (1000 * n) / sampleRate;
      let failures = 0;
      for (const p of this.pedals) failures += p.failures;
      this.port.postMessage({
        type: 'stats',
        inVolts: this.inPeak, inPeak: this.inPeak / this.inGain, outPeak: this.outPeak,
        load: this.busyMs / (this.blocks * blockMs), failures, engine: this.backend ? 'wasm' : 'js',
        limitDb: 20 * Math.log10(this.limiter.min),
        gateOpen: this.cleanupActive ? this.cleanup.gateOpen !== false : null,
      });
      this.limiter.min = 1;
      this.inPeak = 0; this.outPeak = 0; this.busyMs = 0; this.blocks = 0;
      this.lastReport = currentTime;
    }
    return true;
  }
}

registerProcessor('pedal-chain', PedalChain);
