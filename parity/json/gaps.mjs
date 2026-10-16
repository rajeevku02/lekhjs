// Owned gaps (`parity/gaps.json`): differences that are neither a bug nor a register entry but
// work a later task of the Work owns, typically a generator lekhjs does not port yet, so the
// template stays a placeholder (spec 04 §7.4) while C++ runs it. An unexplained diff is
// attributed to a gap when it lies under an object whose template id matches one of the gap's
// `template_ids` or whose native generator `shape` matches its `native_shapes`, or under a root
// `templates/<key>` matching its `root_templates` (globs, `*` = any run of characters). A board whose every unexplained diff is attributed has status `gap`
// (the owner is recorded); it does not fail the merge gate, and a run with `noGaps` (phase exit)
// counts it as `differ`. The owning task deletes its entry when it lands.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { at } from './diff.mjs';
import { isObj } from './lenient-parse.mjs';

const GAPS_FILE = path.resolve(import.meta.dirname, '..', 'gaps.json');

/**
 * @typedef {object} Gap
 * @property {string} owner           the task that closes it (e.g. "G2")
 * @property {string} reason
 * @property {RegExp[]} templateIds
 * @property {RegExp[]} nativeShapes   `generator.shape` of a native generator template
 * @property {RegExp[]} rootTemplates
 */

/** @param {string} glob */
function globRe(glob) {
  return new RegExp('^' + glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
}

/** @param {string} [file] @returns {Gap[]} */
export function loadGaps(file = GAPS_FILE) {
  if (!existsSync(file)) return [];
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  return (Array.isArray(raw.gaps) ? raw.gaps : []).map((/** @type {any} */ g) => ({
    owner: String(g.owner),
    reason: String(g.reason ?? ''),
    templateIds: (g.template_ids ?? []).map(globRe),
    nativeShapes: (g.native_shapes ?? []).map(globRe),
    rootTemplates: (g.root_templates ?? []).map(globRe),
  }));
}

/**
 * The template (id, native generator shape) of the deepest object on `p`, in either tree, or null.
 * @param {import('./lenient-parse.mjs').LValue} cpp
 * @param {import('./lenient-parse.mjs').LValue} ts
 * @param {string[]} p
 * @returns {{ id: string, shape: string | null } | null}
 */
function templateOn(cpp, ts, p) {
  for (let n = p.length; n > 0; n--) {
    for (const tree of [cpp, ts]) {
      const node = at(tree, p.slice(0, n));
      if (!isObj(node ?? null)) continue;
      const o = /** @type {Record<string, any>} */ (node);
      const t = isObj(o['template'] ?? null) ? o['template'] : p[n - 1] === 'template' ? o : null;
      if (t === null || typeof t['id'] !== 'string') continue;
      const g = t['generator'];
      return { id: t['id'], shape: isObj(g ?? null) && typeof g['shape'] === 'string' ? g['shape'] : null };
    }
  }
  return null;
}

/**
 * Splits `diffs` into those an owned gap explains (counted per owner) and the rest.
 * @param {Gap[]} gaps
 * @param {import('./diff.mjs').DiffEntry[]} diffs
 * @param {import('./lenient-parse.mjs').LValue} cpp
 * @param {import('./lenient-parse.mjs').LValue} ts
 */
export function attributeGaps(gaps, diffs, cpp, ts) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  if (gaps.length === 0) return { unexplained: diffs, gaps: counts };
  /** @type {import('./diff.mjs').DiffEntry[]} */
  const unexplained = [];
  for (const d of diffs) {
    let owner = null;
    if (d.path[0] === 'templates' && d.path.length >= 2) {
      const key = d.path[1] ?? '';
      owner = gaps.find((g) => g.rootTemplates.some((re) => re.test(key)))?.owner ?? null;
    }
    if (owner === null) {
      const t = templateOn(cpp, ts, d.path);
      if (t !== null)
        owner =
          gaps.find(
            (g) =>
              g.templateIds.some((re) => re.test(t.id)) ||
              (t.shape !== null && g.nativeShapes.some((re) => re.test(/** @type {string} */ (t.shape)))),
          )?.owner ?? null;
    }
    if (owner === null) unexplained.push(d);
    else counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  return { unexplained, gaps: counts };
}

/**
 * The owner of the gap a template id falls under, or null.
 * @param {Gap[]} gaps
 * @param {string} id
 */
export function gapOwnerOfId(gaps, id) {
  return gaps.find((g) => g.templateIds.some((re) => re.test(id)))?.owner ?? null;
}
