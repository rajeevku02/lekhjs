#!/usr/bin/env node
// The export manual suite's machine half (owner round EX2, Work 01M4X7TCHFB862XGT68GPY071C): the
// file cases of README.md as data, the expected files each one produces (derived from
// expected.json with the C++ planner rules), and a checker for the exported files. The root e2e
// spec `e2e/tests/export-suite-web.spec.js` imports it; on iOS, Mac and Android the agent copies
// the exported files to the workstation and runs it from the command line:
//
//   node parity/device-checklist/export-suite/suite.mjs list
//   node parity/device-checklist/export-suite/suite.mjs check EXP-13 --host android --dpr 2.625 \
//        --doc export-suite <file> [<file> ...]
//   node parity/device-checklist/export-suite/suite.mjs inspect <file> [<file> ...]
//
// `check` prints one PASS/FAIL line per expectation and exits 1 on any failure. `--doc` is the
// board name the files were named after (default: the fixture's name, "export-suite").
//
// Expected values (cite the C++ reference, see README.md §2):
//   plan     ExportInputBuilder.cpp:25-39: a non-infinite page with Full Page, or any non-infinite
//            page in a PDF, is getCanvasSize(true); otherwise the bounds of all objects plus the
//            padding on each side. lekhjs planner.ts is the same rule.
//   names    ExportInputBuilder.cpp:48-77
//   PDF      one file, a page of plan/2 x plan/2 points (spec 08 §7, the C++ 72/144 rule)
//   raster   round(plan x scale x hostScale) px; hostScale = devicePixelRatio on Android, 1 on the
//            web, iOS and Mac (lekhboard-capacitor deliver.ts rasterHostScaleFor; the C++ web used
//            devicePixelRatio, export.md §10); the 50 MP page / 100 MP export cap (DR-EXP-04)
//   SVG      root width/height/viewBox = plan; background-color only with Include Background
//   JPEG     white ground, then the page colour with Include Background; PNG transparent
//   web zip  several files on the web are one download `<doc>.zip` holding them under these names
//            (owner round EX3, lekhboard-capacitor deliver.ts / zip.ts); one file stays one file.
//            `check` opens any `.zip` it is given (also Android's `lekh-export.zip`) and checks
//            what is inside; with `--host web` (the default) several files must be that one zip.
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const lekhjs = path.resolve(here, '../../..');
const require = createRequire(path.join(lekhjs, 'package.json'));

export const FIXTURES = {
  S: { file: path.join(here, 'fixtures/export-suite.lekh'), key: 'export-suite.lekh', doc: 'export-suite' },
  L: { file: path.join(here, 'fixtures/export-large.lekh'), key: 'export-large.lekh', doc: 'export-large' },
  M: { file: path.resolve(here, '../fixtures/export-matrix.lekh'), key: null, doc: 'export-matrix' },
};

/** @type {Record<string, any[]>} */
const EXPECTED = JSON.parse(fs.readFileSync(path.join(here, 'expected.json'), 'utf8'));

/** export-matrix.lekh: three fixed A4 pages (../fixtures/build-fixtures.mjs). */
const A4 = { width: 1190.551181, height: 1683.779528 };
const MATRIX_PAGES = ['Fonts', 'Shapes', 'Scripts'].map((name, index) => ({
  index,
  name,
  type: 'fixed',
  canvas: A4,
  bounds: null,
  background: '#ffffff',
}));

/** @param {'S' | 'L' | 'M'} f */
export function pageFacts(f) {
  if (f === 'M') return MATRIX_PAGES;
  const key = FIXTURES[f].key;
  return /** @type {any[]} */ (EXPECTED[/** @type {string} */ (key)]);
}

// Points to sample, in board coordinates, per fixture page: [x, y, what] where `what` is a colour
// (an object's fill) or 'bg' (empty page: the background colour, white or transparent).
const PROBES = {
  S: [
    [
      [110, 110, '#1e88e5'],
      [25, 400, '#e53935'],
      [700, 300, 'bg'],
    ],
    [
      [240, 210, '#ff0000'],
      [1000, 300, 'bg'],
    ],
    [
      [110, 110, '#8e24aa'],
      [700, 300, 'bg'],
    ],
    [
      [-290, -140, '#fb8c00'],
      [-250, 250, 'bg'],
    ],
    [],
    [[-30, -30, '#6d4c41']],
    [],
  ],
  L: [0, 1, 2].map(() => [
    [40, 40, '#e53935'],
    [4960, 3960, '#fdd835'],
    [2500, 2000, 'bg'],
  ]),
  M: [[], [], []],
};

/**
 * The data-driven cases (README.md §4). `pages` are page indices or 'all'; `region`, `padding`,
 * `scale` and `bg` are what the panel is set to before Export (the row may be hidden for the
 * format; its value is still in the saved setting and must not leak into the file).
 * @typedef {{ id: string, fixture: 'S' | 'L' | 'M', format: 'pdf' | 'jpg' | 'png' | 'svg' | 'lekh',
 *   pages: number[] | 'all', scale: number, region: 'full' | 'drawing', padding: number, bg: boolean,
 *   paddingText?: string, extra?: Record<string, unknown>, title: string, entry?: 'board' | 'doclist' }} FileCase
 */
/** @type {FileCase[]} */
export const CASES = [
  {
    id: 'EXP-10',
    title: 'PDF, all pages, background off',
    fixture: 'S',
    format: 'pdf',
    pages: 'all',
    scale: 1,
    region: 'drawing',
    padding: 20,
    bg: false,
  },
  {
    id: 'EXP-11',
    title: 'PDF, pages Landscape + Infinite, background on',
    fixture: 'S',
    format: 'pdf',
    pages: [1, 3],
    scale: 1,
    region: 'drawing',
    padding: 20,
    bg: true,
  },
  {
    id: 'EXP-12',
    title: 'PDF, one page, Full Page, text selectable',
    fixture: 'S',
    format: 'pdf',
    pages: [0],
    scale: 1,
    region: 'full',
    padding: 20,
    bg: false,
    extra: { text: ['Export suite A4', 'A4 top'] },
  },
  {
    id: 'EXP-13',
    title: 'PNG x1, all pages, Drawing Area, padding 20',
    fixture: 'S',
    format: 'png',
    pages: 'all',
    scale: 1,
    region: 'drawing',
    padding: 20,
    bg: false,
  },
  {
    id: 'EXP-14',
    title: 'PNG x2, Full Page, fixed + auto + infinite',
    fixture: 'S',
    format: 'png',
    pages: [0, 2, 3],
    scale: 2,
    region: 'full',
    padding: 20,
    bg: false,
  },
  {
    id: 'EXP-15',
    title: 'JPEG x1, Drawing Area padding 0, background on, landscape page with image',
    fixture: 'S',
    format: 'jpg',
    pages: [1],
    scale: 1,
    region: 'drawing',
    padding: 0,
    bg: true,
  },
  {
    id: 'EXP-16',
    title: 'JPEG x4, Full Page, background on, A4 page',
    fixture: 'S',
    format: 'jpg',
    pages: [0],
    scale: 4,
    region: 'full',
    padding: 0,
    bg: true,
  },
  {
    id: 'EXP-17',
    title: 'JPEG x3, Drawing Area padding 100, background off, auto page',
    fixture: 'S',
    format: 'jpg',
    pages: [2],
    scale: 3,
    region: 'drawing',
    padding: 100,
    bg: false,
  },
  {
    id: 'EXP-18',
    title: 'SVG, all pages, Full Page, background on',
    fixture: 'S',
    format: 'svg',
    pages: 'all',
    scale: 1,
    region: 'full',
    padding: 20,
    bg: true,
  },
  {
    id: 'EXP-19',
    title: 'SVG, Drawing Area padding 20, background off, infinite page',
    fixture: 'S',
    format: 'svg',
    pages: [3],
    scale: 1,
    region: 'drawing',
    padding: 20,
    bg: false,
  },
  {
    id: 'EXP-20',
    title: 'LEKH, round trip',
    fixture: 'S',
    format: 'lekh',
    pages: 'all',
    scale: 1,
    region: 'drawing',
    padding: 20,
    bg: false,
  },
  {
    id: 'EXP-21',
    title: 'PNG after a JPEG with background on: still transparent',
    fixture: 'S',
    format: 'png',
    pages: [1],
    scale: 1,
    region: 'drawing',
    padding: 0,
    bg: true,
  },
  {
    id: 'EXP-22a',
    title: 'Padding typed "" -> 0',
    fixture: 'S',
    format: 'png',
    pages: [4],
    scale: 1,
    region: 'drawing',
    padding: 0,
    paddingText: '',
    bg: false,
  },
  {
    id: 'EXP-22b',
    title: 'Padding typed "abc" -> 0',
    fixture: 'S',
    format: 'png',
    pages: [4],
    scale: 1,
    region: 'drawing',
    padding: 0,
    paddingText: 'abc',
    bg: false,
  },
  {
    id: 'EXP-22c',
    title: 'Padding typed "12abc" -> 12',
    fixture: 'S',
    format: 'png',
    pages: [4],
    scale: 1,
    region: 'drawing',
    padding: 12,
    paddingText: '12abc',
    bg: false,
  },
  {
    id: 'EXP-22d',
    title: 'Padding typed "-10" -> -10',
    fixture: 'S',
    format: 'png',
    pages: [4],
    scale: 1,
    region: 'drawing',
    padding: -10,
    paddingText: '-10',
    bg: false,
  },
  {
    id: 'EXP-22e',
    title: 'Padding typed "7.9" -> 7',
    fixture: 'S',
    format: 'png',
    pages: [4],
    scale: 1,
    region: 'drawing',
    padding: 7,
    paddingText: '7.9',
    bg: false,
  },
  {
    id: 'EXP-23a',
    title: 'Empty page, padding 0: nothing to export',
    fixture: 'S',
    format: 'png',
    pages: [6],
    scale: 1,
    region: 'drawing',
    padding: 0,
    bg: false,
    extra: { empty: true },
  },
  {
    id: 'EXP-23b',
    title: 'Empty page, padding 20: a 40 x 40 transparent image',
    fixture: 'S',
    format: 'png',
    pages: [6],
    scale: 1,
    region: 'drawing',
    padding: 20,
    bg: false,
  },
  {
    id: 'EXP-24',
    title: 'Infinite page: Full Page = Drawing Area',
    fixture: 'S',
    format: 'png',
    pages: [3],
    scale: 1,
    region: 'full',
    padding: 35,
    bg: false,
  },
  {
    id: 'EXP-25',
    title: 'Large page PNG x1 (20 MP, banded)',
    fixture: 'L',
    format: 'png',
    pages: [0],
    scale: 1,
    region: 'full',
    padding: 20,
    bg: false,
  },
  {
    id: 'EXP-26',
    title: 'Large page PNG x2: capped at 50 MP, one toast',
    fixture: 'L',
    format: 'png',
    pages: [0],
    scale: 2,
    region: 'full',
    padding: 20,
    bg: false,
  },
  {
    id: 'EXP-27',
    title: 'Three large pages PNG x2: 100 MP total cap',
    fixture: 'L',
    format: 'png',
    pages: 'all',
    scale: 2,
    region: 'full',
    padding: 20,
    bg: false,
  },
  {
    id: 'EXP-28',
    title: 'Large page JPEG x1 (banded JPEG)',
    fixture: 'L',
    format: 'jpg',
    pages: [0],
    scale: 1,
    region: 'full',
    padding: 20,
    bg: false,
  },
  {
    id: 'EXP-29',
    title: 'Large pages PDF',
    fixture: 'L',
    format: 'pdf',
    pages: 'all',
    scale: 1,
    region: 'full',
    padding: 20,
    bg: false,
  },
  {
    id: 'EXP-34',
    title: 'Doc-list export: PNG x2, Full Page, padding 20 (all pages)',
    fixture: 'S',
    format: 'png',
    pages: 'all',
    scale: 2,
    region: 'full',
    padding: 20,
    bg: false,
    entry: 'doclist',
  },
  {
    id: 'EXP-35',
    title: 'Doc-list export: SVG, Drawing Area padding 10, background on (all pages)',
    fixture: 'S',
    format: 'svg',
    pages: 'all',
    scale: 1,
    region: 'drawing',
    padding: 10,
    bg: true,
    entry: 'doclist',
  },
  {
    id: 'EXP-30',
    title: 'Fonts PDF (export-matrix)',
    fixture: 'M',
    format: 'pdf',
    pages: 'all',
    scale: 1,
    region: 'drawing',
    padding: 20,
    bg: false,
    extra: {
      text: [
        'Noto Sans: The quick brown fox 0123',
        'Noto Serif: The quick brown fox 0123',
        'Noto Sans Mono: The quick brown fox 0123',
        'Caveat: The quick brown fox 0123',
      ],
      fonts: ['NotoSans', 'NotoSerif', 'NotoSansMono', 'Caveat'],
    },
  },
];

export const caseById = (/** @type {string} */ id) => CASES.find((c) => c.id === id);

// ---------------------------------------------------------------- expected files

/** C++ `LekhUtil::trim`. */
const trim = (/** @type {string} */ s) => s.replace(/^[ \t\r\n\f\v]+|[ \t\r\n\f\v]+$/g, '');

/**
 * ExportInputBuilder::makeInput (cpp:21-77): the plan of each selected page and its file name.
 * @param {FileCase} c
 * @param {string} doc
 */
export function planCase(c, doc) {
  const facts = pageFacts(c.fixture);
  const sel = c.pages === 'all' ? facts.map((p) => p.index) : c.pages;
  const ext = '.' + c.format;
  const base = trim(doc) === '' ? 'drawing' : trim(doc);
  const pad = Math.trunc(c.padding);
  const names = new Set();
  /** @type {any[]} */
  const out = [];
  const skipped = [];
  for (const i of sel) {
    const p = facts[i];
    const infinite = p.type === 'infinite';
    let rect;
    if (!infinite && (c.region === 'full' || c.format === 'pdf'))
      rect = { width: p.canvas.width, height: p.canvas.height, tx: 0, ty: 0 };
    else
      rect = {
        width: p.bounds.width + 2 * pad,
        height: p.bounds.height + 2 * pad,
        tx: -(p.bounds.x - pad),
        ty: -(p.bounds.y - pad),
      };
    let name = base + ext;
    if (sel.length > 1) {
      let pn = trim(p.name);
      if (pn === '') pn = `page${String(i + 1)}`;
      name = `${base}-${pn}`;
      if (names.has(name)) name += `-page${String(i + 1)}`;
      names.add(name);
      name += ext;
    }
    if (!(rect.width >= 1 && rect.height >= 1)) {
      skipped.push(i);
      continue;
    }
    out.push({ page: i, fact: p, name, ...rect });
  }
  return { pages: out, skipped, single: base + ext };
}

/** lekhjs planner.ts planRaster: round(w x s), then the 50 MP page / 100 MP total cap (DR-EXP-04). */
export function rasterSizes(/** @type {any[]} */ plans, /** @type {number} */ scale, /** @type {number} */ hostScale) {
  const s0 = (scale > 0 && scale < 8 ? scale : 1) * (hostScale > 0 ? hostScale : 1);
  const px = (/** @type {number} */ v, /** @type {number} */ s) => Math.max(1, Math.round(v * s));
  const first = plans.map((p) => {
    let s = s0;
    let w = px(p.width, s);
    let h = px(p.height, s);
    let down = false;
    if (w * h > 50_000_000) {
      s *= Math.sqrt(50_000_000 / (w * h));
      down = true;
    }
    if (p.width * s > 16_384) {
      s = 16_384 / p.width;
      down = true;
    }
    if (down) {
      w = Math.max(1, Math.floor(p.width * s));
      h = Math.max(1, Math.floor(p.height * s));
    }
    return { w, h, s, down };
  });
  const total = first.reduce((n, r) => n + r.w * r.h, 0);
  if (total <= 100_000_000) return first;
  const f = Math.sqrt(100_000_000 / total);
  return plans.map((p, i) => {
    const s = /** @type {any} */ (first[i]).s * f;
    return { w: Math.max(1, Math.floor(p.width * s)), h: Math.max(1, Math.floor(p.height * s)), s, down: true };
  });
}

/**
 * The files a case must produce, with what to check in each.
 * @param {FileCase} c
 * @param {{ doc?: string, hostScale?: number, host?: string }} [o]
 */
export function expectedFiles(c, o = {}) {
  const e = expectedFilesInZip(c, o);
  const doc = o.doc ?? FIXTURES[c.fixture].doc;
  const base = trim(doc) === '' ? 'drawing' : trim(doc);
  const web = (o.host ?? 'web') === 'web';
  return {
    ...e,
    zip: web && e.files.length > 1 ? `${base}.zip` : null,
    downloads: web && e.files.length > 1 ? 1 : e.files.length,
  };
}

/**
 * The files themselves (on the web, several of them are inside the one zip).
 * @param {FileCase} c
 * @param {{ doc?: string, hostScale?: number }} [o]
 */
function expectedFilesInZip(c, o = {}) {
  const doc = o.doc ?? FIXTURES[c.fixture].doc;
  const plan = planCase(c, doc);
  if (c.extra?.['empty'] === true || plan.pages.length === 0) return { empty: true, files: [], toast: null };
  if (c.format === 'pdf') {
    return {
      empty: false,
      toast: null,
      files: [
        {
          name: plan.single,
          kind: 'pdf',
          pages: plan.pages.map((p) => ({
            width: p.width / 2,
            height: p.height / 2,
            bg: c.bg ? p.fact.background : null,
          })),
          text: c.extra?.['text'] ?? [],
          fonts: c.extra?.['fonts'] ?? [],
        },
      ],
    };
  }
  if (c.format === 'lekh') {
    const facts = pageFacts(c.fixture);
    return {
      empty: false,
      toast: null,
      files: [{ name: plan.single, kind: 'lekh', pageCount: facts.length, objects: facts.map((p) => p.objects) }],
    };
  }
  if (c.format === 'svg') {
    return {
      empty: false,
      toast: null,
      files: plan.pages.map((p) => ({
        name: p.name,
        kind: 'svg',
        width: p.width,
        height: p.height,
        bg: c.bg ? p.fact.background : null,
      })),
    };
  }
  const sizes = rasterSizes(plan.pages, c.scale, o.hostScale ?? 1);
  const firstDown = sizes.find((r) => r.down);
  return {
    empty: false,
    toast: firstDown ? `Image was reduced to ${String(firstDown.w)} × ${String(firstDown.h)} to fit` : null,
    files: plan.pages.map((p, i) => {
      const r = /** @type {any} */ (sizes[i]);
      const probes = (PROBES[c.fixture][p.page] ?? []).map(([bx, by, what]) => {
        const x = Math.floor((bx + p.tx) * r.s);
        const y = Math.floor((by + p.ty) * r.s);
        let want = what;
        if (what === 'bg') want = c.format === 'png' ? 'transparent' : c.bg ? p.fact.background : '#ffffff';
        return { x, y, want, where: `board (${String(bx)}, ${String(by)})` };
      });
      return {
        name: p.name,
        kind: c.format,
        width: r.w,
        height: r.h,
        probes: probes.filter((q) => q.x >= 0 && q.y >= 0 && q.x < r.w && q.y < r.h),
      };
    }),
  };
}

// ---------------------------------------------------------------- reading files

/**
 * The entries of a ZIP (stored or deflated; no ZIP64), from its central directory, with a CRC-32
 * check when this Node has `zlib.crc32`.
 * @param {Buffer} b
 * @returns {{ name: string, bytes: Buffer, crcOk: boolean | null }[]}
 */
export function unzip(b) {
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--)
    if (b.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('not a zip: no end of central directory');
  const n = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const out = [];
  for (let k = 0; k < n; k++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const method = b.readUInt16LE(p + 10);
    const crc = b.readUInt32LE(p + 16);
    const csize = b.readUInt32LE(p + 20);
    const nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const commentLen = b.readUInt16LE(p + 32);
    const off = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const start = off + 30 + b.readUInt16LE(off + 26) + b.readUInt16LE(off + 28);
    const raw = b.subarray(start, start + csize);
    const bytes = method === 0 ? Buffer.from(raw) : method === 8 ? zlib.inflateRawSync(raw) : null;
    if (bytes === null) throw new Error(`${name}: compression method ${String(method)}`);
    const crcFn = /** @type {any} */ (zlib).crc32;
    out.push({
      name: name.replace(/^.*\//, ''),
      bytes,
      crcOk: typeof crcFn === 'function' ? crcFn(bytes) >>> 0 === crc : null,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/**
 * The files with every `.zip` among them replaced by what it holds.
 * @param {{ name: string, bytes: Buffer }[]} files
 */
export function expandZips(files) {
  return files.flatMap((f) => (f.name.toLowerCase().endsWith('.zip') ? unzip(f.bytes) : [f]));
}

/** @param {Buffer} b */
export function pngSize(b) {
  if (b.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/** @param {Buffer} b */
export function jpegSize(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) return null;
    const m = /** @type {number} */ (b[i + 1]);
    const len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

/**
 * Samples pixels of a PNG or JPEG through @napi-rs/canvas.
 * @param {Buffer} b
 * @param {{x: number, y: number}[]} pts
 */
export async function samplePixels(b, pts) {
  if (pts.length === 0) return [];
  const { loadImage, createCanvas } = require('@napi-rs/canvas');
  const img = await loadImage(b);
  const out = [];
  const cv = createCanvas(1, 1);
  const ctx = cv.getContext('2d');
  for (const p of pts) {
    ctx.clearRect(0, 0, 1, 1);
    ctx.drawImage(img, p.x, p.y, 1, 1, 0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    out.push([d[0], d[1], d[2], d[3]]);
  }
  return out;
}

/** @param {Buffer} b */
export async function pdfInfo(b) {
  const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  const task = pdfjs.getDocument({ data: new Uint8Array(b), verbosity: 0, disableFontFace: true });
  const doc = await task.promise;
  const pages = [];
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const [x0, y0, x1, y1] = p.view;
    const ops = await p.getOperatorList();
    let firstFill = null;
    for (let k = 0; k < ops.fnArray.length; k++) {
      if (ops.fnArray[k] === pdfjs.OPS.setFillRGBColor) {
        const a = ops.argsArray[k];
        firstFill =
          typeof a[0] === 'string'
            ? a[0].toLowerCase()
            : '#' +
              a
                .slice(0, 3)
                .map((/** @type {number} */ v) => Math.round(v).toString(16).padStart(2, '0'))
                .join('');
        break;
      }
    }
    const tc = await p.getTextContent();
    const pageText = tc.items.map((/** @type {any} */ it) => it.str ?? '').join(' ');
    text += pageText + '\n';
    pages.push({ width: x1 - x0, height: y1 - y0, firstFill });
  }
  const latin = b.toString('latin1');
  const fonts = [
    ...new Set(
      [...latin.matchAll(/\/BaseFont\s*\/([A-Z]{6}\+)?([A-Za-z0-9-]+)/g)].map((m) => /** @type {string} */ (m[2])),
    ),
  ];
  await task.destroy();
  return { numPages: pages.length, pages, text, fonts };
}

/** @param {string} s */
export function svgInfo(s) {
  const root = /<svg\b([^>]*)>/.exec(s);
  const attr = (/** @type {string} */ n) =>
    root ? (new RegExp(`\\b${n}="([^"]*)"`).exec(/** @type {string} */ (root[1]))?.[1] ?? null) : null;
  const bg = root ? /background-color:\s*rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(/** @type {string} */ (root[1])) : null;
  return {
    width: attr('width'),
    height: attr('height'),
    viewBox: attr('viewBox'),
    background: bg
      ? '#' +
        bg
          .slice(1, 4)
          .map((v) => Number(v).toString(16).padStart(2, '0'))
          .join('')
      : null,
    images: (s.match(/<image\b/g) ?? []).length,
  };
}

/** @param {string} hex */
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/**
 * Checks exported files against a case. `files` are { name, bytes } (bytes: Buffer).
 * @param {FileCase} c
 * @param {{ name: string, bytes: Buffer }[]} downloads the downloaded or shared files (a zip is opened)
 * @param {{ doc?: string, hostScale?: number, tolerance?: number, host?: string }} [o]
 * @returns {Promise<{ ok: boolean, lines: string[] }>}
 */
export async function checkCase(c, downloads, o = {}) {
  const exp = expectedFiles(c, o);
  const tol = o.tolerance ?? 8;
  /** @type {string[]} */
  const lines = [];
  let ok = true;
  const t = (/** @type {boolean} */ pass, /** @type {string} */ what) => {
    if (!pass) ok = false;
    lines.push(`${pass ? 'PASS' : 'FAIL'} ${c.id} ${what}`);
  };
  if (exp.zip !== null) {
    const got = downloads.map((f) => f.name);
    t(got.length === 1 && got[0] === exp.zip, `one download ${JSON.stringify(got)} (want ["${exp.zip}"])`);
  }
  /** @type {{ name: string, bytes: Buffer, crcOk?: boolean | null }[]} */
  let files = downloads;
  try {
    files = expandZips(downloads);
  } catch (e) {
    t(false, `zip readable: ${String(e)}`);
  }
  for (const f of files) if (f.crcOk === false) t(false, `${f.name} CRC-32 in the zip`);
  t(files.length === exp.files.length, `file count ${String(files.length)} (want ${String(exp.files.length)})`);
  const want = exp.files.map((f) => f.name).sort();
  const got = files.map((f) => f.name).sort();
  t(JSON.stringify(want) === JSON.stringify(got), `file names ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
  for (const e of /** @type {any[]} */ (exp.files)) {
    const f = files.find((x) => x.name === e.name);
    if (!f) continue;
    if (e.kind === 'png' || e.kind === 'jpg') {
      const sz = e.kind === 'png' ? pngSize(f.bytes) : jpegSize(f.bytes);
      t(sz !== null, `${e.name} is a ${e.kind.toUpperCase()}`);
      if (sz === null) continue;
      t(
        sz.width === e.width && sz.height === e.height,
        `${e.name} ${String(sz.width)} x ${String(sz.height)} px (want ${String(e.width)} x ${String(e.height)})`,
      );
      const px = await samplePixels(f.bytes, e.probes);
      e.probes.forEach((/** @type {any} */ q, /** @type {number} */ k) => {
        const p = /** @type {number[]} */ (px[k]);
        let pass;
        if (q.want === 'transparent') pass = p[3] === 0;
        else {
          const [r = 0, g = 0, b = 0] = rgb(q.want);
          const [pr = 0, pg = 0, pb = 0, pa = 0] = p;
          pass = pa === 255 && Math.abs(pr - r) <= tol && Math.abs(pg - g) <= tol && Math.abs(pb - b) <= tol;
        }
        t(
          pass,
          `${e.name} pixel (${String(q.x)}, ${String(q.y)}) at ${q.where} = rgba(${p.join(', ')}) (want ${q.want})`,
        );
      });
    } else if (e.kind === 'pdf') {
      const info = await pdfInfo(f.bytes);
      t(info.numPages === e.pages.length, `${e.name} ${String(info.numPages)} pages (want ${String(e.pages.length)})`);
      e.pages.forEach((/** @type {any} */ wp, /** @type {number} */ k) => {
        const gp = info.pages[k];
        if (!gp) return;
        t(
          Math.abs(gp.width - wp.width) < 0.5 && Math.abs(gp.height - wp.height) < 0.5,
          `${e.name} page ${String(k + 1)} ${gp.width.toFixed(2)} x ${gp.height.toFixed(2)} pt (want ${wp.width.toFixed(2)} x ${wp.height.toFixed(2)})`,
        );
        if (wp.bg !== null)
          t(
            gp.firstFill === wp.bg,
            `${e.name} page ${String(k + 1)} first fill ${String(gp.firstFill)} (want the background ${String(wp.bg)})`,
          );
      });
      for (const s of e.text) t(info.text.includes(s), `${e.name} text "${s}" extractable`);
      for (const fnt of e.fonts)
        t(
          info.fonts.some((x) => x.replace(/-.*/, '') === fnt),
          `${e.name} embeds font ${fnt} (${info.fonts.join(', ')})`,
        );
    } else if (e.kind === 'svg') {
      const s = svgInfo(f.bytes.toString('utf8'));
      const num = (/** @type {string | null} */ v) => (v === null ? NaN : Number(v));
      t(
        Math.abs(num(s.width) - e.width) < 0.001 && Math.abs(num(s.height) - e.height) < 0.001,
        `${e.name} width/height ${String(s.width)} x ${String(s.height)} (want ${String(e.width)} x ${String(e.height)})`,
      );
      t(s.viewBox === `0 0 ${String(s.width)} ${String(s.height)}`, `${e.name} viewBox "${String(s.viewBox)}"`);
      t(s.background === e.bg, `${e.name} background ${String(s.background)} (want ${String(e.bg)})`);
    } else if (e.kind === 'lekh') {
      let j = null;
      try {
        j = JSON.parse(f.bytes.toString('utf8'));
      } catch {
        /* reported below */
      }
      t(j !== null, `${e.name} parses as JSON`);
      if (j === null) continue;
      t(j.info?.version === '5.0', `${e.name} info.version ${String(j.info?.version)} (want 5.0)`);
      const pages = Object.values(j.pages ?? {}).sort(
        (a, b) => /** @type {any} */ (a).order - /** @type {any} */ (b).order,
      );
      t(pages.length === e.pageCount, `${e.name} ${String(pages.length)} pages (want ${String(e.pageCount)})`);
      const counts = pages.map((p) => Object.keys(/** @type {any} */ (p).objects ?? {}).length);
      t(
        JSON.stringify(counts) === JSON.stringify(e.objects),
        `${e.name} objects per page ${JSON.stringify(counts)} (want ${JSON.stringify(e.objects)})`,
      );
    }
  }
  return { ok, lines };
}

/**
 * What a file is, for the `inspect` command and for results notes (a zip: what each entry is).
 * @returns {Promise<Record<string, unknown>>}
 */
export async function inspect(/** @type {string} */ name, /** @type {Buffer} */ bytes) {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.png') return { name, png: pngSize(bytes) };
  if (ext === '.jpg' || ext === '.jpeg') return { name, jpeg: jpegSize(bytes) };
  if (ext === '.pdf') return { name, pdf: await pdfInfo(bytes) };
  if (ext === '.svg') return { name, svg: svgInfo(bytes.toString('utf8')) };
  if (ext === '.lekh') return { name, bytes: bytes.length };
  if (ext === '.zip') return { name, zip: await Promise.all(unzip(bytes).map((e) => inspect(e.name, e.bytes))) };
  return { name, bytes: bytes.length };
}

// ---------------------------------------------------------------- CLI

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'list') {
    for (const c of CASES) console.log(`${c.id}\t${c.title}`);
    return;
  }
  /** @type {Record<string, string>} */
  const flags = {};
  const files = [];
  for (let i = 0; i < rest.length; i++) {
    const a = /** @type {string} */ (rest[i]);
    if (a.startsWith('--')) flags[a.slice(2)] = /** @type {string} */ (rest[++i]);
    else files.push(a);
  }
  if (cmd === 'inspect') {
    for (const f of files) console.log(JSON.stringify(await inspect(path.basename(f), fs.readFileSync(f))));
    return;
  }
  if (cmd === 'check') {
    const id = files.shift();
    const c = id ? caseById(id) : undefined;
    if (!c) throw new Error(`unknown case ${String(id)}; see "list"`);
    const host = flags['host'] ?? 'web';
    const dpr = Number(flags['dpr'] ?? '1');
    const hostScale = host === 'android' ? dpr : 1;
    const r = await checkCase(
      c,
      files.map((f) => ({ name: path.basename(f), bytes: fs.readFileSync(f) })),
      {
        ...(flags['doc'] !== undefined ? { doc: flags['doc'] } : {}),
        hostScale,
        host,
      },
    );
    for (const l of r.lines) console.log(l);
    const exp = expectedFiles(c, { hostScale, ...(flags['doc'] !== undefined ? { doc: flags['doc'] } : {}) });
    if (exp.toast) console.log(`NOTE ${c.id} expect one toast: "${exp.toast}"`);
    process.exit(r.ok ? 0 : 1);
  }
  console.log(
    'usage: suite.mjs list | check <EXP-id> [--host web|ios|mac|android] [--dpr N] [--doc name] <files...> | inspect <files...>',
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
