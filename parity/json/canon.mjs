// Canonicalisation, applied to both sides in the order of verification 02 §A.5. Steps 1 (parse),
// 2 (generator script), 3 (info.version), 4 (root style), 6 (ids) and 7 (sets) are here; 5 (key
// order) is the diff's sorted walk; 8–10 (numbers, generator data strings, decoded strings) are
// the diff's comparison rules; 11 (register rules) is `rules.mjs`.
import { LNum, isObj, lenientParse } from './lenient-parse.mjs';
import * as generatorScript from './normalisers/generator-script.mjs';
import * as infoVersion from './normalisers/info-version.mjs';
import * as rootStyle from './normalisers/root-style.mjs';

/** @typedef {import('./lenient-parse.mjs').LValue} LValue */
/** @typedef {{ [k: string]: LValue }} LObj */

/** Arrays compared as sets: `<parent key>.<key>` (step 7). */
const SET_MEMBERS = new Set(['generator.embedrefs', 'style.nonoverridables']);

/**
 * Whether the input board is array-form somewhere (no `pages`, top-level `objects`, or a page whose
 * `objects` is an array): both engines then mint ids on read (step 6).
 * @param {LValue} input
 */
export function isArrayForm(input) {
  if (!isObj(input)) return false;
  if (Array.isArray(input['objects'])) return true;
  const pages = input['pages'];
  if (pages === undefined) return true;
  if (Array.isArray(pages)) return true;
  if (isObj(pages)) for (const p of Object.values(pages)) if (isObj(p) && Array.isArray(p['objects'])) return true;
  return false;
}

/**
 * Renames the ids an engine minted (step 6): page keys to `#<pageOrder>`, object keys to
 * `#<pageOrder>/<n>`, by the order they appear in that engine's output, and every string equal to
 * a renamed id. Ids the input stores (any string the input text contains) are kept literally.
 * @param {LValue} tree
 * @param {string} inputText
 * @returns {number} how many ids were renamed
 */
export function renameMintedIds(tree, inputText) {
  if (!isObj(tree) || !isObj(tree['pages'])) return 0;
  /** @type {Map<string, string>} */
  const alias = new Map();
  const pages = /** @type {LObj} */ (tree['pages']);
  let pi = 0;
  for (const [pid, page] of Object.entries(pages)) {
    pi++;
    if (!inputText.includes(pid)) alias.set(pid, `#${pi}`);
    if (isObj(page) && isObj(page['objects'])) {
      let n = 0;
      for (const oid of Object.keys(/** @type {LObj} */ (page['objects']))) {
        n++;
        if (!inputText.includes(oid)) alias.set(oid, `#${pi}/${n}`);
      }
    }
  }
  if (alias.size === 0) return 0;
  /** @param {LValue} v @returns {LValue} */
  const re = (v) => {
    if (typeof v === 'string') return alias.get(v) ?? v;
    if (v instanceof LNum || v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(re);
    /** @type {LObj} */
    const o = Object.create(null);
    for (const [k, x] of Object.entries(v)) o[alias.get(k) ?? k] = re(x);
    return o;
  };
  const renamed = /** @type {LObj} */ (re(tree));
  for (const k of Object.keys(tree)) Reflect.deleteProperty(tree, k);
  Object.assign(tree, renamed);
  return alias.size;
}

/** @param {LValue} v */
function sortKey(v) {
  return JSON.stringify(v, (_k, x) => (x instanceof LNum ? x.value : x));
}

/**
 * Sorts the set-valued arrays (step 7) in place.
 * @param {LValue} v
 * @param {string} parentKey
 */
export function sortSets(v, parentKey = '') {
  if (v instanceof LNum || v === null || typeof v !== 'object') return;
  if (Array.isArray(v)) {
    for (const x of v) sortSets(x, parentKey);
    return;
  }
  for (const [k, x] of Object.entries(v)) {
    if (Array.isArray(x) && SET_MEMBERS.has(`${parentKey}.${k}`)) x.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));
    sortSets(x, k);
  }
}

/**
 * @typedef {object} CanonResult
 * @property {LValue} cpp
 * @property {LValue} ts
 * @property {{ cpp: string | undefined, ts: string | undefined, expected: string | undefined, ok: boolean }} stamp
 * @property {{ ok: number, bad: number, parts: string[] }} generatorParts
 * @property {boolean} rootStyleOk
 * @property {number} renamedIds
 * @property {number} duplicateKeys
 */

/**
 * Parses and canonicalises one board's two outputs.
 * @param {{ inputText: string, cppText: string, tsText: string, stamp: 'app' | 'backend' }} a
 * @returns {CanonResult}
 */
export function canonicalise({ inputText, cppText, tsText, stamp }) {
  const c = lenientParse(cppText);
  const t = lenientParse(tsText);
  /** @type {LValue | null} */
  let input = null;
  try {
    input = lenientParse(inputText).value;
  } catch {
    // XML or broken input: no array-form detection, no Lua scan
  }
  const cpp = c.value;
  const ts = t.value;

  // 2. generator script
  const gc = generatorScript.apply(cpp);
  const gt = generatorScript.apply(ts);
  // 3. info.version
  const cppVersion = infoVersion.apply(cpp);
  const tsVersion = infoVersion.apply(ts);
  const scripted = (input !== null && generatorScript.hasLua(input)) || gt.js > 0;
  const expected = infoVersion.expectedTsVersion(stamp, { cppVersion, generatorScripted: scripted });
  // 4. root style
  const rootStyleOk = rootStyle.check(rootStyle.apply(cpp), rootStyle.apply(ts));
  // 6. ids
  let renamedIds = 0;
  if (input !== null && isArrayForm(input)) {
    renamedIds += renameMintedIds(cpp, inputText);
    renamedIds += renameMintedIds(ts, inputText);
  }
  // 7. sets
  sortSets(cpp);
  sortSets(ts);

  return {
    cpp,
    ts,
    stamp: { cpp: cppVersion, ts: tsVersion, expected, ok: tsVersion === expected },
    generatorParts: {
      ok: gc.partsOk + gt.partsOk,
      bad: gc.partsBad + gt.partsBad,
      parts: [...new Set([...gc.badParts, ...gt.badParts])],
    },
    rootStyleOk,
    renamedIds,
    duplicateKeys: c.duplicateKeys + t.duplicateKeys,
  };
}
