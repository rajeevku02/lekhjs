// Register rules (verification 02 §A.5 step 11, verification 01 §9.2): the structured items of each
// active entry's `rule.json`, applied last, in file order, first match wins per diff path. Plain
// string items are descriptive (they name what an entry explains) and are not applied. Each
// application counts for the entry.
import { createRequire } from 'node:module';
import { at } from './diff.mjs';
import { LNum, isObj } from './lenient-parse.mjs';
import { NORMALISERS } from './normalisers/index.mjs';

const require = createRequire(import.meta.url);
const { withinTolerance } = /** @type {typeof import('./tolerance.cjs')} */ (require('./tolerance.cjs'));

/** @typedef {import('./lenient-parse.mjs').LValue} LValue */

/**
 * @typedef {object} CompiledRule
 * @property {string} id
 * @property {string[]} pattern
 * @property {'ignore' | 'tolerance' | 'normalise'} op
 * @property {Record<string, unknown[]>} when
 * @property {((a: any, b: any, input?: any, rest?: string[]) => boolean | null) | null} equal
 * @property {number | undefined} abs
 * @property {number | undefined} rel
 */

/**
 * @typedef {object} CompiledRegister
 * @property {CompiledRule[]} json
 * @property {{ id: string, re: RegExp }[]} cppFail
 * @property {string[]} errors   rules that could not be compiled (register:check reports them)
 */

/**
 * @param {import('../register/load.mjs').RegisterEntry[]} entries  active entries, in file order
 * @returns {CompiledRegister}
 */
export function compileRules(entries) {
  /** @type {CompiledRegister} */
  const out = { json: [], cppFail: [], errors: [] };
  for (const e of entries) {
    const id = String(e.data['id']);
    const rule = e.data['rule'];
    if (!rule || typeof rule !== 'object') continue;
    for (const item of Array.isArray(rule.json) ? rule.json : []) {
      if (typeof item === 'string') continue;
      if (!item || typeof item.path !== 'string' || !item.path.startsWith('/')) {
        out.errors.push(`${id}: a rule.json item needs a path starting with /`);
        continue;
      }
      /** @type {((a: any, b: any, input?: any, rest?: string[]) => boolean | null) | null} */
      let equal = null;
      if (item.op === 'normalise') {
        const n = NORMALISERS[item.normaliser];
        if (n === undefined) {
          out.errors.push(`${id}: unknown normaliser ${JSON.stringify(item.normaliser)}`);
          continue;
        }
        equal = n.equal ?? null;
        if (equal === null) continue; // a canonicalisation step: always applied already
      }
      out.json.push({
        id,
        pattern: item.path.split('/').slice(1),
        op: item.op,
        when: item.when ?? {},
        equal,
        abs: item.abs,
        rel: item.rel,
      });
    }
    if (rule.cpp_fail && typeof rule.cpp_fail.input_matches === 'string') {
      try {
        out.cppFail.push({ id, re: new RegExp(rule.cpp_fail.input_matches) });
      } catch (err) {
        out.errors.push(`${id}: rule.cpp_fail.input_matches is not a regular expression: ${String(err)}`);
      }
    }
  }
  return out;
}

/**
 * Matches `pattern` against a prefix of `path`; returns the prefix length, or -1.
 * `*` is one segment (an array index `[i]` included), `**` any number of segments.
 * @param {string[]} pattern
 * @param {string[]} path
 * @returns {number}
 */
export function matchPrefix(pattern, path) {
  /** @param {number} pi @param {number} si @returns {number} */
  const go = (pi, si) => {
    if (pi === pattern.length) return si;
    const p = pattern[pi];
    if (p === '**') {
      for (let k = path.length; k >= si; k--) {
        const r = go(pi + 1, k);
        if (r >= 0) return r;
      }
      return -1;
    }
    if (si >= path.length) return -1;
    const seg = path[si] ?? '';
    const lit = (p ?? '').replace(/~1/g, '/').replace(/~0/g, '~');
    if (p === '*' || lit === seg || `[${lit}]` === seg) return go(pi + 1, si + 1);
    return -1;
  };
  return go(0, 0);
}

/**
 * @param {Record<string, unknown[]>} when
 * @param {LValue | undefined} cppAt
 * @param {LValue | undefined} tsAt
 */
function whenHolds(when, cppAt, tsAt) {
  for (const [k, list] of Object.entries(when)) {
    const m = /^(cpp|ts)_([a-z_]+)_in$/.exec(k);
    if (m === null) return false;
    const subject = m[1] === 'cpp' ? cppAt : tsAt;
    if (!isObj(subject ?? null)) return false;
    const v = /** @type {Record<string, LValue>} */ (subject)[m[2] ?? ''];
    const plainV = v instanceof LNum ? v.value : v;
    if (!list.includes(plainV)) return false;
  }
  return true;
}

/**
 * Applies the rules to one board's diffs. Returns the unexplained diffs and the ids applied.
 * @param {CompiledRegister} reg
 * @param {import('./diff.mjs').DiffEntry[]} diffs
 * @param {LValue} cpp
 * @param {LValue} ts
 * @param {LValue} [input]  the parsed input board (normalisers may compare against what was stored)
 */
export function applyRules(reg, diffs, cpp, ts, input) {
  /** @type {import('./diff.mjs').DiffEntry[]} */
  const unexplained = [];
  /** @type {Map<string, number>} */
  const applied = new Map();
  for (const d of diffs) {
    let explained = false;
    for (const r of reg.json) {
      const n = matchPrefix(r.pattern, d.path);
      if (n < 0) continue;
      const prefix = d.path.slice(0, n);
      const cAt = at(cpp, prefix);
      const tAt = at(ts, prefix);
      if (!whenHolds(r.when, cAt, tAt)) continue;
      // First match wins: this rule decides the path, whether or not it explains it, unless its
      // normaliser says it does not apply here (null): then the next rule is tried.
      if (r.op === 'ignore') explained = true;
      else if (r.op === 'tolerance') {
        const a = at(cpp, d.path);
        const b = at(ts, d.path);
        explained = a instanceof LNum && b instanceof LNum && withinTolerance(a.value, b.value, r.abs ?? 0, r.rel ?? 0);
      } else if (r.equal !== null) {
        const verdict = r.equal(cAt, tAt, input === undefined ? undefined : at(input, prefix), d.path.slice(n));
        if (verdict === null) continue;
        explained = verdict === true;
      }
      if (explained) applied.set(r.id, (applied.get(r.id) ?? 0) + 1);
      break;
    }
    if (!explained) unexplained.push(d);
  }
  return { unexplained, applied };
}

/**
 * The register entry a `cpp_fail` is tied to: an entry's `rule.cpp_fail`, else the built-in
 * attribution of verification 02 §A.7 item 2 (a `\u` escape in the input → DR-ENG-01).
 * @param {CompiledRegister} reg
 * @param {string} inputText
 * @param {Set<string>} filed  the ids that exist in the register
 */
export function cppFailEntry(reg, inputText, filed) {
  for (const r of reg.cppFail) if (r.re.test(inputText)) return r.id;
  if (filed.has('DR-ENG-01') && /\\u[0-9a-fA-F]{4}/.test(inputText)) return 'DR-ENG-01';
  return null;
}
