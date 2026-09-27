// Shared constants and helpers for the device models (diodes, transistors).
//
// Background: a semiconductor junction's current grows like exp(voltage / 26 mV). That is
// what makes pedals distort, but it is also dangerous for the solver: a guess of 2 V
// instead of 0.7 V gives exp(77), a number with 33 digits. The helpers below keep the
// Newton iterations (see circuit.cpp) from ever taking such a wild step.
// Direct port of engine/js/devices/common.js; keep the two in sync.
#pragma once
#include <cmath>

namespace ps {

constexpr double VT = 0.025864186;   // thermal voltage kT/q at 27 C
constexpr double GMIN = 1e-12;       // minimum conductance across every junction
constexpr double EXP_LIM = 80.0;     // exp() argument where linear continuation starts
constexpr double SQRT2 = 1.4142135623730951;

inline double expLimVal() { static const double v = std::exp(EXP_LIM); return v; }

// exp() that never overflows: linear continuation above EXP_LIM so Newton never sees infinity.
inline double safeExp(double x) { return x < EXP_LIM ? std::exp(x) : expLimVal() * (1 + x - EXP_LIM); }
inline double safeExpD(double x) { return x < EXP_LIM ? std::exp(x) : expLimVal(); }

// Voltage where a junction's exponential gets steep (used by pnjlim).
inline double vcrit(double is, double nvt) { return nvt * std::log(nvt / (SQRT2 * is)); }

// SPICE3 pn-junction voltage limiting: stops Newton from jumping far up the exponential.
inline double pnjlim(double vnew, double vold, double nvt, double vc, bool& limited) {
  if (vnew > vc && std::fabs(vnew - vold) > 2 * nvt) {
    if (vold > 0) {
      const double arg = 1 + (vnew - vold) / nvt;
      vnew = arg > 0 ? vold + nvt * std::log(arg) : vc;
    } else {
      vnew = nvt * std::log(vnew / nvt);
    }
    limited = true;
  }
  return vnew;
}

// Step limiter for FET gate voltages (simplified SPICE fetlim).
inline double fetlim(double vnew, double vold, double vto, bool& limited) {
  const double vtstlo = std::fabs(vold - vto) + 1;
  const double delta = vnew - vold;
  const double mx = vtstlo > 0.5 ? vtstlo : 0.5;
  if (std::fabs(delta) > mx) {
    limited = true;
    return vold + (delta > 0 ? mx : delta < 0 ? -mx : 0);
  }
  return vnew;
}

}  // namespace ps
