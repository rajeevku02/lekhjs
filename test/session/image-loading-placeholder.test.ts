// Images load like C++ (owner decision 2026-10-20, Work 01M4X7TCHFB862XGT68GPY071C, IM1): the board
// is drawn without waiting for an image fetch or decode. While an image is loading its slot is the
// C++ placeholder (white, black 2 pt border, at the image's frame: C++ `ShapeElement.cpp:537-554`)
// with a centred "Loading…" label that scales with the shape and is skipped when the rectangle is
// too small; the arrival repaints with the image. A failed image keeps the plain placeholder, and
// an export never shows the label (it waits for the image).
import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { BoardSession } from '../../src/session';
import { IMAGE_LOADING_LABEL, layoutTextInBox } from '../../src/template';
import { Point, Rect } from '../../src/geometry';
import { Style } from '../../src/style';
import { fontPx, type LineMetrics, type TextMeasurer } from '../../src/text';
import { FakeImagePort, FakeScheduler } from '../../src/testing';
import { Canvas2DDrawingPlatform, type DecodedImage } from '../../src/render';
import { testRuntime } from './helpers';

const URL = 'res://im1-slow-image';

function board(w: number, h: number, angle = 0): string {
  return JSON.stringify({
    info: { version: '4.2' },
    attributes: { grid: { present: false }, scaling: { scale: 1, unit: 'point' } },
    pages: {
      p1: {
        name: 'Page 1',
        order: 0,
        canvassizetype: 'infinite',
        size: { width: 0, height: 0, unit: 'point' },
        objects: {
          o1: {
            type: 'templated',
            order: 1,
            params: { cx: 200, cy: 150, width: w, height: h, angle },
            template: {
              id: 'avabodh.basic.image',
              texts: '',
              images: [{ location: '0 1 2 3 4 0', src: URL }],
              data: ['0', '0', 'w', 'h', '0'],
              draw: [],
            },
          },
        },
      },
    },
  });
}

function open(w = 240, h = 180, angle = 0): { s: BoardSession; images: FakeImagePort; sched: FakeScheduler } {
  const sched = new FakeScheduler();
  const images = new FakeImagePort();
  const s = new BoardSession(testRuntime({ clock: sched }), { images, scheduler: sched });
  s.dispatch({ type: 'open', raw: board(w, h, angle), meta: { kind: 'offline' } });
  s.dispatch({
    type: 'command',
    origin: 'ui',
    command: { kind: 'view', canvasW: 400, canvasH: 300, zoom: 1, tx: 0, ty: 0 },
  });
  sched.flushTimers(); // the deferred image request goes out (ImageRequests' setTimeout 0)
  return { s, images, sched };
}

interface Recorded {
  texts: string[];
  images: unknown[];
  px(x: number, y: number): number[];
}

/** Paints the drawing layer onto a real canvas, recording `fillText` and `drawImage`. */
function paintDrawing(s: BoardSession): Recorded {
  const canvas = createCanvas(400, 300);
  const ctx = canvas.getContext('2d');
  const texts: string[] = [];
  const images: unknown[] = [];
  const rec = new Proxy(ctx, {
    get(target, prop) {
      const v = Reflect.get(target, prop, target) as unknown;
      if (typeof v !== 'function') return v;
      const fn = v as (...a: unknown[]) => unknown;
      if (prop === 'fillText') return (...a: unknown[]) => (texts.push(String(a[0])), fn.apply(target, a));
      if (prop === 'drawImage') return (...a: unknown[]) => (images.push(a[0]), fn.apply(target, a));
      return fn.bind(target);
    },
    set(target, prop, value) {
      return Reflect.set(target, prop, value, target);
    },
  });
  s.paint('drawing', rec);
  const data = ctx.getImageData(0, 0, 400, 300).data;
  return {
    texts,
    images,
    px: (x, y) => {
      const i = (y * 400 + x) * 4;
      return [data[i] ?? -1, data[i + 1] ?? -1, data[i + 2] ?? -1, data[i + 3] ?? -1];
    },
  };
}

function solid(w: number, h: number): DecodedImage {
  const c = createCanvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = '#ff0000';
  g.fillRect(0, 0, w, h);
  return { width: w, height: h, source: c };
}

describe('an image that is still loading (IM1)', () => {
  it('does not block the first frame: the board paints while the fetch is in flight', () => {
    const { s, images } = open();
    expect(images.requested).toContain(URL);
    expect(s.imageCache.state(URL)).toBe('pending');
    expect(s.waitingForFonts).toBe(false);
    const r = paintDrawing(s);
    // The placeholder is on the canvas now: white inside the image's frame (200 ± 120, 150 ± 90).
    expect(r.px(120, 100)).toEqual([255, 255, 255, 251]);
    expect(r.images).toHaveLength(0);
  });

  it('draws the white placeholder with a centred "Loading…" label', () => {
    const { s } = open();
    const r = paintDrawing(s);
    expect(r.texts.join('')).toBe(IMAGE_LOADING_LABEL);
    // The C++ border: the default style's black 2 pt stroke on the frame's edge (x = 80).
    expect(r.px(80, 150).slice(0, 3)).toEqual([0, 0, 0]);
  });

  it('skips the label when the rectangle is too small for it', () => {
    const { s } = open(40, 30);
    const r = paintDrawing(s);
    expect(r.texts).toEqual([]);
    expect(r.px(200, 150)).toEqual([255, 255, 255, 251]); // the placeholder is still drawn
  });

  it('repaints with the image when it arrives, without the label', () => {
    const { s, sched } = open();
    const paints: string[] = [];
    s.on('paintRequested', (e) => paints.push(e.layer));
    sched.frame();
    paints.length = 0;
    s.dispatch({ type: 'imageLoaded', url: URL, image: solid(4, 3) });
    sched.frame(); // repaints are coalesced to the next frame
    expect(paints).toContain('drawing');
    const r = paintDrawing(s);
    expect(r.images).toHaveLength(1);
    expect(r.texts).toEqual([]);
    expect(r.px(200, 150).slice(0, 3)).toEqual([255, 0, 0]);
  });

  it('a failed image keeps the plain placeholder (no label, as before)', () => {
    const { s } = open();
    s.dispatch({ type: 'imageFailed', url: URL, reason: 'http' });
    const r = paintDrawing(s);
    expect(r.texts).toEqual([]);
    expect(r.images).toHaveLength(0);
    expect(r.px(120, 100)).toEqual([255, 255, 255, 251]);
  });

  it('an image evicted while off screen is requested again when it is painted, and shows as loading', () => {
    const { s, images, sched } = open();
    s.dispatch({ type: 'imageLoaded', url: URL, image: solid(4, 3) });
    expect(paintDrawing(s).images).toHaveLength(1);
    // Scrolled away for over the 60 s TTL: culled, unused, evicted.
    s.dispatch({
      type: 'command',
      origin: 'ui',
      command: { kind: 'view', canvasW: 400, canvasH: 300, zoom: 1, tx: -5000, ty: -5000 },
    });
    paintDrawing(s);
    sched.advance(61_000);
    expect(s.imageCache.state(URL)).toBe('absent');
    const asked = images.requested.length;
    // Back on screen: the placeholder with the label, and one deferred request.
    s.dispatch({
      type: 'command',
      origin: 'ui',
      command: { kind: 'view', canvasW: 400, canvasH: 300, zoom: 1, tx: 0, ty: 0 },
    });
    const r = paintDrawing(s);
    expect(r.texts.join('')).toBe(IMAGE_LOADING_LABEL);
    expect(s.imageCache.state(URL)).toBe('pending');
    sched.flushTimers();
    expect(images.requested.length).toBe(asked + 1);
    expect(images.requested.at(-1)).toBe(URL);
  });

  it('an export draw never shows the label, even for an image still pending', () => {
    const { s } = open();
    const canvas = createCanvas(400, 300);
    const texts: string[] = [];
    const ctx = canvas.getContext('2d');
    const real = ctx.fillText.bind(ctx);
    ctx.fillText = (t: string, x: number, y: number) => {
      texts.push(t);
      real(t, x, y);
    };
    s.drawForExport(new Canvas2DDrawingPlatform(ctx), 0, false, { scale: 1, tx: 0, ty: 0 });
    expect(s.imageCache.state(URL)).toBe('pending');
    expect(texts).toEqual([]);
  });

  // P3 (P-01 S-dec/d7 1.26: a board with 32 image slots): each placeholder size was a font size of
  // its own, so the first frame of a board still loading its images measured the label once per
  // slot. The label is now one reference layout, scaled.
  describe('the label is measured once, not once per placeholder size (P3)', () => {
    /** Widths linear in the font size (as a canvas measures), counting the calls. */
    class LinearMeasurer implements TextMeasurer {
      calls = 0;
      measureLine(text: string, fontKey: string): LineMetrics {
        this.calls++;
        const px = fontPx(fontKey);
        return { width: 0.55 * px * text.length, ascent: 0.8 * px, descent: 0.25 * px };
      }
    }

    function boardOf(sizes: readonly [number, number][]): string {
      const doc = JSON.parse(board(10, 10)) as { pages: { p1: { objects: Record<string, unknown> } } };
      const objects: Record<string, unknown> = {};
      sizes.forEach(([w, h], i) => {
        objects['o' + String(i + 1)] = {
          type: 'templated',
          order: i + 1,
          params: { cx: 60 + i * 130, cy: 150, width: w, height: h, angle: 0 },
          template: {
            id: 'avabodh.basic.image',
            texts: '',
            images: [{ location: '0 1 2 3 4 0', src: URL + '-' + String(i) }],
            data: ['0', '0', 'w', 'h', '0'],
            draw: [],
          },
        };
      });
      doc.pages.p1.objects = objects;
      return JSON.stringify(doc);
    }

    function openWith(measurer: LinearMeasurer, sizes: readonly [number, number][]): BoardSession {
      const sched = new FakeScheduler();
      const s = new BoardSession(testRuntime({ clock: sched, measurer }), {
        images: new FakeImagePort(),
        scheduler: sched,
      });
      s.dispatch({ type: 'open', raw: boardOf(sizes), meta: { kind: 'offline' } });
      s.dispatch({
        type: 'command',
        origin: 'ui',
        command: { kind: 'view', canvasW: 1000, canvasH: 300, zoom: 1, tx: 0, ty: 0 },
      });
      sched.flushTimers();
      return s;
    }

    /** Paints the drawing layer, recording each fillText with the font it was drawn in. */
    function paintRecording(s: BoardSession): { text: string; x: number; y: number; font: string }[] {
      const ctx = createCanvas(1000, 300).getContext('2d');
      const out: { text: string; x: number; y: number; font: string }[] = [];
      const real = ctx.fillText.bind(ctx);
      ctx.fillText = (t: string, x: number, y: number) => {
        out.push({ text: t, x, y, font: ctx.font });
        real(t, x, y);
      };
      s.paint('drawing', ctx);
      return out;
    }

    const SIZES: readonly [number, number][] = [
      [100, 80],
      [110, 90],
      [120, 70],
      [125, 105],
      [90, 120],
      [118, 97],
    ];

    it('measures nothing per placeholder: six sizes, one label layout', () => {
      const m = new LinearMeasurer();
      const s = openWith(m, SIZES);
      const before = m.calls;
      const drawn = paintRecording(s);
      expect(drawn.map((d) => d.text)).toEqual(SIZES.map(() => IMAGE_LOADING_LABEL));
      // The reference layout: the label and the font metrics, once (two per size before P3).
      expect(m.calls - before).toBeLessThanOrEqual(2);
      const again = m.calls;
      paintRecording(s);
      expect(m.calls).toBe(again);
    });

    it('draws each label at the size and place a layout at its own font size gives', () => {
      const m = new LinearMeasurer();
      const s = openWith(m, SIZES);
      const drawn = paintRecording(s);
      SIZES.forEach(([w, h], i) => {
        const rect = Rect.fromCenter(new Point(60 + i * 130, 150), w, h);
        const style = new Style();
        style.setFontSize(Math.min(w, h) * 0.1);
        const own = layoutTextInBox(
          s.text,
          { text: IMAGE_LOADING_LABEL, angle: 0, inRect: rect, wrapMode: 'float' },
          style,
          0,
        );
        const d = drawn[i];
        expect(own).not.toBeNull();
        expect(d).toBeDefined();
        expect(fontPx(d?.font ?? '')).toBeCloseTo(own?.px ?? NaN, 3);
        expect(d?.x).toBeCloseTo(own?.lines[0]?.x ?? NaN, 6);
        expect(d?.y).toBeCloseTo(own?.lines[0]?.baselineY ?? NaN, 6);
      });
    });
  });
});
