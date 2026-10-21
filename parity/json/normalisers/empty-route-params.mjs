// Normaliser `empty-route-params` (DR-ENG-20). An orthogonal (multi-line, ctype 2) connector the
// input stores with no segments: C++ LineConnection::getParams read origLines_[0] of the empty
// vector (B18b) and wrote whatever was there as one segment; lekhjs writes []. At an object path,
// for its `params` only: true when the input object is such a connector with `params: []` and TS
// wrote `params: []`; null for any other object or member.
import { num, obj } from './util.mjs';

export const name = 'empty-route-params';

/** @param {any} cpp @param {any} ts @param {any} input @param {string[]} [rest] */
export function equal(cpp, ts, input, rest = []) {
  void cpp;
  if (rest[0] !== 'params') return null;
  const i = obj(input);
  const t = obj(ts);
  if (i === null || t === null || num(i['ctype']) !== 2 || num(t['ctype']) !== 2) return null;
  const ip = i['params'];
  const tp = t['params'];
  return Array.isArray(ip) && ip.length === 0 && Array.isArray(tp) && tp.length === 0 ? true : null;
}
