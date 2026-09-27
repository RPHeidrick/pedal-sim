// ============================================================================
// Oversampler: runs the circuit at a higher sample rate, then comes back down.
// Port of engine/js/oversample.js.
// ============================================================================
//
// Why: clipping (diodes, fuzz transistors) creates new high harmonics. Above half the
// sample rate they cannot be represented and "fold back" as harsh, out of tune tones
// (aliasing). Running the circuit 2x..8x faster gives those harmonics room, and the
// lowpass filter below removes them before coming back to the normal rate.
//
// "Polyphase" is a shortcut: upsampling inserts zeros between samples, and multiplying
// by zeros is wasted work, so the filter is split into L smaller filters ("phases")
// that each skip the zeros.
//
// One linear-phase Kaiser-windowed lowpass serves both directions; its cutoff sits just
// under the base-rate Nyquist so aliasing made by the clipping circuit is removed.
#pragma once
#include <vector>

namespace ps {

class Oversampler {
 public:
  explicit Oversampler(int factor, int tapsPerPhase = 24);
  void up(double x, double* out);     // one base-rate sample -> L high-rate samples
  double down(const double* in);      // L high-rate samples -> one base-rate sample
  void reset(double upValue, double downValue);
  int factor() const { return L_; }
  double latency() const { return latency_; }

 private:
  int L_, taps_ = 1, P_ = 1, upPos_ = 0, downPos_ = 0;
  double latency_ = 0;
  std::vector<double> h_, poly_, upHist_, downHist_;
};

}  // namespace ps
