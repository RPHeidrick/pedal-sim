/**
 * Thin JavaScript wrapper around the compiled C++ engine (pedal-engine.wasm).
 *
 * WebAssembly has one flat block of memory. To hand the engine an array, we
 * allocate space inside that memory (ps_alloc), copy the numbers in, and pass
 * the pointer (a byte offset). Results come back the same way.
 *
 * Works in the AudioWorklet (where fetch is unavailable: the main thread sends
 * the .wasm bytes over) and in Node for tests.
 */
import { encodeCircuit } from './encode.js';

const BLOCK = 1024; // max samples per process() call

export class WasmEngine {
  /** @param {ArrayBuffer|Uint8Array} bytes contents of pedal-engine.wasm */
  constructor(bytes) {
    const module = new WebAssembly.Module(bytes);
    // Stub any system imports the toolchain may add (WASI / Emscripten); the engine never calls them.
    const imports = {};
    for (const imp of WebAssembly.Module.imports(module)) {
      imports[imp.module] ??= {};
      if (imp.kind === 'function') imports[imp.module][imp.name] = () => 0;
      else if (imp.kind === 'memory') imports[imp.module][imp.name] = new WebAssembly.Memory({ initial: 256, maximum: 32768 });
    }
    this.instance = new WebAssembly.Instance(module, imports);
    this.ex = this.instance.exports;
    if (this.ex._initialize) this.ex._initialize(); // run C++ static constructors
    this.mem = this.ex.memory || Object.values(imports).map((o) => Object.values(o).find((v) => v instanceof WebAssembly.Memory)).find(Boolean);
    this.inPtr = this.ex.ps_alloc(BLOCK);
    this.outPtr = this.ex.ps_alloc(BLOCK);
  }

  /** Float64 view of the module's memory. Re-created if the memory grew (growing detaches old views). */
  f64() {
    if (this._view?.buffer !== this.mem.buffer) this._view = new Float64Array(this.mem.buffer);
    return this._view;
  }

  /**
   * Build a pedal. Returns a handle (>= 0).
   * @param {Object} desc circuit description from engine/parsers/elaborate.js
   * @param {number[]} controls knob positions 0..1
   */
  create(desc, controls, sampleRate, oversample) {
    const rec = encodeCircuit(desc);
    const rp = this.ex.ps_alloc(rec.length);
    const cp = this.ex.ps_alloc(Math.max(1, controls.length));
    const m = this.f64();
    m.set(rec, rp / 8);                         // pointers are byte offsets; a double is 8 bytes
    this.f64().set(controls, cp / 8);
    const h = this.ex.ps_create(rp, rec.length, controls.length, cp, sampleRate, oversample);
    this.ex.ps_free(rp);
    this.ex.ps_free(cp);
    if (h < 0) throw new Error('C++ engine could not build this circuit');
    return h;
  }

  destroy(h) { this.ex.ps_destroy(h); }
  setControl(h, index, value) { this.ex.ps_set_control(h, index, value); }
  failures(h) { return this.ex.ps_failures(h); }
  iterations(h) { return this.ex.ps_iterations(h); }

  /** Process n samples (volts) in place. */
  process(h, buf, n = buf.length) {
    for (let off = 0; off < n; off += BLOCK) {
      const len = Math.min(BLOCK, n - off);
      const m = this.f64();
      m.set(buf.subarray(off, off + len), this.inPtr / 8);
      this.ex.ps_process(h, this.inPtr, this.outPtr, len);
      const o = this.f64();
      buf.set(o.subarray(this.outPtr / 8, this.outPtr / 8 + len), off);
    }
  }
}
