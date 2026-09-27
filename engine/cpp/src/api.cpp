// ============================================================================
// api.cpp: the WebAssembly boundary, i.e. the only functions JavaScript can call.
// ============================================================================
//
// READ THIS FILE FIRST. It is the "front door" of the C++ engine.
//
// Only plain numbers cross this boundary: ints, doubles, and pointers (which in
// WebAssembly are just byte offsets into the module's one big block of memory).
// The JavaScript side (engine/wasm/wasm-engine.js) does this:
//
//   1. ps_alloc()      ask C++ for a buffer, get back a pointer (a number)
//   2. write the encoded circuit / input samples into that memory
//   3. ps_create()     build a pedal, get back a "handle" (a small int, like a ticket number)
//   4. ps_process()    every 128 samples: run the audio through the pedal
//   5. ps_set_control  when a knob or switch moves
//   6. ps_destroy()    when the pedal is removed from the board
//
// No strings, no objects, no exceptions cross the boundary.
//
// One "Processor" = one pedal on the board: circuit + oversampler + output DC blocker.
#include <cmath>
#include <cstdlib>
#include <memory>
#include <vector>

#include "circuit.hpp"
#include "oversampler.hpp"

// Marks a function as "exported": visible to JavaScript under this exact name.
// extern "C" turns off C++ name mangling so the name stays readable.
#define PS_EXPORT(name) extern "C" __attribute__((export_name(#name), used))

namespace {

struct Processor {
  std::vector<double> records;  // the encoded circuit, kept so the pedal can rebuild itself after a numerical blow-up
  std::vector<double> controlsBackup;  // latest knob/switch positions, re-applied after a rebuild
  double fs;  // the page's sample rate (usually 48000)
  int L;      // oversampling factor: the circuit runs at fs * L

  std::unique_ptr<ps::Circuit> c;       // the circuit simulator itself
  std::unique_ptr<ps::Oversampler> os;  // raises the rate before the circuit and lowers it after
  std::vector<double> up, hi;           // scratch buffers of L samples (sized once, reused)

  // A 1-pole high pass at 5 Hz removes any steady DC offset the circuit puts on its output
  // (a real pedal does the same with its output capacitor).
  double hpX = 0, hpY = 0, hpA = 0;

  // After a blow-up, output silence for this many samples instead of rebuilding on every
  // sample. Without it, a circuit that fails to rebuild would try to rebuild 48,000 times a
  // second and freeze the audio thread (a "rebuild storm").
  int muted = 0;

  // (Re)build the circuit from the stored records. Returns false if the circuit cannot be built
  // or has no DC operating point; the old circuit (if any) is then left in place.
  bool build() {
    ps::Options o;
    o.sampleRate = fs * L;
    auto nc = std::make_unique<ps::Circuit>(records.data(), static_cast<int>(records.size()), o);
    if (!nc->ok()) return false;
    for (size_t i = 0; i < controlsBackup.size(); i++) nc->setControl(static_cast<int>(i), controlsBackup[i], true);
    nc->reset();  // find the DC operating point with the knobs where the user left them
    c = std::move(nc);
    os = std::make_unique<ps::Oversampler>(L);
    const double dcOut = c->out();
    os->reset(0, dcOut);  // start the filters "already settled", so there is no click at start
    up.assign(L, 0);
    hi.assign(L, 0);
    hpX = dcOut; hpY = 0;
    hpA = std::exp(-2 * 3.141592653589793 * 5 / fs);
    return true;
  }

  // The hot loop. For each input sample:
  //   upsample to L samples  ->  step the circuit L times  ->  downsample back to 1  ->  DC block
  void process(const double* in, double* out, int n) {
    for (int i = 0; i < n; i++) {
      if (muted > 0) { muted--; out[i] = 0; continue; }
      os->up(in[i], up.data());
      for (int k = 0; k < L; k++) hi[k] = c->step(up[k]);
      double y = os->down(hi.data());
      const double hp = hpA * (hpY + y - hpX);
      hpX = y; hpY = hp; y = hp;
      if (!std::isfinite(y)) {
        // The maths produced NaN or infinity (can happen with extreme knob settings).
        // Start over from a clean circuit; stay quiet briefly so the restart is not heard
        // as a pop. If even the rebuild fails, stay quiet for a whole second before retrying.
        muted = build() ? 64 : static_cast<int>(fs);
        y = 0;
      }
      out[i] = y;
    }
  }
};

// All live pedals. A handle is an index into this list; removed pedals leave a null slot
// that the next ps_create reuses.
std::vector<std::unique_ptr<Processor>> g_procs;

Processor* get(int h) {
  return h >= 0 && h < static_cast<int>(g_procs.size()) ? g_procs[h].get() : nullptr;
}

}  // namespace

// Memory helpers: JavaScript asks for a buffer of `count` doubles, fills it, passes the pointer in.
PS_EXPORT(ps_alloc) double* ps_alloc(int count) { return static_cast<double*>(std::malloc(sizeof(double) * (count > 0 ? count : 1))); }
PS_EXPORT(ps_free) void ps_free(double* p) { std::free(p); }

// Create a pedal from encoded records (see engine/wasm/encode.js). Returns a handle, or -1.
PS_EXPORT(ps_create) int ps_create(const double* records, int len, int nControls, const double* controls, double sampleRate, int oversample) {
  auto p = std::make_unique<Processor>();
  p->records.assign(records, records + len);
  p->fs = sampleRate;
  p->L = oversample < 1 ? 1 : oversample > 8 ? 8 : oversample;
  p->controlsBackup.assign(controls, controls + (nControls > 0 ? nControls : 0));
  if (!p->build()) return -1;
  for (size_t i = 0; i < g_procs.size(); i++)
    if (!g_procs[i]) { g_procs[i] = std::move(p); return static_cast<int>(i); }
  g_procs.push_back(std::move(p));
  return static_cast<int>(g_procs.size()) - 1;
}

// Free a pedal. Safe to call twice or with a bad handle.
PS_EXPORT(ps_destroy) void ps_destroy(int h) { if (get(h)) g_procs[h].reset(); }

// Move a knob or switch. `value` is 0..1 for a knob, or the position number for a switch.
// The circuit glides to the new value over a few milliseconds (see Circuit::smoothControls),
// so turning a knob never clicks.
PS_EXPORT(ps_set_control) void ps_set_control(int h, int id, double value) {
  Processor* p = get(h);
  if (!p) return;
  if (id >= 0 && id < static_cast<int>(p->controlsBackup.size())) p->controlsBackup[id] = value;
  p->c->setControl(id, value, false);
}

// Run n samples through the pedal. An unknown handle passes the audio straight through.
PS_EXPORT(ps_process) void ps_process(int h, const double* in, double* out, int n) {
  Processor* p = get(h);
  if (!p) { for (int i = 0; i < n; i++) out[i] = in[i]; return; }
  p->process(in, out, n);
}

// Statistics for the "Engine load" readout and the tests.
PS_EXPORT(ps_failures) double ps_failures(int h) { Processor* p = get(h); return p ? static_cast<double>(p->c->stats.failures) : 0; }
PS_EXPORT(ps_iterations) double ps_iterations(int h) { Processor* p = get(h); return p ? static_cast<double>(p->c->stats.iterations) : 0; }
PS_EXPORT(ps_latency) double ps_latency(int h) { Processor* p = get(h); return p ? p->os->latency() : 0; }
