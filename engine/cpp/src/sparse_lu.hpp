// ============================================================================
// sparse_lu: solves the circuit's system of equations  A x = b  very quickly.
// Port of engine/js/sparse-lu.js.
// ============================================================================
//
// Plain-language version:
//   Every time step, the circuit becomes a grid of numbers (matrix A) times the unknown
//   voltages (x) equals the known currents (b). "LU" is the schoolbook elimination you
//   would do by hand (subtract multiples of one row from the others), split into a
//   Lower and an Upper triangle so it can be reused.
//
//   "Sparse" means most of A is zero: a resistor only connects two nodes, so it only
//   touches four cells. Skipping the zeros is most of the speed.
//
//
//
// The matrix keeps the same sparsity pattern for the whole simulation, so
// analyze() picks a pivot order once and records the exact sequence of
// arithmetic as flat integer "programs". factor() and solve() replay them:
// no searching, no allocation, no branching on structure.
#pragma once
#include <cstdint>
#include <vector>

namespace ps {

class SparseLU {
 public:
  explicit SparseLU(int n = 0) : n_(n), pivRef_(n, 0.0) {}

  // Choose pivots and compile programs. A: representative values, pattern: structural nonzeros.
  bool analyze(const std::vector<double>& A, const std::vector<uint8_t>& pattern);
  // Numeric LU in place. false if a pivot collapsed (caller re-analyzes).
  bool factor(std::vector<double>& A) const;
  // Solve with a factored A. b is overwritten; x receives the solution.
  void solve(const std::vector<double>& A, std::vector<double>& b, std::vector<double>& x) const;

  const std::vector<int32_t>& active() const { return active_; }

 private:
  int n_;
  std::vector<int32_t> fprog_, fwd_, bwd_, active_;
  std::vector<double> pivRef_;
};

}  // namespace ps
