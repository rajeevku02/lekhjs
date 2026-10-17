// Normaliser `six-digit-data` (DR-ENG-26). Both engines print the numbers of generated data
// expressions with six significant digits, C++ from a float32 value and lekhjs from a double, so
// the two texts can differ by one unit in the sixth digit (`0.144286` against `0.144285`), which is
// up to 1e-5 relative: more than the half unit the numeric rule allows. At a template path, for a
// `data/[i]` string: true when the two strings have the same tokens (operators, names,
// punctuation) and each pair of number literals differs by at most one unit in the sixth
// significant digit; null otherwise.
import { tokens } from './lua-data-number.mjs';
import { obj } from './util.mjs';

export const name = 'six-digit-data';

/** One unit in the sixth significant digit of the larger magnitude (1e-6 at least). */
/** @param {number} a @param {number} b */
function unit6(a, b) {
  const m = Math.max(Math.abs(a), Math.abs(b));
  if (m === 0) return 1e-6;
  return Math.max(1e-6, 10 ** (Math.floor(Math.log10(m)) - 5));
}

/** @param {any} t @param {string[]} rest */
function dataString(t, rest) {
  const data = obj(t)?.['data'];
  const m = /^\[(\d+)\]$/.exec(rest[1] ?? '');
  if (!Array.isArray(data) || m === null) return null;
  const s = data[Number(m[1])];
  return typeof s === 'string' ? s : null;
}

/** @param {any} cpp @param {any} ts @param {any} _input @param {string[]} [rest] */
export function equal(cpp, ts, _input, rest = []) {
  if (rest.length !== 2 || rest[0] !== 'data') return null;
  const a = dataString(cpp, rest);
  const b = dataString(ts, rest);
  if (a === null || b === null) return null;
  const x = tokens(a);
  const y = tokens(b);
  if (x === null || y === null || x.length !== y.length) return null;
  for (let i = 0; i < x.length; i++) {
    const p = x[i];
    const q = y[i];
    if (p === undefined || q === undefined) return null;
    if (typeof p === 'string' || typeof q === 'string') {
      if (p !== q) return null;
    } else if (Math.abs(p.n - q.n) > unit6(p.n, q.n) * 1.0001) return null;
  }
  return true;
}
