// ============================================================================
// circuit.cpp: turns a list of parts into numbers, and solves them every sample.
// Port of engine/js/circuit.js.
// ============================================================================
//
// THE IDEA IN ONE PARAGRAPH (Modified Nodal Analysis, "MNA"):
//   Give every wire junction (node) an unknown voltage. Kirchhoff's current law says the
//   currents into each node add up to zero. Each part adds its share to those equations
//   ("stamps" them): a resistor between nodes a and b adds 1/R to four cells of the matrix.
//   Voltage sources and inductors add one extra unknown each: their current ("branch").
//   The result is one matrix equation  A x = b  that the sparse solver (sparse_lu) solves.
//
// WHY IT LOOPS (Newton-Raphson):
//   Diodes and transistors are not straight lines (current ~ exp(voltage)), so A depends on
//   the answer x. Newton's method guesses x, replaces each curve by its tangent at the guess,
//   solves, and repeats until the guess stops moving (usually 2 to 4 rounds per sample).
//
// WHY IT REMEMBERS (time stepping):
//   Capacitors and inductors depend on what happened a moment ago. The trapezoidal rule
//   turns each one into "a resistor plus a current source" that is updated every sample
//   (Device::stepRHS / Device::accept in devices.cpp).
//
// Life of a pedal:  constructor (read parts)  ->  reset(): dcOperatingPoint() (the circuit
// sitting powered with no signal)  ->  startTransient()  ->  step() once per sample, forever.
#include "circuit.hpp"

#include <cmath>

#include "common.hpp"

namespace ps {

namespace {
// Element type codes shared with engine/wasm/encode.js.
enum Type { T_R = 1, T_C, T_L, T_V, T_I, T_E, T_G, T_F, T_H, T_POT, T_SW, T_D, T_Q, T_FET, T_OPAMP };

// Bounds-checked reader over the record list; any overrun marks the stream bad.
struct Reader {
  const double* d; int len; int i = 0; bool bad = false;
  double num() { if (i >= len) { bad = true; return 0; } return d[i++]; }
  int id() { return static_cast<int>(num()); }
  Wave wave() {
    Wave w;
    w.kind = id();
    if (w.kind == 1) for (int k = 0; k < 6; k++) w.a[k] = num();
    else if (w.kind == 2) for (int k = 0; k < 7; k++) w.a[k] = num();
    else if (w.kind == 3) { const int m = id(); if (m < 0 || m > 100000) { bad = true; return w; } for (int k = 0; k < 2 * m; k++) w.pts.push_back(num()); }
    return w;
  }
};
}  // namespace

Circuit::Circuit(const double* rec, int len, const Options& opts) : opts_(opts) {
  Reader r{rec, len};
  if (r.id() != 1) return;  // format version
  const int nNames = r.id();
  const int outName = r.id();
  const int nControls = r.id();
  if (nNames < 0 || nNames > 1000000 || nControls < 0 || nControls > 10000) return;
  nodeOf_.assign(nNames, -1);
  ctlCur_.resize(nControls);
  for (int i = 0; i < nControls; i++) ctlCur_[i] = r.num();
  ctlTarget_ = ctlCur_;
  const int nEl = r.id();
  backwardEuler = opts_.backwardEuler;
  dt = 1 / opts_.sampleRate;

  // Header: version, number of node names, which name is the output, knob count, knob values.
  // --- allocation phase: construct devices in record order (sets unknown numbering)
  for (int e = 0; e < nEl && !r.bad; e++) {
    const int t = r.id();
    switch (t) {
      case T_R: { int a = r.id(), b = r.id(); double v = r.num(); devices_.emplace_back(new Resistor(*this, a, b, v)); break; }
      case T_C: { int a = r.id(), b = r.id(); double v = r.num(); devices_.emplace_back(new Capacitor(*this, a, b, v)); break; }
      case T_L: { int a = r.id(), b = r.id(), k = r.id(); double v = r.num(); devices_.emplace_back(new Inductor(*this, a, b, k, v)); break; }
      case T_V: {
        int a = r.id(), b = r.id(), k = r.id(); double dc = r.num(); bool in = r.num() != 0; Wave w = r.wave();
        auto* v = new VSource(*this, a, b, k, dc, in, std::move(w));
        devices_.emplace_back(v);
        if (in && !input_) input_ = v;
        break;
      }
      case T_I: { int a = r.id(), b = r.id(); double dc = r.num(); Wave w = r.wave(); devices_.emplace_back(new ISource(*this, a, b, dc, std::move(w))); break; }
      case T_E: { int a = r.id(), b = r.id(), cp = r.id(), cn = r.id(), k = r.id(); double g = r.num(); devices_.emplace_back(new VCVS(*this, a, b, cp, cn, k, g)); break; }
      case T_G: { int a = r.id(), b = r.id(), cp = r.id(), cn = r.id(); double g = r.num(); devices_.emplace_back(new VCCS(*this, a, b, cp, cn, g)); break; }
      case T_F: { int a = r.id(), b = r.id(), s = r.id(); double g = r.num(); devices_.emplace_back(new CCCS(*this, a, b, s, g)); break; }
      case T_H: { int a = r.id(), b = r.id(), k = r.id(), s = r.id(); double g = r.num(); devices_.emplace_back(new CCVS(*this, a, b, k, s, g)); break; }
      case T_POT: {
        int a = r.id(), w = r.id(), c = r.id(); double rr = r.num(); int tp = r.id(); double rot = r.num(); int ctl = r.id();
        devices_.emplace_back(new Pot(*this, a, w, c, rr, tp, rot, ctl));
        break;
      }
      case T_SW: {
        int ctl = r.id(); double st = r.num(); int np = r.id();
        if (np < 0 || np > 64) { r.bad = true; break; }
        std::vector<std::array<int, 3>> poles(np);
        for (auto& p : poles) { p[0] = r.id(); p[1] = r.id(); p[2] = r.id(); }
        devices_.emplace_back(new Switch(*this, ctl, st, std::move(poles)));
        break;
      }
      case T_D: {
        int a = r.id(), k = r.id();
        DiodeParams p{}; p.is = r.num(); p.n = r.num(); p.rs = r.num(); p.bv = r.num(); p.ibv = r.num(); p.nbv = r.num();
        devices_.emplace_back(new Diode(*this, a, k, p));
        break;
      }
      case T_Q: {
        int c = r.id(), b = r.id(), e2 = r.id(); double pol = r.num();
        BJTParams p{};
        double* f = &p.is;  // BJTParams is 16 consecutive doubles in encoder order
        for (int k = 0; k < 16; k++) f[k] = r.num();
        devices_.emplace_back(new BJT(*this, c, b, e2, pol, p));
        break;
      }
      case T_FET: {
        int d = r.id(), g = r.id(), s = r.id(); double pol = r.num();
        FETParams p{}; p.k = r.num(); p.vto = r.num(); p.lambda = r.num(); p.is = r.num(); p.n = r.num(); p.rd = r.num(); p.rs = r.num();
        devices_.emplace_back(new FET(*this, d, g, s, pol, p));
        break;
      }
      case T_OPAMP: {
        int inp = r.id(), inn = r.id(), vp = r.id(), vn = r.id(), out = r.id(), in = r.id();
        double imax = r.num(), gout = r.num(), dh = r.num(), dl = r.num();
        devices_.emplace_back(new OpampCore(*this, inp, inn, vp, vn, out, in, imax, gout, dh, dl));
        break;
      }
      default: r.bad = true;
    }
  }
  if (r.bad) return;

  const int n = n_ = static_cast<int>(isVoltage_.size());
  trash_ = n * n;

  // --- binding phase: every device resolves its matrix positions
  pattern_.assign(static_cast<size_t>(n) * n, 0);
  for (auto& d : devices_) d->bind(*this);
  tol_.assign(n, 0);
  for (int i = 0; i < n; i++) {
    tol_[i] = isVoltage_[i] ? opts_.vntol : opts_.abstol;
    if (isVoltage_[i]) diagIdx_.push_back(pos(i, i));
  }

  for (auto& d : devices_) {
    Device* p = d.get();
    if (p->hasStatic) staticDevs_.push_back(p);
    if (p->hasRHS) rhsDevs_.push_back(p);
    if (p->hasLoad) nlDevs_.push_back(p);
    if (p->hasAccept) stateDevs_.push_back(p);
    if (p->hasInit) initDevs_.push_back(p);
  }
  linear_ = nlDevs_.empty();

  const size_t nn1 = static_cast<size_t>(n) * n + 1;
  G_.assign(nn1, 0); A_.assign(nn1, 0);
  b_.assign(n + 1, 0); bStep_.assign(n + 1, 0);
  x_.assign(n + 1, 0); xNew_.assign(n + 1, 0); xPrev_.assign(n + 1, 0); xPrev2_.assign(n + 1, 0);
  F_.assign(nn1, 0); r_.assign(n + 1, 0); dx_.assign(n + 1, 0);
  lu_ = SparseLU(n);

  const int outNode = outName >= 0 && outName < nNames ? nodeOf_[outName] : -1;
  outIdx_ = rhs(outNode);

  controlDevs_.assign(nControls, nullptr);
  for (auto& d : devices_) if (d->control >= 0 && d->control < nControls) controlDevs_[d->control] = d.get();
  ctlAlpha_ = opts_.smoothingMs > 0 ? 1 - std::exp(-1 / ((opts_.smoothingMs / 1000) * opts_.sampleRate)) : 1;
  ok_ = n > 0;
}

// ---------------------------------------------------------------- allocation
// Unknowns are numbered in the order devices ask for them. node() maps a netlist node name
// to an unknown (ground, -1, is never an unknown: it is 0 V by definition). internal() is a
// hidden node inside a part (e.g. behind a transistor's base resistance). branch() is a
// current unknown for a voltage source or inductor.
int Circuit::node(int nameId) {
  if (nameId < 0 || nameId >= static_cast<int>(nodeOf_.size())) return -1;  // ground
  int& i = nodeOf_[nameId];
  if (i < 0) { i = static_cast<int>(isVoltage_.size()); isVoltage_.push_back(1); }
  return i;
}
int Circuit::internal() { isVoltage_.push_back(1); return static_cast<int>(isVoltage_.size()) - 1; }
int Circuit::branch(int key) {
  const int i = static_cast<int>(isVoltage_.size());
  isVoltage_.push_back(0);
  branches_[key] = i;
  return i;
}
int Circuit::branchOf(int key) const {
  auto it = branches_.find(key);
  return it == branches_.end() ? -1 : it->second;
}
// Matrix cell index for (row, column). Anything touching ground goes to a spare "trash" cell
// at the end, so devices can stamp without checking for ground every time.
int Circuit::pos(int r, int c) {
  if (r < 0 || c < 0) return trash_;
  const int p = r * n_ + c;
  pattern_[p] = 1;
  return p;
}

// ---------------------------------------------------------------- assembly
// Three layers, from least to most often rebuilt:
//   G_     "static" part: resistors, capacitor/inductor companions, pots, switches.
//          Only changes when a knob moves.
//   bStep_ right hand side for this sample: sources and capacitor/inductor history.
//   A_, b_ G_ and bStep_ plus the nonlinear parts linearised at the current guess.
//          Rebuilt every Newton iteration.
void Circuit::buildStatic(bool dc) {
  dcMode = dc;
  std::fill(G_.begin(), G_.end(), 0.0);
  for (Device* d : staticDevs_) d->stampStatic(G_.data(), *this);
  for (int k : diagIdx_) G_[k] += opts_.gshunt;
  factored_ = false;
  haveF_ = false;
}

void Circuit::buildRHS() {
  std::fill(bStep_.begin(), bStep_.end(), 0.0);
  for (Device* d : rhsDevs_) d->stepRHS(bStep_.data(), *this);
}

void Circuit::assemble() {
  if (needAnalyze_) A_ = G_;
  else for (int p : lu_.active()) A_[p] = G_[p];  // only entries the LU programs touch
  b_ = bStep_;
  limited = false;
  const double* x = x_.data();
  double* A = A_.data();
  double* b = b_.data();
  for (Device* d : nlDevs_) d->load(x, A, b, *this);
  if (gminExtra_ > 0) for (int k : diagIdx_) A_[k] += gminExtra_;
}

// LU-factor A_ in place. Picks a pivot order first if needed, and picks a new one if the
// current order hits a (near) zero pivot with these values.
bool Circuit::factor() {
  if (needAnalyze_) {
    if (!lu_.analyze(A_, pattern_)) return false;
    needAnalyze_ = false;
    stats.reanalyses++;
  }
  if (lu_.factor(A_)) return true;
  // a pivot collapsed: re-assemble and choose a new ordering for these values
  needAnalyze_ = true;
  assemble();
  needAnalyze_ = false;
  stats.reanalyses++;
  if (!lu_.analyze(A_, pattern_)) return false;
  return lu_.factor(A_);
}

// Plain Newton-Raphson: assemble, factor, solve, repeat until converged. Returns the number of
// iterations, or -1 if it did not converge. "Converged" means every unknown moved by less than
// reltol (0.01%) of its size plus a small absolute tolerance, and no junction was limited.
// `damped` (or a long struggle) takes half steps, which helps when Newton bounces back and forth.
int Circuit::newton(int maxIter, bool damped) {
  const int n = n_;
  const double rel = opts_.reltol;
  for (int it = 1; it <= maxIter; it++) {
    assemble();
    if (!factor()) return -1;
    lu_.solve(A_, b_, xNew_);
    bool conv = !limited;
    const double alpha = damped || it > 20 ? 0.5 : 1;
    for (int i = 0; i < n; i++) {
      const double v = xNew_[i];
      if (!std::isfinite(v)) return -1;
      const double old = x_[i];
      const double d = v - old;
      const double ad = d < 0 ? -d : d;
      const double mag = std::fmax(v < 0 ? -v : v, old < 0 ? -old : old);
      if (ad > rel * mag + tol_[i]) conv = false;
      x_[i] = alpha == 1 ? v : old + alpha * d;
    }
    if (conv) return it;
  }
  return -1;
}

/*
 * Transient Newton with Jacobian reuse (the "chord" or modified Newton method).
 *
 * Plain Newton re-factors the matrix on every iteration. At 192,000 steps a second the
 * circuit barely moves between samples, so the matrix from a moment ago is almost the same
 * as today's. This version keeps the last LU factors (F_) and, as long as Newton keeps
 * converging quickly, only rebuilds the cheap parts:
 *
 *   A x = b              the linearised circuit at the current guess x (device loads)
 *   r   = A x - b        how far x is from satisfying it (a sparse multiply)
 *   F dx = r             one solve with the OLD factors (cheap: no factoring)
 *   x  -= dx
 *
 * With fresh factors this is exactly the classic Newton step (x - A^-1 (A x - b) = A^-1 b).
 * With slightly stale factors it still converges to the same answer, just a little less
 * directly; the moment an iteration count creeps up, the factors are rebuilt. The stopping
 * test is unchanged, so the result is as accurate as before.
 */
int Circuit::newtonFast(int maxIter) {
  const int n = n_;
  const double rel = opts_.reltol;
  const auto& act = lu_.active();
  for (int it = 1; it <= maxIter; it++) {
    assemble();
    // refresh the factors when: none yet, the last step was slow, or this step is dragging on
    const bool refresh = !haveF_ || needAnalyze_ || lastIters_ > 2 || it > 2;
    if (refresh) {
      if (needAnalyze_) {                       // first time with this pattern: pick pivots on A
        if (!factor()) return -1;               // factor() works in place on A_ ...
        assemble();                             // ... so rebuild A_ for the residual below
      }
      for (int p : act) F_[p] = A_[p];
      if (!lu_.factor(F_)) {                    // a pivot collapsed: choose a new pivot order
        needAnalyze_ = true;
        haveF_ = false;
        return newton(maxIter);                 // plain Newton handles re-analysis
      }
      haveF_ = true;
    }
    // residual r = A x - b over the structural nonzeros (fill-in positions of A_ are zero)
    if (actFor_ != stats.reanalyses) {          // pivot order changed: rebuild the row/column lists
      actRow_.resize(act.size()); actCol_.resize(act.size());
      for (size_t k = 0; k < act.size(); k++) { actRow_[k] = act[k] / n; actCol_[k] = act[k] % n; }
      actFor_ = stats.reanalyses;
    }
    for (int i = 0; i < n; i++) r_[i] = -b_[i];
    const double* A = A_.data();
    const double* x = x_.data();
    const int* ar = actRow_.data();
    const int* ac = actCol_.data();
    const int na = static_cast<int>(act.size());
    for (int k = 0; k < na; k++) r_[ar[k]] += A[act[k]] * x[ac[k]];
    lu_.solve(F_, r_, dx_);
    bool conv = !limited;
    for (int i = 0; i < n; i++) {
      const double d = -dx_[i];
      if (!std::isfinite(d)) return -1;
      const double old = x_[i], v = old + d;
      const double ad = d < 0 ? -d : d;
      const double mag = std::fmax(v < 0 ? -v : v, old < 0 ? -old : old);
      if (ad > rel * mag + tol_[i]) conv = false;
      x_[i] = v;
    }
    if (conv) return it;
  }
  return -1;
}

// ---------------------------------------------------------------- analyses
// Where does the circuit settle with the power on and no guitar playing? Capacitors are open,
// inductors are wires. Three strategies, each more patient than the last (all from SPICE):
//   1. plain Newton from 0 V
//   2. "gmin stepping": add a big conductance from every node to ground (making the circuit
//      easy), solve, then shrink it step by step until it is gone
//   3. "source stepping": ramp the battery from 0 V up to 9 V, solving along the way
bool Circuit::dcOperatingPoint() {
  buildStatic(true);
  time = 0;
  srcScale = 1;
  gminExtra_ = 0;
  if (input_) input_->value = input_->dc;
  std::fill(x_.begin(), x_.end(), 0.0);
  for (Device* d : initDevs_) d->initState(x_.data(), *this);
  buildRHS();
  if (newton(200) >= 0) { needAnalyze_ = true; return true; }

  // gmin stepping
  std::fill(x_.begin(), x_.end(), 0.0);
  bool ok = true;
  for (double g = 1e-2; g >= 1e-12; g /= 10) {
    gminExtra_ = g;
    if (newton(100) < 0) { ok = false; break; }
  }
  gminExtra_ = 0;
  if (ok && newton(100) >= 0) { needAnalyze_ = true; return true; }

  // source stepping
  std::fill(x_.begin(), x_.end(), 0.0);
  for (Device* d : initDevs_) d->initState(x_.data(), *this);
  double s = 0, step = 0.1;
  std::vector<double> save(n_ + 1);
  while (s < 1) {
    const double sTry = std::fmin(1.0, s + step);
    srcScale = sTry;
    buildRHS();
    save = x_;
    if (newton(100) >= 0) { s = sTry; step *= 1.5; }
    else {
      x_ = save;
      step /= 4;
      if (step < 1e-5) break;
    }
  }
  srcScale = 1;
  buildRHS();
  if (s >= 1) { needAnalyze_ = true; return true; }
  return false;
}

void Circuit::startTransient() {
  buildStatic(false);
  for (Device* d : initDevs_) d->initState(x_.data(), *this);
  time = 0;
  needAnalyze_ = true;
}

// A knob or switch moved. Switches jump at once (a real switch does too); knobs set a target
// that smoothControls() glides toward. `immediate` is used when (re)building.
void Circuit::setControl(int id, double value, bool immediate) {
  if (id < 0 || id >= static_cast<int>(controlDevs_.size()) || !controlDevs_[id]) return;
  Device* d = controlDevs_[id];
  ctlTarget_[id] = value;
  if (immediate || d->isSwitch) {
    ctlCur_[id] = value;
    d->setValue(value, G_.data());
    factored_ = false;
    haveF_ = false;
  }
}

// Knobs glide to their target with a one-pole smoother (about 20 ms). Without it, a knob moving
// in steps makes a crackle called "zipper noise". Any change invalidates the stored factors.
bool Circuit::smoothControls() {
  bool changed = false;
  for (size_t i = 0; i < ctlCur_.size(); i++) {
    const double c = ctlCur_[i], t = ctlTarget_[i];
    if (c == t) continue;
    double v = c + (t - c) * ctlAlpha_;
    if (std::fabs(t - v) < 1e-5) v = t;
    ctlCur_[i] = v;
    if (controlDevs_[i]) controlDevs_[i]->setValue(v, G_.data());
    changed = true;
  }
  if (changed) { factored_ = false; haveF_ = false; }
  return changed;
}

// Advance the circuit by one (oversampled) sample and return the output voltage.
// This is the function that runs ~96,000 to 384,000 times a second per pedal.
double Circuit::step(double vin) {
  if (input_) input_->value = vin;
  smoothControls();
  time += dt;
  buildRHS();
  stats.steps++;

  if (linear_) {  // no nonlinear devices: one solve per sample
    if (!factored_) {
      A_ = G_;
      if (!factor()) { stats.failures++; return x_[outIdx_]; }
      factored_ = true;
    }
    b_ = bStep_;
    lu_.solve(A_, b_, x_);
    for (Device* d : stateDevs_) d->accept(x_.data(), *this);
    stats.iterations++;
    return x_[outIdx_];
  }

  xPrev2_ = xPrev_;
  xPrev_ = x_;
  if (predict_ && stats.steps > 2) {  // linear extrapolation as the Newton starting point
    for (int i = 0; i < n_; i++) x_[i] = 2 * xPrev_[i] - xPrev2_[i];
  }
  // Fast path first; if it fails, restart from the last good state with careful damped Newton.
  int it = newtonFast(opts_.maxIter);
  lastIters_ = it < 0 ? opts_.maxIter : it;
  if (it < 0) {
    x_ = xPrev_;
    for (Device* d : initDevs_) d->initState(x_.data(), *this);
    it = newton(opts_.maxIter * 2, true);
    if (it < 0) {  // hold the last valid state: no NaN, no click
      x_ = xPrev_;
      for (Device* d : initDevs_) d->initState(x_.data(), *this);
      stats.failures++;
      stats.iterations += opts_.maxIter * 3;
      return x_[outIdx_];
    }
    it += opts_.maxIter;
  }
  stats.iterations += it;
  if (it > stats.maxIterations) stats.maxIterations = it;
  for (Device* d : stateDevs_) d->accept(x_.data(), *this);
  return x_[outIdx_];
}

}  // namespace ps
