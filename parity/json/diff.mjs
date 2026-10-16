// The deep diff of two canonical documents (verification 02 §A.5 steps 5, 8–10), with generalised
// paths for the reports: a key under `pages`, `objects`, `templates` or `arrows`, any id-like key,
// and every array index become `*`, so a path names a kind of member and never a board's ids.
import { createRequire } from 'node:module';
import { LNum, isObj } from './lenient-parse.mjs';
import * as luaDataNumber from './normalisers/lua-data-number.mjs';

const require = createRequire(import.meta.url);
const { withinTolerance, relativeDeviation, colour } = /** @type {typeof import('./tolerance.cjs')} */ (
  require('./tolerance.cjs')
);

/** @typedef {import('./lenient-parse.mjs').LValue} LValue */

/** Integer-typed members: exact, and integer tokens in the TS output (step 8). */
const INT_KEYS = new Set(['type', 'order', 'ctype', 'index', 'flags']);
const COLOUR_KEY = /colou?r$/i;
const MAP_PARENTS = new Set(['pages', 'objects', 'templates', 'arrows']);
const ID_LIKE =
  /^(?:#[\d/]+|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[1-9A-HJ-NP-Za-km-z]{22})$/;

/**
 * @typedef {object} DiffEntry
 * @property {string[]} path      concrete segments (for rule matching; never reported for corpus runs)
 * @property {string} gpath       generalised JSON pointer
 * @property {'missing_ts' | 'extra_ts' | 'type' | 'value' | 'number' | 'int_token' | 'length'} kind
 */

/**
 * @typedef {object} DiffResult
 * @property {DiffEntry[]} diffs
 * @property {Map<string, number>} tolerance  gpath → the largest relative deviation accepted within tolerance
 */

/** @param {string[]} path */
export function generalise(path) {
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < path.length; i++) {
    const seg = path[i] ?? '';
    const parent = i > 0 ? (path[i - 1] ?? '') : '';
    if (/^\[\d+\]$/.test(seg)) out.push('*');
    else if (MAP_PARENTS.has(parent) || ID_LIKE.test(seg)) out.push('*');
    else out.push(seg.replace(/~/g, '~0').replace(/\//g, '~1'));
  }
  return '/' + out.join('/');
}

/** @param {LValue} v */
function kindOf(v) {
  if (v === null) return 'null';
  if (v instanceof LNum) return 'number';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/**
 * @param {LValue} cpp
 * @param {LValue} ts
 * @returns {DiffResult}
 */
export function diff(cpp, ts) {
  /** @type {DiffEntry[]} */
  const diffs = [];
  /** @type {Map<string, number>} */
  const tolerance = new Map();

  /** @param {string[]} path @param {DiffEntry['kind']} kind */
  const push = (path, kind) => diffs.push({ path: path.slice(), gpath: generalise(path), kind });

  /**
   * @param {LValue} a
   * @param {LValue} b
   * @param {string[]} path
   * @param {{ inGeneratorData: boolean }} ctx
   */
  const walk = (a, b, path, ctx) => {
    const key = path.length > 0 ? (path[path.length - 1] ?? '') : '';
    const ka = kindOf(a);
    const kb = kindOf(b);
    if (ka !== kb) {
      push(path, 'type');
      return;
    }
    if (a instanceof LNum && b instanceof LNum) {
      if (INT_KEYS.has(key) || COLOUR_KEY.test(key)) {
        const x = COLOUR_KEY.test(key) ? colour(a.value) : a.value;
        const y = COLOUR_KEY.test(key) ? colour(b.value) : b.value;
        if (x !== y) push(path, 'value');
        else if (!b.isInt) push(path, 'int_token');
        return;
      }
      if (a.value === b.value || (Number.isNaN(a.value) && Number.isNaN(b.value))) return;
      if (withinTolerance(a.value, b.value)) {
        const g = generalise(path);
        tolerance.set(g, Math.max(tolerance.get(g) ?? 0, relativeDeviation(a.value, b.value)));
        return;
      }
      push(path, 'number');
      return;
    }
    if (typeof a === 'string' && typeof b === 'string') {
      if (a === b) return;
      if (ctx.inGeneratorData) {
        const eq = luaDataNumber.equal(a, b);
        if (eq === true) {
          const g = generalise(path);
          tolerance.set(g, Math.max(tolerance.get(g) ?? 0, relativeDeviation(Number(a), Number(b))));
          return;
        }
      }
      push(path, 'value');
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) push(path, 'length');
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i++) walk(a[i] ?? null, b[i] ?? null, [...path, `[${i}]`], ctx);
      return;
    }
    if (isObj(a) && isObj(b)) {
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
      const isTemplate = isObj(a['generator'] ?? null) || isObj(b['generator'] ?? null);
      for (const k of keys) {
        const p = [...path, k];
        if (!(k in b)) push(p, 'missing_ts');
        else if (!(k in a)) push(p, 'extra_ts');
        else
          walk(/** @type {LValue} */ (a[k]), /** @type {LValue} */ (b[k]), p, {
            inGeneratorData: ctx.inGeneratorData || (isTemplate && k === 'data'),
          });
      }
      return;
    }
    if (a !== b) push(path, 'value');
  };

  walk(cpp, ts, [], { inGeneratorData: false });
  return { diffs, tolerance };
}

/**
 * The value at `path` (concrete segments as `diff` makes them), or undefined.
 * @param {LValue} tree
 * @param {string[]} path
 * @returns {LValue | undefined}
 */
export function at(tree, path) {
  /** @type {LValue | undefined} */
  let v = tree;
  for (const seg of path) {
    if (v === undefined || v === null || v instanceof LNum || typeof v !== 'object') return undefined;
    if (Array.isArray(v)) {
      const m = /^\[(\d+)\]$/.exec(seg);
      v = m === null ? undefined : v[Number(m[1])];
    } else v = v[seg];
  }
  return v;
}
