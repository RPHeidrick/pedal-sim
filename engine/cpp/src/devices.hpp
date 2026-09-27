// Device models. Ports of engine/js/devices/*.js.
//
// Every device follows the same protocol as the JavaScript engine:
//   constructor   allocate nodes / branch currents (order matters: it sets unknown numbering)
//   bind          resolve flat matrix positions (Circuit::pos)
//   stampStatic   time-invariant stamps for the current mode (DC or transient)
//   stepRHS       per-timestep right-hand side (sources, capacitor history)
//   load          nonlinear stamps, every Newton iteration
//   initState     seed history from the DC operating point
//   accept        commit a converged timestep
// The has*() flags say which of these a device uses, so the circuit keeps
// short per-phase lists instead of calling empty functions 96,000 times a second.
#pragma once
#include <array>
#include <vector>

namespace ps {

class Circuit;

struct Device {
  virtual ~Device() = default;
  virtual void bind(Circuit&) {}
  virtual void stampStatic(double* /*G*/, Circuit&) {}
  virtual void stepRHS(double* /*b*/, Circuit&) {}
  virtual void load(const double* /*x*/, double* /*A*/, double* /*b*/, Circuit&) {}
  virtual void initState(const double* /*x*/, Circuit&) {}
  virtual void accept(const double* /*x*/, Circuit&) {}
  virtual void setValue(double /*v*/, double* /*G*/) {}  // pots and switches

  bool hasStatic = false, hasRHS = false, hasLoad = false, hasInit = false, hasAccept = false;
  int control = -1;       // index into the circuit's controls, or -1
  bool isSwitch = false;
};

// Stamp a conductance g between the four flat positions of a node pair.
inline void stampG(double* G, const std::array<int, 4>& p, double g) {
  G[p[0]] += g; G[p[1]] -= g; G[p[2]] -= g; G[p[3]] += g;
}
std::array<int, 4> posPair(Circuit& c, int a, int b);

// ---------------------------------------------------------------- linear
struct Resistor : Device {
  Resistor(Circuit& c, int a, int b, double r);
  void bind(Circuit& c) override;
  void stampStatic(double* G, Circuit&) override { stampG(G, p, g); }
  int a, b; double g; std::array<int, 4> p{};
};

struct Capacitor : Device {
  Capacitor(Circuit& c, int a, int b, double cap);
  void bind(Circuit& c) override;
  void stampStatic(double* G, Circuit& c) override;
  void stepRHS(double* b, Circuit& c) override;
  void initState(const double* x, Circuit&) override { v = x[ra] - x[rb]; i = 0; }
  void accept(const double* x, Circuit&) override;
  int a, b, ra = 0, rb = 0; double c, gc = 0, v = 0, i = 0, ieq = 0; std::array<int, 4> p{};
};

struct Inductor : Device {
  Inductor(Circuit& c, int a, int b, int branchKey, double l);
  void bind(Circuit& c) override;
  void stampStatic(double* G, Circuit& c) override;
  void stepRHS(double* b, Circuit& c) override;
  void initState(const double* x, Circuit&) override { i = x[rk]; v = 0; }
  void accept(const double* x, Circuit&) override { i = x[rk]; v = x[ra] - x[rb]; }
  int a, b, k, ra = 0, rb = 0, rk = 0; double l, req = 0, v = 0, i = 0; std::array<int, 5> p{};
};

// Transient source waveform (sin / pulse / pwl), as in linear.js waveValue().
struct Wave {
  int kind = 0;                   // 0 none, 1 sin, 2 pulse, 3 pwl
  double a[7] = {0};              // sin: vo va freq td theta phase | pulse: v1 v2 td tr tf pw per
  std::vector<double> pts;        // pwl: t0 v0 t1 v1 ...
  double value(double t, double dc) const;
};

struct VSource : Device {
  VSource(Circuit& c, int a, int b, int branchKey, double dc, bool input, Wave w);
  void bind(Circuit& c) override;
  void stampStatic(double* G, Circuit&) override;
  void stepRHS(double* b, Circuit& c) override;
  int a, b, k, rk = 0; double dc, value; bool input; Wave wave; std::array<int, 4> p{};
};

struct ISource : Device {
  ISource(Circuit& c, int a, int b, double dc, Wave w);
  void bind(Circuit& c) override;
  void stepRHS(double* b, Circuit& c) override;
  int a, b, ra = 0, rb = 0; double dc; Wave wave;
};

struct VCVS : Device {  // E
  VCVS(Circuit& c, int a, int b, int cp, int cn, int branchKey, double gain);
  void bind(Circuit& c) override;
  void stampStatic(double* G, Circuit&) override;
  int a, b, cp, cn, k; double gain; std::array<int, 6> p{};
};

struct VCCS : Device {  // G
  VCCS(Circuit& c, int a, int b, int cp, int cn, double gm);
  void bind(Circuit& c) override;
  void stampStatic(double* G, Circuit&) override;
  int a, b, cp, cn; double gm; std::array<int, 4> p{};
};

struct CCCS : Device {  // F
  CCCS(Circuit& c, int a, int b, int srcKey, double gain);
  void bind(Circuit& c) override;
  void stampStatic(double* G, Circuit&) override { G[p[0]] += gain; G[p[1]] -= gain; }
  int a, b, srcKey; double gain; std::array<int, 2> p{};
};

struct CCVS : Device {  // H
  CCVS(Circuit& c, int a, int b, int branchKey, int srcKey, double r);
  void bind(Circuit& c) override;
  void stampStatic(double* G, Circuit&) override;
  int a, b, k, srcKey; double r; std::array<int, 5> p{};
};

// Potentiometer: two resistors whose split follows the knob through the taper.
struct Pot : Device {
  Pot(Circuit& c, int a, int w, int cc, double r, int taper, double rot, int control);
  void bind(Circuit& c) override;
  void stampStatic(double* G, Circuit&) override;
  void setValue(double rot, double* G) override;
  void legs(double rot, double& g1, double& g2) const;
  int a, w, c, taper; double r, rot, rMin, g1 = 0, g2 = 0; std::array<int, 4> p1{}, p2{};
};

// Multi-pole switch: state 0 connects common-a, state 1 connects common-b on every pole.
struct Switch : Device {
  struct Pole { int c, a, b; bool hasA, hasB; std::array<int, 4> pa{}, pb{}; };
  Switch(Circuit& c, int control, double state, std::vector<std::array<int, 3>> poles);
  void bind(Circuit& c) override;
  void stampStatic(double* G, Circuit&) override;
  void setValue(double state, double* G) override;
  int state; double gon = 10.0, goff = 1e-9; std::vector<Pole> poles;
};

// ---------------------------------------------------------------- nonlinear
struct DiodeParams { double is, n, rs, bv, ibv, nbv; };
struct Diode : Device {
  Diode(Circuit& c, int a, int k, const DiodeParams& p);
  void bind(Circuit& c) override;
  void stampStatic(double* G, Circuit&) override;
  void load(const double* x, double* A, double* b, Circuit& c) override;
  void initState(const double* x, Circuit&) override { vold = x[rai] - x[rk]; }
  DiodeParams p; int a, k, ai, rai = 0, rkk = 0, rk = 0; double nvt, vc, vold = 0;
  std::array<int, 4> pj{}, ps{}; bool hasSeries;
};

struct BJTParams { double is, bf, br, nf, nr, invVaf, invVar, invIkf, invIkr, ise, ne, isc, nc, rb, rc, re; };
struct BJT : Device {
  BJT(Circuit& c, int cn, int bn, int en, double pol, const BJTParams& p);
  void bind(Circuit& c) override;
  void stampStatic(double* G, Circuit&) override;
  void load(const double* x, double* A, double* b, Circuit& c) override;
  void initState(const double* x, Circuit&) override;
  BJTParams p; double pol; int c, b, e, ci, bi, ei;
  double vcBE, vcBC, vbeOld = 0, vbcOld = 0;
  std::array<int, 9> P{}; std::array<int, 3> R{};
  struct Series { double g; std::array<int, 4> p; };
  std::vector<Series> series;
};

struct FETParams { double k, vto, lambda, is, n, rd, rs; };
struct FET : Device {  // JFET and MOSFET level 1 (the MOSFET resolves to the same parameter set)
  FET(Circuit& c, int dn, int gn, int sn, double pol, const FETParams& p);
  void bind(Circuit& c) override;
  void stampStatic(double* G, Circuit&) override;
  void load(const double* x, double* A, double* b, Circuit& c) override;
  void initState(const double* x, Circuit&) override;
  FETParams p; double pol; int d, g, s, di, si; double vc, vgsOld = 0, vgdOld = 0;
  std::array<int, 9> P{}; std::array<int, 3> R{};
  struct Series { double g; std::array<int, 4> p; };
  std::vector<Series> series;
};

// Op amp macromodel core (the input resistor, gain-node R and C are separate Resistor/Capacitor devices).
struct OpampCore : Device {
  OpampCore(Circuit& c, int inp, int inn, int vp, int vn, int out, int intNode,
            double imax, double gout, double dropHi, double dropLo);
  void bind(Circuit& c) override;
  void stampStatic(double* G, Circuit&) override { G[pOutOut] += gout; }
  void load(const double* x, double* A, double* b, Circuit& c) override;
  int inp, inn, vp, vn, out, in_; bool hasVp, hasVn;
  double imax, gout, dropHi, dropLo;
  int pIntP = 0, pIntN = 0, pIntInt = 0, pOutOut = 0, pOutInt = 0;
  int rInp = 0, rInn = 0, rInt = 0, rOut = 0, rVp = -1, rVn = -1;
};

}  // namespace ps
