// Normaliser `root-style` (verification 02 §A.5 step 4): the root `style` is the writer's current
// drawing tool, not document content, so it is excluded from the diff. Checked on its own: the TS
// root style may differ from the C++ one only by `fontfamily: "Noto Sans"` (DR-TXT-06).
import { LNum, isObj } from '../lenient-parse.mjs';

export const name = 'root-style';

/**
 * Removes the root `style` (in place) and returns it.
 * @param {import('../lenient-parse.mjs').LValue} tree
 */
export function apply(tree) {
  if (!isObj(tree)) return undefined;
  const s = tree['style'];
  delete tree['style'];
  return s;
}

/** @param {import('../lenient-parse.mjs').LValue | undefined} a @param {import('../lenient-parse.mjs').LValue | undefined} b @returns {boolean} */
function same(a, b) {
  if (a instanceof LNum || b instanceof LNum)
    return a instanceof LNum && b instanceof LNum && (a.value === b.value || (a.value | 0) === (b.value | 0));
  if (Array.isArray(a) || Array.isArray(b))
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (isObj(a ?? null) || isObj(b ?? null)) {
    if (!isObj(a ?? null) || !isObj(b ?? null)) return false;
    const ao = /** @type {{ [k: string]: import('../lenient-parse.mjs').LValue }} */ (a);
    const bo = /** @type {{ [k: string]: import('../lenient-parse.mjs').LValue }} */ (b);
    const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
    for (const k of keys) if (!same(ao[k], bo[k])) return false;
    return true;
  }
  return a === b;
}

/**
 * Whether the TS root style is the C++ one, with at most `fontfamily` set to "Noto Sans".
 * @param {import('../lenient-parse.mjs').LValue | undefined} cpp
 * @param {import('../lenient-parse.mjs').LValue | undefined} ts
 */
export function check(cpp, ts) {
  if (same(cpp, ts)) return true;
  if (!isObj(cpp ?? null) || !isObj(ts ?? null)) return false;
  const c = /** @type {{ [k: string]: import('../lenient-parse.mjs').LValue }} */ (cpp);
  const t = /** @type {{ [k: string]: import('../lenient-parse.mjs').LValue }} */ (ts);
  if (t['fontfamily'] !== 'Noto Sans') return false;
  return same({ ...c, fontfamily: 'Noto Sans' }, t);
}
