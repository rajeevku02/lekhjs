// `PdfDrawingPlatform` primitives (spec 08 §7): AC-EXP-11 (a 5-stop linear and a focal radial
// gradient are shadings with every stop), the operators behind AC-EXP-12 (dashes, a cubic clip,
// opacity, rotated images, PNG alpha as an SMask, an opaque image as JPEG), and a raster check:
// the scripted drawing of the SVG suite rendered by pdf.js matches the canvas platform.
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { BezierCurve, PathStepType, Point, Rect, Size, pathStep, type PathStep } from '../../src/geometry';
import {
  Canvas2DDrawingPlatform,
  type ComputedGradient,
  type DecodedImage,
  type DrawingPlatform,
} from '../../src/render';
import { Color, Style } from '../../src/style';
import {
  BidiResolver,
  PdfDrawingPlatform,
  PdfFontResolver,
  PdfTextWriter,
  RunImageFallback,
  dashOperand,
  encodeImageForPdf,
  pdfModules,
} from '../../src/export/pdf';
import { env, napiFactory, solidImage } from './helpers';

function filled(c: Color, stroke = 0): Style {
  const s = new Style();
  s.setFillColor(c);
  s.setStrokeWidth(stroke);
  if (stroke > 0) s.setStrokeColor(new Color(0, 0, 0));
  return s;
}

function step(type: PathStepType, ...pts: Point[]): PathStep {
  const p = pathStep(type, pts[0]);
  if (pts[1] !== undefined) p.p2 = pts[1];
  if (pts[2] !== undefined) p.p3 = pts[2];
  return p;
}

/** One page `w × h` points drawn by `draw` through `PdfDrawingPlatform` (uncompressed). */
async function pdfOf(
  draw: (dp: DrawingPlatform) => void,
  opts: { w?: number; h?: number; images?: Map<DecodedImage, Uint8Array>; compress?: boolean } = {},
): Promise<{ bytes: Uint8Array; raw: string }> {
  const m = pdfModules();
  const doc = new m.PDFDocument({
    autoFirstPage: false,
    compress: opts.compress ?? false,
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
  doc.addPage({ size: [opts.w ?? 200, opts.h ?? 200], margin: 0 });
  const resolver = new PdfFontResolver({
    fontkit: m.fontkit,
    bidi: new BidiResolver(m.bidi),
    providers: [],
    images: new RunImageFallback(napiFactory()),
  });
  const dp = new PdfDrawingPlatform({
    doc,
    text: new PdfTextWriter(doc, resolver),
    imageBytes: opts.images ?? new Map(),
  });
  draw(dp);
  doc.end();
  await ended;
  const bytes = new Uint8Array(Buffer.concat(chunks));
  return { bytes, raw: Buffer.from(bytes).toString('latin1') };
}

/** RGBA of page 1 at `scale` through pdf.js + @napi-rs/canvas. */
async function rasterPdf(bytes: Uint8Array, w: number, h: number): Promise<Uint8ClampedArray> {
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  await page.render({ canvas: canvas as never, canvasContext: ctx as never, viewport }).promise;
  const data = ctx.getImageData(0, 0, w, h).data;
  await task.destroy();
  return data;
}

function rasterCanvas(draw: (dp: DrawingPlatform) => void, w: number, h: number): Uint8ClampedArray {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  draw(new Canvas2DDrawingPlatform(ctx));
  return ctx.getImageData(0, 0, w, h).data;
}

/** The fraction of pixels whose channels differ by more than `tol`. */
function diffRatio(a: Uint8ClampedArray, b: Uint8ClampedArray, tol = 40): number {
  let bad = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(
      Math.abs((a[i] ?? 0) - (b[i] ?? 0)),
      Math.abs((a[i + 1] ?? 0) - (b[i + 1] ?? 0)),
      Math.abs((a[i + 2] ?? 0) - (b[i + 2] ?? 0)),
    );
    if (d > tol) bad++;
  }
  return bad / (a.length / 4);
}

/** The scripted drawing of svg.test.ts: a cubic clip, a translated group, nested save/restore. */
function script(dp: DrawingPlatform): void {
  const blue = filled(new Color(30, 90, 200));
  dp.startDrawing(new Point(10, 10), blue);
  dp.addLineTo(new Point(150, 10));
  dp.addLineTo(new Point(150, 60));
  dp.addLineTo(new Point(10, 60));
  dp.closePath();
  dp.endDrawing();
  dp.saveContext();
  dp.clip([
    step(PathStepType.Move, new Point(20, 80)),
    step(PathStepType.Cubic, new Point(60, 40), new Point(120, 160), new Point(160, 80)),
    step(PathStepType.Line, new Point(160, 180)),
    step(PathStepType.Line, new Point(20, 180)),
    step(PathStepType.Close),
  ]);
  const red = filled(new Color(220, 30, 30));
  dp.startDrawing(new Point(0, 70), red);
  dp.addLineTo(new Point(200, 70));
  dp.addLineTo(new Point(200, 200));
  dp.addLineTo(new Point(0, 200));
  dp.closePath();
  dp.endDrawing();
  dp.saveContext();
  dp.translate(30, 20);
  const green = filled(new Color(20, 160, 60));
  dp.startDrawing(new Point(0, 0), green);
  dp.addEllipse(new Point(60, 110), 60, 30, 0.4);
  dp.endDrawing();
  dp.restoreContext();
  dp.restoreContext();
  const grey = filled(new Color(90, 90, 90));
  dp.startDrawing(new Point(170, 150), grey);
  dp.addCurve(new BezierCurve(new Point(170, 150), new Point(190, 120), new Point(200, 180), new Point(195, 195)));
  dp.addLineTo(new Point(170, 195));
  dp.closePath();
  dp.endDrawing();
  // A dashed, translucent stroke and an arc.
  const dashed = new Style();
  dashed.setStrokeWidth(3);
  dashed.setStrokeColor(new Color(0, 0, 0, 128));
  dashed.setDashArray([6, 3]);
  dp.startDrawing(new Point(10, 190), dashed);
  dp.addLineTo(new Point(160, 190));
  dp.endDrawing();
  const ring = new Style();
  ring.setStrokeWidth(2);
  ring.setStrokeColor(new Color(120, 0, 160));
  dp.startDrawing(new Point(0, 0), ring);
  dp.addArc(new Point(175, 35), 18, 0, Math.PI * 1.5);
  dp.endDrawing();
}

describe('PdfDrawingPlatform primitives', () => {
  it('the scripted drawing renders as on the canvas (pdf.js raster, AC-EXP-12 smoke)', async () => {
    const { bytes } = await pdfOf(script);
    const pdf = await rasterPdf(bytes, 200, 200);
    const canvas = rasterCanvas(script, 200, 200);
    const white = new Uint8ClampedArray(canvas.length).fill(255);
    expect(diffRatio(canvas, white)).toBeGreaterThan(0.3); // there is a drawing to compare
    expect(diffRatio(pdf, canvas)).toBeLessThan(0.01);
  });

  it('a 5-stop linear gradient is an axial shading with a 4-part stitching function (AC-EXP-11)', async () => {
    const stops = [0, 0.25, 0.5, 0.75, 1].map((offset, i) => ({ offset, color: new Color(50 * i, 255 - 50 * i, 100) }));
    const g: ComputedGradient = { type: 'linear', x1: 10, y1: 20, x2: 180, y2: 20, stops };
    const { raw } = await pdfOf((dp) => {
      dp.startDrawing(new Point(10, 10), filled(new Color(0, 0, 0)), { fillGradient: g });
      dp.addLineTo(new Point(190, 10));
      dp.addLineTo(new Point(190, 100));
      dp.closePath();
      dp.endDrawing();
    });
    expect(raw).toMatch(/\/ShadingType 2/);
    expect(raw).toMatch(/\/Coords \[10 20 180 20\]/);
    const stitch = /\/FunctionType 3[\s\S]*?\/Functions \[([^\]]*)\]/.exec(raw);
    expect(
      stitch?.[1]
        ?.trim()
        .split(/\s+0 R\s*/)
        .filter((x) => x !== '').length,
    ).toBe(4);
    expect(raw).toMatch(/\/Bounds \[0\.25 0\.5 0\.75\]/);
  });

  it('a focal radial gradient keeps its focal point and radii (AC-EXP-11)', async () => {
    const stops = [
      { offset: 0, color: new Color(255, 0, 0) },
      { offset: 0.5, color: new Color(0, 255, 0) },
      { offset: 1, color: new Color(0, 0, 255) },
    ];
    const g: ComputedGradient = { type: 'radial', cx: 100, cy: 100, r: 80, fx: 70, fy: 90, fr: 5, stops };
    const { raw } = await pdfOf((dp) => {
      dp.startDrawing(new Point(0, 0), filled(new Color(0, 0, 0)), { fillGradient: g });
      dp.addCircle(new Point(100, 100), 80);
      dp.endDrawing();
    });
    expect(raw).toMatch(/\/ShadingType 3/);
    expect(raw).toMatch(/\/Coords \[70 90 5 100 100 80\]/);
    expect(raw).toMatch(/\/Bounds \[0\.5\]/);
  });

  it('stop alpha becomes a soft mask', async () => {
    const stops = [
      { offset: 0, color: new Color(255, 0, 0, 255) },
      { offset: 1, color: new Color(0, 0, 255, 64) },
    ];
    const { raw } = await pdfOf((dp) => {
      dp.startDrawing(new Point(0, 0), filled(new Color(0, 0, 0)), {
        fillGradient: { type: 'linear', x1: 0, y1: 0, x2: 100, y2: 0, stops },
      });
      dp.addRoundedRect(new Rect(10, 10, 100, 60), 0);
      dp.endDrawing();
    });
    expect(raw).toMatch(/\/SMask/);
  });

  it('dashes, opacity and a cubic clip are written as PDF operators', async () => {
    const { raw } = await pdfOf(script);
    expect(raw).toContain('[6 3] 0 d');
    expect(raw).toMatch(/\/CA 0\.50196/); // stroke alpha 128/255
    expect(raw).toMatch(/W n/);
    expect(raw).toMatch(/ c\n/); // cubic segments (clip, ellipse, arc)
  });

  it('dash rules follow the canvas: negatives ignore the dash, all zeros are solid', () => {
    expect(dashOperand([])).toBeNull();
    expect(dashOperand([4, -1])).toBeNull();
    expect(dashOperand([0, 0])).toBeNull();
    expect(dashOperand([5])).toBe('[5] 0 d');
    expect(dashOperand([0, 4])).toBe('[0 4] 0 d');
  });

  it('a rotated opaque image is JPEG (DCTDecode); an image with alpha is PNG with an SMask; each opened once', async () => {
    const e = env();
    const opaque = solidImage(40, 30, '#3366cc');
    const c = createCanvas(20, 20);
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
    ctx.fillRect(0, 0, 20, 10);
    const alpha: DecodedImage = { width: 20, height: 20, source: c };
    const images = new Map<DecodedImage, Uint8Array>();
    for (const i of [opaque, alpha]) {
      const b = await encodeImageForPdf(e, i);
      if (b !== null) images.set(i, b);
    }
    const { raw } = await pdfOf(
      (dp) => {
        dp.drawImage(new Point(60, 60), new Size(80, 60), Math.PI / 6, opaque);
        dp.drawImage(new Point(150, 60), new Size(40, 40), 0, alpha);
        dp.drawImage(new Point(150, 150), new Size(40, 40), 0, alpha);
      },
      { images },
    );
    expect(raw).toMatch(/\/Filter \/DCTDecode/);
    expect((raw.match(/\/SMask \d+ 0 R/g) ?? []).length).toBe(1);
    expect((raw.match(/\/Subtype \/Image/g) ?? []).length).toBe(3); // JPEG, PNG and its mask
  });
});
