// SVG export (spec 08 §8): the C++ document structure (prolog, root, `<desc>`, background style),
// the fixed gaps of DR-EXP-03 (save/restore groups, translate, clip), gradients with every stop,
// one `<tspan>` per laid-out line, and AC-EXP-20: clipped content and a translated group render
// like the canvas (the PNG export's platform), rasterised here by @napi-rs/canvas's SVG reader.
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { SvgDrawingPlatform, escapeXml, resolveSvgParts, svgNum } from '../../src/export';
import { BezierCurve, PathStepType, Point, Rect, Size, pathStep, type PathStep } from '../../src/geometry';
import { Canvas2DDrawingPlatform, type DrawingPlatform } from '../../src/render';
import { Color, Style } from '../../src/style';
import { boardSession, env, fixtureSession, rectBoard, recordingSink, run, solidImage } from './helpers';

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

/** A scripted drawing with a cubic clip, a translated group and nested save/restore. */
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

  // After the restores: neither the clip nor the translation applies.
  const grey = filled(new Color(90, 90, 90));
  dp.startDrawing(new Point(170, 150), grey);
  dp.addCurve(new BezierCurve(new Point(170, 150), new Point(190, 120), new Point(200, 180), new Point(195, 195)));
  dp.addLineTo(new Point(170, 195));
  dp.closePath();
  dp.endDrawing();
}

async function rasterSvg(text: string, w: number, h: number): Promise<Uint8ClampedArray> {
  const img = await loadImage(Buffer.from(text));
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

function svgOf(draw: (dp: SvgDrawingPlatform) => void, w = 200, h = 200): SvgDrawingPlatform & { text(): string } {
  const sp = new SvgDrawingPlatform();
  sp.start(w, h, null);
  draw(sp);
  sp.finish();
  return Object.assign(sp, { text: () => textOf(sp) });
}

/** The SVG text of a platform without images. */
function textOf(sp: SvgDrawingPlatform): string {
  return sp
    .parts()
    .map((p) => (typeof p === 'string' ? p : ''))
    .join('');
}

describe('SvgDrawingPlatform structure (C++ SVGExporter)', () => {
  it('the prolog, the root and the description, as C++ writes them', () => {
    const t = svgOf(() => undefined, 120.5, 80).text();
    expect(t).toBe(
      '<?xml version="1.0" standalone="no"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"\n\t"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n' +
        '\n<svg  width="120.5" height="80" viewBox="0 0 120.5 80" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"  version="1.1">' +
        '\n  <desc>Lekh Diagram</desc>\n</svg>',
    );
  });

  it('the background: a colour as background-color, an image as background-image', () => {
    const a = new SvgDrawingPlatform();
    a.start(10, 10, { color: new Color(1, 2, 3) });
    expect(textOf(a)).toContain('style="background-color: rgb(1, 2, 3)" xmlns=');
    const b = new SvgDrawingPlatform();
    b.start(10, 10, { imageBase64: 'QUJD' });
    expect(textOf(b)).toContain('style="background-image: url(data:image/png;base64,QUJD);" ');
  });

  it('paths, circles, rounded rects with the C++ style attributes', () => {
    const t = svgOf((dp) => {
      const s = new Style();
      s.setStrokeColor(new Color(10, 20, 30, 128));
      s.setStrokeWidth(2);
      s.setDashArray([4, 2]);
      s.setFillColor(new Color(200, 100, 50, 255));
      dp.startDrawing(new Point(1, 2), s);
      dp.moveTo(new Point(3, 4)); // a move after a move replaces it
      dp.addLineTo(new Point(5, 6));
      dp.addCurve(new BezierCurve(new Point(5, 6), new Point(7, 8), new Point(9, 10), new Point(11, 12), 3));
      dp.closePath();
      dp.endDrawing();
      dp.startDrawing(new Point(0, 0), s);
      dp.addCircle(new Point(50, 50), 10);
      dp.startDrawing(new Point(0, 0), s);
      dp.addRoundedRect(new Rect(0, 0, 50, 20));
    }).text();
    expect(t).toContain(
      '<path  stroke-dasharray="4, 2"  stroke-linecap="round"  stroke-width="2" stroke="rgb(10, 20, 30)" stroke-opacity="0.501961" fill="rgb(200, 100, 50)" d=" M 3,4  L 5,6  Q 7,8 9,10  Z "/>',
    );
    expect(t).toContain(' cx="50" cy="50" r="10"/>');
    expect(t).toContain(' x="0" y="0" width="50" height="20" rx="4" ry="4"/>');
  });

  it('a path of moves only writes nothing', () => {
    const t = svgOf((dp) => {
      dp.startDrawing(new Point(1, 1), new Style());
      dp.endDrawing();
    }).text();
    expect(t).not.toContain('<path');
  });

  it('save/restore, translate and clip open and close balanced groups (DR-EXP-03)', () => {
    const t = svgOf(script).text();
    expect(t.match(/<g[ >]/g)?.length).toBe(t.match(/<\/g>/g)?.length);
    expect(t).toMatch(
      /<clipPath id="lkclip1">\s*<path\s+d=" M 20,80 {2}C 60,40 120,160 160,80 {2}L 160,180 {2}L 20,180 {2}Z "\/><\/clipPath>|<clipPath id="lkclip1">/,
    );
    expect(t).toContain('clip-path="url(#lkclip1)"');
    expect(t).toContain('transform="translate(30 20)"');
  });

  it('the export view offsets coordinates, as TranslatedDrawingPlatform did', () => {
    const t = svgOf((dp) => {
      dp.applyExportView({ scale: 1, tx: 100, ty: -50 });
      dp.startDrawing(new Point(1, 2), filled(new Color(0, 0, 0)));
      dp.addLineTo(new Point(3, 4));
      dp.endDrawing();
    }).text();
    expect(t).toContain('d=" M 101,-48  L 103,-46 "');
  });

  it('a gradient fill is a gradient element with every stop (DR-EXP-02)', () => {
    const t = svgOf((dp) => {
      const s = filled(new Color(0, 0, 0));
      const stops = [0, 0.25, 0.5, 0.75, 1].map((offset, i) => ({ offset, color: new Color(i * 50, 0, 0) }));
      dp.startDrawing(new Point(0, 0), s, { fillGradient: { type: 'linear', x1: 0, y1: 0, x2: 10, y2: 0, stops } });
      dp.addLineTo(new Point(10, 0));
      dp.addLineTo(new Point(10, 10));
      dp.closePath();
      dp.endDrawing();
    }).text();
    expect(t.match(/<stop /g)).toHaveLength(5);
    expect(t).toContain('fill="url(#lkgrad1)"');
    expect(t.indexOf('<linearGradient')).toBeLessThan(t.indexOf('fill="url(#lkgrad1)"'));
  });

  it('numbers and escaping', () => {
    expect(svgNum(1.23456789)).toBe('1.2346');
    expect(svgNum(-0.00001)).toBe('0');
    expect(svgNum(1e7)).toBe('10000000');
    expect(escapeXml(`a<b>&"c'`)).toBe('a&lt;b&gt;&amp;&quot;c&apos;');
  });

  it('images become base64 PNG, each image encoded once', async () => {
    const img = solidImage(4, 4, '#ff0000');
    const sp = svgOf((dp) => {
      dp.drawImage(new Point(10, 10), new Size(8, 8), 0, img);
      dp.drawImage(new Point(30, 10), new Size(8, 8), Math.PI / 2, img);
    });
    let encodes = 0;
    const e = env();
    const base = e.canvasFactory;
    const t = await resolveSvgParts(sp.parts(), {
      ...e,
      canvasFactory: {
        ...base,
        encode: (c, m, q) => {
          encodes++;
          return base.encode(c, m, q);
        },
      },
    });
    expect(encodes).toBe(1);
    expect(t.match(/xlink:href="data:image\/png;base64,iVBORw0KGgo/g)).toHaveLength(2);
    expect(t).toContain('transform="rotate(90 30 10)" ');
  });
});

describe('SVG renders like the canvas (AC-EXP-20)', () => {
  it('clipped content and a translated group', async () => {
    const W = 200;
    const H = 200;
    const c = createCanvas(W, H);
    const ctx = c.getContext('2d');
    script(new Canvas2DDrawingPlatform(ctx));
    const canvas = ctx.getImageData(0, 0, W, H).data;
    const svg = await rasterSvg(svgOf(script).text(), W, H);
    let bad = 0;
    for (let i = 0; i < canvas.length; i += 4) {
      let d = 0;
      for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs((canvas[i + k] ?? 0) - (svg[i + k] ?? 0)));
      if (d > 48) bad++; // anti-aliasing at edges only
    }
    // The image bar: under 0.5 % of the pixels differ beyond anti-aliasing.
    expect(bad / (W * H)).toBeLessThan(0.005);
    // And the clip really clips: inside the red rectangle but outside the clip path is empty.
    const at = (x: number, y: number): number => svg[(y * W + x) * 4 + 3] ?? -1;
    expect(at(5, 190)).toBe(0);
    expect(at(100, 170)).toBe(255);
  });

  it('a board page through the export job, rasterised, matches its PNG export', async () => {
    const s = boardSession(
      rectBoard([
        {
          rects: [
            [60, 50, 80, 40],
            [150, 120, 60, 60],
          ],
          fill: 0xff2266aa | 0,
          background: 0xffeeeeee | 0,
        },
      ]),
      undefined,
      'S',
    );
    const svg = recordingSink();
    await run(s, { format: 'svg', region: 'drawing', padding: 10 }, env({ sink: svg.sink }));
    const png = recordingSink();
    await run(s, { format: 'png', region: 'drawing', padding: 10 }, env({ sink: png.sink }));
    const pimg = await loadImage(Buffer.from(png.rec.file('S.png')));
    const W = pimg.width;
    const H = pimg.height;
    const pc = createCanvas(W, H);
    const pctx = pc.getContext('2d');
    pctx.drawImage(pimg, 0, 0);
    const a = pctx.getImageData(0, 0, W, H).data;
    const b = await rasterSvg(Buffer.from(svg.rec.file('S.svg')).toString('utf8'), W, H);
    let bad = 0;
    for (let i = 0; i < a.length; i += 4) {
      let d = 0;
      for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs((a[i + k] ?? 0) - (b[i + k] ?? 0)));
      if (d > 48) bad++;
    }
    expect(bad / (W * H)).toBeLessThan(0.005);
  });
});

describe('SVG text (spec 08 §8, spec 06 §4)', () => {
  it('one tspan per laid-out line at its baseline, quoted family with a generic fallback', async () => {
    const s = fixtureSession('format/05-multi-page.lekh');
    const { sink, rec } = recordingSink();
    const r = await run(s, { format: 'svg', region: 'drawing', padding: 10, pageIndexes: [0] }, env({ sink }));
    expect(r.status).toBe('done');
    const t = Buffer.from(rec.file(rec.names[0] ?? '')).toString('utf8');
    expect(t).toContain('>Server</tspan>');
    expect(t).toMatch(/font-family:&quot;[^&]+&quot;(, [a-z-]+)+;/);
    expect(t).toMatch(/<tspan +x="[-\d.]+" y="[-\d.]+">/);
  });
});
