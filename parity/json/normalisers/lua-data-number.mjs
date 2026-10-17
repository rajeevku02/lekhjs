// Normaliser `lua-data-number` (verification 02 §A.5 step 9, DR-GEN-13): in a generator template's
// `data`, two strings that both parse as finite numbers compare with the numeric rule (Lua's
// `%.14g` text vs JS shortest round trip, float32-widened sizes). Since task B4 the ports write Lua's
// `%.14g` text themselves (DR-GEN-13 withdrawn) and the T6 fixtures pass without this rule; it is
// kept for the corpus runs, where stored data was written from float32-widened inputs and by older
// script versions.
//
// The scripts also write numbers inside expressions (`"-28.680000305176+14.340000152588"` against
// the port's `"-28.68000030517578+14.34000015258789"`, `"-80.5+69.0"` against `"-80.5+69"`), so two
// expression strings compare token by token (G3): the same operators, names and punctuation in the
// same order (whitespace ignored), and each pair of number literals within the numeric rule. A sign
// at the start, or after an operator, `(` or `,`, belongs to its literal (Lua's `-0.0` is the port's
// `0`). This is stricter than evaluating both on a grid (spec 04 §5.5): a rewritten but equivalent
// expression still differs.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { withinTolerance, relativeDeviation } = /** @type {typeof import('../tolerance.cjs')} */ (
  require('../tolerance.cjs')
);

export const name = 'lua-data-number';

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/;

/**
 * The tokens of a data string: numbers as `{ n }`, everything else (names, operators,
 * punctuation) as single-character strings; whitespace is dropped. `null` for a literal that is
 * not finite.
 * @param {string} s
 * @returns {(string | { n: number })[] | null}
 */
function tokens(s) {
  /** @type {(string | { n: number })[]} */
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s.charAt(i);
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const prev = out.length > 0 ? out[out.length - 1] : null;
    const prevChar = i > 0 ? s.charAt(i - 1) : '';
    // A literal starts on a digit or `.`, not inside a name (`d2`), or on a sign where a value may
    // begin (start, after an operator, `(` or `,`).
    const inName = /[A-Za-z_\d.]/.test(prevChar) && typeof prev === 'string' && /[A-Za-z_]/.test(prev);
    const signAllowed = prev === null || (typeof prev === 'string' && /[-+*/(,]/.test(prev));
    const m = NUMBER.exec(s.slice(i));
    if (m !== null && !inName && (/[\d.]/.test(c) || signAllowed)) {
      const v = Number(m[0]);
      if (!Number.isFinite(v)) return null;
      out.push({ n: v });
      i += m[0].length;
      continue;
    }
    out.push(c);
    i++;
  }
  return out;
}

/**
 * `true` when both strings are numbers (or expressions of the same shape) equal within the
 * tolerance, `false` when they differ, `null` when neither rule applies (compare as strings).
 * @param {string} a
 * @param {string} b
 */
export function equal(a, b) {
  const x = tokens(a);
  const y = tokens(b);
  if (x === null || y === null) return null;
  if (!x.some((t) => typeof t !== 'string') && !y.some((t) => typeof t !== 'string')) return null;
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) {
    const p = x[i];
    const q = y[i];
    if (p === undefined || q === undefined) return false;
    if (typeof p === 'string' || typeof q === 'string') {
      if (p !== q) return false;
    } else if (!withinTolerance(p.n, q.n)) return false;
  }
  return true;
}

/**
 * The largest relative deviation between the number literals of two strings that `equal` accepts
 * (for the drift report).
 * @param {string} a
 * @param {string} b
 */
export function deviation(a, b) {
  const x = tokens(a) ?? [];
  const y = tokens(b) ?? [];
  let d = 0;
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const p = x[i];
    const q = y[i];
    if (typeof p !== 'string' && typeof q !== 'string' && p !== undefined && q !== undefined)
      d = Math.max(d, relativeDeviation(p.n, q.n));
  }
  return d;
}
