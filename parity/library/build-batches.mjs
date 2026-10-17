// Builds the library-shape batches (verification 02 §C.2, §C.4, §C.6): one category per batch,
// ≤ 100 cells and ≤ 16 MP per page, shelf-packed at each template's default size from the stencil
// file, "Sample 12" in every text slot, two cells per generator shape (defaults, and the set of
// params.json), normalised through the Node oracle so the file carries inline Lua as boards saved
// by the C++ apps do.
//
//   node parity/library/build-batches.mjs --set v3|v4|v5|core [--out <dir>] [--only <id,…>]
//                                         [--no-normalise] [--list] [--v4 <dir>]
//
// Writes into `--out` (default parity/out/library/<set>/, git-ignored):
//   <batch>.lekh            the input of both builds (normalised; for v5 the source itself)
//   <batch>.src.lekh        the document as built from the stencil files, before normalisation
//   <batch>.manifest.json   each cell's rectangle, shape id, file, groups and parameter set
//   batches.json            every batch of the set, its hashes, and for v4 the v3 batch it is
//                           covered by (§C.4; for v5 the v4 batch, §C.5 item 1)
//
// v5 batches are TS-only (§C.5): their JS generators are not something the C++ oracle can run. The
// v5 batch is therefore the normalised v4 batch of the same suffix (from `--v4`, default
// parity/out/library/v4/) with each Lua `generator.script` replaced by the v5 stencil's JS script at
// the same object path: the C++ writer rounds positions and sizes when it normalises (cx 1651.095 →
// 1651.09), so a v5 source compared with a normalised v4 batch would differ by that rounding, not by
// the generators. build-v5.js changes nothing in wireframe.json but the generator objects, and the
// user's `text`/`interprettext`/`embedrefs` are kept as the v4 batch carries them. Without a v4
// batch the v5 source itself is written. `--list` prints the batch plan without writing or
// normalising.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { holdHeavyLock } from '../tools/lock.mjs';
import { GUTTER, footprint, pagePixels, shelfPack, splitCategory } from './layout.mjs';
import { StencilSet, defaultSize, embedClosure, sha256, slug } from './stencil-set.mjs';

const HERE = import.meta.dirname;
const PARITY = path.resolve(HERE, '..');
export const SAMPLE_TEXT = 'Sample 12';
const PAGE_ID = 'page0001';

/** @returns {Record<string, { params: Record<string, unknown>, text?: string }>} */
export function loadParams() {
  const raw = JSON.parse(readFileSync(path.join(HERE, 'params.json'), 'utf8'));
  return Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('_')));
}

/**
 * Sets parameter `name` of template `t` to `value`: the object form keeps its editor.
 * @param {any} t
 * @param {string} name
 * @param {unknown} value
 */
function setParam(t, name, value) {
  t.params ??= {};
  const cur = t.params[name];
  if (cur !== null && typeof cur === 'object' && !Array.isArray(cur)) cur.value = value;
  else t.params[name] = value;
}

/**
 * Every text slot gets the sample text (§C.2 step 4). The string form becomes the one entry it
 * declares, as the reader turns it into.
 * @param {any} t
 */
function fillTexts(t) {
  if (typeof t.texts === 'string') {
    if (t.texts !== '') t.texts = [{ location: t.texts, text: SAMPLE_TEXT }];
  } else if (Array.isArray(t.texts)) {
    t.texts = t.texts.map((/** @type {any} */ e) => (e && typeof e === 'object' ? { ...e, text: SAMPLE_TEXT } : e));
  }
}

/**
 * @typedef {object} Shape   one placement to lay out (one or two cells)
 * @property {string} id         template id
 * @property {string} file
 * @property {string[]} groups
 * @property {any} template      as the stencil file defines it
 * @property {Record<string, any> | null} objParams
 * @property {{ width: number, height: number, angle: number, source: string }} size
 * @property {boolean} generator
 * @property {boolean} sampleText   fill the text slots
 * @property {'shape' | 'arrowhead'} kind
 */

/** @param {Shape} s */
const cellsOf = (s) => (s.generator ? 2 : 1);

/** @param {Shape} s */
function cellFootprint(s) {
  if (s.kind === 'arrowhead') return { w: 240, h: 40 };
  return footprint(s.size.width, s.size.height, s.size.angle);
}

/** @param {Shape[]} chunk */
function expand(chunk) {
  return chunk.flatMap((s) =>
    s.generator
      ? [
          { shape: s, variant: /** @type {const} */ ('default') },
          { shape: s, variant: /** @type {const} */ ('params') },
        ]
      : [{ shape: s, variant: /** @type {const} */ ('default') }],
  );
}

/** @param {Shape[]} chunk */
const pageOf = (chunk) => shelfPack(expand(chunk).map((c) => cellFootprint(c.shape)));

/**
 * @param {Shape} s
 * @param {'default' | 'params'} variant
 * @param {ReturnType<typeof loadParams>} params
 */
function cellTemplate(s, variant, params) {
  const t = structuredClone(s.template);
  for (const [k, v] of Object.entries(s.objParams ?? {}))
    if (!['width', 'height', 'angle'].includes(k)) setParam(t, k, v);
  if (variant === 'params') {
    const p = params[s.id];
    if (p === undefined) throw new Error(`params.json has no entry for generator ${s.id} (§C.2 step 5)`);
    for (const [k, v] of Object.entries(p.params ?? {})) setParam(t, k, v);
    if (typeof p.text === 'string') {
      if (t.generator === undefined) throw new Error(`params.json gives ${s.id} a text but it has no generator`);
      t.generator.text = p.text;
    }
  }
  if (s.sampleText) fillTexts(t);
  return t;
}

/**
 * The document and manifest of one batch.
 * @param {{ id: string, set: string, category: string, shapes: Shape[], coreTemplates: Map<string, any>, table: Map<string, any>, params: ReturnType<typeof loadParams> }} b
 */
export function buildBatch(b) {
  const cells = expand(b.shapes);
  const packed = shelfPack(cells.map((c) => cellFootprint(c.shape)));
  /** @type {Record<string, any>} */
  const objects = {};
  /** @type {any[]} */
  const manifestCells = [];
  /** @type {any[]} */
  const inline = [];
  let order = 0;
  cells.forEach((c, i) => {
    const n = String(i + 1).padStart(4, '0');
    const r = /** @type {{ x: number, y: number, w: number, h: number }} */ (packed.rects[i]);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const s = c.shape;
    const ids = [];
    if (s.kind === 'arrowhead') {
      const rect = b.coreTemplates.get('avabodh.basic.rectangle');
      const end = (/** @type {string} */ id, /** @type {number} */ x) => {
        objects[id] = {
          name: '',
          order: ++order,
          params: { angle: 0, cx: x, cy, height: 20, width: 20 },
          template: structuredClone(rect),
          type: 'templated',
        };
        ids.push(id);
      };
      end(`cell${n}a`, r.x + 10);
      end(`cell${n}b`, r.x + r.w - 10);
      const id = `cell${n}`;
      objects[id] = {
        arrows: { end: structuredClone(s.template), start: structuredClone(s.template) },
        ctype: 1,
        order: ++order,
        params: [{ angle: 0, autotype: 1 }, { angle: 0 }],
        source: `cell${n}a`,
        target: `cell${n}b`,
        text: '',
        texts: [],
        type: 'avabodh.basic.connection',
      };
      ids.unshift(id);
    } else {
      const t = cellTemplate(s, c.variant, b.params);
      inline.push(t);
      const id = `cell${n}`;
      objects[id] = {
        name: '',
        order: ++order,
        params: { angle: s.size.angle, cx, cy, height: s.size.height, width: s.size.width },
        template: t,
        type: 'templated',
      };
      ids.push(id);
    }
    manifestCells.push({
      n: i + 1,
      object: ids[0],
      objects: ids,
      shape: s.id,
      file: s.file,
      groups: s.groups,
      params: c.variant,
      size: s.kind === 'arrowhead' ? null : s.size,
      rect: r,
    });
  });
  /** @type {Record<string, any>} */
  const templates = {};
  for (const t of embedClosure(inline, b.table)) templates[String(t.id).replace(/\./g, '_')] = t;
  /** @type {Record<string, any>} */
  const doc = {
    attributes: { grid: { present: true }, scaling: { scale: 1, unit: 'point' } },
    info: { author: '', description: '', platform: '1', title: '', version: '4.2' },
    pages: {
      [PAGE_ID]: {
        background: { color: -1 },
        canvasname: 'Infinite',
        canvassizetype: 'infinite',
        name: 'Page 1',
        objects,
        order: 0,
        size: { height: 0, unit: 'point', width: 0 },
      },
    },
  };
  if (Object.keys(templates).length > 0) doc['templates'] = templates;
  const page = { width: packed.width, height: packed.height };
  const manifest = {
    batch: b.id,
    set: b.set,
    category: b.category,
    files: [...new Set(b.shapes.map((s) => s.file))],
    shapes: b.shapes.length,
    cells: manifestCells,
    page,
    page_pixels: pagePixels(page),
    gutter: GUTTER,
    embeds: Object.values(templates).map((t) => t.id),
  };
  return { doc, manifest };
}

/**
 * The batch plan of a set: `{ id, category, part, shapes }` in category order.
 * @param {string} setName
 */
export function planSet(setName) {
  const set = new StencilSet(setName);
  const core = new StencilSet('core');
  /** @type {Map<string, any>} */
  const coreTemplates = new Map();
  for (const [id, t] of core.templateTable('basic')) coreTemplates.set(id, t);
  const params = loadParams();
  /** @type {{ id: string, category: string, part: string, shapes: Shape[], files: string[], table: Map<string, any> }[]} */
  const plan = [];

  if (setName === 'core') {
    const table = core.templateTable();
    const fromFile = (/** @type {string} */ file, /** @type {(t: any) => boolean} */ keep = () => true) => {
      const json = core.file(file).json;
      /** @type {Shape[]} */
      const out = [];
      const seen = new Set();
      const push = (/** @type {any} */ template, /** @type {any} */ objParams, /** @type {string} */ group) => {
        if (seen.has(template.id) || !keep(template)) return;
        seen.add(template.id);
        out.push({
          id: template.id,
          file,
          groups: [group],
          template,
          objParams,
          size: defaultSize(template, objParams, null),
          generator: template.generator !== undefined,
          sampleText: template.generator === undefined,
          kind: 'shape',
        });
      };
      for (const lib of json.library ?? [])
        for (const o of lib.objects ?? []) {
          const r =
            typeof o === 'string' ? core.template(file, o) : { template: o.template, objParams: o.params ?? null };
          push(r.template, r.objParams, lib.name ?? '');
        }
      for (const t of json.templates ?? []) push(t, null, '');
      return out;
    };
    plan.push({
      id: 'core-flowchart-01',
      category: 'Flowchart',
      part: 'flowchart',
      shapes: fromFile('flowchart'),
      files: ['flowchart'],
      table,
    });
    const arrows = (core.file('connection_arrows').json.arrows ?? []).map((/** @type {any} */ t) => ({
      id: t.id,
      file: 'connection_arrows',
      groups: [],
      template: t,
      objParams: null,
      size: defaultSize(t, null, null),
      generator: false,
      sampleText: false,
      kind: /** @type {const} */ ('arrowhead'),
    }));
    plan.push({
      id: 'core-arrowheads-01',
      category: 'Arrowheads',
      part: 'arrowheads',
      shapes: arrows,
      files: ['connection_arrows', 'basic'],
      table,
    });
    plan.push({
      id: 'core-templates-01',
      category: 'Templates',
      part: 'templates',
      shapes: fromFile('templates'),
      files: ['templates'],
      table,
    });
    return { set, plan, coreTemplates, params };
  }

  /** @type {Map<string, import('./stencil-set.mjs').Placement[]>} */
  const byCategory = new Map();
  for (const p of set.placements()) {
    const list = byCategory.get(p.category) ?? [];
    list.push(p);
    byCategory.set(p.category, list);
  }
  for (const [category, members] of byCategory) {
    // Two files defining the same id cannot share one document's template store (§C.2 step 2):
    // such a category is one batch series per file, named after the file.
    const ids = new Map();
    let clash = false;
    for (const m of members) {
      const f = ids.get(m.id);
      if (f !== undefined && f !== m.file) clash = true;
      ids.set(m.id, m.file);
    }
    /** @type {[string, import('./stencil-set.mjs').Placement[]][]} */
    const parts = [];
    if (clash) {
      for (const m of members) {
        let part = parts.find(([f]) => f === m.file);
        if (part === undefined) parts.push((part = [m.file, []]));
        part[1].push(m);
      }
    } else parts.push(['', members]);
    for (const [file, list] of parts) {
      const partSlug = file === '' ? slug(category) : slug(file);
      const table = set.templateTable(list[0]?.file);
      /** @type {Shape[]} */
      const shapes = list.map((m) => {
        const { template, objParams } = set.template(m.file, m.id);
        return {
          id: m.id,
          file: m.file,
          groups: m.groups,
          template,
          objParams,
          size: defaultSize(template, objParams, m.entry.default_size),
          generator: m.entry.generated === true,
          sampleText: m.entry.text_slots > 0 && m.entry.interpret_text !== true,
          kind: /** @type {const} */ ('shape'),
        };
      });
      const chunks = splitCategory(shapes, cellsOf, pageOf);
      chunks.forEach((chunk, i) =>
        plan.push({
          id: `${setName}-${partSlug}-${String(i + 1).padStart(2, '0')}`,
          category,
          part: partSlug,
          shapes: chunk,
          files: [...new Set(list.map((m) => m.file))],
          table,
        }),
      );
    }
  }
  return { set, plan, coreTemplates, params };
}

const JS_MARKER = '/*lekh-js:';

/**
 * The templates with a generator in `doc`, by JSON path.
 * @param {any} doc
 * @returns {Map<string, any>}
 */
function generatorTemplates(doc) {
  /** @type {Map<string, any>} */
  const out = new Map();
  /** @param {any} x @param {string} at */
  const walk = (x, at) => {
    if (Array.isArray(x)) x.forEach((v, i) => walk(v, `${at}/${i}`));
    else if (x !== null && typeof x === 'object') {
      if (typeof x.id === 'string' && x.generator !== null && typeof x.generator === 'object') out.set(at, x);
      for (const [k, v] of Object.entries(x)) walk(v, `${at}/${k}`);
    }
  };
  walk(doc, '');
  return out;
}

/**
 * §C.5: the normalised v4 batch with each Lua generator script replaced by the v5 source's JS
 * script at the same path. Fails unless every Lua generator is replaced by a JS one of the same id.
 * @param {string} v4Text
 * @param {any} v5Doc
 */
export function withJsGenerators(v4Text, v5Doc) {
  const doc = JSON.parse(v4Text);
  const js = generatorTemplates(v5Doc);
  let swapped = 0;
  for (const [at, t] of generatorTemplates(doc)) {
    const g = t.generator;
    const lua = typeof g.scriptfile === 'string' || (typeof g.script === 'string' && !g.script.startsWith(JS_MARKER));
    if (!lua) continue;
    const v5 = js.get(at);
    if (
      v5 === undefined ||
      v5.id !== t.id ||
      typeof v5.generator.script !== 'string' ||
      !v5.generator.script.startsWith(JS_MARKER)
    )
      throw new Error(`v5: no JS generator for ${t.id} at ${at}`);
    g.script = v5.generator.script;
    delete g.scriptfile;
    delete g.type;
    swapped++;
  }
  return { text: JSON.stringify(doc), swapped };
}

/**
 * Builds every batch of a set in memory (no normalisation): `{ id, doc, manifest, srcText, srcSha }`.
 * @param {string} setName
 */
export function buildSet(setName) {
  const { set, plan, coreTemplates, params } = planSet(setName);
  const out = plan.map((p) => {
    const { doc, manifest } = buildBatch({
      id: p.id,
      set: setName,
      category: p.category,
      shapes: p.shapes,
      coreTemplates,
      table: p.table,
      params,
    });
    const srcText = JSON.stringify(doc);
    const fileShas = Object.fromEntries(p.files.map((f) => [f, set.file(f).sha256]));
    const fileFrom = Object.fromEntries(p.files.map((f) => [f, set.file(f).from]));
    return {
      ...p,
      doc,
      manifest: { ...manifest, file_sha256: fileShas, file_from: fileFrom },
      srcText,
      srcSha: sha256(srcText),
    };
  });
  return { set, batches: out };
}

/**
 * §C.4: a v4 batch is covered by the v3 batch with the same suffix (and a v5 batch by the v4 one, §C.5) when every file of its category
 * is byte-identical in v3 and v4 (or compiled-in), and the ordered member list is identical; the
 * batch files are then byte-identical, which is asserted too.
 * @param {ReturnType<typeof buildSet>['batches']} v4
 * @param {ReturnType<typeof buildSet>['batches']} v3
 */
export function coverage(v4, v3) {
  const suffix = (/** @type {string} */ id) => id.replace(/^v\d+-/, '');
  const v3by = new Map(v3.map((b) => [suffix(b.id), b]));
  /** @param {string} category */
  const members = (/** @type {typeof v3} */ list, category) =>
    JSON.stringify(list.filter((b) => b.category === category).flatMap((b) => b.shapes.map((s) => [s.file, s.id])));
  /** @param {string} category */
  const filesOf = (/** @type {typeof v3} */ list, category) => {
    /** @type {Record<string, string>} */
    const out = {};
    for (const b of list.filter((x) => x.category === category))
      for (const [f, h] of Object.entries(b.manifest.file_sha256))
        out[f] = b.manifest.file_from[f] === 'core' ? 'core' : h;
    return out;
  };
  return v4.map((b) => {
    const o = v3by.get(suffix(b.id));
    if (o === undefined) return { id: b.id, covered_by: null, reason: 'no v3 batch with this suffix' };
    const f4 = filesOf(v4, b.category);
    const f3 = filesOf(v3, o.category);
    const sameFiles = JSON.stringify(Object.entries(f4).sort()) === JSON.stringify(Object.entries(f3).sort());
    const sameMembers = members(v4, b.category) === members(v3, o.category);
    if (!sameFiles) return { id: b.id, covered_by: null, reason: 'files differ' };
    if (!sameMembers) return { id: b.id, covered_by: null, reason: 'members differ' };
    if (b.srcSha !== o.srcSha)
      return { id: b.id, covered_by: null, reason: 'criteria hold but the batch files differ (builder bug)' };
    return {
      id: b.id,
      covered_by: o.id,
      reason: Object.values(f4).every((h) => h === 'core') ? 'compiled-in' : 'files identical',
    };
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      set: { type: 'string' },
      out: { type: 'string' },
      only: { type: 'string' },
      'no-normalise': { type: 'boolean', default: false },
      list: { type: 'boolean', default: false },
      v4: { type: 'string' },
    },
  });
  const setName = values.set;
  if (setName === undefined) {
    process.stderr.write(
      'usage: build-batches.mjs --set v3|v4|v5|core [--out <dir>] [--only <id,…>] [--no-normalise] [--list]\n',
    );
    process.exit(2);
  }
  const { batches } = buildSet(setName);
  // §C.4 (v4 over v3) and §C.5 item 1 (v5 over v4: only the batches whose files changed run).
  const previous = { v4: 'v3', v5: 'v4' }[setName];
  const cover = previous !== undefined ? coverage(batches, buildSet(previous).batches) : null;
  if (values.list) {
    for (const b of batches) {
      const c = cover?.find((x) => x.id === b.id);
      process.stdout.write(
        `${b.id}\t${b.shapes.length} shapes\t${b.manifest.cells.length} cells\t${b.manifest.page.width}x${b.manifest.page.height}` +
          (c ? `\t${c.covered_by ? `covered by ${c.covered_by}` : `run (${c.reason})`}` : '') +
          '\n',
      );
    }
    const shapes = batches.reduce((n, b) => n + b.shapes.length, 0);
    const cells = batches.reduce((n, b) => n + b.manifest.cells.length, 0);
    const run = cover ? cover.filter((c) => c.covered_by === null).length : batches.length;
    process.stdout.write(`${setName}: ${batches.length} batches, ${shapes} shapes, ${cells} cells, ${run} to run\n`);
    return;
  }
  const only = values.only ? new Set(values.only.split(',')) : null;
  const selected = batches.filter((b) => only === null || only.has(b.id));
  if (only !== null && selected.length !== only.size) throw new Error(`unknown batch id in --only ${values.only}`);
  const normalise = !values['no-normalise'] && setName !== 'v5';
  if (normalise) holdHeavyLock();
  const out = path.resolve(values.out ?? path.join(PARITY, 'out', 'library', setName));
  const v4Dir = path.resolve(values.v4 ?? path.join(PARITY, 'out', 'library', 'v4'));
  mkdirSync(out, { recursive: true });

  const require = createRequire(import.meta.url);
  /** @type {any} */
  let oracle = null;
  /** @type {any} */
  let identity = null;
  if (normalise) {
    const { NodeOracle } = require('../oracle/node-oracle.cjs');
    oracle = new NodeOracle();
    identity = await oracle.identity();
  }
  const index = [];
  let failed = 0;
  try {
    for (const b of selected) {
      writeFileSync(path.join(out, `${b.id}.src.lekh`), b.srcText);
      let text = b.srcText;
      /** @type {Record<string, any>} */
      const norm = { normalised: false };
      if (oracle !== null) {
        const r = await oracle.load(b.srcText, { stamp: 'app' });
        if (!r.ok) {
          failed++;
          process.stderr.write(`${b.id}: the Node oracle refused the batch: ${r.error}\n`);
          index.push({ id: b.id, error: String(r.error) });
          continue;
        }
        text = r.json;
        Object.assign(norm, { normalised: true, oracle: identity });
      } else if (setName === 'v5') {
        const v4File = path.join(v4Dir, `${b.id.replace(/^v5-/, 'v4-')}.lekh`);
        if (existsSync(v4File)) {
          const swapped = withJsGenerators(readFileSync(v4File, 'utf8'), b.doc);
          text = swapped.text;
          Object.assign(norm, {
            from_v4: path.relative(PARITY, v4File),
            from_v4_sha256: sha256(readFileSync(v4File, 'utf8')),
            generators_swapped: swapped.swapped,
          });
        }
      }
      writeFileSync(path.join(out, `${b.id}.lekh`), text);
      const manifest = { ...b.manifest, source_sha256: b.srcSha, sha256: sha256(text), ...norm };
      writeFileSync(path.join(out, `${b.id}.manifest.json`), JSON.stringify(manifest, null, 2) + '\n');
      const c = cover?.find((x) => x.id === b.id);
      index.push({
        id: b.id,
        category: b.category,
        shapes: b.shapes.length,
        cells: b.manifest.cells.length,
        source_sha256: b.srcSha,
        sha256: manifest.sha256,
        ...(c ? { covered_by: c.covered_by, coverage: c.reason } : {}),
      });
      process.stdout.write(
        `${b.id}: ${b.manifest.cells.length} cells${c?.covered_by ? ` (covered by ${c.covered_by})` : ''}\n`,
      );
    }
  } finally {
    if (oracle !== null) await oracle.close();
  }
  if (only === null)
    writeFileSync(path.join(out, 'batches.json'), JSON.stringify({ set: setName, batches: index }, null, 2) + '\n');
  process.stdout.write(
    `${setName}: ${index.length - failed} batches written to ${out}${failed ? `, ${failed} refused` : ''}\n`,
  );
  if (failed > 0) process.exit(1);
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) {
  main().catch((e) => {
    process.stderr.write(String(e?.stack ?? e) + '\n');
    process.exit(1);
  });
}
