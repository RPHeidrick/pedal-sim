// See sparse_lu.hpp for the big picture. This file has three parts:
//   analyze()  slow, runs rarely: pick the pivot order and write the "programs"
//   factor()   fast, runs every Newton step that needs it: replay the elimination
//   solve()    fastest, runs every Newton step: forward then back substitution
//
// Matrix cells are addressed by one number, row * n + col, so a whole program is
// just a list of ints.
#include "sparse_lu.hpp"

#include <cmath>
#include <limits>

namespace ps {

namespace {
constexpr double THRESHOLD = 1e-3;       // accept pivots >= THRESHOLD * column max
constexpr double PIVOT_REL_MIN = 1e-15;  // factor() fails if a pivot shrinks below this fraction
}  // namespace

bool SparseLU::analyze(const std::vector<double>& A, const std::vector<uint8_t>& pattern) {
  const int n = n_;
  const size_t nn = static_cast<size_t>(n) * n;
  std::vector<double> w(A.begin(), A.begin() + nn);
  std::vector<uint8_t> nz(pattern.begin(), pattern.begin() + nn);
  for (size_t i = 0; i < nn; i++) if (w[i] != 0) nz[i] = 1;

  std::vector<uint8_t> rowDone(n, 0), colDone(n, 0);
  std::vector<int> rowCount(n, 0), colCount(n, 0);
  for (int i = 0; i < n; i++)
    for (int j = 0; j < n; j++)
      if (nz[i * n + j]) { rowCount[i]++; colCount[j]++; }

  std::vector<double> colMax(n);
  std::vector<int32_t> f, fwd;
  std::vector<std::vector<int32_t>> bwdSteps;
  std::vector<int> rows, ucols;

  // Elimination, one pivot per round. Each round:
  //  1. find the biggest value left in each column (to judge which pivots are safe)
  //  2. choose the pivot (see Markowitz below)
  //  3. eliminate that pivot's column from every other row, recording each operation
  //     into the programs instead of just doing it once
  for (int k = 0; k < n; k++) {
    std::fill(colMax.begin(), colMax.end(), 0.0);
    for (int i = 0; i < n; i++) {
      if (rowDone[i]) continue;
      const int base = i * n;
      for (int j = 0; j < n; j++) {
        if (colDone[j] || !nz[base + j]) continue;
        const double a = std::fabs(w[base + j]);
        if (a > colMax[j]) colMax[j] = a;
      }
    }
    // Markowitz rule: prefer the pivot that creates the fewest new nonzeros ("fill-in"),
    // measured as (other entries in its row) x (other entries in its column). A pivot must
    // also be at least THRESHOLD of its column's biggest value, so we never divide by a
    // tiny number (that would amplify rounding errors). Ties go to the relatively bigger one.
    int pr = -1, pc = -1;
    double bestCost = std::numeric_limits<double>::infinity();
    double bestRel = 0;
    for (int i = 0; i < n; i++) {
      if (rowDone[i]) continue;
      const int base = i * n;
      for (int j = 0; j < n; j++) {
        if (colDone[j] || !nz[base + j]) continue;
        const double a = std::fabs(w[base + j]);
        if (!(a > 1e-300) || a < THRESHOLD * colMax[j]) continue;
        const double cost = static_cast<double>(rowCount[i] - 1) * (colCount[j] - 1);
        const double rel = a / colMax[j];
        if (cost < bestCost || (cost == bestCost && rel > bestRel)) {
          bestCost = cost; bestRel = rel; pr = i; pc = j;
        }
      }
    }
    if (pr < 0) return false;

    rowDone[pr] = 1;
    colDone[pc] = 1;
    const int piv = pr * n + pc;
    pivRef_[k] = std::fabs(w[piv]);
    rows.clear(); ucols.clear();
    for (int i = 0; i < n; i++) if (!rowDone[i] && nz[i * n + pc]) rows.push_back(i);
    for (int j = 0; j < n; j++) if (!colDone[j] && nz[pr * n + j]) ucols.push_back(j);

    // Factor program for this pivot: [pivot cell, row count, then per row:
    //   [L cell, count, then pairs (target cell, U cell)]]  meaning  target -= L * U
    f.push_back(piv);
    f.push_back(static_cast<int32_t>(rows.size()));
    fwd.push_back(pr);
    fwd.push_back(static_cast<int32_t>(rows.size()));
    for (int i : rows) {
      const int l = i * n + pc;
      w[l] /= w[piv];
      f.push_back(l);
      f.push_back(static_cast<int32_t>(ucols.size()));
      for (int j : ucols) {
        const int t = i * n + j;
        if (!nz[t]) { nz[t] = 1; rowCount[i]++; colCount[j]++; }
        w[t] -= w[l] * w[pr * n + j];
        f.push_back(t);
        f.push_back(pr * n + j);
      }
      fwd.push_back(i);
      fwd.push_back(l);
    }
    std::vector<int32_t> step = {pc, pr, piv, static_cast<int32_t>(ucols.size())};
    for (int j : ucols) { step.push_back(pr * n + j); step.push_back(j); }
    bwdSteps.push_back(std::move(step));

    for (int i : rows) rowCount[i]--;
    for (int j : ucols) colCount[j]--;
  }

  // Back substitution must run from the last pivot to the first, so reverse the steps.
  bwd_.clear();
  for (int k = static_cast<int>(bwdSteps.size()) - 1; k >= 0; k--)
    bwd_.insert(bwd_.end(), bwdSteps[k].begin(), bwdSteps[k].end());
  fprog_ = std::move(f);
  fwd_ = std::move(fwd);
  active_.clear();
  for (size_t i = 0; i < nn; i++) if (nz[i]) active_.push_back(static_cast<int32_t>(i));
  return true;
}

// Replay the recorded elimination on new numbers. Same structure every time, so this is a
// tight loop of loads, multiplies and subtracts with no decisions about the matrix shape.
// Returns false if a pivot became (nearly) zero with the new numbers; the caller then runs
// analyze() again to pick a different, safe pivot order.
bool SparseLU::factor(std::vector<double>& A) const {
  const int32_t* f = fprog_.data();
  double* a = A.data();
  size_t p = 0;
  for (int k = 0; k < n_; k++) {
    const double piv = a[f[p++]];
    const double ap = piv < 0 ? -piv : piv;
    if (!(ap > 1e-300) || ap < PIVOT_REL_MIN * pivRef_[k]) return false;
    const double inv = 1 / piv;
    const int nr = f[p++];
    for (int r = 0; r < nr; r++) {
      const int l = f[p++];
      const double lv = (a[l] *= inv);
      const int nu = f[p++];
      for (int u = 0; u < nu; u++) {
        const int t = f[p++];
        a[t] -= lv * a[f[p++]];
      }
    }
  }
  return true;
}

// With A factored into L and U:  L y = b  (forward, top to bottom), then  U x = y  (back,
// bottom to top). Each is one pass over the recorded program.
void SparseLU::solve(const std::vector<double>& A, std::vector<double>& bv, std::vector<double>& xv) const {
  const int32_t* fw = fwd_.data();
  const int32_t* bw = bwd_.data();
  const double* a = A.data();
  double* b = bv.data();
  double* x = xv.data();
  size_t p = 0;
  for (int k = 0; k < n_; k++) {  // forward substitution (L)
    const double bp = b[fw[p++]];
    const int nr = fw[p++];
    for (int r = 0; r < nr; r++) {
      const int i = fw[p++];
      b[i] -= a[fw[p++]] * bp;
    }
  }
  p = 0;
  for (int k = 0; k < n_; k++) {  // back substitution (U)
    const int pc = bw[p++];
    double s = b[bw[p++]];
    const int piv = bw[p++];
    const int nu = bw[p++];
    for (int u = 0; u < nu; u++) {
      const double av = a[bw[p++]];
      s -= av * x[bw[p++]];
    }
    x[pc] = s / a[piv];
  }
}

}  // namespace ps
