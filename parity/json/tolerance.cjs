'use strict';

// The numeric rule of the JSON comparison (verification 02 §A.5 step 8), shared with the kashi core
// tier on lekhjs (verification 01 §2.3: `require('<lekhjs>/parity/json/tolerance.cjs')` by relative
// path until cutover). CommonJS so kashi's Jest suites can require it as is.
//
//   equal  iff  |a − b| ≤ max(ABS, REL · max(|a|, |b|))
//
// ABS = 1e-6 and REL = 5e-6: half a unit in the 6th significant digit, plus the float32 rounding of
// the C++ writer. Integer-typed members and colours never use it (they compare exactly).

const ABS = 1e-6;
const REL = 5e-6;

/**
 * The allowed deviation between `a` and `b`.
 * @param {number} a @param {number} b @param {number} [abs] @param {number} [rel]
 */
function allowance(a, b, abs = ABS, rel = REL) {
  return Math.max(abs, rel * Math.max(Math.abs(a), Math.abs(b)));
}

/**
 * Whether two numbers are equal within the tolerance. NaN equals NaN (both writers print `nan`
 * for it), and infinities equal only themselves.
 * @param {number} a @param {number} b @param {number} [abs] @param {number} [rel]
 */
function withinTolerance(a, b, abs = ABS, rel = REL) {
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) && Number.isNaN(b);
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= allowance(a, b, abs, rel);
}

/**
 * The relative deviation `|a − b| / max(|a|, |b|)` (0 when equal), for the drift report.
 * @param {number} a @param {number} b
 */
function relativeDeviation(a, b) {
  if (a === b) return 0;
  const m = Math.max(Math.abs(a), Math.abs(b));
  return m === 0 ? 0 : Math.abs(a - b) / m;
}

/**
 * A colour as the signed 32-bit integer both engines mean (DR-ENG-04 exempts colours).
 * @param {number} x
 */
function colour(x) {
  return x | 0;
}

module.exports = { ABS, REL, allowance, withinTolerance, relativeDeviation, colour };
