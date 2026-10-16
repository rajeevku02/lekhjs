// Normaliser `generator-script` (verification 02 §A.5 step 2). In every template whose generator is
// Lua or JS (objects, groups at any depth, `arrows`, root `templates`, `multi`: every object that
// holds a `generator` record), `generator.script` and `generator.scriptfile` are deleted; the
// user's `text`, `interprettext` and `embedrefs` stay and are compared. Separately, the parts a
// generator makes (`texts`, `images`, `draw`, `containers`, `embeds`) must be absent on both sides:
// generated parts are never serialized (`generator_parts_ok`).
import { LNum, isObj } from '../lenient-parse.mjs';

export const name = 'generator-script';

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
 * @returns {{ lua: number, js: number, partsOk: number, partsBad: number, badParts: string[] }}
 */
export function apply(tree) {
  const out = { lua: 0, js: 0, partsOk: 0, partsBad: 0, badParts: /** @type {string[]} */ ([]) };
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
 * Whether `tree` (an input board, before stripping) holds a Lua generator anywhere.
 * @param {import('../lenient-parse.mjs').LValue} tree
 */
export function hasLua(tree) {
  let found = false;
  /** @param {import('../lenient-parse.mjs').LValue} v */
  const walk = (v) => {
    if (found || v instanceof LNum || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    const gen = v['generator'];
    if (isObj(gen) && scriptKind(gen) === 'lua') found = true;
    for (const x of Object.values(v)) walk(x);
  };
  walk(tree);
  return found;
}
