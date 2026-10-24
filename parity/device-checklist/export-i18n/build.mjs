#!/usr/bin/env node
// The multilingual export suite's fixture boards and expected geometry (round I18N1, Work
// 01M4X7TCHFB862XGT68GPY071C). Every board is synthetic: generated from samples.json by lekhjs's own
// semantic generator (as ../export-suite/build.mjs and ../fixtures/build-fixtures.mjs do), so nothing
// is copied from a customer board and the boards can be rebuilt.
//
//   fixtures/i18n-scripts.lekh   one page per script group; per sample a Latin label box and the
//                                sample in a 680-point rectangle (Noto Sans 18)
//   fixtures/i18n-styles.lekh    page Styles: each sample's short text regular / bold / italic /
//                                bold italic; page Families: in Noto Sans / Noto Serif /
//                                Noto Sans Mono / Caveat
//   fixtures/i18n-layout.lekh    page Containers: shape label, free text and connector label per
//                                script; page Wrapping: narrow boxes of long paragraphs; page Runs:
//                                several scripts in one run, three lines in three directions, RTL
//                                alignment, decorations across scripts
//   fixtures/i18n-names.lekh     non-Latin page names (one sample each), a duplicate and an emoji
//                                page name; loaded under the non-Latin board name NAMES_BOARD
//   expected.json                per fixture page: canvas type, the bounds of all objects (the
//                                export plan) and every check target: its sample, kind, style and
//                                rectangle in board points
//
// samples.json is the source of every string; this script also keeps its `codepoints` fields in
// step with the texts (rewritten on a build, verified by --check).
//
// Run from lekhjs after `npm run build` (it imports dist/node/headless.js):
//   node parity/device-checklist/export-i18n/build.mjs [--check]
// --check regenerates in memory and fails when a committed file differs (ids are fixed).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const require = createRequire(path.join(root, 'package.json'));
const lib = await import(path.join(root, 'dist/node/headless.js'));
const { createCanvas } = require('@napi-rs/canvas');

const check = process.argv.includes('--check');

/** The board name the names fixture is loaded under (web: the file name; cloud: the doc name). */
export const NAMES_BOARD = '出口 निर्यात تصدير';
/** The folder of the doc-list case (I18N-11). */
export const NAMES_FOLDER = 'फ़ोल्डर 文件夹';

// ---------------------------------------------------------------- engine (as ../export-suite/build.mjs)

const SKIP = new Set(['_index.json', '_text_syntax.json', 'libnames.json']);
/** @param {string} dir */
const stencilFiles = (dir) =>
  fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !SKIP.has(f))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
const catalog = lib.buildCatalog([
  ...stencilFiles(path.join(root, 'stencils/core')),
  ...stencilFiles(path.join(root, 'stencils/builtin')),
]);
let seq = 0;
const ids = { next: () => `i18n-${String(++seq).padStart(5, '0')}` };
const clock = { now: () => Date.UTC(2026, 9, 24) };
const runtime = lib.createNodeRuntime({
  canvas: { createCanvas: (/** @type {number} */ w, /** @type {number} */ h) => createCanvas(w, h) },
  catalog,
  ids,
  clock,
});
const scheduler = {
  setTimeout: () => 0,
  clearTimeout: () => undefined,
  requestFrame: () => 0,
  cancelFrame: () => undefined,
};
const images = {
  request: () => undefined,
  ensure: (/** @type {string[]} */ urls) => Promise.resolve({ loaded: [], missing: urls }),
  pin: () => () => undefined,
  get: () => undefined,
  decodeInline: () => Promise.reject(new Error('no images')),
};

// ---------------------------------------------------------------- samples

const SAMPLES_FILE = path.join(here, 'samples.json');
const samplesDoc = JSON.parse(fs.readFileSync(SAMPLES_FILE, 'utf8'));
/** @type {any[]} */
const SAMPLES = samplesDoc.samples;
const sample = (/** @type {string} */ id) => {
  const s = SAMPLES.find((x) => x.id === id);
  if (!s) throw new Error(`no sample ${id}`);
  return s;
};
const codepoints = (/** @type {string} */ t) =>
  Array.from(
    t,
    (c) => 'U+' + /** @type {number} */ (c.codePointAt(0)).toString(16).toUpperCase().padStart(4, '0'),
  ).join(' ');
for (const s of SAMPLES) s.codepoints = codepoints(s.text);

/** The script groups of the scripts board, in page order (samples.json `group`). */
const SCRIPT_GROUPS = [
  'Latin Greek Cyrillic',
  'RTL',
  'Indic',
  'Thai Lao Khmer Myanmar',
  'CJK',
  'CJK Ext B',
  'Emoji',
  'Others',
  'Edge cases',
];
const onScriptsBoard = (/** @type {any} */ s) => SCRIPT_GROUPS.includes(s.group);

// ---------------------------------------------------------------- content

const RECT = 'avabodh.basic.rectangle';
const FREE_TEXT = 'avabodh.basic.text';
const WHITE = '#ffffff';

/**
 * A node; `target` (sample id, kind, variant) marks it as a check target.
 * @param {string} ref
 * @param {number} cx
 * @param {number} cy
 * @param {number} width
 * @param {number} height
 * @param {string} text
 * @param {Record<string, unknown>} style
 * @param {string} [shape]
 */
const node = (ref, cx, cy, width, height, text, style, shape = RECT) => ({
  ref,
  shape,
  cx,
  cy,
  width,
  height,
  text,
  style,
});

/** Each page: { name, nodes, edges, targets }; a target: { sample, kind, variant, rect: [x, y, w, h] }. */
function scriptsContent() {
  const pages = SCRIPT_GROUPS.map((group) => {
    const nodes = [];
    const targets = [];
    SAMPLES.filter((s) => s.group === group).forEach((s, row) => {
      const cy = 60 + row * 90;
      nodes.push(node(`lab_${s.id}`, 100, cy, 180, 48, `${s.id} · ${s.language}`, { font_size: 12, fill: WHITE }));
      nodes.push(node(`s_${s.id}`, 560, cy, 680, 56, s.text, { font_family: 'Noto Sans', font_size: 18, fill: WHITE }));
      targets.push({ sample: s.id, text: s.text, kind: 'shape', variant: 'regular', rect: [220, cy - 28, 680, 56] });
    });
    return { name: group, nodes, edges: [], targets };
  });
  return { name: 'i18n-scripts', pages };
}

const VARIANTS = [
  ['regular', {}],
  ['bold', { font_weight: 'bold' }],
  ['italic', { font_style: 'italic' }],
  ['bold-italic', { font_weight: 'bold', font_style: 'italic' }],
];
const FAMILIES = ['Noto Sans', 'Noto Serif', 'Noto Sans Mono', 'Caveat'];

function stylesContent() {
  const rows = SAMPLES.filter((s) => onScriptsBoard(s) && s.short !== '');
  /**
   * @param {string} name
   * @param {[string, Record<string, unknown>][]} cols
   */
  const page = (name, cols) => {
    const nodes = [];
    const targets = [];
    rows.forEach((s, row) => {
      const cy = 40 + row * 64;
      nodes.push(node(`${name}_lab_${s.id}`, 70, cy, 120, 44, s.id, { font_size: 12, fill: WHITE }));
      cols.forEach(([variant, style], col) => {
        const cx = 260 + col * 250;
        nodes.push(
          node(`${name}_${String(col)}_${s.id}`, cx, cy, 230, 44, s.short, { font_size: 16, fill: WHITE, ...style }),
        );
        targets.push({ sample: s.id, text: s.short, kind: 'shape', variant, rect: [cx - 115, cy - 22, 230, 44] });
      });
    });
    return { name, nodes, edges: [], targets };
  };
  return {
    name: 'i18n-styles',
    pages: [
      page(
        'Styles',
        VARIANTS.map(([v, st]) => [
          /** @type {string} */ (v),
          { font_family: 'Noto Sans', .../** @type {object} */ (st) },
        ]),
      ),
      page(
        'Families',
        FAMILIES.map((f) => [`family:${f}`, { font_family: f }]),
      ),
    ],
  };
}

/** Samples on the Containers page: the scripts with distinct shaping or font paths. */
const CONTAINER_SAMPLES = [
  'ar',
  'fa',
  'hi',
  'ta',
  'th',
  'km',
  'my',
  'zh-Hans',
  'ja',
  'ko',
  'am',
  'bo',
  'si',
  'emoji-zwj',
];
const WRAP_SAMPLES = [
  'th-long',
  'km-long',
  'my-long',
  'zh-long',
  'ja-long',
  'ko-long',
  'ar-long',
  'hi-long',
  'long-narrow',
  'mixed-long',
];

function layoutContent() {
  // Containers: label | shape label | free text | box —(label)— box
  const cNodes = [];
  const cEdges = [];
  const cTargets = [];
  CONTAINER_SAMPLES.forEach((id, row) => {
    const s = sample(id);
    const cy = 50 + row * 100;
    cNodes.push(node(`lab_${id}`, 70, cy, 120, 44, id, { font_size: 12, fill: WHITE }));
    cNodes.push(
      node(`shape_${id}`, 290, cy, 260, 50, s.short, { font_family: 'Noto Sans', font_size: 18, fill: WHITE }),
    );
    cTargets.push({ sample: id, text: s.short, kind: 'shape', variant: 'regular', rect: [160, cy - 25, 260, 50] });
    cNodes.push(node(`free_${id}`, 560, cy, 220, 40, s.short, { font_family: 'Noto Sans', font_size: 18 }, FREE_TEXT));
    cTargets.push({ sample: id, text: s.short, kind: 'free', variant: 'regular', rect: [450, cy - 20, 220, 40] });
    cNodes.push(node(`a_${id}`, 720, cy, 40, 30, '', { fill: WHITE }));
    cNodes.push(node(`b_${id}`, 1040, cy, 40, 30, '', { fill: WHITE }));
    cEdges.push({ from: `a_${id}`, to: `b_${id}`, texts: [{ text: s.short }] });
    // The label sits on the connector between the boxes (the line crosses it: raster checks of
    // this target compare against the reference, they cannot ask for a blank background).
    cTargets.push({ sample: id, text: s.short, kind: 'edge', variant: 'regular', rect: [745, cy - 35, 270, 70] });
  });
  // Wrapping: 150 x 320 boxes, five per row.
  const wNodes = [];
  const wTargets = [];
  WRAP_SAMPLES.forEach((id, i) => {
    const cx = 100 + (i % 5) * 190;
    const cy = 200 + Math.floor(i / 5) * 380;
    wNodes.push(node(`lab_${id}`, cx, cy - 180, 150, 30, id, { font_size: 12, fill: WHITE }));
    wNodes.push(
      node(`wrap_${id}`, cx, cy, 150, 320, sample(id).text, { font_family: 'Noto Sans', font_size: 16, fill: WHITE }),
    );
    wTargets.push({
      sample: id,
      text: sample(id).text,
      kind: 'wrap',
      variant: 'regular',
      rect: [cx - 75, cy - 160, 150, 320],
      // The 40-point gap to the right of the box: nothing may be drawn there (no overflow).
      gap: [cx + 80, cy - 160, 30, 320],
    });
  });
  // Runs.
  const rNodes = [];
  const rTargets = [];
  /**
   * @param {string} id
   * @param {number} cx
   * @param {number} cy
   * @param {number} w
   * @param {number} h
   * @param {Record<string, unknown>} style
   * @param {string} variant
   */
  const run = (id, cx, cy, w, h, style, variant = 'regular') => {
    rNodes.push(
      node(`run_${id}`, cx, cy, w, h, sample(id).text, {
        font_family: 'Noto Sans',
        font_size: 18,
        fill: WHITE,
        ...style,
      }),
    );
    rTargets.push({ sample: id, text: sample(id).text, kind: 'shape', variant, rect: [cx - w / 2, cy - h / 2, w, h] });
  };
  run('multi', 500, 60, 900, 60, {});
  run('lines', 300, 200, 500, 130, {});
  run('ar-left', 300, 330, 500, 50, { text_align_horizontal: 'left' });
  run('ar-right', 300, 410, 500, 50, { text_align_horizontal: 'right' });
  run(
    'decorated',
    300,
    490,
    500,
    50,
    { font_weight: 'bold', font_style: 'italic', text_decoration: ['underline'] },
    'bold-italic',
  );
  return {
    name: 'i18n-layout',
    pages: [
      { name: 'Containers', nodes: cNodes, edges: cEdges, targets: cTargets },
      { name: 'Wrapping', nodes: wNodes, edges: [], targets: wTargets },
      { name: 'Runs', nodes: rNodes, edges: [], targets: rTargets },
    ],
  };
}

/** Page name → the sample on it. The sixth page repeats the first name (file name `-page6`). */
const NAME_PAGES = [
  ['中文', 'zh-Hans'],
  ['العربية', 'ar'],
  ['हिन्दी', 'hi'],
  ['Ελληνικά', 'el'],
  ['Emoji 😀', 'emoji-skin'],
  ['中文', 'ja'],
];

function namesContent() {
  return {
    name: NAMES_BOARD,
    pages: NAME_PAGES.map(([name, id]) => ({
      name: /** @type {string} */ (name),
      nodes: [
        node(`n_${id}`, 360, 60, 680, 56, sample(/** @type {string} */ (id)).text, {
          font_family: 'Noto Sans',
          font_size: 18,
          fill: WHITE,
        }),
      ],
      edges: [],
      targets: [
        {
          sample: id,
          text: sample(/** @type {string} */ (id)).text,
          kind: 'shape',
          variant: 'regular',
          rect: [20, 32, 680, 56],
        },
      ],
    })),
  };
}

// ---------------------------------------------------------------- build

/** @param {number} v */
const round6 = (v) => Math.round(v * 1e6) / 1e6;

/**
 * Generates a board from its content and reads back the planner's inputs per page.
 * @param {any} content
 */
function build(content) {
  seq = 0;
  const s = new lib.BoardSession(runtime, { images, scheduler });
  const semantic = {
    name: content.name,
    pages: content.pages.map((/** @type {any} */ p) => ({
      name: p.name,
      canvas: { type: 'infinite' },
      nodes: p.nodes,
      ...(p.edges.length > 0 ? { edges: p.edges } : {}),
    })),
  };
  const answer = lib.generate(s, semantic);
  if (answer.ok !== true) throw new Error(`generate refused ${content.name}: ${JSON.stringify(answer).slice(0, 2000)}`);
  const text = s.serialize({ stamp: 'offline' });
  const r = new lib.BoardSession(runtime, { images, scheduler });
  const loaded = r.load(text);
  if (loaded.ok !== true) throw new Error(`load refused ${content.name}: ${JSON.stringify(loaded)}`);
  const pages = r.document.pages.map((/** @type {any} */ p, /** @type {number} */ i) => {
    r.layoutAll(p.id);
    const b = p.objectStore.hit.boundsOfAll();
    const src = content.pages[i];
    if (src.name !== p.name) throw new Error(`page ${String(i)} is "${String(p.name)}", want "${String(src.name)}"`);
    return {
      index: i,
      name: p.name,
      type: ['auto', 'fixed', 'infinite'][p.canvasSizeType] ?? String(p.canvasSizeType),
      canvas: null,
      bounds: { x: round6(b.x), y: round6(b.y), width: round6(b.width), height: round6(b.height) },
      objects: p.objectStore.objects.length,
      background: null,
      targets: src.targets,
    };
  });
  return { text, pages };
}

const boards = {
  'i18n-scripts.lekh': build(scriptsContent()),
  'i18n-styles.lekh': build(stylesContent()),
  'i18n-layout.lekh': build(layoutContent()),
  'i18n-names.lekh': build(namesContent()),
};

const expected = {
  note: 'Board points. Pages are infinite: a Drawing Area / PDF plan is the bounds plus the padding on each side (ExportInputBuilder.cpp:25-39). Target rect: [x, y, width, height] of the box (or region) whose text is checked.',
  namesBoard: NAMES_BOARD,
  namesFolder: NAMES_FOLDER,
  ...Object.fromEntries(Object.entries(boards).map(([k, v]) => [k, v.pages])),
};

/** @type {Map<string, string>} */
const out = new Map([
  ...Object.entries(boards).map(([k, v]) => /** @type {[string, string]} */ ([`fixtures/${k}`, v.text])),
  ['expected.json', JSON.stringify(expected, null, 2)],
  ['samples.json', JSON.stringify(samplesDoc, null, 2)],
]);

let bad = 0;
for (const [name, body] of out) {
  const file = path.join(here, name);
  const data = Buffer.from(body.endsWith('\n') ? body : body + '\n', 'utf8');
  if (check) {
    const cur = fs.existsSync(file) ? fs.readFileSync(file) : null;
    // samples.json and expected.json may be reformatted by prettier: compare their parsed JSON.
    const same =
      cur !== null &&
      (name.endsWith('.json')
        ? JSON.stringify(JSON.parse(cur.toString('utf8'))) === JSON.stringify(JSON.parse(body))
        : cur.equals(data));
    if (!same) {
      console.error(`differs: ${name}`);
      bad++;
    }
    continue;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  console.log(`${name}  ${String(data.length)} bytes`);
}
if (bad > 0) process.exit(1);
