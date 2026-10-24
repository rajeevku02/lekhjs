#!/usr/bin/env node
// The multilingual export suite's machine half (round I18N1, Work 01M4X7TCHFB862XGT68GPY071C): the
// file cases of README.md as data, the files each one produces, and a checker that looks inside
// them per text box. The root e2e spec `e2e/tests/export-i18n-web.spec.js` imports it; on iOS, Mac,
// Android and other browsers the files are copied to a machine with this repository and checked
// from the command line:
//
//   node parity/device-checklist/export-i18n/suite.mjs list
//   node parity/device-checklist/export-i18n/suite.mjs check I18N-01 --host ios [--dpr N] [--toast yes|no] <files...>
//   node parity/device-checklist/export-i18n/suite.mjs inspect <files...>
//   node parity/device-checklist/export-i18n/suite.mjs reference <I18N-01.pdf> <I18N-05.pdf> <I18N-07.pdf>
//   node parity/device-checklist/export-i18n/suite.mjs shaping [--noto ../lekhboard/fonts/noto] [<extra font files>]
//   node parity/device-checklist/export-i18n/suite.mjs checklist
//
// The plan, the file names, the raster sizes and the zip reader are the export suite's
// (../export-suite/suite.mjs: planCase, rasterSizes, expandZips, pngSize, jpegSize); this file adds
// what is about text. Per target (a box whose text is checked; build.mjs lists them in
// expected.json):
//
//   PDF   pdf.js text extraction inside the box, compared with the sample after normalisation
//         (NFKC; whitespace, ZWJ/ZWNJ, bidi controls and variation selectors removed): in order for
//         left-to-right scripts without reordering, as a multiset of code points after NFKD where
//         the sample says `pdfOrder: visual` (RTL, pre-base and two-part vowels). Emoji clusters are never text. The box's
//         mode is `text` (extracted), `image` (an image drawn in the box, no text), `outline`
//         (ink but no text and no image: glyph outlines) or `missing` (blank); it must be one the
//         sample allows for the host (samples.json expect.pdf, per-style overrides). The page is
//         rendered by pdf.js and the box must have ink. On the web the font of the extracted text
//         is checked too (expect.webFont).
//   SVG   the box's <tspan>s: their text equals the sample exactly (no normalisation: the SVG
//         keeps the board's string, NFD included), the font-family names the box's family quoted
//         plus a generic family; wrapped boxes: several lines, no line break inside a grapheme,
//         at a word boundary for Thai/Lao/Khmer/Myanmar, kinsoku for Japanese and Chinese.
//   PNG / JPEG  ink in the box (not blank), compared with the reference render (references/,
//         pdf.js renders of the web PDF in Noto fonts) by ink coverage and ink extent, with a
//         tolerance wide enough for another platform's fonts; wrapped boxes: nothing drawn in the
//         gap to their right (no overflow).
//   names the file names (and a web zip's names, with its UTF-8 flag) after Unicode NFC; an exact
//         byte match is reported separately (a file system may store names decomposed).
//   LEKH  every text of the exported board equals the fixture's, code point for code point.
//
// Shaping, bidi order and line breaks are judged by eye (README §6 and references/).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { planCase, rasterSizes, expandZips, pngSize, jpegSize, unzip } from '../export-suite/suite.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const lekhjs = path.resolve(here, '../../..');
const require = createRequire(path.join(lekhjs, 'package.json'));

const SAMPLES_DOC = JSON.parse(fs.readFileSync(path.join(here, 'samples.json'), 'utf8'));
/** @type {any[]} */
export const SAMPLES = SAMPLES_DOC.samples;
export const HOSTS = ['web', 'ios', 'mac', 'android'];
const EXPECTED = JSON.parse(fs.readFileSync(path.join(here, 'expected.json'), 'utf8'));
const REFERENCE_FILE = path.join(here, 'references/metrics.json');

export const NAMES_BOARD = /** @type {string} */ (EXPECTED.namesBoard);
export const NAMES_FOLDER = /** @type {string} */ (EXPECTED.namesFolder);

export const FIXTURES = {
  scripts: { file: path.join(here, 'fixtures/i18n-scripts.lekh'), key: 'i18n-scripts.lekh', doc: 'i18n-scripts' },
  styles: { file: path.join(here, 'fixtures/i18n-styles.lekh'), key: 'i18n-styles.lekh', doc: 'i18n-styles' },
  layout: { file: path.join(here, 'fixtures/i18n-layout.lekh'), key: 'i18n-layout.lekh', doc: 'i18n-layout' },
  names: { file: path.join(here, 'fixtures/i18n-names.lekh'), key: 'i18n-names.lekh', doc: NAMES_BOARD },
};

/** @param {keyof typeof FIXTURES} f @returns {any[]} */
export const pageFacts = (f) => EXPECTED[FIXTURES[f].key];
export const sampleById = (/** @type {string} */ id) => SAMPLES.find((s) => s.id === id);

/**
 * @typedef {{ id: string, title: string, fixture: keyof typeof FIXTURES, format: 'pdf' | 'png' | 'jpg' | 'svg' | 'lekh',
 *   pages: number[] | 'all', scale: number, region: 'drawing' | 'full', padding: number, bg: boolean,
 *   entry?: 'board' | 'doclist', network?: 'online' | 'offline-warm' | 'offline-cold', names?: boolean,
 *   hosts: string[] }} I18nCase
 */
/** @type {I18nCase[]} */
export const CASES = [
  { id: 'I18N-01', title: 'PDF, every script', fixture: 'scripts', format: 'pdf', pages: 'all' },
  { id: 'I18N-02', title: 'PNG x1, every script', fixture: 'scripts', format: 'png', pages: 'all' },
  { id: 'I18N-03', title: 'SVG, every script', fixture: 'scripts', format: 'svg', pages: 'all' },
  {
    id: 'I18N-04',
    title: 'JPEG x2, CJK page, background on',
    fixture: 'scripts',
    format: 'jpg',
    pages: [4],
    scale: 2,
    bg: true,
  },
  {
    id: 'I18N-05',
    title: 'PDF, bold / italic and the four families per script',
    fixture: 'styles',
    format: 'pdf',
    pages: 'all',
  },
  {
    id: 'I18N-06',
    title: 'PNG x1, bold / italic and the four families',
    fixture: 'styles',
    format: 'png',
    pages: 'all',
  },
  {
    id: 'I18N-07',
    title: 'PDF, shape labels, free text, connector labels, wrapping, mixed runs',
    fixture: 'layout',
    format: 'pdf',
    pages: 'all',
  },
  { id: 'I18N-08', title: 'PNG x1, containers, wrapping and runs', fixture: 'layout', format: 'png', pages: 'all' },
  {
    id: 'I18N-09',
    title: 'SVG, containers, wrapping and runs (line breaks)',
    fixture: 'layout',
    format: 'svg',
    pages: 'all',
  },
  {
    id: 'I18N-10',
    title: 'PNG x1 of a board and pages with non-Latin names (file names)',
    fixture: 'names',
    format: 'png',
    pages: 'all',
    names: true,
  },
  {
    id: 'I18N-11',
    title: 'PDF of the non-Latin board (one file, its name)',
    fixture: 'names',
    format: 'pdf',
    pages: 'all',
    names: true,
  },
  {
    id: 'I18N-12',
    title: 'Doc list: PDF of a non-Latin folder (the folder zip and the names in it)',
    fixture: 'names',
    format: 'pdf',
    pages: 'all',
    entry: 'doclist',
    names: true,
  },
  {
    id: 'I18N-13a',
    title: 'Toast: PDF of the Latin/Greek/Cyrillic page only (no toast)',
    fixture: 'scripts',
    format: 'pdf',
    pages: [0],
  },
  {
    id: 'I18N-13b',
    title: 'Toast: PDF of the emoji page only (emoji are images, no toast)',
    fixture: 'scripts',
    format: 'pdf',
    pages: [6],
  },
  {
    id: 'I18N-13c',
    title: 'Toast: PDF of the Others page (Tibetan: an image and the toast on the web)',
    fixture: 'scripts',
    format: 'pdf',
    pages: [7],
  },
  {
    id: 'I18N-14',
    title: 'PDF, every script, offline after I18N-01 (cached fonts)',
    fixture: 'scripts',
    format: 'pdf',
    pages: 'all',
    network: 'offline-warm',
  },
  {
    id: 'I18N-15',
    title: 'PDF, every script, offline before any script font was downloaded (web)',
    fixture: 'scripts',
    format: 'pdf',
    pages: 'all',
    network: 'offline-cold',
    hosts: ['web'],
  },
  { id: 'I18N-16', title: 'LEKH round trip of every script', fixture: 'scripts', format: 'lekh', pages: 'all' },
].map((c) => ({
  scale: 1,
  region: 'drawing',
  padding: 20,
  bg: false,
  entry: 'board',
  network: 'online',
  hosts: HOSTS,
  ...c,
}));

export const caseById = (/** @type {string} */ id) => CASES.find((c) => c.id === id);

// ---------------------------------------------------------------- text helpers

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export const graphemes = (/** @type {string} */ s) => Array.from(segmenter.segment(s), (g) => g.segment);

/** lekhjs `isEmojiCluster` (src/export/pdf/text-run-splitter.ts): emoji are images in every PDF. */
export function isEmojiCluster(/** @type {string} */ text) {
  const cps = Array.from(text);
  const first = cps[0] ?? '';
  if (cps.includes('\u20e3')) return /^[0-9#*]$/u.test(first);
  if (/\p{Emoji_Presentation}/u.test(first)) return true;
  return (
    cps.length > 1 && /\p{Extended_Pictographic}/u.test(first) && (cps.includes('\ufe0f') || cps.includes('\u200d'))
  );
}

// A class of single code points (variation selectors listed on purpose, not as a combined character).
// eslint-disable-next-line no-misleading-character-class
const IGNORED = /[\s\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufe00-\ufe0f\ufeff\u{e0000}-\u{e0fff}]/gu;
/** The comparison form of PDF text: NFKC, without whitespace and default-ignorable characters. */
export const normPdf = (/** @type {string} */ s) => s.normalize('NFKC').replace(IGNORED, '');
const withoutEmoji = (/** @type {string} */ s) =>
  graphemes(s)
    .filter((g) => !isEmojiCluster(g))
    .join('');
const hasEmoji = (/** @type {string} */ s) => graphemes(s).some(isEmojiCluster);
/** The characters of `s` as a sorted multiset, after canonical decomposition (a two-part vowel such as
 * ொ is drawn as two glyphs, ெ before the consonant and ா after it, and extracts as those two). */
const sortedCps = (/** @type {string} */ s) => Array.from(s.normalize('NFKD')).sort().join('');
/** Characters in `a` and not in `b` (multiset difference), for a FAIL line. */
function cpDiff(/** @type {string} */ a, /** @type {string} */ b) {
  const rest = Array.from(b);
  const out = [];
  for (const c of a) {
    const i = rest.indexOf(c);
    if (i >= 0) rest.splice(i, 1);
    else out.push(c);
  }
  return out.map((c) => `${c}(U+${/** @type {number} */ (c.codePointAt(0)).toString(16).toUpperCase()})`).join(' ');
}

// ---------------------------------------------------------------- expectations

/** The variant group whose overrides apply (samples.json expect.bold). */
const variantKey = (/** @type {string} */ v) => (v === 'bold' || v === 'bold-italic' ? 'bold' : null);

/**
 * The PDF modes a target may have on a host, with the reason when it is not plain text.
 * @param {any} target
 * @param {string} host
 * @param {I18nCase} c
 * @returns {{ modes: string[], why: string | null, verified: boolean }}
 */
export function allowedPdfModes(target, host, c) {
  const s = sampleById(target.sample);
  const h = host === 'web' || host.startsWith('web-') ? 'web' : host;
  let v = s.expect.pdf[h] ?? 'text';
  let why = s.expect.why?.[h] ?? null;
  const vk = variantKey(target.variant);
  const o = vk !== null ? s.expect[vk]?.[h] : undefined;
  if (o !== undefined) {
    v = o.pdf;
    why = o.why;
  }
  if (c.network === 'offline-cold' && s.expect.webFont !== 'NotoSans') {
    // Only the bundled faces (Noto Sans and its three siblings) are at hand: every other script
    // is drawn as an image, or partly as text where the box mixes in bundled characters.
    v = hasEmoji(s.text) && withoutEmoji(s.text).trim() === '' ? 'image' : ['image', 'partial', 'text'];
    why = 'Offline before any script font was downloaded: only the bundled faces are available (export.md §7).';
  }
  return { modes: Array.isArray(v) ? v : [v], why, verified: s.expect.verified?.[h] === true };
}

/** Whether a PDF of the case's pages should raise "Some text was exported as an image…" on a host. */
export function expectedToast(/** @type {I18nCase} */ c, /** @type {string} */ host) {
  if (c.format !== 'pdf') return 'no';
  const facts = pageFacts(c.fixture);
  const sel = c.pages === 'all' ? facts.map((p) => p.index) : c.pages;
  let yes = false;
  let maybe = false;
  for (const i of sel)
    for (const t of facts[i].targets) {
      const s = sampleById(t.sample);
      if (withoutEmoji(s.text).trim() === '') continue; // emoji never toast
      const { modes } = allowedPdfModes(t, host, c);
      if (modes.every((m) => m === 'image' || m === 'partial')) yes = true;
      else if (modes.includes('image') || modes.includes('partial')) maybe = true;
    }
  return yes ? 'yes' : maybe ? 'either' : 'no';
}

// ---------------------------------------------------------------- expected files

/**
 * The files a case produces, by the export suite's rules (planCase, rasterSizes).
 * @param {I18nCase} c
 * @param {{ doc?: string, hostScale?: number, host?: string }} [o]
 */
export function expectedFiles(c, o = {}) {
  const doc = o.doc ?? (c.entry === 'doclist' ? FIXTURES[c.fixture].doc : FIXTURES[c.fixture].doc);
  const facts = pageFacts(c.fixture);
  const plan = planCase(c, doc, facts);
  const web = (o.host ?? 'web').startsWith('web');
  if (c.entry === 'doclist') {
    // The folder holds the names board and the layout board: one PDF each, in `<folder>.zip` on the web.
    const files = [
      { name: `${FIXTURES.names.doc}.pdf`, kind: 'pdf', fixture: 'names', plans: plan.pages },
      {
        name: `${FIXTURES.layout.doc}.pdf`,
        kind: 'pdf',
        fixture: 'layout',
        plans: planCase(c, FIXTURES.layout.doc, pageFacts('layout')).pages,
      },
    ];
    return { files, zip: web ? `${NAMES_FOLDER}.zip` : null };
  }
  if (c.format === 'pdf' || c.format === 'lekh') {
    return { files: [{ name: plan.single, kind: c.format, fixture: c.fixture, plans: plan.pages }], zip: null };
  }
  const sizes = c.format === 'svg' ? null : rasterSizes(plan.pages, c.scale, o.hostScale ?? 1);
  const files = plan.pages.map((p, i) => ({
    name: p.name,
    kind: c.format,
    fixture: c.fixture,
    plans: [p],
    size: sizes ? { width: sizes[i]?.w, height: sizes[i]?.h, s: sizes[i]?.s } : null,
  }));
  return { files, zip: web && files.length > 1 ? `${doc.trim() === '' ? 'drawing' : doc.trim()}.zip` : null };
}

// ---------------------------------------------------------------- PDF reading

/** @type {any} */
let pdfjsMod = null;
const pdfjs = async () =>
  (pdfjsMod ??= await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href));

/** 2-D affine [a b c d e f] product (pdf.js order: m1 then m2). */
const mul = (/** @type {number[]} */ m1, /** @type {number[]} */ m2) => [
  m1[0] * m2[0] + m1[2] * m2[1],
  m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3],
  m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
  m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];
const apply = (/** @type {number[]} */ m, /** @type {number} */ x, /** @type {number} */ y) => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

/**
 * Every page of a PDF as text items, image rectangles and a raster, all in pixels at `pxPerPt`
 * (2 px per point = 1 px per board point: a PDF page is plan / 2 points).
 * @param {Buffer | Uint8Array} bytes
 */
export async function readPdf(bytes, pxPerPt = 2) {
  const lib = await pdfjs();
  const { createCanvas } = require('@napi-rs/canvas');
  const task = lib.getDocument({ data: new Uint8Array(bytes), verbosity: 0, disableFontFace: true });
  const doc = await task.promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: pxPerPt });
    const toPx = (/** @type {number} */ x, /** @type {number} */ y) => vp.convertToViewportPoint(x, y);
    const ops = await page.getOperatorList();
    /** @type {{ x: number, y: number, w: number, h: number }[]} */
    const imagesPx = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    for (let k = 0; k < ops.fnArray.length; k++) {
      const fn = ops.fnArray[k];
      const a = ops.argsArray[k];
      if (fn === lib.OPS.save) stack.push(ctm);
      else if (fn === lib.OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
      else if (fn === lib.OPS.transform) ctm = mul(ctm, a);
      else if (
        fn === lib.OPS.paintImageXObject ||
        fn === lib.OPS.paintInlineImageXObject ||
        fn === lib.OPS.paintImageMaskXObject ||
        fn === lib.OPS.paintImageXObjectRepeat
      ) {
        const corners = [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ].map(([x, y]) => {
          const [ux, uy] = apply(ctm, /** @type {number} */ (x), /** @type {number} */ (y));
          return toPx(ux, uy);
        });
        const xs = corners.map((c) => c[0]);
        const ys = corners.map((c) => c[1]);
        imagesPx.push({
          x: Math.min(...xs),
          y: Math.min(...ys),
          w: Math.max(...xs) - Math.min(...xs),
          h: Math.max(...ys) - Math.min(...ys),
        });
      }
    }
    const tc = await page.getTextContent({ disableNormalization: true });
    /** @type {Map<string, string>} */
    const fontNames = new Map();
    const fontOf = (/** @type {string} */ id) => {
      if (!fontNames.has(id)) {
        let name = id;
        try {
          if (page.commonObjs.has(id)) name = String(page.commonObjs.get(id)?.name ?? id);
        } catch {
          /* keep the id */
        }
        fontNames.set(id, name);
      }
      return /** @type {string} */ (fontNames.get(id));
    };
    const items = tc.items
      .filter((/** @type {any} */ it) => typeof it.str === 'string' && it.str !== '')
      .map((/** @type {any} */ it) => {
        const [e, f] = [it.transform[4], it.transform[5]];
        const h = Math.abs(it.transform[3]) || it.height || 0;
        const [x0, y0] = toPx(e, f);
        const [x1, y1] = toPx(e + it.width, f + h * 0.7);
        return {
          str: it.str,
          dir: it.dir,
          font: fontOf(it.fontName),
          x: Math.min(x0, x1),
          y: Math.min(y0, y1),
          w: Math.abs(x1 - x0),
          h: Math.abs(y1 - y0),
          cx: (x0 + x1) / 2,
          cy: (y0 + y1) / 2,
        };
      });
    const W = Math.ceil(vp.width);
    const H = Math.ceil(vp.height);
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
    const data = ctx.getImageData(0, 0, W, H).data;
    pages.push({
      width: vp.width / pxPerPt,
      height: vp.height / pxPerPt,
      items,
      images: imagesPx,
      raster: { width: W, height: H, data, opaque: true },
      canvas,
    });
  }
  await task.destroy();
  return pages;
}

// ---------------------------------------------------------------- raster helpers

/** Decodes a PNG/JPEG to RGBA through @napi-rs/canvas. */
export async function decodeImage(/** @type {Buffer} */ b) {
  const { loadImage, createCanvas } = require('@napi-rs/canvas');
  const img = await loadImage(b);
  const cv = createCanvas(img.width, img.height);
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return {
    width: img.width,
    height: img.height,
    data: ctx.getImageData(0, 0, img.width, img.height).data,
    opaque: false,
  };
}

/**
 * Ink inside a pixel rectangle: a pixel is ink when, over white, it differs from white by more
 * than 96 (sum of |255 − channel|). Returns the fraction of ink pixels and the ink extent as a
 * fraction of the rectangle's width and height.
 * @param {{ width: number, height: number, data: Uint8ClampedArray | Uint8Array }} img
 * @param {{ x: number, y: number, w: number, h: number }} r
 */
export function inkIn(img, r) {
  const x0 = Math.max(0, Math.round(r.x));
  const y0 = Math.max(0, Math.round(r.y));
  const x1 = Math.min(img.width, Math.round(r.x + r.w));
  const y1 = Math.min(img.height, Math.round(r.y + r.h));
  let n = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 4;
      const a = /** @type {number} */ (img.data[i + 3]) / 255;
      const d =
        255 -
        /** @type {number} */ (img.data[i] * a + 255 * (1 - a)) +
        (255 - /** @type {number} */ (img.data[i + 1] * a + 255 * (1 - a))) +
        (255 - /** @type {number} */ (img.data[i + 2] * a + 255 * (1 - a)));
      if (d > 96) {
        n++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const area = Math.max(1, (x1 - x0) * (y1 - y0));
  return {
    ink: n / area,
    extentW: n === 0 ? 0 : (maxX - minX + 1) / Math.max(1, x1 - x0),
    extentH: n === 0 ? 0 : (maxY - minY + 1) / Math.max(1, y1 - y0),
  };
}

/** A target's rectangle in a file's pixels: board → plan (translate) → × scale, inset by `inset` board points. */
function targetPx(/** @type {number[]} */ rect, /** @type {any} */ plan, /** @type {number} */ s, inset = 0) {
  const [x, y, w, h] = /** @type {[number, number, number, number]} */ (rect);
  return { x: (x + inset + plan.tx) * s, y: (y + inset + plan.ty) * s, w: (w - 2 * inset) * s, h: (h - 2 * inset) * s };
}
/** The inset that keeps a box's border out of its ink: shapes and wrapped boxes have one. */
const insetOf = (/** @type {any} */ t) => (t.kind === 'shape' || t.kind === 'wrap' ? 4 : 0);

/** Reference metrics (references/metrics.json), or null before `reference` has been run. */
function loadReference() {
  return fs.existsSync(REFERENCE_FILE) ? JSON.parse(fs.readFileSync(REFERENCE_FILE, 'utf8')) : null;
}
/** Tolerance of the reference comparison (README §5): ink coverage and ink width ratios. */
export const REF_TOLERANCE = { ink: [0.35, 2.8], extentW: [0.5, 1.8] };

// ---------------------------------------------------------------- SVG reading

const unescapeXml = (/** @type {string} */ s) =>
  s.replace(/&(amp|quot|apos|lt|gt|#x[0-9a-f]+|#\d+);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
    return String.fromCodePoint(parseInt(k.slice(1), 10));
  });

/** Every <text> of an SVG: its style and its tspans (x, y, text), in document order. */
export function svgTexts(/** @type {string} */ svg) {
  const out = [];
  for (const m of svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const attrs = /** @type {string} */ (m[1]);
    const style = unescapeXml(/\bstyle="([^"]*)"/.exec(attrs)?.[1] ?? '');
    const spans = [.../** @type {string} */ (m[2]).matchAll(/<tspan\b([^>]*)>([\s\S]*?)<\/tspan>/g)].map((t) => ({
      x: Number(/\bx="([^"]*)"/.exec(/** @type {string} */ (t[1]))?.[1] ?? NaN),
      y: Number(/\by="([^"]*)"/.exec(/** @type {string} */ (t[1]))?.[1] ?? NaN),
      rtl: /direction="rtl"/.test(/** @type {string} */ (t[1])),
      text: unescapeXml(/** @type {string} */ (t[2])),
    }));
    out.push({ style, family: /font-family:([^;]*);/.exec(style)?.[1]?.trim() ?? '', spans });
  }
  return out;
}

const GENERIC = /\b(sans-serif|serif|monospace|cursive|fantasy|system-ui)\b/;
const NO_LINE_START = /^[、。，．・：；？！）」』】〕〉》ー々ぁぃぅぇぉっゃゅょァィゥェォッャュョ,.)]/u;
const NO_LINE_END = /[「『【〔〈《（(]$/u;
const WORD_BREAK_SCRIPTS = { th: 'th', lo: 'lo', km: 'km', my: 'my' };

/** Line-break checks of a wrapped box's lines (SVG). @returns {[boolean, string][]} */
function breakChecks(/** @type {any} */ s, /** @type {string[]} */ lines) {
  /** @type {[boolean, string][]} */
  const out = [[lines.length >= 2, `wraps onto ${String(lines.length)} lines (want at least 2)`]];
  const joined = lines.join('');
  // Grapheme boundaries: every break offset must be a cluster boundary of the joined text.
  const bounds = new Set([0]);
  let off = 0;
  for (const g of graphemes(joined)) bounds.add((off += g.length));
  let at = 0;
  const bad = [];
  for (const l of lines.slice(0, -1)) {
    at += l.length;
    if (!bounds.has(at)) bad.push(at);
  }
  out.push([bad.length === 0, `no break inside a grapheme cluster${bad.length ? ` (at ${bad.join(', ')})` : ''}`]);
  const lang = /** @type {Record<string, string>} */ (WORD_BREAK_SCRIPTS)[s.lang];
  if (lang !== undefined) {
    const words = new Set([0]);
    let o = 0;
    for (const w of new Intl.Segmenter(lang, { granularity: 'word' }).segment(joined))
      words.add((o += w.segment.length));
    let p = 0;
    const off2 = [];
    for (const l of lines.slice(0, -1)) {
      p += l.length;
      if (!words.has(p)) off2.push(`${l.slice(-3)}|${joined.slice(p, p + 3)}`);
    }
    out.push([off2.length === 0, `breaks at ICU word boundaries${off2.length ? ` (not at: ${off2.join(', ')})` : ''}`]);
  }
  if (s.lang === 'ja' || s.lang.startsWith('zh')) {
    const bad2 = lines.slice(1).filter((l) => NO_LINE_START.test(l.trimStart()));
    const bad3 = lines.slice(0, -1).filter((l) => NO_LINE_END.test(l.trimEnd()));
    out.push([
      bad2.length === 0 && bad3.length === 0,
      `kinsoku: no line starts with closing punctuation or ends with an opening one${bad2.length + bad3.length ? ` (${[...bad2, ...bad3].map((l) => JSON.stringify(l)).join(', ')})` : ''}`,
    ]);
  }
  return out;
}

// ---------------------------------------------------------------- the checker

/**
 * Checks the files of a case. `downloads`: { name, bytes } (a zip is opened).
 * @param {I18nCase} c
 * @param {{ name: string, bytes: Buffer }[]} downloads
 * @param {{ host?: string, hostScale?: number, doc?: string, toast?: boolean | null, reference?: any }} [o]
 */
export async function checkCase(c, downloads, o = {}) {
  const host = o.host ?? 'web';
  const exp = expectedFiles(c, o);
  const ref = o.reference === undefined ? loadReference() : o.reference;
  /** @type {string[]} */
  const lines = [];
  /** @type {any[]} */
  const targets = [];
  let ok = true;
  const t = (/** @type {boolean} */ pass, /** @type {string} */ what, level = 'FAIL') => {
    if (!pass && level === 'FAIL') ok = false;
    lines.push(`${pass ? 'PASS' : level} ${c.id} ${what}`);
  };
  const nfc = (/** @type {string} */ s) => s.normalize('NFC');
  if (exp.zip !== null) {
    const got = downloads.map((f) => f.name);
    t(
      got.length === 1 && nfc(got[0] ?? '') === nfc(exp.zip),
      `one download ${JSON.stringify(got)} (want ["${exp.zip}"])`,
    );
    if (got.length === 1) t(got[0] === exp.zip, `download name byte-exact (NFC as built)`, 'NOTE');
  }
  /** @type {any[]} */
  let files = downloads;
  try {
    files = expandZips(downloads);
  } catch (e) {
    t(false, `zip readable: ${String(e)}`);
  }
  if (c.names === true || exp.zip !== null)
    for (const f of files)
      if (f.utf8Flag === false && /[^\x20-\x7e]/.test(f.name))
        t(false, `${f.name}: zip entry without the UTF-8 name flag`);
  const want = exp.files.map((f) => nfc(f.name)).sort();
  const got = files.map((f) => nfc(f.name)).sort();
  t(JSON.stringify(want) === JSON.stringify(got), `file names ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
  if (c.names === true) {
    const exact =
      JSON.stringify(exp.files.map((f) => f.name).sort()) === JSON.stringify(files.map((f) => f.name).sort());
    t(exact, 'file names byte-exact (not only after NFC)', 'NOTE');
  }
  for (const e of exp.files) {
    const f = files.find((x) => nfc(x.name) === nfc(e.name));
    if (!f) continue;
    const facts = pageFacts(/** @type {any} */ (e.fixture));
    if (e.kind === 'pdf') {
      const pdf = await readPdf(f.bytes);
      t(pdf.length === e.plans.length, `${e.name}: ${String(pdf.length)} pages (want ${String(e.plans.length)})`);
      e.plans.forEach((/** @type {any} */ plan, /** @type {number} */ k) => {
        const pg = pdf[k];
        if (!pg) return;
        for (const tg of facts[plan.page].targets) {
          const r = checkPdfTarget(c, host, tg, plan, pg, ref?.[e.fixture]?.[plan.page]?.[targetKey(tg)]);
          targets.push({ file: e.name, page: plan.fact.name, ...r.summary });
          for (const [pass, what, level] of r.checks)
            t(pass, `${e.name} p${String(k + 1)} ${targetKey(tg)}: ${what}`, level);
        }
      });
    } else if (e.kind === 'svg') {
      const plan = e.plans[0];
      const svg = f.bytes.toString('utf8');
      const texts = svgTexts(svg);
      for (const tg of facts[plan.page].targets) {
        const r = checkSvgTarget(tg, plan, texts);
        targets.push({ file: e.name, page: plan.fact.name, ...r.summary });
        for (const [pass, what, level] of r.checks) t(pass, `${e.name} ${targetKey(tg)}: ${what}`, level);
      }
    } else if (e.kind === 'png' || e.kind === 'jpg') {
      const sz = e.kind === 'png' ? pngSize(f.bytes) : jpegSize(f.bytes);
      t(sz !== null, `${e.name} is a ${e.kind.toUpperCase()}`);
      if (sz === null) continue;
      t(
        sz.width === e.size.width && sz.height === e.size.height,
        `${e.name} ${String(sz.width)} x ${String(sz.height)} px (want ${String(e.size.width)} x ${String(e.size.height)})`,
      );
      const img = await decodeImage(f.bytes);
      const plan = e.plans[0];
      const s = img.width / plan.width;
      for (const tg of facts[plan.page].targets) {
        const r = checkRasterTarget(tg, plan, img, s, ref?.[e.fixture]?.[plan.page]?.[targetKey(tg)]);
        targets.push({ file: e.name, page: plan.fact.name, ...r.summary });
        for (const [pass, what, level] of r.checks) t(pass, `${e.name} ${targetKey(tg)}: ${what}`, level);
      }
    } else if (e.kind === 'lekh') {
      const want2 = boardTexts(fs.readFileSync(FIXTURES[c.fixture].file, 'utf8'));
      let gotTexts = null;
      try {
        gotTexts = boardTexts(f.bytes.toString('utf8'));
      } catch (err) {
        t(false, `${e.name} parses: ${String(err)}`);
      }
      if (gotTexts !== null) {
        let same = 0;
        for (const [id, txt] of want2) {
          const g = gotTexts.get(id);
          if (g === txt) same++;
          else t(false, `${e.name} object ${id}: text ${JSON.stringify(g)} (want ${JSON.stringify(txt)})`);
        }
        t(
          same === want2.size,
          `${e.name}: ${String(same)} of ${String(want2.size)} texts identical code point for code point`,
        );
      }
    }
  }
  if (c.format === 'pdf') {
    const want3 = expectedToast(c, host);
    if (o.toast === true || o.toast === false)
      t(
        want3 === 'either' || (want3 === 'yes') === o.toast,
        `toast "Some text was exported as an image…" ${o.toast ? 'shown' : 'not shown'} (want ${want3})`,
      );
    else lines.push(`NOTE ${c.id} expect the toast "Some text was exported as an image…": ${want3}`);
  } else if (o.toast === true) t(false, 'a text-as-image toast on a non-PDF export');
  return { ok, lines, targets };
}

const targetKey = (/** @type {any} */ t) => `${t.sample}/${t.kind}/${t.variant}`;

/** id → text of every object of a board (all text slots joined with U+001F). */
function boardTexts(/** @type {string} */ text) {
  const doc = JSON.parse(text);
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const p of Object.values(doc.pages ?? {}))
    for (const [id, ob] of Object.entries(/** @type {any} */ (p).objects ?? {})) {
      const texts = /** @type {any} */ (ob).template?.texts ?? /** @type {any} */ (ob).texts ?? [];
      const s = Array.isArray(texts)
        ? texts.map((x) => (typeof x === 'string' ? x : (x?.text ?? ''))).join('\u001f')
        : String(texts);
      out.set(id, s);
    }
  return out;
}

/**
 * One PDF target: text, mode, font, ink and reference.
 * @returns {{ checks: [boolean, string, string?][], summary: any }}
 */
function checkPdfTarget(
  /** @type {I18nCase} */ c,
  /** @type {string} */ host,
  /** @type {any} */ tg,
  /** @type {any} */ plan,
  /** @type {any} */ pg,
  /** @type {any} */ refM,
) {
  const s = sampleById(tg.sample);
  const box = targetPx(tg.rect, plan, 1);
  const margin = 3;
  const inBox = (/** @type {any} */ it) =>
    it.cx >= box.x - margin &&
    it.cx <= box.x + box.w + margin &&
    it.cy >= box.y - margin &&
    it.cy <= box.y + box.h + margin;
  const items = pg.items
    .filter(inBox)
    .sort((/** @type {any} */ a, /** @type {any} */ b) => (Math.abs(a.cy - b.cy) > 6 ? a.cy - b.cy : a.x - b.x));
  const extracted = items.map((/** @type {any} */ it) => it.str).join('');
  const fonts = [...new Set(items.map((/** @type {any} */ it) => String(it.font).replace(/^[A-Z]{6}\+/, '')))];
  const images = pg.images.filter((/** @type {any} */ im) => {
    const ix = Math.max(0, Math.min(im.x + im.w, box.x + box.w) - Math.max(im.x, box.x));
    const iy = Math.max(0, Math.min(im.y + im.h, box.y + box.h) - Math.max(im.y, box.y));
    return ix * iy >= 0.5 * im.w * im.h && im.w * im.h > 0;
  });
  const ink = inkIn(pg.raster, targetPx(tg.rect, plan, 1, insetOf(tg)));
  const text = tg.text ?? s.text;
  const wantText = normPdf(withoutEmoji(text));
  const gotText = normPdf(extracted);
  const visual = s.expect.pdfOrder === 'visual';
  const exact = gotText === wantText;
  const multiset = sortedCps(gotText) === sortedCps(wantText);
  let mode;
  if (wantText === '') mode = images.length > 0 ? 'image' : ink.ink > 0.002 ? 'outline' : 'missing';
  else if (exact || (visual && multiset)) mode = 'text';
  else if (gotText === '' && images.length > 0) mode = 'image';
  else if (gotText === '' && ink.ink > 0.002) mode = 'outline';
  else if (gotText !== '') mode = 'partial';
  else mode = 'missing';
  const allowed = allowedPdfModes(tg, host, c);
  /** @type {[boolean, string, string?][]} */
  const checks = [];
  const detail =
    mode === 'partial' || (mode !== 'text' && allowed.modes.includes('text') && gotText !== '')
      ? ` extracted ${JSON.stringify(extracted)}; missing ${cpDiff(wantText.normalize('NFKD'), gotText.normalize('NFKD')) || '-'}; extra ${cpDiff(gotText.normalize('NFKD'), wantText.normalize('NFKD')) || '-'}`
      : '';
  checks.push([
    allowed.modes.includes(mode),
    `mode ${mode} (allowed ${allowed.modes.join('|')}${allowed.verified ? '' : ', unverified on this host'})${detail}${allowed.why && mode !== 'text' ? ` — ${allowed.why}` : ''}`,
  ]);
  if (mode === 'text' && !exact)
    checks.push([true, `text in visual order (characters all present; ${s.expect.pdfOrderWhy ?? ''})`, 'NOTE']);
  if (mode === 'text' && hasEmoji(text))
    checks.push([images.length > 0, `emoji drawn as images (${String(images.length)} in the box)`]);
  checks.push([ink.ink > 0.002, `not blank in the PDF render (ink ${(ink.ink * 100).toFixed(2)} %)`]);
  if (mode === 'text' && (host === 'web' || host.startsWith('web-')) && c.network !== 'offline-cold') {
    const wf = webFontFor(tg, s);
    if (wf !== null)
      checks.push([fonts.some((f) => f.startsWith(wf)), `font ${wf} (got ${fonts.join(', ') || 'none'})`]);
  }
  if (refM !== undefined && refM !== null && ink.ink > 0) {
    const ri = ink.ink / Math.max(1e-6, refM.ink);
    checks.push([
      ri >= REF_TOLERANCE.ink[0] && ri <= REF_TOLERANCE.ink[1],
      `ink vs reference ×${ri.toFixed(2)}`,
      'WARN',
    ]);
  }
  return {
    checks,
    summary: { target: targetKey(tg), format: 'pdf', mode, fonts, images: images.length, ink: ink.ink, extracted },
  };
}

/** The PostScript name prefix the web PDF should use for a target (null: not checked). */
function webFontFor(/** @type {any} */ tg, /** @type {any} */ s) {
  // A Latin-only text (a style row's short label such as "NFC") is drawn in the bundled face.
  const latinOnly = /^[\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}\s]*$/u.test(tg.text ?? s.text);
  const wf = latinOnly ? 'NotoSans' : s.expect.webFont;
  if (wf === undefined) return null;
  const bold = tg.variant === 'bold' || tg.variant === 'bold-italic';
  const italic = tg.variant === 'italic' || tg.variant === 'bold-italic';
  if (wf === 'NotoSans') {
    const fam = tg.variant.startsWith('family:') ? tg.variant.slice(7).replace(/ /g, '') : 'NotoSans';
    if (fam === 'NotoSansMono' || fam === 'Caveat') return `${fam}-${bold ? 'Bold' : 'Regular'}`; // no italic face
    if (tg.variant.startsWith('family:')) return `${fam}-Regular`;
    return `NotoSans-${bold && italic ? 'BoldItalic' : bold ? 'Bold' : italic ? 'Italic' : 'Regular'}`;
  }
  // A script face: Regular and Bold exist (no italic: the writer slants it).
  return `${wf}-${bold ? 'Bold' : 'Regular'}`;
}

/** One SVG target. @returns {{ checks: [boolean, string, string?][], summary: any }} */
function checkSvgTarget(/** @type {any} */ tg, /** @type {any} */ plan, /** @type {any[]} */ texts) {
  const s = sampleById(tg.sample);
  const box = targetPx(tg.rect, plan, 1);
  const inBox = (/** @type {any} */ sp) =>
    sp.x >= box.x - 2 && sp.x <= box.x + box.w + 2 && sp.y >= box.y - 2 && sp.y <= box.y + box.h + 2;
  const mine = texts.filter((tx) => tx.spans.length > 0 && tx.spans.every(inBox));
  const spans = mine.flatMap((tx) => tx.spans).sort((a, b) => a.y - b.y);
  const linesTxt = spans.map((sp) => sp.text);
  const got = linesTxt.join('');
  const text = tg.text ?? s.text;
  const strip = (/** @type {string} */ x) => x.replace(/\s+/gu, '');
  /** @type {[boolean, string, string?][]} */
  const checks = [];
  checks.push([
    strip(got) === strip(text),
    `text equals the sample code point for code point${strip(got) === strip(text) ? '' : `: got ${JSON.stringify(got)}; missing ${cpDiff(strip(text), strip(got)) || '-'}; extra ${cpDiff(strip(got), strip(text)) || '-'}`}`,
  ]);
  const fam = tg.variant.startsWith('family:') ? tg.variant.slice(7) : 'Noto Sans';
  const ff = mine[0]?.family ?? '';
  checks.push([
    ff.includes(`"${fam}"`) && GENERIC.test(ff),
    `font-family ${ff || '(none)'} (want "${fam}" and a generic family)`,
  ]);
  if (tg.kind === 'wrap') for (const [p, w] of breakChecks(s, linesTxt)) checks.push([p, w]);
  if (s.dir === 'rtl' && spans.length > 0)
    checks.push([spans.every((sp) => sp.rtl), 'RTL lines carry direction="rtl"']);
  return { checks, summary: { target: targetKey(tg), format: 'svg', lines: linesTxt } };
}

/** One raster target. @returns {{ checks: [boolean, string, string?][], summary: any }} */
function checkRasterTarget(
  /** @type {any} */ tg,
  /** @type {any} */ plan,
  /** @type {any} */ img,
  /** @type {number} */ s,
  /** @type {any} */ refM,
) {
  const ink = inkIn(img, targetPx(tg.rect, plan, s, insetOf(tg)));
  /** @type {[boolean, string, string?][]} */
  const checks = [[ink.ink > 0.002, `not blank (ink ${(ink.ink * 100).toFixed(2)} %)`]];
  if (refM !== undefined && refM !== null) {
    const ri = ink.ink / Math.max(1e-6, refM.ink);
    const rw = ink.extentW / Math.max(1e-6, refM.extentW);
    checks.push([
      ri >= REF_TOLERANCE.ink[0] &&
        ri <= REF_TOLERANCE.ink[1] &&
        rw >= REF_TOLERANCE.extentW[0] &&
        rw <= REF_TOLERANCE.extentW[1],
      `against the reference: ink ×${ri.toFixed(2)} (allowed ${REF_TOLERANCE.ink.join('…')}), ink width ×${rw.toFixed(2)} (allowed ${REF_TOLERANCE.extentW.join('…')})`,
    ]);
  }
  if (tg.gap !== undefined) {
    const g = inkIn(img, targetPx(tg.gap, plan, s));
    checks.push([g.ink < 0.001, `nothing drawn right of the box (ink ${(g.ink * 100).toFixed(2)} % in the gap)`]);
  }
  return { checks, summary: { target: targetKey(tg), format: 'raster', ink: ink.ink, extentW: ink.extentW } };
}

// ---------------------------------------------------------------- references

/**
 * Builds references/ from PDF exports of the scripts, styles and layout boards (the web's, in
 * Noto fonts): one PNG per page at 1 px per board point, and the ink metrics of every target.
 * @param {string[]} pdfFiles
 */
async function buildReference(pdfFiles) {
  /** @type {Record<string, Record<number, Record<string, any>>>} */
  const metrics = {};
  for (const file of pdfFiles) {
    const bytes = fs.readFileSync(file);
    const fixture = /** @type {keyof typeof FIXTURES} */ (
      /** @type {string} */ (
        Object.keys(FIXTURES).find((k) =>
          path.basename(file).startsWith(FIXTURES[/** @type {keyof typeof FIXTURES} */ (k)].doc),
        )
      )
    );
    if (fixture === undefined) throw new Error(`${file}: not named after a fixture board`);
    const facts = pageFacts(fixture);
    const plan = planCase(
      { pages: 'all', format: 'pdf', region: 'drawing', padding: 20 },
      FIXTURES[fixture].doc,
      facts,
    );
    const pages = await readPdf(bytes);
    fs.mkdirSync(path.join(here, 'references', fixture), { recursive: true });
    metrics[fixture] = {};
    pages.forEach((pg, k) => {
      const p = /** @type {any} */ (plan.pages[k]);
      const m = /** @type {Record<string, any>} */ ({});
      for (const tg of facts[p.page].targets) {
        const ink = inkIn(pg.raster, targetPx(tg.rect, p, 1, insetOf(tg)));
        m[targetKey(tg)] = { ink: Math.round(ink.ink * 1e5) / 1e5, extentW: Math.round(ink.extentW * 1e4) / 1e4 };
      }
      /** @type {any} */ (metrics[fixture])[p.page] = m;
      const out = path.join(
        here,
        'references',
        fixture,
        `${String(p.page + 1)}-${p.fact.name.replace(/[^\p{L}\p{N}]+/gu, '-')}.png`,
      );
      fs.writeFileSync(out, pg.canvas.toBuffer('image/png'));
      console.log(out);
    });
  }
  const prev = loadReference() ?? {};
  fs.writeFileSync(REFERENCE_FILE, JSON.stringify({ ...prev, ...metrics }, null, 1) + '\n');
}

/**
 * The shaping references (references/shaping/): every sample drawn by Skia with HarfBuzz shaping
 * (@napi-rs/canvas) in the bundled Noto faces, the web PDF's Noto script fonts (`--noto`, the
 * lekhboard fonts/noto folder) and any `--font` file, one PNG per sample group. They show what
 * correct shaping and bidi order look like, independent of the export under test.
 * @param {string} noto
 * @param {string[]} extra
 */
function buildShaping(noto, extra) {
  const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
  const fams = ['RefNotoSans'];
  GlobalFonts.registerFromPath(path.join(lekhjs, 'fonts/noto-sans/NotoSans-Regular.ttf'), 'RefNotoSans');
  // CJK: JP before SC before TC before KR, so kana texts get JP shapes and Ext B finds TC.
  const order = (/** @type {string} */ f) =>
    /JP/.test(f) ? 0 : /SC/.test(f) ? 1 : /TC/.test(f) ? 2 : /KR/.test(f) ? 3 : -1;
  const files = fs
    .readdirSync(noto)
    .filter((f) => /-Regular\.(ttf|otf)$/.test(f))
    .sort((a, b) => order(a) - order(b));
  for (const f of [...files.map((x) => path.join(noto, x)), ...extra]) {
    const fam = `Ref${path.basename(f).replace(/[-.].*$/, '')}`;
    GlobalFonts.registerFromPath(f, fam);
    fams.push(fam);
  }
  const font = `28px ${fams.map((f) => `"${f}"`).join(', ')}, "Noto Color Emoji", sans-serif`;
  const groups = [...new Set(SAMPLES.map((x) => x.group))];
  fs.mkdirSync(path.join(here, 'references/shaping'), { recursive: true });
  for (const g of groups) {
    const rows = SAMPLES.filter((x) => x.group === g).flatMap((x) =>
      x.text.split('\n').map((t, i) => ({ id: i === 0 ? x.id : '', dir: x.dir, t })),
    );
    const W = 1500;
    const cv = createCanvas(W, 20 + rows.length * 52);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    rows.forEach((r, i) => {
      const y = 46 + i * 52;
      ctx.fillStyle = '#666666';
      ctx.font = '16px "RefNotoSans"';
      ctx.direction = 'ltr';
      ctx.textAlign = 'left';
      ctx.fillText(r.id, 12, y);
      ctx.fillStyle = '#000000';
      ctx.font = font;
      ctx.direction = r.dir === 'rtl' ? 'rtl' : 'ltr';
      ctx.textAlign = r.dir === 'rtl' ? 'right' : 'left';
      ctx.fillText(r.t, r.dir === 'rtl' ? W - 20 : 150, y);
    });
    const out = path.join(here, 'references/shaping', `${g.replace(/[^\p{L}\p{N}]+/gu, '-')}.png`);
    fs.writeFileSync(out, cv.toBuffer('image/png'));
    console.log(out);
  }
}

/** The human checklist (README §6): one line per sample, from samples.json. */
function checklist() {
  for (const s of SAMPLES)
    console.log(`| ${s.id} | ${s.language} | ${s.text.replace(/\n/g, ' / ').replace(/\|/g, '\\|')} | ${s.look} | |`);
}

// ---------------------------------------------------------------- CLI

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  /** @type {Record<string, string>} */
  const flags = {};
  const files = [];
  for (let i = 0; i < rest.length; i++) {
    const a = /** @type {string} */ (rest[i]);
    if (a.startsWith('--')) flags[a.slice(2)] = /** @type {string} */ (rest[++i]);
    else files.push(a);
  }
  if (cmd === 'list') {
    for (const c of CASES) console.log(`${c.id}\t${c.hosts.join(',')}\t${c.title}`);
    return;
  }
  if (cmd === 'checklist') return checklist();
  if (cmd === 'reference') return buildReference(files);
  if (cmd === 'shaping') return buildShaping(flags['noto'] ?? path.resolve(lekhjs, '../lekhboard/fonts/noto'), files);
  if (cmd === 'inspect') {
    for (const f of files) {
      const bytes = fs.readFileSync(f);
      const list = f.toLowerCase().endsWith('.zip') ? unzip(bytes) : [{ name: path.basename(f), bytes }];
      for (const e of list) {
        if (e.name.toLowerCase().endsWith('.pdf')) {
          const pages = await readPdf(e.bytes);
          console.log(
            JSON.stringify({
              name: e.name,
              pages: pages.map((p) => ({
                w: p.width,
                h: p.height,
                fonts: [...new Set(p.items.map((i) => i.font))],
                images: p.images.length,
                text: p.items.map((i) => i.str).join(' '),
              })),
            }),
          );
        } else console.log(JSON.stringify({ name: e.name, bytes: e.bytes.length }));
      }
    }
    return;
  }
  if (cmd === 'check') {
    const id = files.shift();
    const c = id ? caseById(id) : undefined;
    if (!c) throw new Error(`unknown case ${String(id)}; see "list"`);
    const host = flags['host'] ?? 'web';
    const hostScale = host === 'android' ? Number(flags['dpr'] ?? '1') : 1;
    const toast = flags['toast'] === 'yes' ? true : flags['toast'] === 'no' ? false : null;
    const r = await checkCase(
      c,
      files.map((f) => ({ name: path.basename(f), bytes: fs.readFileSync(f) })),
      { host, hostScale, toast, ...(flags['doc'] !== undefined ? { doc: flags['doc'] } : {}) },
    );
    for (const l of r.lines) console.log(l);
    if (flags['json'] !== undefined) fs.writeFileSync(flags['json'], JSON.stringify(r.targets, null, 1));
    process.exit(r.ok ? 0 : 1);
  }
  console.log(
    'usage: suite.mjs list | checklist | check <I18N-id> [--host web|ios|mac|android] [--dpr N] [--toast yes|no] [--doc name] [--json out.json] <files...> | inspect <files...> | reference <pdfs...>',
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
