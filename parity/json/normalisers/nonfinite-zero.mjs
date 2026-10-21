// Normaliser `nonfinite-zero` (DR-ENG-06). C++ wrote a non-finite number as `nan` / `inf` (not
// JSON); lekhjs writes 0 (and logs nonfinite_write). At a leaf (rule path `/**`): true when C++
// wrote a non-finite number there and TS wrote 0; null otherwise.
import { LNum } from '../lenient-parse.mjs';

export const name = 'nonfinite-zero';

/** @param {any} cpp @param {any} ts @param {any} _input @param {string[]} [rest] */
export function equal(cpp, ts, _input, rest = []) {
  if (rest.length !== 0 || !(cpp instanceof LNum) || Number.isFinite(cpp.value)) return null;
  return ts instanceof LNum && ts.value === 0 ? true : null;
}
