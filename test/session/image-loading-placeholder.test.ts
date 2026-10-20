// Images load like C++ (owner decision 2026-10-20, Work 01M4X7TCHFB862XGT68GPY071C, IM1): the board
// is drawn without waiting for an image fetch or decode. While an image is loading its slot is the
// C++ placeholder (white, black 2 pt border, at the image's frame: lekhcore `ShapeElement.cpp:537-554`)
// with a centred "Loading…" label that scales with the shape and is skipped when the rectangle is
// too small; the arrival repaints with the image. A failed image keeps the plain placeholder, and
// an export never shows the label (it waits for the image).
import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { BoardSession } from '../../src/session';
import { IMAGE_LOADING_LABEL } from '../../src/template';
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
});
