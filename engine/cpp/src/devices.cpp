// ============================================================================
// devices.cpp: the physics of every part. Port of engine/js/devices/*.js.
// ============================================================================
//
// Every part answers the same question in the language of the matrix (see circuit.cpp):
// "given the voltages on my pins, what current flows, and how fast does it change if
// the voltages change?" The second number is the conductance g (current per volt). A part
// "stamps" g into four matrix cells between its two nodes:
//
//              col a   col b
//     row a    +g      -g        current leaving a = g * (Va - Vb)
//     row b    -g      +g        and the same current arrives at b
//
// Linear parts (R, C, L, sources, pots, switches) stamp once into the static matrix G.
// Nonlinear parts (diode, transistors, op amp) are re-linearised every Newton iteration
// in load(): current at the guess, plus slope g times the difference ("tangent line").
#include "devices.hpp"

#include <cmath>

#include "circuit.hpp"
#include "common.hpp"

namespace ps {

namespace {
constexpr double PI = 3.141592653589793;
// Real volume pots are not linear: an "audio" (log) pot only reaches about 10% of its
// resistance at half rotation, because our ears hear loudness logarithmically.
// (81^0.5 - 1) / 80 = 0.1, so base 81 gives exactly that curve.
constexpr double LOG_BASE = 81;

double taperFrac(int kind, double rot) {
  const double r = rot < 0 ? 0 : rot > 1 ? 1 : rot;
  switch (kind) {
    case 1: return (std::pow(LOG_BASE, r) - 1) / (LOG_BASE - 1);          // log (A)
    case 2: return 1 - (std::pow(LOG_BASE, 1 - r) - 1) / (LOG_BASE - 1);  // reverse log (C)
    default: return r;                                                    // linear (B)
  }
}

std::array<int, 9> positions3(Circuit& c, int t1, int t2, int t3) {
  const int r[3] = {t1, t2, t3};
  std::array<int, 9> p{};
  for (int i = 0; i < 3; i++)
    for (int j = 0; j < 3; j++) p[i * 3 + j] = c.pos(r[i], r[j]);
  return p;
}

// Linearised stamp for a three-terminal device (see engine/js/devices/stamp3.js).
// Transistors have three pins; currents i1, i2 flow into pins 1 and 2 and leave by pin 3
// (Kirchhoff: whatever goes in must come out). The g's are the four partial derivatives
// (d i1 / d v1, d i1 / d v2, ...), with v1, v2 measured against pin 3. `pol` is +1 for
// NPN / N channel and -1 for PNP / P channel (the same maths with every sign flipped).
inline void stamp3(double* A, double* b, const std::array<int, 9>& P, const std::array<int, 3>& R,
                   double pol, double i1, double i2, double g11, double g12, double g21, double g22,
                   double v1, double v2) {
  const double g31 = -(g11 + g21);
  const double g32 = -(g12 + g22);
  A[P[0]] -= g12; A[P[1]] += g11 + g12; A[P[2]] -= g11;
  A[P[3]] -= g22; A[P[4]] += g21 + g22; A[P[5]] -= g21;
  A[P[6]] -= g32; A[P[7]] += g31 + g32; A[P[8]] -= g31;
  const double e1 = pol * (i1 - g11 * v1 - g12 * v2);
  const double e2 = pol * (i2 - g21 * v1 - g22 * v2);
  b[R[0]] -= e1;
  b[R[1]] -= e2;
  b[R[2]] += e1 + e2;
}
}  // namespace

std::array<int, 4> posPair(Circuit& c, int a, int b) {
  return {c.pos(a, a), c.pos(a, b), c.pos(b, a), c.pos(b, b)};
}

// ---------------------------------------------------------------- Resistor
Resistor::Resistor(Circuit& c, int na, int nb, double r) : a(c.node(na)), b(c.node(nb)), g(1 / r) { hasStatic = true; }
void Resistor::bind(Circuit& c) { p = posPair(c, a, b); }

// ---------------------------------------------------------------- Capacitor (trapezoidal companion model)
// A capacitor's current is C * dV/dt. Over one tiny time step dt, the trapezoidal rule turns
// that into:  i_now = (2C/dt) * v_now - (history term). That is exactly a resistor of
// conductance gc = 2C/dt in parallel with a current source (ieq) that remembers the last
// step. So a capacitor becomes "a resistor plus memory", which the matrix handles easily.
// At DC (power on, nothing changing) a capacitor carries no current: an open circuit.
Capacitor::Capacitor(Circuit& ct, int na, int nb, double cap) : a(ct.node(na)), b(ct.node(nb)), c(cap) {
  hasStatic = hasRHS = hasInit = hasAccept = true;
}
void Capacitor::bind(Circuit& ct) { p = posPair(ct, a, b); ra = ct.rhs(a); rb = ct.rhs(b); }
void Capacitor::stampStatic(double* G, Circuit& ct) {
  if (ct.dcMode) { gc = 0; return; }  // open circuit at DC
  gc = (ct.backwardEuler ? 1 : 2) * c / ct.dt;
  stampG(G, p, gc);
}
void Capacitor::stepRHS(double* bb, Circuit& ct) {
  if (ct.dcMode) return;
  ieq = ct.backwardEuler ? gc * v : gc * v + i;  // i = gc*v - ieq
  bb[ra] += ieq;
  bb[rb] -= ieq;
}
void Capacitor::accept(const double* x, Circuit&) {
  const double vv = x[ra] - x[rb];
  i = gc * vv - ieq;
  v = vv;
}

// ---------------------------------------------------------------- Inductor
// The mirror image of a capacitor: V = L * dI/dt. It gets its own current unknown (branch),
// and the same trapezoidal trick. At DC an inductor is a plain wire.
Inductor::Inductor(Circuit& c, int na, int nb, int key, double ind) : a(c.node(na)), b(c.node(nb)), k(c.branch(key)), l(ind) {
  hasStatic = hasRHS = hasInit = hasAccept = true;
}
void Inductor::bind(Circuit& c) {
  p = {c.pos(a, k), c.pos(b, k), c.pos(k, a), c.pos(k, b), c.pos(k, k)};
  ra = c.rhs(a); rb = c.rhs(b); rk = c.rhs(k);
}
void Inductor::stampStatic(double* G, Circuit& c) {
  G[p[0]] += 1; G[p[1]] -= 1; G[p[2]] += 1; G[p[3]] -= 1;
  if (c.dcMode) { req = 0; return; }  // short at DC
  req = (c.backwardEuler ? 1 : 2) * l / c.dt;
  G[p[4]] -= req;
}
void Inductor::stepRHS(double* bb, Circuit& c) {
  if (c.dcMode) return;
  bb[rk] -= c.backwardEuler ? req * i : req * i + v;
}

// ---------------------------------------------------------------- sources
// A voltage source fixes Va - Vb, which adds one equation and one unknown (its current).
// The guitar input is a voltage source whose value is set to the input sample each step.
// Wave: optional test signals from SPICE files (1 = SIN, 2 = PULSE, 3 = PWL point list).
double Wave::value(double t, double dc) const {
  switch (kind) {
    case 1: {  // SIN(vo va freq td theta phase)
      const double vo = a[0], va = a[1], freq = a[2], td = a[3], theta = a[4], phase = a[5];
      if (t < td) return vo + va * std::sin(phase * PI / 180);
      const double tt = t - td;
      return vo + va * std::exp(-tt * theta) * std::sin(2 * PI * freq * tt + phase * PI / 180);
    }
    case 2: {  // PULSE(v1 v2 td tr tf pw per)
      const double v1 = a[0], v2 = a[1], td = a[2], tr = a[3], tf = a[4], pw = a[5], per = a[6];
      if (t < td) return v1;
      double tt = t - td;
      if (std::isfinite(per) && per > 0) tt = std::fmod(tt, per);
      if (tt < tr) return v1 + (v2 - v1) * tt / (tr != 0 ? tr : 1);
      tt -= tr;
      if (tt < pw) return v2;
      tt -= pw;
      if (tt < tf) return v2 + (v1 - v2) * tt / (tf != 0 ? tf : 1);
      return v1;
    }
    case 3: {  // PWL(t0 v0 t1 v1 ...)
      const size_t m = pts.size() / 2;
      if (!m) return dc;
      if (t <= pts[0]) return pts[1];
      for (size_t i = 1; i < m; i++) {
        if (t <= pts[2 * i]) {
          const double t0 = pts[2 * i - 2], v0 = pts[2 * i - 1], t1 = pts[2 * i], v1 = pts[2 * i + 1];
          const double span = t1 - t0;
          return v0 + (v1 - v0) * (t - t0) / (span != 0 ? span : 1);
        }
      }
      return pts[2 * m - 1];
    }
    default: return dc;
  }
}

VSource::VSource(Circuit& c, int na, int nb, int key, double dcv, bool isInput, Wave w)
    : a(c.node(na)), b(c.node(nb)), k(c.branch(key)), dc(dcv), value(dcv), input(isInput), wave(std::move(w)) {
  hasStatic = hasRHS = true;
}
void VSource::bind(Circuit& c) { p = {c.pos(a, k), c.pos(b, k), c.pos(k, a), c.pos(k, b)}; rk = c.rhs(k); }
void VSource::stampStatic(double* G, Circuit&) { G[p[0]] += 1; G[p[1]] -= 1; G[p[2]] += 1; G[p[3]] -= 1; }
void VSource::stepRHS(double* bb, Circuit& c) {
  const double v = input ? value : c.dcMode ? dc : wave.value(c.time, dc);  // the audio input is written by the engine
  bb[rk] += v * c.srcScale;
}

ISource::ISource(Circuit& c, int na, int nb, double dcv, Wave w) : a(c.node(na)), b(c.node(nb)), dc(dcv), wave(std::move(w)) { hasRHS = true; }
void ISource::bind(Circuit& c) { ra = c.rhs(a); rb = c.rhs(b); }
void ISource::stepRHS(double* bb, Circuit& c) {
  const double i = (c.dcMode ? dc : wave.value(c.time, dc)) * c.srcScale;
  bb[ra] -= i;  // SPICE: current flows from n+ through the source to n-
  bb[rb] += i;
}

// ---------------------------------------------------------------- controlled sources
// SPICE's E, G, F, H elements: an output that follows some other voltage or current, times
// a gain. Used for idealised building blocks (for example buffers inside op amp models).
VCVS::VCVS(Circuit& c, int na, int nb, int ncp, int ncn, int key, double gn)
    : a(c.node(na)), b(c.node(nb)), cp(c.node(ncp)), cn(c.node(ncn)), k(c.branch(key)), gain(gn) { hasStatic = true; }
void VCVS::bind(Circuit& c) { p = {c.pos(a, k), c.pos(b, k), c.pos(k, a), c.pos(k, b), c.pos(k, cp), c.pos(k, cn)}; }
void VCVS::stampStatic(double* G, Circuit&) {
  G[p[0]] += 1; G[p[1]] -= 1; G[p[2]] += 1; G[p[3]] -= 1; G[p[4]] -= gain; G[p[5]] += gain;
}

VCCS::VCCS(Circuit& c, int na, int nb, int ncp, int ncn, double g)
    : a(c.node(na)), b(c.node(nb)), cp(c.node(ncp)), cn(c.node(ncn)), gm(g) { hasStatic = true; }
void VCCS::bind(Circuit& c) { p = {c.pos(a, cp), c.pos(a, cn), c.pos(b, cp), c.pos(b, cn)}; }
void VCCS::stampStatic(double* G, Circuit&) { G[p[0]] += gm; G[p[1]] -= gm; G[p[2]] -= gm; G[p[3]] += gm; }

CCCS::CCCS(Circuit& c, int na, int nb, int sk, double gn) : a(c.node(na)), b(c.node(nb)), srcKey(sk), gain(gn) { hasStatic = true; }
void CCCS::bind(Circuit& c) { const int kc = c.branchOf(srcKey); p = {c.pos(a, kc), c.pos(b, kc)}; }

CCVS::CCVS(Circuit& c, int na, int nb, int key, int sk, double rr) : a(c.node(na)), b(c.node(nb)), k(c.branch(key)), srcKey(sk), r(rr) { hasStatic = true; }
void CCVS::bind(Circuit& c) {
  const int kc = c.branchOf(srcKey);
  p = {c.pos(a, k), c.pos(b, k), c.pos(k, a), c.pos(k, b), c.pos(k, kc)};
}
void CCVS::stampStatic(double* G, Circuit&) { G[p[0]] += 1; G[p[1]] -= 1; G[p[2]] += 1; G[p[3]] -= 1; G[p[4]] -= r; }

// ---------------------------------------------------------------- Pot
// A potentiometer is two resistors that share the wiper: leg 1 (a to wiper) and leg 2
// (wiper to c). Turning the knob moves resistance from one leg to the other. A tiny minimum
// keeps each leg from reaching exactly 0 ohms (infinite conductance would break the maths).
Pot::Pot(Circuit& ct, int na, int nw, int nc, double rr, int tp, double rt, int ctl)
    : a(ct.node(na)), w(ct.node(nw)), c(ct.node(nc)), taper(tp), r(rr), rot(rt) {
  rMin = std::fmax(r * 1e-4, 0.1);  // end resistance keeps both legs finite
  control = ctl;
  hasStatic = true;
}
void Pot::bind(Circuit& ct) { p1 = posPair(ct, a, w); p2 = posPair(ct, w, c); }
void Pot::legs(double rt, double& o1, double& o2) const {
  const double f = taperFrac(taper, rt);
  o1 = 1 / std::fmax(r * f, rMin);
  o2 = 1 / std::fmax(r * (1 - f), rMin);
}
void Pot::stampStatic(double* G, Circuit&) {
  legs(rot, g1, g2);
  stampG(G, p1, g1);
  stampG(G, p2, g2);
}
void Pot::setValue(double rt, double* G) {  // knob move: apply only the change in conductance
  rot = rt;
  double n1, n2;
  legs(rt, n1, n2);
  stampG(G, p1, n1 - g1);
  stampG(G, p2, n2 - g2);
  g1 = n1; g2 = n2;
}

// ---------------------------------------------------------------- Switch
// A switch is modelled as tiny resistors: on = almost a wire, off = almost open. Each pole
// has a common pin and two throws; the state picks which throw is connected.
Switch::Switch(Circuit& ct, int ctl, double st, std::vector<std::array<int, 3>> ps) : state(st ? 1 : 0) {
  control = ctl;
  isSwitch = true;
  hasStatic = true;
  for (const auto& q : ps) {  // allocation order: common, a, b (as in the JS engine)
    Pole pole{};
    pole.c = ct.node(q[0]);
    pole.hasA = q[1] != -2; pole.a = pole.hasA ? ct.node(q[1]) : -1;
    pole.hasB = q[2] != -2; pole.b = pole.hasB ? ct.node(q[2]) : -1;
    poles.push_back(pole);
  }
}
void Switch::bind(Circuit& ct) {
  for (auto& q : poles) {
    if (q.hasA) q.pa = posPair(ct, q.c, q.a);
    if (q.hasB) q.pb = posPair(ct, q.c, q.b);
  }
}
void Switch::stampStatic(double* G, Circuit&) {
  const double ga = state ? goff : gon, gb = state ? gon : goff;
  for (auto& q : poles) {
    if (q.hasA) stampG(G, q.pa, ga);
    if (q.hasB) stampG(G, q.pb, gb);
  }
}
void Switch::setValue(double v, double* G) {
  const int st = v >= 0.5 ? 1 : 0;
  if (st == state) return;
  const double ga0 = state ? goff : gon, gb0 = state ? gon : goff;
  const double ga1 = st ? goff : gon, gb1 = st ? gon : goff;
  for (auto& q : poles) {
    if (q.hasA) stampG(G, q.pa, ga1 - ga0);
    if (q.hasB) stampG(G, q.pb, gb1 - gb0);
  }
  state = st;
}

// ---------------------------------------------------------------- Diode (Shockley + breakdown + RS)
// The Shockley equation:  I = Is * (exp(V / (n * Vt)) - 1)
//   Is  saturation current: tiny (1e-14 A for silicon, larger for germanium, which is why
//       germanium starts conducting at a lower voltage and clips more softly)
//   n   ideality factor, about 1 to 2 (LEDs are higher, so they clip later and louder)
//   Vt  thermal voltage, 25.9 mV at room temperature
// Optional extras: reverse breakdown (bv, ibv, nbv), the "zener" effect, and a series
// resistance rs placed on an extra internal node.
Diode::Diode(Circuit& c, int na, int nk, const DiodeParams& pp) : p(pp), a(c.node(na)), k(c.node(nk)) {
  hasSeries = p.rs > 0;
  ai = hasSeries ? c.internal() : a;
  nvt = p.n * VT;
  vc = vcrit(p.is, nvt);
  hasStatic = hasLoad = hasInit = true;
}
void Diode::bind(Circuit& c) {
  pj = {c.pos(ai, ai), c.pos(ai, k), c.pos(k, ai), c.pos(k, k)};
  if (hasSeries) ps = {c.pos(a, a), c.pos(a, ai), c.pos(ai, a), c.pos(ai, ai)};
  rai = c.rhs(ai); rk = c.rhs(k);
}
void Diode::stampStatic(double* G, Circuit&) {
  if (!hasSeries) return;
  stampG(G, ps, 1 / p.rs);
}
void Diode::load(const double* x, double* A, double* b, Circuit& c) {
  double vd = x[rai] - x[rk];
  const bool bvFinite = std::isfinite(p.bv);
  if (bvFinite && vd < std::fmin(0.0, -p.bv + 10 * nvt)) {
    double vt = -(vd + p.bv);  // limit on the mirrored breakdown exponential
    vt = pnjlim(vt, -(vold + p.bv), p.nbv * VT, vc, c.limited);
    vd = -(vt + p.bv);
  } else {
    vd = pnjlim(vd, vold, nvt, vc, c.limited);
  }
  vold = vd;
  const double e = safeExp(vd / nvt);
  double id = p.is * (e - 1);
  double gd = (p.is * safeExpD(vd / nvt)) / nvt;
  if (bvFinite) {
    const double nbvt = p.nbv * VT;
    const double arg = -(vd + p.bv) / nbvt;
    id -= p.ibv * safeExp(arg);
    gd += (p.ibv * safeExpD(arg)) / nbvt;
  }
  id += GMIN * vd;
  gd += GMIN;
  A[pj[0]] += gd; A[pj[1]] -= gd; A[pj[2]] -= gd; A[pj[3]] += gd;
  const double ieq = id - gd * vd;
  b[rai] -= ieq;
  b[rk] += ieq;
}

// ---------------------------------------------------------------- BJT (simplified Gummel-Poon)
// A bipolar transistor (2N3904, AC128, ...) is two diode junctions back to back
// (base-emitter and base-collector) plus the transistor action: a small base current lets
// a current about bf times larger flow from collector to emitter. Gummel-Poon adds the real
// world effects that shape a fuzz's tone:
//   vaf  Early effect (collector current rises slightly with collector voltage)
//   ikf  high current roll off (gain drops when pushed hard)
//   ise/ne  base leakage at low current (important for leaky vintage germanium)
//   rb, rc, re  resistance of the silicon itself, on extra internal nodes
// bjtEval computes the currents and their derivatives; load() stamps them with stamp3.
namespace {
void bjtEval(const BJTParams& p, double vbe, double vbc, double* out) {
  const double nfvt = p.nf * VT, nrvt = p.nr * VT;
  const double ibf = p.is * (safeExp(vbe / nfvt) - 1);
  const double gbf = (p.is * safeExpD(vbe / nfvt)) / nfvt;
  const double ibr = p.is * (safeExp(vbc / nrvt) - 1);
  const double gbr = (p.is * safeExpD(vbc / nrvt)) / nrvt;

  double ile = 0, gle = 0, ilc = 0, glc = 0;
  if (p.ise > 0) {
    const double nevt = p.ne * VT;
    ile = p.ise * (safeExp(vbe / nevt) - 1);
    gle = (p.ise * safeExpD(vbe / nevt)) / nevt;
  }
  if (p.isc > 0) {
    const double ncvt = p.nc * VT;
    ilc = p.isc * (safeExp(vbc / ncvt) - 1);
    glc = (p.isc * safeExpD(vbc / ncvt)) / ncvt;
  }

  double q1, dq1be, dq1bc;  // base charge: Early effect
  const double den = 1 - vbc * p.invVaf - vbe * p.invVar;
  if (den > 1e-2) {
    q1 = 1 / den;
    dq1be = q1 * q1 * p.invVar;
    dq1bc = q1 * q1 * p.invVaf;
  } else {
    q1 = 100; dq1be = 0; dq1bc = 0;
  }
  const double q2 = ibf * p.invIkf + ibr * p.invIkr;  // high injection
  double qb, dqbe, dqbc;
  if (q2 > 0 || q2 < 0) {
    const double s = std::sqrt(std::fmax(1 + 4 * q2, 1e-6));
    qb = (q1 * (1 + s)) / 2;
    dqbe = ((1 + s) / 2) * dq1be + (q1 / s) * p.invIkf * gbf;
    dqbc = ((1 + s) / 2) * dq1bc + (q1 / s) * p.invIkr * gbr;
  } else {
    qb = q1; dqbe = dq1be; dqbc = dq1bc;
  }

  const double ict = (ibf - ibr) / qb;
  const double dictBe = (gbf - ict * dqbe) / qb;
  const double dictBc = (-gbr - ict * dqbc) / qb;

  out[0] = ict - ibr / p.br - ilc - GMIN * vbc;                  // ic
  out[1] = ibf / p.bf + ile + ibr / p.br + ilc + GMIN * (vbe + vbc);  // ib
  out[2] = dictBe;
  out[3] = dictBc - gbr / p.br - glc - GMIN;
  out[4] = gbf / p.bf + gle + GMIN;
  out[5] = gbr / p.br + glc + GMIN;
}
}  // namespace

BJT::BJT(Circuit& ct, int nc, int nb, int ne, double polarity, const BJTParams& pp)
    : p(pp), pol(polarity), c(ct.node(nc)), b(ct.node(nb)), e(ct.node(ne)) {
  ci = p.rc > 0 ? ct.internal() : c;
  bi = p.rb > 0 ? ct.internal() : b;
  ei = p.re > 0 ? ct.internal() : e;
  vcBE = vcrit(p.is, p.nf * VT);
  vcBC = vcrit(p.is, p.nr * VT);
  hasStatic = hasLoad = hasInit = true;
}
void BJT::bind(Circuit& ct) {
  P = positions3(ct, ci, bi, ei);
  R = {ct.rhs(ci), ct.rhs(bi), ct.rhs(ei)};
  series.clear();
  if (ci != c) series.push_back({1 / p.rc, posPair(ct, c, ci)});
  if (bi != b) series.push_back({1 / p.rb, posPair(ct, b, bi)});
  if (ei != e) series.push_back({1 / p.re, posPair(ct, e, ei)});
}
void BJT::stampStatic(double* G, Circuit&) { for (const auto& s : series) stampG(G, s.p, s.g); }
void BJT::load(const double* x, double* A, double* bb, Circuit& ct) {
  const double vB = x[R[1]];
  double vbe = pol * (vB - x[R[2]]);
  double vbc = pol * (vB - x[R[0]]);
  vbe = pnjlim(vbe, vbeOld, p.nf * VT, vcBE, ct.limited);
  vbc = pnjlim(vbc, vbcOld, p.nr * VT, vcBC, ct.limited);
  vbeOld = vbe;
  vbcOld = vbc;
  double o[6];
  bjtEval(p, vbe, vbc, o);
  stamp3(A, bb, P, R, pol, o[0], o[1], o[2], o[3], o[4], o[5], vbe, vbc);
}
void BJT::initState(const double* x, Circuit&) {
  vbeOld = pol * (x[R[1]] - x[R[2]]);
  vbcOld = pol * (x[R[1]] - x[R[0]]);
}

// ---------------------------------------------------------------- FET (Shichman-Hodges)
// A JFET (J201, 2N5457) or MOSFET: the gate voltage squeezes a channel between drain and
// source. Below the threshold vto it is off; above it the current follows a square law:
//   saturation:  I = k * (Vgs - Vto)^2 * (1 + lambda * Vds)
//   linear:      I = k * Vds * (2 * (Vgs - Vto) - Vds) * (1 + lambda * Vds)
// The channel works both ways, so if Vds goes negative the drain and source swap roles.
// A JFET's gate is also a diode to the channel (is, n), which matters when it is overdriven.
namespace {
// Drain current in normal mode; writes gm, gds.
double channel(double k, double vto, double lambda, double vgs, double vds, double* o) {
  const double vov = vgs - vto;
  if (vov <= 0) { o[0] = 0; o[1] = 0; return 0; }
  const double cl = 1 + lambda * vds;
  if (vds >= vov) {
    o[0] = 2 * k * vov * cl;
    o[1] = k * vov * vov * lambda;
    return k * vov * vov * cl;
  }
  const double f = vds * (2 * vov - vds);
  o[0] = 2 * k * vds * cl;
  o[1] = k * (2 * vov - 2 * vds) * cl + k * f * lambda;
  return k * f * cl;
}

void fetEval(const FETParams& p, double vgs, double vgd, double* out) {
  const double vds = vgs - vgd;
  double tmp[2];
  double ids, dvgs, dvgd;
  if (vds >= 0) {
    ids = channel(p.k, p.vto, p.lambda, vgs, vds, tmp);
    dvgs = tmp[0] + tmp[1];
    dvgd = -tmp[1];
  } else {  // symmetric device: drain and source swap roles
    ids = -channel(p.k, p.vto, p.lambda, vgd, -vds, tmp);
    dvgs = tmp[1];
    dvgd = -tmp[0] - tmp[1];
  }
  ids += GMIN * vds;
  dvgs += GMIN;
  dvgd -= GMIN;

  double igs = 0, ggs = 0, igd = 0, ggd = 0;
  if (p.is > 0) {
    const double nvt = p.n * VT;
    igs = p.is * (safeExp(vgs / nvt) - 1) + GMIN * vgs;
    ggs = (p.is * safeExpD(vgs / nvt)) / nvt + GMIN;
    igd = p.is * (safeExp(vgd / nvt) - 1) + GMIN * vgd;
    ggd = (p.is * safeExpD(vgd / nvt)) / nvt + GMIN;
  }
  out[0] = ids - igd;
  out[1] = igs + igd;
  out[2] = dvgs;
  out[3] = dvgd - ggd;
  out[4] = ggs;
  out[5] = ggd;
}
}  // namespace

FET::FET(Circuit& ct, int nd, int ng, int ns, double polarity, const FETParams& pp)
    : p(pp), pol(polarity), d(ct.node(nd)), g(ct.node(ng)), s(ct.node(ns)) {
  di = p.rd > 0 ? ct.internal() : d;
  si = p.rs > 0 ? ct.internal() : s;
  vc = p.is > 0 ? vcrit(p.is, p.n * VT) : INFINITY;
  hasStatic = hasLoad = hasInit = true;
}
void FET::bind(Circuit& ct) {
  P = positions3(ct, di, g, si);
  R = {ct.rhs(di), ct.rhs(g), ct.rhs(si)};
  series.clear();
  if (di != d) series.push_back({1 / p.rd, posPair(ct, d, di)});
  if (si != s) series.push_back({1 / p.rs, posPair(ct, s, si)});
}
void FET::stampStatic(double* G, Circuit&) { for (const auto& sr : series) stampG(G, sr.p, sr.g); }
void FET::load(const double* x, double* A, double* b, Circuit& ct) {
  const double vG = x[R[1]];
  double vgs = pol * (vG - x[R[2]]);
  double vgd = pol * (vG - x[R[0]]);
  vgs = fetlim(vgs, vgsOld, p.vto, ct.limited);
  vgd = fetlim(vgd, vgdOld, p.vto, ct.limited);
  if (p.is > 0) {
    const double nvt = p.n * VT;
    vgs = pnjlim(vgs, vgsOld, nvt, vc, ct.limited);
    vgd = pnjlim(vgd, vgdOld, nvt, vc, ct.limited);
  }
  vgsOld = vgs;
  vgdOld = vgd;
  double o[6];
  fetEval(p, vgs, vgd, o);
  stamp3(A, b, P, R, pol, o[0], o[1], o[2], o[3], o[4], o[5], vgs, vgd);
}
void FET::initState(const double* x, Circuit&) {
  vgsOld = pol * (x[R[1]] - x[R[2]]);
  vgdOld = pol * (x[R[1]] - x[R[0]]);
}

// ---------------------------------------------------------------- Op amp core
// A behavioural op amp (TL072, 4558, ...), not transistor by transistor. Three pieces:
//   1. input stage: a transconductance (current proportional to V+ minus V-) that saturates
//      at imax. That saturation is what sets the slew rate (how fast the output can move).
//   2. gain node: the current charges an internal node with huge gain.
//   3. output: follows the gain node, but is squeezed softly so it can never go beyond the
//      supply rails minus the chip's "drop" (dropHi / dropLo). That rail clipping is part of
//      why different op amps sound different when overdriven.
// softSat and softplus are smooth versions of hard limits: smooth curves keep Newton happy.
namespace {
constexpr double CLAMP_G = 1, CLAMP_W = 0.02, CLAMP_SCALE = 1.6;

double softSat(double x, double h, double& dy) {  // y = x / (1 + |x/h|^4)^(1/4)
  // SAT_K = 4, so the powers reduce to multiplies and square roots (pow() is slow).
  const double u = x / h;
  const double u2 = u * u;
  const double base = 1 + u2 * u2;
  const double inv4 = 1 / std::sqrt(std::sqrt(base));  // base^(-1/4)
  dy = inv4 / base;                                     // base^(-5/4)
  return x * inv4;
}
double softplus(double u, double& d) {
  const double z = u / CLAMP_W;
  if (z > 40) { d = 1; return u; }
  if (z < -40) { d = 0; return 0; }
  const double e = std::exp(z);
  d = e / (1 + e);
  return CLAMP_W * std::log1p(e);
}
}  // namespace

OpampCore::OpampCore(Circuit& c, int ninp, int ninn, int nvp, int nvn, int nout, int nint,
                     double im, double go, double dh, double dl)
    : imax(im), gout(go), dropHi(dh), dropLo(dl) {
  inp = c.node(ninp);
  inn = c.node(ninn);
  hasVp = nvp != -2; vp = hasVp ? c.node(nvp) : -1;
  hasVn = nvn != -2; vn = hasVn ? c.node(nvn) : -1;
  out = c.node(nout);
  in_ = c.node(nint);
  hasStatic = hasLoad = true;
}
void OpampCore::bind(Circuit& c) {
  pIntP = c.pos(in_, inp);
  pIntN = c.pos(in_, inn);
  pIntInt = c.pos(in_, in_);
  pOutOut = c.pos(out, out);
  pOutInt = c.pos(out, in_);
  rInp = c.rhs(inp); rInn = c.rhs(inn); rInt = c.rhs(in_); rOut = c.rhs(out);
  rVp = hasVp ? c.rhs(vp) : -1;
  rVn = hasVn ? c.rhs(vn) : -1;
}
void OpampCore::load(const double* x, double* A, double* b, Circuit& c) {
  // transconductance stage into the gain node (slew limited in transient)
  const double vd = x[rInp] - x[rInn];
  double i, g;
  if (c.dcMode) { i = vd; g = 1; }
  else {
    const double th = std::tanh(vd / imax);
    i = imax * th;
    g = 1 - th * th;
  }
  A[pIntP] -= g;
  A[pIntN] += g;
  b[rInt] += i - g * vd;

  // rails referenced to the actual supply pins
  const double vcc = rVp < 0 ? 15 : x[rVp];
  const double vee = rVn < 0 ? -15 : x[rVn];
  const double mid = 0.5 * (vcc + vee);
  const double hHi = std::fmax(vcc - dropHi - mid, 0.05);
  const double hLo = std::fmax(mid - vee - dropLo, 0.05);
  const double vint = x[rInt];

  // anti-windup clamps
  double dHi, dLo;
  const double sHi = softplus(vint - CLAMP_SCALE * hHi, dHi);
  const double sLo = softplus(-CLAMP_SCALE * hLo - vint, dLo);
  const double ic = CLAMP_G * (sHi - sLo);
  const double gc = CLAMP_G * (dHi + dLo);
  A[pIntInt] += gc;
  b[rInt] -= ic - gc * vint;

  // output stage: I_out = gout * (Vout - mid - sat(vint))
  double dy;
  const double y = softSat(vint, vint >= 0 ? hHi : hLo, dy);
  A[pOutInt] -= gout * dy;
  b[rOut] += gout * (mid + y - dy * vint);
}

}  // namespace ps
