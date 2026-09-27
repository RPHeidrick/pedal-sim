// MNA circuit engine. Port of engine/js/circuit.js.
//
// Unknowns x = [node voltages..., branch currents...]. Ground maps to index n
// (always 0 in x) and ground matrix stamps land in a "trash" slot at n*n, so
// devices never have to check for ground.
//
//   G      static matrix: resistors, pots, capacitor companion conductances, source incidence
//   bStep  per-timestep right-hand side
//   Newton: A = G + J_nl(x), b = bStep + i_nl(x), solve A * xNew = b, repeat until converged
#pragma once
#include <cstdint>
#include <memory>
#include <unordered_map>
#include <vector>

#include "devices.hpp"
#include "sparse_lu.hpp"

namespace ps {

struct Options {
  double sampleRate = 96000;
  bool backwardEuler = false;  // false = trapezoidal
  int maxIter = 40;
  double reltol = 1e-4, vntol = 1e-6, abstol = 1e-9, gshunt = 1e-12;
  double smoothingMs = 20;
};

struct Stats { long steps = 0, iterations = 0, maxIterations = 0, failures = 0, reanalyses = 0; };

class Circuit {
 public:
  // Build from the flat record list produced by engine/wasm/encode.js. ok() tells whether it parsed.
  Circuit(const double* rec, int len, const Options& opts);
  bool ok() const { return ok_; }

  // --- allocation API used by device constructors
  int node(int nameId);           // named node (from the encoder), ground = -1
  int internal();                 // device-private node
  int branch(int key);            // new branch-current unknown, registered under key
  int branchOf(int key) const;    // look up a branch registered earlier
  int pos(int r, int c);          // flat matrix position; ground -> trash slot
  int rhs(int r) const { return r < 0 ? n_ : r; }

  // --- analyses
  bool dcOperatingPoint();
  void startTransient();
  bool reset() { const bool ok = dcOperatingPoint(); startTransient(); return ok; }
  double step(double vin);        // advance one sample, returns V(out)
  void setControl(int id, double value, bool immediate);
  double out() const { return x_[outIdx_]; }

  // --- state devices read during stamping
  bool dcMode = true;
  bool backwardEuler = false;
  double dt = 0, time = 0, srcScale = 1;
  bool limited = false;           // set by device voltage limiters during a Newton iteration

  Stats stats;

 private:
  void buildStatic(bool dc);
  void buildRHS();
  void assemble();
  bool factor();
  int newton(int maxIter, bool damped = false);
  int newtonFast(int maxIter);    // transient Newton that reuses the last LU factors when it can
  bool smoothControls();

  bool ok_ = false;
  Options opts_;
  int n_ = 0, trash_ = 0, outIdx_ = 0;
  std::vector<int> nodeOf_;                 // encoder name id -> unknown index (-1 = not yet)
  std::vector<char> isVoltage_;             // per unknown: node voltage (1) or branch current (0)
  std::unordered_map<int, int> branches_;
  std::vector<std::unique_ptr<Device>> devices_;
  std::vector<Device*> staticDevs_, rhsDevs_, nlDevs_, stateDevs_, initDevs_, controlDevs_;
  VSource* input_ = nullptr;
  bool linear_ = true;

  std::vector<uint8_t> pattern_;
  std::vector<double> G_, A_, b_, bStep_, x_, xNew_, xPrev_, xPrev2_, tol_;
  // Jacobian reuse (see newtonFast): F_ holds the most recent LU factors, r_/dx_ are scratch.
  std::vector<double> F_, r_, dx_;
  std::vector<int> actRow_, actCol_;  // row and column of each active matrix entry (no divisions in the hot loop)
  long actFor_ = -1;                  // which LU analysis actRow_/actCol_ were built for
  bool haveF_ = false;            // F_ holds valid factors for the current pattern and G
  int lastIters_ = 0;             // iterations the previous time step needed
  std::vector<int> diagIdx_;
  SparseLU lu_;
  bool needAnalyze_ = true, factored_ = false, predict_ = true;
  double gminExtra_ = 0;
  std::vector<double> ctlCur_, ctlTarget_;
  double ctlAlpha_ = 1;
};

}  // namespace ps
