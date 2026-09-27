#include "oversampler.hpp"

#include <cmath>

namespace ps {

namespace {
constexpr double PI = 3.141592653589793;

// Modified Bessel function I0, needed for the Kaiser window below (a power series).
double besselI0(double x) {
  double sum = 1, term = 1;
  const double q = (x * x) / 4;
  for (int k = 1; k < 50; k++) {
    term *= q / (static_cast<double>(k) * k);
    sum += term;
    if (term < sum * 1e-16) break;
  }
  return sum;
}

// Classic "windowed sinc" lowpass: sinc is the ideal filter shape, but it is infinitely long,
// so it is cut to `taps` values and softened with a Kaiser window (beta = 9 gives about
// 90 dB of rejection). Normalised so the gain at 0 Hz is exactly 1.
std::vector<double> designLowpass(int taps, double cutoff, double beta) {
  std::vector<double> h(taps);
  const double m = (taps - 1) / 2.0;
  const double i0b = besselI0(beta);
  double sum = 0;
  for (int i = 0; i < taps; i++) {
    const double t = i - m;
    const double sinc = t == 0 ? 2 * cutoff : std::sin(2 * PI * cutoff * t) / (PI * t);
    const double r = t / m;
    const double w = besselI0(beta * std::sqrt(std::fmax(0.0, 1 - r * r))) / i0b;
    h[i] = sinc * w;
    sum += h[i];
  }
  for (double& v : h) v /= sum;
  return h;
}
}  // namespace

Oversampler::Oversampler(int factor, int tapsPerPhase) : L_(factor < 1 ? 1 : factor) {
  if (L_ == 1) return;
  int taps = L_ * tapsPerPhase;
  if (taps % 2 == 0) taps += 1;
  taps_ = taps;
  // cutoff at 0.47 of the base rate (just under half), measured at the high rate
  h_ = designLowpass(taps, 0.47 / L_, 9);
  P_ = (taps + L_ - 1) / L_;  // taps per phase
  poly_.assign(static_cast<size_t>(L_) * P_, 0);
  for (int p = 0; p < L_; p++)
    for (int k = 0; k < P_; k++) {
      const int idx = p + L_ * k;
      poly_[p * P_ + k] = idx < taps ? h_[idx] * L_ : 0;
    }
  upHist_.assign(P_ * 2, 0);
  downHist_.assign(taps * 2, 0);
  // Delay added by the two filters, in base-rate samples (reported to the UI).
  latency_ = (taps - 1.0) / L_ - (L_ - 1.0) / L_;
}

void Oversampler::up(double x, double* out) {
  if (L_ == 1) { out[0] = x; return; }
  const int P = P_;
  upPos_ = (upPos_ + P - 1) % P;  // mirrored circular buffer: a contiguous read of P values is always valid
  upHist_[upPos_] = x;
  upHist_[upPos_ + P] = x;
  const double* hist = upHist_.data() + upPos_;
  for (int p = 0; p < L_; p++) {
    const double* c = poly_.data() + p * P;
    double acc = 0;
    for (int k = 0; k < P; k++) acc += c[k] * hist[k];
    out[p] = acc;
  }
}

// Only one output is needed per L inputs, so the filter is evaluated once here,
// not L times (the other L-1 results would be thrown away).
double Oversampler::down(const double* in) {
  if (L_ == 1) return in[0];
  const int N = taps_;
  for (int p = 0; p < L_; p++) {
    downPos_ = (downPos_ + N - 1) % N;
    downHist_[downPos_] = in[p];
    downHist_[downPos_ + N] = in[p];
  }
  const double* hist = downHist_.data() + downPos_;
  double acc = 0;
  for (int k = 0; k < N; k++) acc += h_[k] * hist[k];
  return acc;
}

void Oversampler::reset(double upValue, double downValue) {
  if (L_ == 1) return;
  std::fill(upHist_.begin(), upHist_.end(), upValue);
  std::fill(downHist_.begin(), downHist_.end(), downValue);
}

}  // namespace ps
