// Reading one stencil set for the library-shape test (verification 02 §C.1, §C.2 step 1): the
// index, the library files it names (a file the set directory lacks is compiled into the apps and
// comes from `lekhcore/stencils/core/`), each placement's template as the stencil file defines it,
// its default size, and the embed closure a template needs.
//
// Sets: `v3`, `v4`, `v5` (`lekhboard/stencils/<set>/`, each with `_index.json`) and `core`
// (`lekhcore/stencils/core/`, no index; its three batches are defined in build-batches.mjs).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
/** The workspace (or worktree) root that holds lekhjs, lekhboard and lekhcore side by side. */
export const WS = path.resolve(HERE, '..', '..', '..');
export const CORE_DIR = path.join(WS, 'lekhcore', 'stencils', 'core');

/** @param {string} set */
export function setDir(set) {
  if (set === 'core') return CORE_DIR;
  if (!/^v\d+$/.test(set)) throw new Error(`unknown stencil set ${set} (v3, v4, v5 or core)`);
  return path.join(WS, 'lekhboard', 'stencils', set);
}

/** @param {Buffer | string} b */
export const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/**
 * @typedef {object} StencilFile
 * @property {string} name     file name without `.json`
 * @property {string} path     absolute path
 * @property {'set' | 'core'} from   the set directory, or compiled-in (`lekhcore/stencils/core`)
 * @property {string} sha256   of the file's bytes
 * @property {any} json
 */

/**
 * @typedef {object} IndexEntry
 * @property {string} id
 * @property {string} name
 * @property {string} category
 * @property {string} group
 * @property {string} library
 * @property {string} file
 * @property {[number, number] | null} default_size
 * @property {boolean} generated
 * @property {boolean} interpret_text
 * @property {boolean} has_params
 * @property {number} text_slots
 */

/**
 * @typedef {object} Placement   one unique (file, id) pair of the index
 * @property {string} id
 * @property {string} file
 * @property {string} category
 * @property {string[]} groups   every library group of the file that lists it (§C.7 item 2)
 * @property {IndexEntry} entry  the first index entry
 */

export class StencilSet {
  /** @param {string} name */
  constructor(name) {
    this.name = name;
    this.dir = setDir(name);
    if (!existsSync(this.dir)) throw new Error(`no stencil set at ${this.dir}`);
    /** @type {Map<string, StencilFile | null>} */
    this.files_ = new Map();
    /** @type {IndexEntry[]} */
    this.index = [];
    const idx = path.join(this.dir, '_index.json');
    if (existsSync(idx)) this.index = JSON.parse(readFileSync(idx, 'utf8'));
  }

  /**
   * A library file by name (no `.json`): the set's own, else the compiled-in core file.
   * @param {string} name
   * @returns {StencilFile}
   */
  file(name) {
    let f = this.files_.get(name);
    if (f === undefined) {
      f = null;
      for (const [dir, from] of /** @type {const} */ ([
        [this.dir, 'set'],
        [CORE_DIR, 'core'],
      ])) {
        const p = path.join(dir, `${name}.json`);
        if (existsSync(p)) {
          const bytes = readFileSync(p);
          f = { name, path: p, from, sha256: sha256(bytes), json: JSON.parse(bytes.toString('utf8')) };
          break;
        }
      }
      this.files_.set(name, f);
    }
    if (f === null) throw new Error(`stencil set ${this.name}: no library file ${name}.json`);
    return f;
  }

  /**
   * Unique placements in index order (§C.2 step 1): a repeated (file, id) pair is placed once and
   * its groups are listed.
   * @returns {Placement[]}
   */
  placements() {
    /** @type {Map<string, Placement>} */
    const seen = new Map();
    for (const e of this.index) {
      const key = `${e.file}\0${e.id}`;
      const p = seen.get(key);
      if (p === undefined) seen.set(key, { id: e.id, file: e.file, category: e.category, groups: [e.group], entry: e });
      else if (!p.groups.includes(e.group)) p.groups.push(e.group);
    }
    return [...seen.values()];
  }

  /**
   * The template of `id` as file `fileName` defines it, with the library object's `params` (the
   * placed size and parameter values) when the entry is `{ template, params }`.
   * @param {string} fileName
   * @param {string} id
   * @returns {{ template: any, objParams: Record<string, any> | null }}
   */
  template(fileName, id) {
    const json = this.file(fileName).json;
    for (const lib of json.library ?? []) {
      for (const o of lib.objects ?? []) {
        if (typeof o === 'string') {
          if (o !== id) continue;
          const t = (json.templates ?? []).find((/** @type {any} */ x) => x.id === id);
          if (t === undefined) throw new Error(`${fileName}: library object ${id} has no top-level template`);
          return { template: t, objParams: null };
        }
        if (o?.template?.id === id) return { template: o.template, objParams: o.params ?? null };
      }
    }
    const top = (json.templates ?? []).find((/** @type {any} */ x) => x.id === id);
    if (top !== undefined) return { template: top, objParams: null };
    throw new Error(`${fileName}: no template ${id}`);
  }

  /**
   * Every template the set defines, by id, first definition wins, the file `prefer` first: what an
   * embed name or a generator's `embedrefs` resolves to inside the set.
   * @param {string} [prefer]
   */
  templateTable(prefer) {
    const names = new Set(this.index.map((e) => e.file));
    /** @type {Map<string, any>} */
    const table = new Map();
    const add = (/** @type {string} */ n) => {
      const json = this.file(n).json;
      for (const t of json.templates ?? []) if (t?.id && !table.has(t.id)) table.set(t.id, t);
      for (const lib of json.library ?? [])
        for (const o of lib.objects ?? [])
          if (typeof o === 'object' && o?.template?.id && !table.has(o.template.id))
            table.set(o.template.id, o.template);
    };
    if (prefer !== undefined) add(prefer);
    for (const n of [...names].sort()) add(n);
    return table;
  }
}

/**
 * The size a placement starts at (§C.2 step 3): the library object's `params`, else the
 * template's `default`, else the index `default_size`, else 120 × 80.
 * @param {any} template
 * @param {Record<string, any> | null} objParams
 * @param {[number, number] | null | undefined} indexSize
 * @returns {{ width: number, height: number, angle: number, source: 'library' | 'template' | 'index' | 'fallback' }}
 */
export function defaultSize(template, objParams, indexSize) {
  const num = (/** @type {unknown} */ v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const angle = (/** @type {any} */ o) => (typeof o?.angle === 'number' ? o.angle : 0);
  if (objParams !== null && num(objParams.width) && num(objParams.height))
    return { width: objParams.width, height: objParams.height, angle: angle(objParams), source: 'library' };
  const d = template?.default;
  if (num(d?.width) && num(d?.height)) return { width: d.width, height: d.height, angle: angle(d), source: 'template' };
  if (Array.isArray(indexSize) && num(indexSize[0]) && num(indexSize[1]))
    return { width: indexSize[0], height: indexSize[1], angle: 0, source: 'index' };
  return { width: 120, height: 80, angle: 0, source: 'fallback' };
}

/**
 * The ids `template` embeds, directly: `embeds[].name` and a generator's `embedrefs`.
 * @param {any} template
 * @returns {string[]}
 */
export function embedNames(template) {
  const out = [];
  for (const e of template?.embeds ?? []) if (typeof e?.name === 'string' && e.name !== '') out.push(e.name);
  for (const r of template?.generator?.embedrefs ?? []) if (typeof r === 'string' && r !== '') out.push(r);
  return out;
}

/**
 * The embed closure of `templates` inside `table` (ids not defined in the set are left to the
 * loading process's store, as in the apps), sorted by id.
 * @param {any[]} templates
 * @param {Map<string, any>} table
 * @returns {any[]}
 */
export function embedClosure(templates, table) {
  /** @type {Map<string, any>} */
  const out = new Map();
  const todo = templates.flatMap(embedNames);
  while (todo.length > 0) {
    const id = /** @type {string} */ (todo.pop());
    if (out.has(id)) continue;
    const t = table.get(id);
    if (t === undefined) continue;
    out.set(id, t);
    todo.push(...embedNames(t));
  }
  return [...out.keys()].sort().map((k) => out.get(k));
}

/** `UI Wireframe` → `ui-wireframe` (§C.2 step 7). @param {string} s */
export function slug(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
