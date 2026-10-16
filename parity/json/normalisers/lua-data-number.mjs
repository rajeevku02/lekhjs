// Normaliser `lua-data-number` (verification 02 §A.5 step 9, DR-GEN-13): in a generator template's
// `data`, two strings that both parse as finite numbers compare with the numeric rule (Lua's
// `%.14g` text vs JS shortest round trip, float32-widened sizes).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { withinTolerance } = /** @type {typeof import('../tolerance.cjs')} */ (require('../tolerance.cjs'));

export const name = 'lua-data-number';

/** @param {string} s */
function finite(s) {
  if (!/^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/**
 * `true` when both strings are numbers equal within the tolerance, `false` when both are numbers
 * that differ, `null` when either is not a number (compare as strings).
 * @param {string} a
 * @param {string} b
 */
export function equal(a, b) {
  const x = finite(a);
  const y = finite(b);
  if (x === null || y === null) return null;
  return withinTolerance(x, y);
}
