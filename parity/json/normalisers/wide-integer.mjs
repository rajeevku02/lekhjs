// Normaliser `wide-integer` (DR-ENG-04). C++ parsed integer members with atoi/int and kept their
// low 32 bits (B13: an order of 2^40 + 3 read as 3); lekhjs keeps the whole value. At a leaf
// (rule path `/**`): true when the input held an integer token outside the signed 32-bit range,
// TS wrote that value and C++ wrote its low 32 bits as a signed integer; null otherwise.
import { LNum } from '../lenient-parse.mjs';

export const name = 'wide-integer';

/** @param {any} cpp @param {any} ts @param {any} input @param {string[]} [rest] */
export function equal(cpp, ts, input, rest = []) {
  if (rest.length !== 0 || !(input instanceof LNum) || !input.isInt) return null;
  const v = input.value;
  if (!Number.isSafeInteger(v) || (v >= -(2 ** 31) && v < 2 ** 31)) return null;
  const low = Number(BigInt.asIntN(32, BigInt(v)));
  return ts instanceof LNum && ts.value === v && cpp instanceof LNum && cpp.value === low ? true : null;
}
