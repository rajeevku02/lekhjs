#!/usr/bin/env node
// The export manual suite's fixture boards and expected values (owner round EX2, Work
// 01M4X7TCHFB862XGT68GPY071C). Every board is synthetic: generated from a semantic description by
// lekhjs's own generator (as ../fixtures/build-fixtures.mjs does), with a few attributes the
// semantic format cannot express patched into the serialized board (a blank and a duplicate page
// name, an inline image). Nothing is copied from a customer board.
//
//   fixtures/export-suite.lekh   7 pages: fixed A4 portrait (background, a shape near the left
//                                edge, one off the page), fixed Letter landscape (inline image),
//                                auto, infinite (negative coordinates), a blank page name, a
//                                duplicate page name, an empty page
//   fixtures/export-large.lekh   3 fixed pages of 5000 x 4000 points (raster cap, banding)
//   expected.json                per page: canvas size type, getCanvasSize(true) and the bounds of
//                                all objects, in board points; the cases derive every plan from them
//
// Run from lekhjs after `npm run build` (it imports dist/node/headless.js):
//   node parity/device-checklist/export-suite/build.mjs [--check]
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
const ids = { next: () => `ex-${String(++seq).padStart(5, '0')}` };
const clock = { now: () => Date.UTC(2026, 9, 23) };
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

const RECT = 'avabodh.basic.rectangle';
/**
 * @param {string} ref
 * @param {number} cx
 * @param {number} cy
 * @param {number} width
 * @param {number} height
 * @param {string | undefined} text
 * @param {Record<string, unknown>} [style]
 */
const node = (ref, cx, cy, width, height, text, style = {}) => ({
  ref,
  shape: RECT,
  cx,
  cy,
  width,
  height,
  ...(text !== undefined ? { text } : {}),
  ...(Object.keys(style).length > 0 ? { style } : {}),
});

// A 48 x 36 opaque red PNG (e2e/fixtures/img-red.png's pixels), drawn as an inline image.
const RED_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAADAAAAAkCAIAAABAJy5dAAAAN0lEQVR4nO3OAQkAMAwDsPo3vcto4YEISC6Z0h8ICQkJjekPhISEhMb0B0JCQkJj+gMhIaHfQw+A/bmbsTDW+wAAAABJRU5ErkJggg==';

function suiteContent() {
  return {
    name: 'export-suite',
    pages: [
      {
        name: 'Fixed A4',
        canvas: { type: 'fixed', width: 21, height: 29.7, unit: 'cm' },
        background: { color: '#fff3c4' },
        nodes: [
          node('a', 200, 150, 200, 100, 'A4 top', { fill: '#1e88e5' }),
          node('edge', 25, 400, 40, 40, undefined, { fill: '#e53935' }),
          node('off', 1300, 600, 120, 80, 'off page', { fill: '#43a047' }),
          node('b', 600, 1500, 300, 120, 'Export suite A4', { font_family: 'Noto Sans', font_size: 20 }),
        ],
        edges: [{ from: 'a', to: 'b' }],
      },
      {
        name: 'Landscape',
        canvas: { type: 'fixed', width: 11, height: 8.5, unit: 'inch' },
        background: { color: '#e3f2fd' },
        nodes: [node('l1', 900, 600, 400, 200, 'Landscape page', { fill: '#fdd835' })],
      },
      {
        name: 'Auto',
        canvas: { type: 'auto' },
        nodes: [
          node('u1', 300, 200, 400, 200, 'Auto page', { fill: '#8e24aa' }),
          node('u2', 700, 900, 200, 100, undefined, { fill: '#00acc1' }),
        ],
      },
      {
        name: 'Infinite',
        canvas: { type: 'infinite' },
        background: { color: '#e8f5e9' },
        nodes: [
          node('i1', -200, -100, 200, 100, 'negative', { fill: '#fb8c00' }),
          node('i2', 300, 250, 200, 100, 'positive', { fill: '#3949ab' }),
        ],
        edges: [{ from: 'i1', to: 'i2' }],
      },
      { name: 'Blank', canvas: { type: 'infinite' }, nodes: [node('n1', 100, 100, 100, 60, 'blank name')] },
      { name: 'Dup', canvas: { type: 'infinite' }, nodes: [node('d1', 0, 0, 80, 80, undefined, { fill: '#6d4c41' })] },
      { name: 'Empty', canvas: { type: 'infinite' }, nodes: [] },
    ],
  };
}

function largeContent() {
  const corners = (/** @type {string} */ p) => [
    node(`${p}tl`, 100, 100, 150, 150, 'TL', { fill: '#e53935' }),
    node(`${p}tr`, 4900, 100, 150, 150, 'TR', { fill: '#43a047' }),
    node(`${p}bl`, 100, 3900, 150, 150, 'BL', { fill: '#1e88e5' }),
    node(`${p}br`, 4900, 3900, 150, 150, 'BR', { fill: '#fdd835' }),
  ];
  const canvas = { type: 'fixed', width: 5000, height: 4000, unit: 'point' };
  return {
    name: 'export-large',
    pages: [1, 2, 3].map((i) => ({ name: `Large ${String(i)}`, canvas, nodes: corners(`p${String(i)}`) })),
  };
}

/**
 * @param {any} content
 * @param {(doc: any) => void} [patch]
 */
function build(content, patch) {
  seq = 0;
  const s = new lib.BoardSession(runtime, { images, scheduler });
  const answer = lib.generate(s, content);
  if (answer.ok !== true) throw new Error(`generate refused ${content.name}: ${JSON.stringify(answer)}`);
  const doc = JSON.parse(s.serialize({ stamp: 'offline' }));
  if (patch) patch(doc);
  const text = JSON.stringify(doc);
  // Re-read the patched board and take the planner's inputs from it (C++ ExportInputBuilder.cpp:25-39).
  const r = new lib.BoardSession(runtime, { images, scheduler });
  const loaded = r.load(text);
  if (loaded.ok !== true) throw new Error(`load refused ${content.name}: ${JSON.stringify(loaded)}`);
  const pages = r.document.pages.map((/** @type {any} */ p, /** @type {number} */ i) => {
    r.layoutAll(p.id);
    const c = p.getCanvasSize(true);
    const b = p.objectStore.hit.boundsOfAll();
    return {
      index: i,
      name: p.name,
      type: ['auto', 'fixed', 'infinite'][p.canvasSizeType] ?? String(p.canvasSizeType),
      canvasSizeType: p.canvasSizeType,
      canvas: { width: round6(c.width), height: round6(c.height) },
      bounds: { x: round6(b.x), y: round6(b.y), width: round6(b.width), height: round6(b.height) },
      objects: p.objectStore.objects.length,
      background: p.background.type === 2 ? colorHex(p.background.color) : null,
    };
  });
  return { text, pages };
}

/** @param {number} v */
const round6 = (v) => Math.round(v * 1e6) / 1e6;
/** @param {any} c */
const colorHex = (c) => '#' + [c.red, c.green, c.blue].map((v) => Number(v).toString(16).padStart(2, '0')).join('');

/** The page objects of a serialized board, in page order. */
function pagesInOrder(/** @type {any} */ doc) {
  return Object.values(doc.pages).sort((a, b) => /** @type {any} */ (a).order - /** @type {any} */ (b).order);
}

const suite = build(suiteContent(), (doc) => {
  const pages = pagesInOrder(doc);
  /** @type {any} */ (pages[4]).name = ''; // C++ names its files page5 (ExportInputBuilder.cpp:63-67)
  /** @type {any} */ (pages[5]).name = 'Infinite'; // a duplicate: -page6 (ExportInputBuilder.cpp:69-73)
  // An inline image on the landscape page (as e2e/fixtures/two-images.lekh carries them).
  /** @type {any} */ (pages[1]).objects['ex-img-1'] = {
    type: 'templated',
    name: 'Image',
    order: 200,
    params: { cx: 300, cy: 250, width: 160, height: 120, angle: 0 },
    template: {
      id: 'avabodh.basic.image',
      texts: '',
      images: [{ location: '0 1 2 3 4 0', data: RED_PNG, format: 'png' }],
      primitive_for_distance: false,
      primitive_for_intersection: false,
      primitive_for_inside: false,
      data: ['0', '0', 'w', 'h', '0'],
      draw: [],
    },
  };
});
const large = build(largeContent());

// Which value each page's type must show, checked here so a generator change cannot pass silently.
const wantTypes = ['fixed', 'fixed', 'auto', 'infinite', 'infinite', 'infinite', 'infinite'];
suite.pages.forEach((/** @type {any} */ p, /** @type {number} */ i) => {
  if (p.type !== wantTypes[i]) throw new Error(`page ${String(i)} is ${p.type}, want ${String(wantTypes[i])}`);
});

const expected = {
  note: 'Board points (1/144 in). Plans: ExportInputBuilder.cpp:25-39; PDF page = plan / 2 pt; raster px = round(plan x scale x hostScale).',
  'export-suite.lekh': suite.pages,
  'export-large.lekh': large.pages,
};

/** @type {Map<string, string>} */
const out = new Map([
  ['fixtures/export-suite.lekh', suite.text],
  ['fixtures/export-large.lekh', large.text],
  ['expected.json', JSON.stringify(expected, null, 2)],
]);

let bad = 0;
for (const [name, body] of out) {
  const file = path.join(here, name);
  const data = Buffer.from(body.endsWith('\n') ? body : body + '\n', 'utf8');
  if (check) {
    const cur = fs.existsSync(file) ? fs.readFileSync(file) : null;
    if (cur === null || !cur.equals(data)) {
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
