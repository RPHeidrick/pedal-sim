/**
 * Stamping helper for three-terminal devices (BJT, JFET, MOSFET) whose
 * terminal currents depend on two control voltages that share a common
 * terminal:  v1 = pol*(V(t2) - V(t3))   v2 = pol*(V(t2) - V(t1))
 *
 * For a BJT t1=C, t2=B, t3=E so v1 = Vbe, v2 = Vbc.
 * For FETs  t1=D, t2=G, t3=S so v1 = Vgs, v2 = Vgd.
 *
 * Given currents i1 (into t1) and i2 (into t2) in the device's own polarity
 * and their partials, the third current is i3 = -(i1 + i2). The linearised
 * physical stamp is identical for N and P types except for the RHS sign.
 */

/** Positions: 9 entries, rows t1,t2,t3 x cols t1,t2,t3. */
export function positions3(ctx, t1, t2, t3) {
  const r = [t1, t2, t3];
  const p = new Int32Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) p[i * 3 + j] = ctx.pos(r[i], r[j]);
  return p;
}

/**
 * @param {Float64Array} A
 * @param {Float64Array} b
 * @param {Int32Array} P from positions3
 * @param {Int32Array} R rhs indices [t1,t2,t3]
 * @param {number} pol +1 N-type, -1 P-type
 * @param {number} i1 current into t1 (device polarity)
 * @param {number} i2 current into t2
 * @param {number} g11 d i1/d v1   @param {number} g12 d i1/d v2
 * @param {number} g21 d i2/d v1   @param {number} g22 d i2/d v2
 * @param {number} v1 @param {number} v2 control voltages the currents were evaluated at
 */
export function stamp3(A, b, P, R, pol, i1, i2, g11, g12, g21, g22, v1, v2) {
  const g31 = -(g11 + g21);
  const g32 = -(g12 + g22);
  // row t1
  A[P[0]] -= g12; A[P[1]] += g11 + g12; A[P[2]] -= g11;
  // row t2
  A[P[3]] -= g22; A[P[4]] += g21 + g22; A[P[5]] -= g21;
  // row t3
  A[P[6]] -= g32; A[P[7]] += g31 + g32; A[P[8]] -= g31;
  const e1 = pol * (i1 - g11 * v1 - g12 * v2);
  const e2 = pol * (i2 - g21 * v1 - g22 * v2);
  b[R[0]] -= e1;
  b[R[1]] -= e2;
  b[R[2]] += e1 + e2;
}
