// Helpers shared by the normalisers that compare whole subtrees (`equal(cpp, ts, input)`).
import { createRequire } from 'node:module';
import { LNum, isObj } from '../lenient-parse.mjs';

const require = createRequire(import.meta.url);
const { withinTolerance } = /** @type {typeof import('../tolerance.cjs')} */ (require('../tolerance.cjs'));

/** @typedef {import('../lenient-parse.mjs').LValue} LValue */
/** @typedef {{ [k: string]: LValue }} LObj */

/** The number a value holds, or null. @param {LValue | undefined} v */
export function num(v) {
  return v instanceof LNum ? v.value : null;
}

/** @param {LValue | undefined} v @returns {LObj | null} */
export function obj(v) {
  return v !== undefined && isObj(v) ? /** @type {LObj} */ (v) : null;
}

/**
 * Deep equality with the numeric rule of verification 02 §A.5 step 8 (colours as signed 32-bit);
 * `skip` names member paths (`a/b`) left out of the comparison.
 * @param {LValue | undefined} a
 * @param {LValue | undefined} b
 * @param {ReadonlySet<string>} [skip]
 * @param {string} [at]
 * @returns {boolean}
 */
export function sameValue(a, b, skip = new Set(), at = '') {
  if (a instanceof LNum || b instanceof LNum) {
    if (!(a instanceof LNum && b instanceof LNum)) return false;
    if (/colou?r$/i.test(at)) return (a.value | 0) === (b.value | 0);
    return withinTolerance(a.value, b.value);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => sameValue(x, b[i], skip, at));
  }
  const ao = obj(a);
  const bo = obj(b);
  if (ao !== null || bo !== null) {
    if (ao === null || bo === null) return false;
    for (const k of new Set([...Object.keys(ao), ...Object.keys(bo)])) {
      const p = at === '' ? k : `${at}/${k}`;
      if (skip.has(p)) continue;
      if (!sameValue(ao[k], bo[k], skip, k === 'color' ? 'color' : p)) return false;
    }
    return true;
  }
  return a === b;
}

/**
 * A copy of a template with `generator.script` and `generator.scriptfile` removed, as the
 * `generator-script` step does to both outputs (the input is never canonicalised).
 * @param {LValue | undefined} t
 * @returns {LValue | undefined}
 */
export function withoutScript(t) {
  const o = obj(t);
  if (o === null) return t;
  const g = obj(o['generator']);
  if (g === null) return t;
  const rest = { ...g };
  delete rest['script'];
  delete rest['scriptfile'];
  return { ...o, generator: rest };
}
