/**
 * Compiled sparse LU for MNA matrices.
 *
 * Circuit matrices keep the same sparsity pattern for the whole simulation;
 * only values change. analyze() picks a pivot order once (Markowitz ordering
 * with threshold partial pivoting on representative values), works out the
 * fill-in, and records the exact sequence of arithmetic as flat Int32Array
 * "programs". factor() and solve() then just replay those programs: no
 * allocation, no branching on structure, no searching. This is the classic
 * SPICE approach (reuse the ordering until a pivot goes bad) and maps 1:1 onto
 * a future WebAssembly implementation.
 *
 * Storage: the matrix is a dense row-major Float64Array of n*n (+1 trash slot
 * for ground stamps, which the LU never reads). Dense storage keeps indexing
 * trivial; the programs only touch structurally nonzero entries so the cost is
 * proportional to the fill-in, not n^3. Pedal circuits have n ~ 10-60.
 */

const THRESHOLD = 1e-3; // accept pivots >= THRESHOLD * column max (partial pivoting relaxation)
const PIVOT_REL_MIN = 1e-15; // factor() fails if a pivot shrinks below this fraction of its analysis value

export class SparseLU {
  /** @param {number} n matrix dimension */
  constructor(n) {
    this.n = n;
    this.fprog = new Int32Array(0);
    this.fwd = new Int32Array(0);
    this.bwd = new Int32Array(0);
    this.pivRef = new Float64Array(n);
    this.analyzed = false;
    this.fillCount = 0;
    this.opCount = 0;
  }

  /**
   * Choose pivots and compile programs.
   * @param {Float64Array} A representative numeric values (not modified)
   * @param {Uint8Array} pattern structural nonzeros (n*n), entries that may ever be nonzero
   * @returns {boolean} false if the matrix is singular
   */
  analyze(A, pattern) {
    const n = this.n;
    const w = Float64Array.from(A.subarray(0, n * n));
    const nz = Uint8Array.from(pattern.subarray(0, n * n));
    for (let i = 0; i < n * n; i++) if (w[i] !== 0) nz[i] = 1;
    const rowDone = new Uint8Array(n);
    const colDone = new Uint8Array(n);
    const rowCount = new Int32Array(n);
    const colCount = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) if (nz[i * n + j]) { rowCount[i]++; colCount[j]++; }
    }
    const colMax = new Float64Array(n);
    const f = [];
    const fwd = [];
    const bwdSteps = [];
    let fill = 0;
    let ops = 0;

    for (let k = 0; k < n; k++) {
      colMax.fill(0);
      for (let i = 0; i < n; i++) {
        if (rowDone[i]) continue;
        const base = i * n;
        for (let j = 0; j < n; j++) {
          if (colDone[j] || !nz[base + j]) continue;
          const a = Math.abs(w[base + j]);
          if (a > colMax[j]) colMax[j] = a;
        }
      }
      let pr = -1;
      let pc = -1;
      let bestCost = Infinity;
      let bestRel = 0;
      for (let i = 0; i < n; i++) {
        if (rowDone[i]) continue;
        const base = i * n;
        for (let j = 0; j < n; j++) {
          if (colDone[j] || !nz[base + j]) continue;
          const a = Math.abs(w[base + j]);
          if (!(a > 1e-300) || a < THRESHOLD * colMax[j]) continue;
          const cost = (rowCount[i] - 1) * (colCount[j] - 1);
          const rel = a / colMax[j];
          if (cost < bestCost || (cost === bestCost && rel > bestRel)) {
            bestCost = cost; bestRel = rel; pr = i; pc = j;
          }
        }
      }
      if (pr < 0) return (this.analyzed = false);

      rowDone[pr] = 1;
      colDone[pc] = 1;
      const piv = pr * n + pc;
      this.pivRef[k] = Math.abs(w[piv]);
      const rows = [];
      const ucols = [];
      for (let i = 0; i < n; i++) if (!rowDone[i] && nz[i * n + pc]) rows.push(i);
      for (let j = 0; j < n; j++) if (!colDone[j] && nz[pr * n + j]) ucols.push(j);

      f.push(piv, rows.length);
      const fwdRows = [];
      for (const i of rows) {
        const l = i * n + pc;
        w[l] /= w[piv];
        f.push(l, ucols.length);
        for (const j of ucols) {
          const t = i * n + j;
          if (!nz[t]) { nz[t] = 1; rowCount[i]++; colCount[j]++; fill++; }
          w[t] -= w[l] * w[pr * n + j];
          f.push(t, pr * n + j);
          ops++;
        }
        fwdRows.push(i, l);
      }
      fwd.push(pr, rows.length, ...fwdRows);
      const terms = [];
      for (const j of ucols) terms.push(pr * n + j, j);
      bwdSteps.push([pc, pr, piv, ucols.length, ...terms]);

      for (const i of rows) rowCount[i]--;
      for (const j of ucols) colCount[j]--;
    }

    const bwd = [];
    for (let k = bwdSteps.length - 1; k >= 0; k--) bwd.push(...bwdSteps[k]);
    this.fprog = Int32Array.from(f);
    this.fwd = Int32Array.from(fwd);
    this.bwd = Int32Array.from(bwd);
    const active = [];
    for (let i = 0; i < n * n; i++) if (nz[i]) active.push(i);
    /** positions read or written by the programs (pattern + fill) */
    this.active = Int32Array.from(active);
    this.fillCount = fill;
    this.opCount = ops;
    return (this.analyzed = true);
  }

  /**
   * In-place numeric LU using the compiled program.
   * @param {Float64Array} A
   * @returns {boolean} false if a pivot became unusable (caller should re-analyze)
   */
  factor(A) {
    const f = this.fprog;
    const ref = this.pivRef;
    const n = this.n;
    let p = 0;
    for (let k = 0; k < n; k++) {
      const piv = A[f[p++]];
      const a = piv < 0 ? -piv : piv;
      if (!(a > 1e-300) || a < PIVOT_REL_MIN * ref[k]) return false;
      const inv = 1 / piv;
      const nr = f[p++];
      for (let r = 0; r < nr; r++) {
        const l = f[p++];
        const lv = (A[l] *= inv);
        const nu = f[p++];
        for (let u = 0; u < nu; u++) {
          const t = f[p++];
          A[t] -= lv * A[f[p++]];
        }
      }
    }
    return true;
  }

  /**
   * Solve with a factored matrix. b is overwritten; x receives the solution
   * (x may be longer than n; extra entries are untouched).
   */
  solve(A, b, x) {
    const fw = this.fwd;
    const bw = this.bwd;
    const n = this.n;
    let p = 0;
    for (let k = 0; k < n; k++) {
      const bp = b[fw[p++]];
      const nr = fw[p++];
      for (let r = 0; r < nr; r++) {
        const i = fw[p++];
        b[i] -= A[fw[p++]] * bp;
      }
    }
    p = 0;
    for (let k = 0; k < n; k++) {
      const pc = bw[p++];
      let s = b[bw[p++]];
      const piv = bw[p++];
      const nu = bw[p++];
      for (let u = 0; u < nu; u++) {
        const a = A[bw[p++]];
        s -= a * x[bw[p++]];
      }
      x[pc] = s / A[piv];
    }
  }
}
