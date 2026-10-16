// Normaliser `generator-script` (verification 02 §A.5 step 2). In every template whose generator is
// Lua or JS (objects, groups at any depth, `arrows`, root `templates`, `multi`: every object that
// holds a `generator` record), `generator.script` and `generator.scriptfile` are deleted; the
// user's `text`, `interprettext` and `embedrefs` stay and are compared. Separately, the parts a
// generator makes (`texts`, `images`, `draw`, `containers`, `embeds`) must be absent on both sides:
// generated parts are never serialized (`generator_parts_ok`).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { LNum, isObj } from '../lenient-parse.mjs';

export const name = 'generator-script';

/** @type {ReadonlySet<string> | null} */
let wireframe = null;

/**
 * The 34 wireframe generator template ids (spec 04 §5.3): the templates with a `generator` in
 * `lekhboard/stencils/v4/wireframe.json` (`fixture-sets.json` `stencilsV4`). A script generator
 * under any other id is a placeholder in lekhjs (spec 04 §7.4): kept verbatim, never converted or
 * stamped, and its stored parts are written back as they were.
 */
export function wireframeIds() {
  if (wireframe !== null) return wireframe;
  const pkg = path.resolve(import.meta.dirname, '..', '..', '..');
  const sets = JSON.parse(readFileSync(path.join(pkg, 'parity', 'fixture-sets.json'), 'utf8'));
  const file = path.join(path.resolve(pkg, sets.stencilsV4), 'wireframe.json');
  /** @type {Set<string>} */
  const ids = new Set();
  if (existsSync(file)) {
    /** @param {unknown} v */
    const walk = (v) => {
      if (Array.isArray(v)) for (const x of v) walk(x);
      else if (v !== null && typeof v === 'object') {
        const o = /** @type {Record<string, unknown>} */ (v);
        if (typeof o['id'] === 'string' && o['generator'] !== undefined) ids.add(o['id']);
        for (const x of Object.values(o)) walk(x);
      }
    };
    walk(JSON.parse(readFileSync(file, 'utf8')));
  }
  wireframe = Object.freeze(ids);
  return wireframe;
}

const GENERATED_PARTS = ['texts', 'images', 'draw', 'containers', 'embeds'];
const JS_MARKER = /^\/\*lekh-js:\d+:[a-z0-9/_-]+\*\//;

/**
 * Whether a generator record is a script (Lua or JS) generator: no `type`, or `LuaShapeGenerator`
 * (the classification of lekhjs `classifyGenerator` and C++ `ShapeGenerator::getGenerator`).
 * @param {{ [k: string]: import('../lenient-parse.mjs').LValue }} gen
 */
export function scriptKind(gen) {
  const type = gen['type'];
  if (type !== undefined && type !== 'LuaShapeGenerator') return null;
  const script = typeof gen['script'] === 'string' ? gen['script'] : '';
  return JS_MARKER.test(script) ? 'js' : 'lua';
}

/**
 * Strips the script of every script generator in `tree` (in place).
 * @param {import('../lenient-parse.mjs').LValue} tree
 * @returns {{ lua: number, js: number, partsOk: number, partsBad: number, placeholders: number, badParts: string[] }}
 */
export function apply(tree) {
  const out = { lua: 0, js: 0, partsOk: 0, partsBad: 0, placeholders: 0, badParts: /** @type {string[]} */ ([]) };
  /** @param {import('../lenient-parse.mjs').LValue} v */
  const walk = (v) => {
    if (v instanceof LNum || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    const gen = v['generator'];
    if (isObj(gen)) {
      const kind = scriptKind(gen);
      if (kind !== null) {
        out[kind]++;
        delete gen['script'];
        delete gen['scriptfile'];
        // A placeholder (unknown id) keeps its stored parts: not a generated-parts check.
        if (typeof v['id'] === 'string' && !wireframeIds().has(v['id'])) {
          out.placeholders++;
          for (const x of Object.values(v)) walk(x);
          return;
        }
        const present = GENERATED_PARTS.filter((p) => v[p] !== undefined);
        if (present.length === 0) out.partsOk++;
        else {
          out.partsBad++;
          for (const p of present) if (!out.badParts.includes(p)) out.badParts.push(p);
        }
      }
    }
    for (const x of Object.values(v)) walk(x);
  };
  walk(tree);
  return out;
}

/**
 * The ids of the Lua generators under a wireframe id in `tree` (an input board, before stripping):
 * what lekhjs converts and stamps 5.0 (spec 04 §7.2 step 6, §9.2). Lua under an unknown id is a
 * placeholder and stamps nothing (§7.4).
 * @param {import('../lenient-parse.mjs').LValue} tree
 * @returns {Set<string>}
 */
export function luaIds(tree) {
  /** @type {Set<string>} */
  const ids = new Set();
  /** @param {import('../lenient-parse.mjs').LValue} v */
  const walk = (v) => {
    if (v instanceof LNum || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    const gen = v['generator'];
    if (isObj(gen) && scriptKind(gen) === 'lua' && typeof v['id'] === 'string' && wireframeIds().has(v['id']))
      ids.add(v['id']);
    for (const x of Object.values(v)) walk(x);
  };
  walk(tree);
  return ids;
}

/**
 * Whether `tree` holds a Lua generator under a wireframe id that lekhjs ports (`unported(id)`
 * false: an owned gap of `parity/gaps.json` stays Lua and stamps nothing until its task lands).
 * @param {import('../lenient-parse.mjs').LValue} tree
 * @param {(id: string) => boolean} [unported]
 */
export function hasLua(tree, unported = () => false) {
  for (const id of luaIds(tree)) if (!unported(id)) return true;
  return false;
}
