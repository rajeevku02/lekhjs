// Normaliser `integer-with-fraction` (DR-ENG-03). C++ getField(int*) refused a FLOAT node, so an
// integer member the input wrote with a fraction part or an exponent (`2.0`, `31.0`) read as
// absent and C++ wrote its default; lekhjs reads any integer-valued number. At a leaf (rule path
// `/**`) named order, flags, index, row or col: true when the input literal there was not an
// integer token, its value is an integer and TS wrote that value; null otherwise.
import { LNum } from '../lenient-parse.mjs';

export const name = 'integer-with-fraction';

const MEMBERS = new Set(['order', 'flags', 'index', 'row', 'col']);

/** @param {any} cpp @param {any} ts @param {any} input @param {string[]} [rest] @param {string[]} [path] */
export function equal(cpp, ts, input, rest = [], path = []) {
  void cpp;
  if (rest.length !== 0 || !MEMBERS.has(path[path.length - 1] ?? '')) return null;
  if (!(input instanceof LNum) || input.isInt || !Number.isInteger(input.value)) return null;
  return ts instanceof LNum && ts.value === input.value ? true : null;
}
