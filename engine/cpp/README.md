# C++ engine (WebAssembly)

This folder is the circuit simulator's real-time core, written in C++ and compiled to WebAssembly so it runs inside the browser at close to native speed. It is a line-by-line port of the JavaScript engine in `engine/`, and the tests prove both give the same audio.

## The big picture

```
 main thread (JavaScript)                         audio thread (AudioWorklet)
 ───────────────────────                          ─────────────────────────────
 LTspice .asc / .cir                               every 128 samples (2.7 ms):
   │ engine/parsers/asc.js, netlist.js, elaborate.js        input ─► pedal 1 ─► pedal 2 ─► output
   ▼                                                           │
 circuit description (objects)                      WasmEngine (engine/wasm/wasm-engine.js)
   │ engine/wasm/encode.js                                     │ ps_process(...)
   ▼                                                           ▼
 flat list of numbers  ───── postMessage ─────►     pedal-engine.wasm  (this folder, compiled)
```

Work that happens once (reading files, parsing, looking up transistor models) stays in JavaScript, where it is easy to write. Work that happens 96,000 times a second (solving the circuit) runs in C++.

## Refresher: what WebAssembly is

* **WebAssembly (wasm)** is a compact machine-code format every modern browser can run. You compile C++ to it the same way you would compile to an `.exe`, just with a different target. The browser checks it for safety and translates it to your CPU's real instructions when the page loads.
* **Why it is faster than JavaScript here:** JavaScript has to guess types at run time and can pause for garbage collection. The C++ is compiled ahead of time with fixed types (`double`, `int`), no garbage collector, and full optimization (`-O3`). For this engine it measures about 2x faster.
* **Memory model:** a wasm module has one flat block of memory, like a big `uint8_t[]`. A C++ pointer is just a byte offset into that block. JavaScript can see the same block as a `Float64Array`, which is how audio moves in and out:
  1. JavaScript calls `ps_alloc(n)` and gets back a pointer, e.g. `65536`.
  2. It writes samples at `memory[65536 / 8 ...]` (divide by 8 because a `double` is 8 bytes).
  3. It calls `ps_process(handle, inPtr, outPtr, n)`, and C++ reads and writes those addresses directly.
* **The boundary only passes numbers.** `extern "C"` functions with `int` / `double` / pointer arguments are the whole interface (`src/api.cpp`). No strings, classes or exceptions cross it. That is why the circuit is "encoded" into a list of numbers first.

## Files

| File | What it is | JavaScript original |
|---|---|---|
| `src/common.hpp` | Thermal voltage, safe `exp`, junction voltage limiting (`pnjlim`) | `engine/js/devices/common.js` |
| `src/sparse_lu.*` | Sparse LU solver that "compiles" its pivot order into integer programs | `engine/js/sparse-lu.js` |
| `src/devices.*` | R, C, L, sources, pots, switches, diode, BJT (Gummel-Poon), JFET/MOSFET, op amp | `engine/js/devices/*.js` |
| `src/circuit.*` | MNA matrix assembly, Newton-Raphson, DC operating point, time stepping, knob smoothing | `engine/js/circuit.js` |
| `src/oversampler.*` | Polyphase FIR up/down sampling | `engine/js/oversample.js` |
| `src/api.cpp` | The exported functions JavaScript calls | (new) |
| `build.ps1` / `build.sh` | Compile everything into `engine/wasm/pedal-engine.wasm` | |

Design notes:

* **One base class, virtual methods.** `Device` has `stampStatic`, `stepRHS`, `load`, `initState`, `accept`. Each component overrides what it needs. The `has*` flags let the circuit keep short lists per phase, so a resistor is never asked to do Newton work.
* **Unknown numbering must match JavaScript.** Device constructors allocate nodes in exactly the same order as the JS classes. That keeps the matrix identical, so the sparse solver picks the same pivots and the results match to the last bit.
* **No allocation in the audio path.** Every `std::vector` is sized when the pedal is created. `step()` only does arithmetic.
* **No exceptions.** The build uses `-fno-exceptions`. Errors are return values (`ps_create` returns `-1`).

## Guided tour: reading the code in order

Every file starts with a plain-language header, so you can read them like chapters:

1. **`src/api.cpp`**, the front door. The six functions JavaScript calls, and what one "pedal" (a `Processor`) holds. Start here to see a sample go in and come out.
2. **`src/circuit.cpp`**, the heart. How a list of parts becomes one matrix equation (MNA), why each sample needs a few Newton rounds, and how the circuit finds its resting state when it powers up.
3. **`src/devices.cpp`**, the physics. One section per part, each with the formula it follows: capacitors as "a resistor plus memory", the diode equation, transistors, the op amp.
4. **`src/sparse_lu.cpp`**, the fast maths. How the equation is solved by recording the elimination steps once and replaying them.
5. **`src/oversampler.cpp`**, the clean-up. Why the circuit runs 4x faster than the audio and how the filter removes the harsh aliasing.
6. **`src/common.hpp`**, the safety rails that keep `exp()` from blowing up.

What happens for one sample of guitar (4x oversampling):

```
ps_process ─► Processor::process
                ├─ Oversampler::up        1 sample in, 4 out
                ├─ Circuit::step  x4      each: smooth knobs, update capacitor memory,
                │    └─ newtonFast        2 to 4 rounds of: load devices, solve A x = b
                ├─ Oversampler::down      4 samples in, 1 out
                └─ 5 Hz high pass         removes DC offset
```

## Speed

Measure it yourself with `node tools/bench.js` (add `2` or `8` for another oversampling factor). "Load" is the share of one CPU core a pedal needs to keep up in real time. At 4x on the development machine:

| Pedal | C++ | JavaScript |
|---|---|---|
| blues-od | 44% | 85% |
| rp-fuzz-si | 38% | 70% |
| op-amp-drive | 26% | 48% |
| jfet-boost | 10% | 24% |
| tone-stack | 3.5% | 7.7% |

The C++ engine is about 2x faster across the board. Where the time goes in the C++ (measured with callgrind on blues-od): factoring the matrix about 25%, solving 20%, Newton bookkeeping 11%, `exp()` 11%, device models the rest.

Two speed-ups used in `circuit.cpp`:

* **Reusing the factored matrix ("chord Newton", `newtonFast`).** At 192,000 steps a second the circuit barely changes between steps, so last step's factored matrix is still a good map. Newton then only re-checks the answer against today's exact equations, and refactors the moment it starts to take more rounds. Same accuracy, fewer factorisations.
* **Predicting the next answer.** Each step starts from a straight-line guess based on the previous two steps, so Newton usually needs only 1 to 2 rounds.

Safety nets, so the audio never freezes or screams:

* If Newton fails to converge, the step is retried with damped Newton, and failing that the last good state is held (no NaN reaches the speakers).
* If the output ever becomes NaN anyway, `Processor::process` rebuilds the circuit and stays silent for 64 samples; if the rebuild fails it waits a full second before trying again.
* In the browser, `site/audio/pedal-worklet.js` catches any error from a pedal and swaps it onto the JavaScript engine.

## Building on Windows

You only need to rebuild after changing a `.cpp` / `.hpp` file. The compiled `engine/wasm/pedal-engine.wasm` is committed, so the site works without building.

**One-time setup: install Emscripten** (the standard C++ to WebAssembly compiler; it is clang plus the tools around it). You need Git and Python installed.

```powershell
git clone https://github.com/emscripten-core/emsdk.git C:\emsdk
cd C:\emsdk
.\emsdk install latest
.\emsdk activate latest
```

**Each time you open a new terminal**, load Emscripten into it:

```powershell
C:\emsdk\emsdk_env.ps1
```

**Build** from the `pedal-sim` folder:

```powershell
.\engine\cpp\build.ps1
```

The flags in `build.ps1`, briefly:

| Flag | Meaning |
|---|---|
| `-O3` | full optimization |
| `-std=c++17` | language version |
| `-fno-exceptions -fno-rtti` | leave out exception tables and runtime type info (smaller, faster; not used) |
| `-fno-math-errno` | maths functions skip setting the C error flag, which lets the compiler inline `sqrt` |
| `-mbulk-memory` | fast block copy/fill instructions, used by every `std::vector` copy in the hot loop |
| `-sSTANDALONE_WASM --no-entry` | a plain `.wasm` with no generated JavaScript glue and no `main()` (it is a library) |
| `-sALLOW_MEMORY_GROWTH=1` | memory can grow when you add more pedals |
| `-sEXPORTED_FUNCTIONS=...` | which functions JavaScript may call (the leading `_` is Emscripten's naming) |

## Checking your changes

```powershell
npm test
```

`tests/wasm.test.js` runs every library pedal through both engines at 1x, 2x and 4x oversampling and fails if they differ by more than -60 dB. Most match to better than -130 dB. High-gain circuits can sit nearer -70 dB (the Jacobian reuse in `newtonFast` stops at a slightly different point inside the same tolerance), because Newton's method may stop one iteration earlier or later when the last digit of `exp()` differs. Both answers are within the solver's 0.01% tolerance.

On the website, the **Engine** menu in the Output panel switches between C++ and JavaScript live, and **Engine load** shows the difference.

## Adding a new device model

1. Write it in JavaScript first (`engine/js/devices/`), with tests. That is the reference.
2. Give it a record type in `engine/wasm/encode.js` (resolve all model defaults there).
3. Add the C++ class to `devices.hpp/.cpp` and a `case` in the `Circuit` constructor (`circuit.cpp`), allocating nodes in the same order as the JavaScript constructor.
4. Add a circuit using it to `circuits/`, rebuild, and run `npm test`.
