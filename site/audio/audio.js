/**
 * Audio graph for the pedalboard.
 *
 *   source (sample sound | audio interface | digital guitar | file)
 *      -> input tap (analyser for the tuner and the guitar setup level check)
 *      -> PedalChain worklet (circuits in real time, then speaker cabinet,
 *         volume and a -1 dBFS peak limiter that protects ears and speakers)
 *      -> analyser (scope) -> speakers
 */
import { DEFAULT_SAMPLE, loadSample, prefetchSample } from '../inputs/samples.js';

/** Safety limiter look-ahead in seconds (see Limiter in pedal-worklet.js). */
export const LIMITER_LOOKAHEAD = 0.0006;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.source = null;       // current source node
    this.sourceKind = 'sample'; // 'sample' | 'live' | 'digital' | 'file'
    this.sampleId = DEFAULT_SAMPLE;
    this.deviceId = '';       // chosen audio input for a live guitar ('' = the computer's default)
    this.stream = null;
    this.buffers = {};        // decoded AudioBuffers: file, and 'sample:<id>'
    this.onStats = () => {};
    this.onError = () => {};
    this.onEngine = () => {};
    this.pending = [];        // messages queued before the worklet exists
    this.captures = new Map(); // capture id -> resolve function
    this.cleanup = null;      // input cleanup settings for a live guitar (see input-cleanup.js)
  }

  get running() { return !!this.ctx && this.ctx.state === 'running'; }

  /** Must be called from a click (browsers only allow audio after a user gesture). */
  async start() {
    if (!this.ctx) {
      // Run at the sound card's own rate when it is 44.1 or 48 kHz, so the browser never
      // has to resample the output (resampling softens the top end a little). Rates above
      // 48 kHz only cost processing power here, so those run at 48 kHz.
      // Fastest response asks the browser for its smallest sound card buffer (0 = "as small
      // as you can"): the lowest delay for a live guitar, at some risk of crackles on a slow
      // computer. Steady uses the browser's normal interactive buffer.
      const latencyHint = this.lowLatency ? 0 : 'interactive';
      this.ctx = new AudioContext({ latencyHint });
      if (this.ctx.sampleRate > 48000 || this.ctx.sampleRate < 44100) {
        await this.ctx.close();
        this.ctx = new AudioContext({ latencyHint, sampleRate: 48000 });
      }
      await this.ctx.audioWorklet.addModule(new URL('./pedal-worklet.js', import.meta.url));
      this.node = new AudioWorkletNode(this.ctx, 'pedal-chain', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        channelCount: 2, channelCountMode: 'explicit',
      });
      this.node.port.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'stats') this.onStats(m);
        else if (m.type === 'error') this.onError(m);
        else if (m.type === 'engine') this.onEngine(m.engine);
        else if (m.type === 'capture') { const done = this.captures.get(m.id); if (done) { this.captures.delete(m.id); done(m.samples); } }
      };
      // The limiter lives inside the worklet. The browser's DynamicsCompressor adds its own
      // automatic make-up gain and lookahead colour, so it is no longer in the path.
      this.master = new GainNode(this.ctx, { gain: 0 }); // faded in by start()
      this.analyser = new AnalyserNode(this.ctx, { fftSize: 2048, smoothingTimeConstant: 0.6 });
      this.node.connect(this.master).connect(this.analyser).connect(this.ctx.destination);
      // what the pedals receive, for the tuner and the level check (does not change the sound)
      this.inTap = new AnalyserNode(this.ctx, { fftSize: 4096, smoothingTimeConstant: 0 });
      // the Digital guitar plays its notes into this bus
      this.digitalBus = new GainNode(this.ctx, { gain: 1 });
      for (const m of this.pending) this.node.port.postMessage(m);
      this.pending = [];
      this.loadWasm();
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    await this.setSource(this.sourceKind);
    // never start at full level: fade in over about 2 seconds
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(0, t);
    this.master.gain.setTargetAtTime(1, t + 0.05, 0.5);
  }

  /**
   * Download what Power on needs (the C++ engine and the chosen sample) while the visitor
   * is still looking at the page, so the sound starts straight away when they click.
   * Skipped when the browser asks to save data.
   */
  prefetch() {
    if (navigator.connection && navigator.connection.saveData) return;
    this.wasmBytes();
    if (this.sourceKind === 'sample') prefetchSample(this.sampleId).catch(() => {});
  }

  /** The compiled C++ engine's bytes (downloaded once). */
  wasmBytes() {
    if (!this._wasm) {
      this._wasm = fetch(new URL('../../engine/wasm/pedal-engine.wasm', import.meta.url)).then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      });
      this._wasm.catch(() => { this._wasm = null; }); // try again next time
    }
    return this._wasm;
  }

  /** Hand the compiled C++ engine to the audio thread (which cannot download by itself). */
  async loadWasm() {
    try {
      this.node.port.postMessage({ type: 'wasm', bytes: await this.wasmBytes() }); // posting copies the bytes
    } catch (err) {
      this.onError({ message: `C++ engine unavailable, using JavaScript (${err.message || err})` });
    }
  }

  async stop() {
    if (this.master) this.master.gain.setValueAtTime(0, this.ctx.currentTime);
    this.disconnectSource();
    if (this.ctx) await this.ctx.suspend();
  }

  /** Send a message to the audio thread (queued until Power on creates it). */
  send(msg) {
    if (this.node) { this.node.port.postMessage(msg); return; }
    // Before Power on, a knob turned back and forth would queue hundreds of messages;
    // only its last position matters, so replace the older one.
    if (msg.type === 'control') {
      const i = this.pending.findIndex((m) => m.type === 'control' && m.uid === msg.uid && m.index === msg.index);
      if (i >= 0) { this.pending.splice(i, 1); }
    }
    this.pending.push(msg);
  }

  disconnectSource() {
    if (this.source) {
      if (this.source !== this.digitalBus) { try { this.source.stop && this.source.stop(); } catch { /* already stopped */ } }
      this.source.disconnect();
      this.source = null;
    }
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
  }

  /** Decode (or build) a sample once and keep it. */
  async sampleBuffer(id) {
    const key = `sample:${id}`;
    if (!this.buffers[key]) this.buffers[key] = await loadSample(this.ctx, id);
    return this.buffers[key];
  }

  /**
   * @param {'sample'|'live'|'digital'|'file'} kind
   * @param {{deviceId?: string, sampleId?: string}} [opts]
   */
  async setSource(kind, opts = {}) {
    this.sourceKind = kind;
    if (opts.sampleId) this.sampleId = opts.sampleId;
    if (opts.deviceId !== undefined) this.deviceId = opts.deviceId || '';
    if (!this.ctx) return;
    // Each call gets a number. If a newer call starts while this one is still loading,
    // this one quietly gives up, so the last thing clicked is always what you hear.
    const gen = this.srcGen = (this.srcGen || 0) + 1;
    // fetch before stopping the old source, so switching samples has no gap
    const buf = kind === 'sample' ? await this.sampleBuffer(this.sampleId) : kind === 'file' ? this.buffers.file : null;
    if (gen !== this.srcGen) return;
    this.disconnectSource();
    // a live interface often delivers 2 channels with the guitar on only one of them;
    // and only a live guitar goes through the input cleanup (samples are clean already)
    this.send({ type: 'settings', inputMode: kind === 'live' ? 'loudest' : 'mix', cleanupActive: kind === 'live' && !!this.cleanup && this.cleanup.enabled !== false });
    if (kind === 'live') {
      // Raw signal: no echo cancellation, noise suppression or auto gain, which would wreck a guitar tone.
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: this.deviceId ? { exact: this.deviceId } : undefined,
          echoCancellation: false, noiseSuppression: false, autoGainControl: false, voiceIsolation: false,
          channelCount: { ideal: 1 }, latency: { ideal: 0 }, sampleRate: { ideal: this.ctx.sampleRate }, sampleSize: { ideal: 24 },
        },
      });
      if (gen !== this.srcGen) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; return; } // superseded: close the mic again
      this.source = new MediaStreamAudioSourceNode(this.ctx, { mediaStream: this.stream });
      this.liveLabel = (this.stream.getAudioTracks()[0] || {}).label || '';
    } else if (kind === 'digital') {
      this.source = this.digitalBus;
    } else {
      if (!buf) return;
      this.source = new AudioBufferSourceNode(this.ctx, { buffer: buf, loop: true });
      this.source.start();
    }
    this.source.connect(this.node);
    this.source.connect(this.inTap);
  }

  /** Change the live guitar cleanup (hum canceller, filters, noise gate). */
  setCleanup(opts) {
    this.cleanup = { ...(this.cleanup || {}), ...opts };
    this.send({ type: 'settings', cleanup: this.cleanup, cleanupActive: this.sourceKind === 'live' && this.cleanup.enabled !== false });
  }

  /**
   * Record up to `seconds` of the input. Resolves with a Float32Array.
   * stage 'raw': exactly what the interface sends (the input check, test clips);
   * stage 'clean': after the input cleanup, before the level and the pedals (Record a riff).
   * `onStart(stop)` receives a function that ends the recording early.
   */
  capture(seconds, { stage = 'raw', onStart } = {}) {
    if (!this.node) return Promise.reject(new Error('the sound is off'));
    const id = Math.random().toString(36).slice(2);
    return new Promise((resolve, reject) => {
      this.captures.set(id, resolve);
      this.send({ type: 'capture', id, seconds, stage });
      if (onStart) onStart(() => this.send({ type: 'captureStop', id }));
      setTimeout(() => { if (this.captures.delete(id)) reject(new Error('no audio arrived')); }, (seconds + 3) * 1000);
    });
  }

  /** Ask for microphone / interface permission once, so device names can be listed. */
  async askInputPermission() {
    const st = await navigator.mediaDevices.getUserMedia({ audio: true });
    st.getTracks().forEach((t) => t.stop());
  }

  async loadFile(file) {
    const ctx = this.ctx || new OfflineAudioContext(1, 1, 48000);
    this.buffers.file = await ctx.decodeAudioData(await file.arrayBuffer());
    this.fileName = file.name;
  }

  async inputDevices() {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput');
  }

  /**
   * Delay estimate in ms from the input to your ears: the input device's buffer (live
   * guitar only, when the browser reports it), the sound card output buffers, the
   * oversampling filters and the safety limiter's look-ahead.
   */
  latencyMs(oversampleLatencySamples = 0) {
    if (!this.ctx) return null;
    const out = (this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0);
    const input = this.sourceKind === 'live' ? (this.inputSettings().latency || 0) : 0;
    return (input + out + (oversampleLatencySamples + LIMITER_LOOKAHEAD * this.ctx.sampleRate) / this.ctx.sampleRate) * 1000;
  }

  /** What the browser reports about the live input: {sampleRate?, latency?} */
  inputSettings() {
    const t = this.stream && this.stream.getAudioTracks()[0];
    try { return (t && t.getSettings()) || {}; } catch { return {}; }
  }
}
