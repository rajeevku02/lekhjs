// The image halves of the PDF rows (Work 01M4X7TCHFB862XGT68GPY071C, F2; spec 08 §7, verification
// 05 §4): each PDF page rasterised by pdf.js on a napi canvas at the PNG export's pixel size
// (a page is width/2 points, so 2·scale px per point) is compared with the PNG export of the same
// board by the image bar of verification 02 §B.3 (parity/image/diff.mjs: pixelmatch 0.1 with
// anti-aliasing excluded, < 0.1 % differing pixels, no blob > 16·s² px), with every text box (the
// engine's layout rectangles, grown by 2 px) masked: text is checked by extraction instead
// (pdf-text-extract.test.ts).
//
// - AC-EXP-10: the core fixture boards, every page, at scale 1 and 2.
// - AC-EXP-12: dashes with a phase, opacity, a rotated opaque image, a PNG with alpha (boards), and
//   cubic clips (the scripted drawing: no board object clips, so the platform is driven directly).
// - AC-EXP-18: the mixed Arabic/Latin board, outside its text boxes.
// - AC-EXP-19: a restricted-fsType font and a variable font drawn as outlines match the canvas
//   inside their text box, with a 1 px tolerance at glyph edges.
//
// PDF_PARITY_DUMP=1 writes PNG | PDF raster pairs to parity/out/pdf-parity/ for review.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { GlobalFonts, createCanvas, type Canvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { PathStepType, Point, pathStep, type PathStep } from '../../src/geometry';
import { Canvas2DDrawingPlatform, type DrawingPlatform } from '../../src/render';
import { Color, Style } from '../../src/style';
import {
  BidiResolver,
  PdfDrawingPlatform,
  PdfFontResolver,
  PdfTextWriter,
  RunImageFallback,
  pdfModules,
  type FontDataProvider,
} from '../../src/export/pdf';
import { FakeImagePort, FakeScheduler } from '../../src/testing';
import type { BoardSession } from '../../src/session';
import { CORE_FIXTURES, readText } from '../io/helpers';
import { napiFactory } from './helpers';
import { FixtureProvider, PKG, TEST_FONTS, bundledSource, fixtureFont, scriptFixtures } from './pdf-helpers';
import {
  boxMask,
  edgeMask,
  encodePng,
  exportPdfFile,
  exportPngs,
  inkIn,
  measuredSession,
  outsideMask,
  pageBar,
  pngOverWhite,
  rasterPdf,
  textBoxes,
  union,
  type Rgba,
} from './pdf-parity-helpers';

const DUMP = process.env['PDF_PARITY_DUMP'] === '1';
const OUT = path.join(PKG, 'parity/out/pdf-parity');

GlobalFonts.registerFromPath(path.join(TEST_FONTS, 'NotoSansArabic-subset.ttf'), 'Noto Sans Arabic');
GlobalFonts.registerFromPath(path.join(TEST_FONTS, 'Restricted-fsType2.ttf'), 'Lekh Restricted Test');
GlobalFonts.registerFromPath(path.join(TEST_FONTS, 'NotoSansVariable-ascii.ttf'), 'Lekh Variable Test');

function dump(name: string, png: Rgba, pdf: Rgba): void {
  if (!DUMP) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `${name}-png.png`), encodePng(png));
  writeFileSync(path.join(OUT, `${name}-pdf.png`), encodePng(pdf));
}

interface Compared {
  readonly png: Rgba;
  readonly pdf: Rgba;
  readonly boxes: ReturnType<typeof textBoxes>[number]['boxes'];
}

/** PNG and rasterised PDF of every page of `s` at `scale`, with the pages' text boxes. */
async function comparePages(
  s: BoardSession,
  scale: number,
  fonts: readonly FontDataProvider[] = [bundledSource()],
): Promise<Compared[]> {
  const pngs = (await exportPngs(s, { scale })).map(pngOverWhite);
  const { bytes } = await exportPdfFile(s, fonts, { scale });
  const pdf = await rasterPdf(bytes, 2 * scale, pngs);
  const tb = textBoxes(s, { scale });
  expect(pdf.length).toBe(pngs.length);
  return pngs.map((png, i) => ({ png, pdf: pdf[i] as Rgba, boxes: tb[i]?.boxes ?? [] }));
}

const BOARDS = readdirSync(path.join(CORE_FIXTURES, 'boards')).filter((f) => f.endsWith('.lekh'));

describe('PDF raster parity with the PNG export, text boxes masked (AC-EXP-10)', () => {
  it.each(BOARDS.flatMap((f) => [1, 2].map((scale) => [f, scale] as const)))(
    '%s at scale %d: the bar is met outside the text boxes on every page',
    async (file, scale) => {
      const s = measuredSession(JSON.parse(readText(path.join(CORE_FIXTURES, 'boards', file))) as object, 'Board');
      const pages = await comparePages(s, scale);
      for (const [i, p] of pages.entries()) {
        const mask = boxMask(p.boxes, p.png.width, p.png.height, 2 * scale);
        const v = pageBar(p.png, p.pdf, mask, scale);
        dump(`${file}-s${String(scale)}-p${String(i)}`, p.png, p.pdf);
        expect(
          { pass: v.pass, fraction: v.fraction, largestBlob: v.largestBlob },
          `${file} page ${String(i)}: ${String(v.differing)} of ${String(v.compared)} px differ`,
        ).toMatchObject({ pass: true });
      }
    },
  );
});

// ---- AC-EXP-12 ----

/**
 * An opaque image and one with alpha, as napi canvases (the session's decoded images), at 4 px per
 * board unit so neither renderer upscales them at scale 2 (canvas and pdf.js resample an upscaled
 * image with different filters, which is not the PDF's doing).
 */
function images(): { opaque: Canvas; alpha: Canvas } {
  const k = 4;
  const opaque = createCanvas(120 * k, 90 * k);
  const o = opaque.getContext('2d');
  o.scale((k * 120) / 64, (k * 90) / 48);
  o.fillStyle = '#3366cc';
  o.fillRect(0, 0, 64, 48);
  o.fillStyle = '#ffcc00';
  o.fillRect(8, 8, 24, 16);
  o.fillStyle = '#cc3333';
  o.fillRect(36, 24, 20, 16);
  const alpha = createCanvas(100 * k, 100 * k);
  const a = alpha.getContext('2d');
  a.scale((k * 100) / 64, (k * 100) / 64);
  a.fillStyle = 'rgba(220, 40, 40, 0.5)';
  a.fillRect(0, 0, 64, 32);
  a.fillStyle = 'rgba(20, 140, 60, 1)';
  a.fillRect(16, 32, 32, 32);
  return { opaque, alpha };
}

const RECT_TEMPLATE = {
  data: ['-w/2', '-h/2', '-w/2', 'h/2', 'w/2', 'h/2', 'w/2', '-h/2'],
  default: { angle: 0, height: 10, width: 10 },
  draw: [{ path: 'M 0 1 L 2 3 L 4 5 L 6 7 L 0 1' }],
  flags: 31,
  id: 'avabodh.basic.rectangle',
  polygon: true,
};

function imageObject(order: number, cx: number, cy: number, w: number, h: number, angle: number, src: string): object {
  return {
    type: 'templated',
    name: 'Image',
    order,
    params: { cx, cy, width: w, height: h, angle },
    template: {
      id: 'avabodh.basic.image',
      texts: '',
      images: [{ location: '0 1 2 3 4 0', src }],
      primitive_for_distance: false,
      primitive_for_intersection: false,
      primitive_for_inside: false,
      data: ['0', '0', 'w', 'h', '0'],
      draw: [],
    },
  };
}

/** Dashes with a phase, translucent fills and strokes, a rotated opaque image, a PNG with alpha. */
function primitivesBoard(): object {
  const rect = (order: number, cx: number, cy: number, w: number, h: number, style: object, angle = 0): object => ({
    type: 'templated',
    name: '',
    order,
    params: { angle, cx, cy, width: w, height: h },
    style,
    template: RECT_TEMPLATE,
  });
  const argb = (a: number, r: number, g: number, b: number): number => (a << 24) | (r << 16) | (g << 8) | b | 0;
  const objects: Record<string, object> = {
    o01: rect(1, 100, 80, 140, 80, {
      strokewidth: 4,
      dasharray: [12, 6],
      dashpatternphase: 5,
      fillpaint: { color: -1, type: 2 },
    }),
    o02: rect(2, 280, 80, 140, 80, {
      strokewidth: 3,
      dasharray: [4, 4, 12, 4],
      dashpatternphase: 0,
      strokepaint: { color: argb(255, 200, 30, 30), type: 2 },
    }),
    o03: rect(3, 100, 220, 160, 100, { fillpaint: { color: argb(128, 30, 90, 200), type: 2 } }),
    o04: rect(4, 150, 260, 160, 100, {
      fillpaint: { color: argb(96, 220, 30, 30), type: 2 },
      strokewidth: 6,
      strokepaint: { color: argb(128, 0, 0, 0), type: 2 },
    }),
    o05: rect(5, 330, 240, 90, 60, { fillpaint: { color: argb(255, 20, 160, 60), type: 2 } }, 0.5),
    o06: imageObject(6, 470, 90, 120, 90, 0.6, 'res://f2-opaque'),
    o07: imageObject(7, 470, 250, 100, 100, 0, 'res://f2-alpha'),
    o08: imageObject(8, 600, 250, 100, 100, -0.3, 'res://f2-alpha'),
  };
  return {
    attributes: { grid: { present: false }, scaling: { scale: 1, unit: 'point' } },
    info: { author: '', description: '', platform: '1', title: '', version: '4.2' },
    pages: {
      p0001: {
        name: 'Page 1',
        order: 1,
        canvassizetype: 'infinite',
        canvasname: 'Infinite',
        size: { width: 0, height: 0, unit: 'point' },
        background: { color: -1 },
        objects,
      },
    },
  };
}

function step(type: PathStepType, ...pts: Point[]): PathStep {
  const p = pathStep(type, pts[0]);
  if (pts[1] !== undefined) p.p2 = pts[1];
  if (pts[2] !== undefined) p.p3 = pts[2];
  return p;
}

/** Cubic clips (nested), drawn through any platform. */
function clipScript(dp: DrawingPlatform): void {
  const fill = (c: Color): Style => {
    const s = new Style();
    s.setFillColor(c);
    s.setStrokeWidth(0);
    return s;
  };
  dp.saveContext();
  dp.clip([
    step(PathStepType.Move, new Point(20, 100)),
    step(PathStepType.Cubic, new Point(80, 10), new Point(220, 200), new Point(280, 90)),
    step(PathStepType.Line, new Point(280, 280)),
    step(PathStepType.Cubic, new Point(200, 230), new Point(100, 300), new Point(20, 260)),
    step(PathStepType.Close),
  ]);
  dp.startDrawing(new Point(0, 0), fill(new Color(220, 30, 30)));
  dp.addLineTo(new Point(300, 0));
  dp.addLineTo(new Point(300, 300));
  dp.addLineTo(new Point(0, 300));
  dp.closePath();
  dp.endDrawing();
  dp.saveContext();
  dp.clip([
    step(PathStepType.Move, new Point(60, 150)),
    step(PathStepType.Cubic, new Point(60, 80), new Point(240, 80), new Point(240, 150)),
    step(PathStepType.Cubic, new Point(240, 220), new Point(60, 220), new Point(60, 150)),
    step(PathStepType.Close),
  ]);
  dp.startDrawing(new Point(0, 0), fill(new Color(30, 90, 200, 160)));
  dp.addLineTo(new Point(300, 0));
  dp.addLineTo(new Point(300, 300));
  dp.addLineTo(new Point(0, 300));
  dp.closePath();
  dp.endDrawing();
  dp.restoreContext();
  dp.restoreContext();
}

async function clipPdf(w: number, h: number): Promise<Uint8Array> {
  const m = pdfModules();
  const doc = new m.PDFDocument({
    autoFirstPage: false,
    compress: true,
    font: null,
    info: { Title: 't', Creator: 'Lekh', Producer: 'Lekh' },
  });
  const chunks: Uint8Array[] = [];
  doc.on('data', (c) => {
    chunks.push(c);
  });
  const ended = new Promise<void>((r) => {
    doc.on('end', () => {
      r();
    });
  });
  // The export's page: width/2 × height/2 points drawn at scale 0.5.
  doc.addPage({ size: [w / 2, h / 2], margin: 0 });
  doc.transform(0.5, 0, 0, 0.5, 0, 0);
  const resolver = new PdfFontResolver({
    fontkit: m.fontkit,
    bidi: new BidiResolver(m.bidi),
    providers: [],
    images: new RunImageFallback(napiFactory()),
  });
  const dp = new PdfDrawingPlatform({ doc, text: new PdfTextWriter(doc, resolver), imageBytes: new Map() });
  clipScript(dp);
  doc.end();
  await ended;
  return new Uint8Array(Buffer.concat(chunks));
}

describe('PDF primitives against the PNG (AC-EXP-12)', () => {
  it.each([1, 2])(
    'dashes with phase, opacity, a rotated image and PNG alpha meet the bar at scale %d',
    async (scale) => {
      const port = new FakeImagePort();
      const sched = new FakeScheduler();
      const s = measuredSession(primitivesBoard(), 'Primitives', { images: port, scheduler: sched });
      sched.flushTimers(); // the image request is deferred (ImageRefs)
      const { opaque, alpha } = images();
      const urls = [...new Set(port.requested)];
      expect(urls.length).toBe(2);
      for (const u of urls) {
        const img = u.includes('opaque') ? opaque : alpha;
        s.dispatch({ type: 'imageLoaded', url: u, image: { width: img.width, height: img.height, source: img } });
      }
      const [p] = await comparePages(s, scale);
      if (p === undefined) throw new Error('page');
      dump(`primitives-s${String(scale)}`, p.png, p.pdf);
      // There is a drawing to compare: dashes, fills and the images.
      expect(inkIn(p.png, { x: 0, y: 0, w: p.png.width, h: p.png.height })).toBeGreaterThan(
        p.png.width * p.png.height * 0.2,
      );
      const v = pageBar(p.png, p.pdf, null, scale);
      expect({ pass: v.pass, fraction: v.fraction, largestBlob: v.largestBlob }).toMatchObject({ pass: true });
    },
  );

  it.each([1, 2])('nested cubic clips meet the bar at scale %d', async (scale) => {
    const w = 300 * scale;
    const h = 300 * scale;
    const c = createCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.scale(scale, scale);
    clipScript(new Canvas2DDrawingPlatform(ctx));
    const d = ctx.getImageData(0, 0, w, h).data;
    const png: Rgba = { width: w, height: h, data: new Uint8Array(d.buffer, d.byteOffset, d.length) };
    const bytes = await clipPdf(300, 300);
    const [pdf] = await rasterPdf(bytes, 2 * scale, [{ width: w, height: h }]);
    if (pdf === undefined) throw new Error('raster');
    dump(`clips-s${String(scale)}`, png, pdf);
    const v = pageBar(png, pdf, null, scale);
    expect({ pass: v.pass, fraction: v.fraction, largestBlob: v.largestBlob }).toMatchObject({ pass: true });
  });
});

// ---- AC-EXP-18 ----

function textOnlyBoard(specs: { text: string; family?: string; cy: number; w?: number }[]): object {
  const objects: Record<string, object> = {};
  specs.forEach((t, i) => {
    objects[`t${String(i + 1).padStart(4, '0')}`] = {
      type: 'templated',
      name: 'Text',
      order: i + 1,
      params: { cx: 260, cy: t.cy, width: t.w ?? 460, height: 44, angle: 0 },
      style: { fontsize: 24, fontfamily: t.family ?? 'Noto Sans', textalignhorizontal: 0 },
      template: {
        id: 'avabodh.basic.text',
        texts: [{ location: 'default', text: t.text }],
        images: '',
        primitive_for_distance: false,
        primitive_for_intersection: false,
        primitive_for_inside: false,
        data: [],
        draw: [],
      },
    };
  });
  // A frame around the text, so there is something outside the boxes to compare.
  objects['frame'] = {
    type: 'templated',
    name: '',
    order: 99,
    params: { angle: 0, cx: 260, cy: 30 + specs.length * 30, width: 500, height: specs.length * 60 + 40 },
    style: { strokewidth: 2, strokepaint: { color: -16777216, type: 2 } },
    template: RECT_TEMPLATE,
  };
  return {
    attributes: { grid: { present: false }, scaling: { scale: 1, unit: 'point' } },
    info: { author: '', description: '', platform: '1', title: '', version: '4.2' },
    pages: {
      p0001: {
        name: 'Page 1',
        order: 1,
        canvassizetype: 'infinite',
        canvasname: 'Infinite',
        size: { width: 0, height: 0, unit: 'point' },
        background: { color: -1 },
        objects,
      },
    },
  };
}

describe('mixed Arabic/Latin lines (AC-EXP-18)', () => {
  it('the bar is met outside the text boxes', async () => {
    const s = measuredSession(
      textOnlyBoard([
        { text: 'abc مرحبا def', cy: 40 },
        { text: 'مرحبا abc', cy: 100 },
        { text: 'Hello مرحبا world', cy: 160 },
        { text: '(مرحبا) 123', cy: 220 },
      ]),
      'Bidi',
    );
    const [p] = await comparePages(s, 1, [bundledSource(), scriptFixtures()]);
    if (p === undefined) throw new Error('page');
    dump('bidi', p.png, p.pdf);
    expect(p.boxes.length).toBe(4);
    const v = pageBar(p.png, p.pdf, boxMask(p.boxes, p.png.width, p.png.height, 2), 1);
    expect(v.compared).toBeGreaterThan(0);
    expect({ pass: v.pass, fraction: v.fraction, largestBlob: v.largestBlob }).toMatchObject({ pass: true });
  });
});

// ---- AC-EXP-19 ----

describe('outlined runs inside their box (AC-EXP-19)', () => {
  it.each([
    ['a restricted font (fsType 2)', 'Lekh Restricted Test', 'Restricted-fsType2.ttf'],
    ['a variable font', 'Lekh Variable Test', 'NotoSansVariable-ascii.ttf'],
  ])('%s: the outlines match the canvas inside the box (1 px glyph-edge tolerance)', async (_n, family, file) => {
    const provider = new FixtureProvider((r) => (r.family === family ? fixtureFont(file) : null), 'platform');
    const s = measuredSession(textOnlyBoard([{ text: 'Outlined Hamburgefonts 0123', family, cy: 40 }]), 'Outline', {
      platformFamilies: [family],
    });
    const { warnings } = await exportPdfFile(s, [bundledSource(), provider]);
    expect(warnings).toEqual([{ code: 'font_outlined', count: 1 }]);
    const [p] = await comparePages(s, 2, [bundledSource(), provider]);
    if (p === undefined) throw new Error('page');
    dump(`outline-${file}`, p.png, p.pdf);
    const box = p.boxes[0];
    if (box === undefined) throw new Error('box');
    // There is text in the box on both sides.
    expect(inkIn(p.png, box)).toBeGreaterThan(200);
    expect(inkIn(p.pdf, box)).toBeGreaterThan(200);
    const ignore = union(outsideMask(box, p.png.width, p.png.height, 2), edgeMask(p.png, p.pdf, 1));
    const v = pageBar(p.png, p.pdf, ignore, 2);
    expect({ pass: v.pass, fraction: v.fraction, largestBlob: v.largestBlob }).toMatchObject({ pass: true });
  });
});

// pdf.js is imported so a failure to load it fails here, not inside a helper.
it('pdf.js is the dev dependency the matrix names', () => {
  expect(typeof pdfjs.getDocument).toBe('function');
});
