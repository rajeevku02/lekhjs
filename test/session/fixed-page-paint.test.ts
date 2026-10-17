// A fixed-size page on screen (W10 FX-B, AC-UI-18): as C++ `CanvasWidget::computeSize` places the
// grid and drawing canvases, the grid layer paints only the page rectangle (its background, grid
// and 2 px separator border, clipped to the page) and leaves the surround transparent for the
// board's grey/black; the drawing layer is clipped to the page. An infinite page still fills the
// whole view.
import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { BoardSession } from '../../src/session';
import { FakeImagePort, FakeScheduler } from '../../src/testing';
import { testRuntime } from './helpers';

function board(sizeType: 'fixed' | 'infinite'): string {
  return JSON.stringify({
    info: { version: '4.2' },
    attributes: {},
    pages: {
      p1: {
        name: 'Page 1',
        order: 0,
        canvassizetype: sizeType,
        size: { width: 200, height: 100, unit: 'point' },
        background: { color: -1 },
        objects: {},
      },
    },
  });
}

function session(sizeType: 'fixed' | 'infinite', view: { zoom: number; tx: number; ty: number }): BoardSession {
  const s = new BoardSession(testRuntime(), { images: new FakeImagePort(), scheduler: new FakeScheduler() });
  const r = s.load(board(sizeType), { kind: 'offline' });
  expect(r.ok).toBe(true);
  s.dispatch({ type: 'command', origin: 'ui', command: { kind: 'view', canvasW: 400, canvasH: 300, ...view } });
  return s;
}

function paintGrid(s: BoardSession, theme?: 'light' | 'dark'): (x: number, y: number) => number[] {
  const canvas = createCanvas(400, 300);
  const ctx = canvas.getContext('2d');
  s.paint('grid', ctx, theme !== undefined ? { theme } : {});
  const data = ctx.getImageData(0, 0, 400, 300).data;
  return (x, y) => {
    const i = (y * 400 + x) * 4;
    return [data[i] ?? -1, data[i + 1] ?? -1, data[i + 2] ?? -1, data[i + 3] ?? -1];
  };
}

describe('fixed-size page on screen', () => {
  it('paints the page rectangle only, the surround stays transparent', () => {
    const s = session('fixed', { zoom: 1, tx: 50, ty: 40 });
    const px = paintGrid(s);
    expect(px(10, 10)[3]).toBe(0); // left of and above the page
    expect(px(260, 100)[3]).toBe(0); // right of the page (50 + 200)
    expect(px(100, 100)[3]).toBe(255); // inside
    expect(px(249, 139)[3]).toBe(255); // the page's last pixel
    expect(px(250, 140)[3]).toBe(0);
  });

  it('draws the border in the separator colour of the theme', () => {
    const s = session('fixed', { zoom: 1, tx: 50, ty: 40 });
    const light = paintGrid(s, 'light')(249, 80);
    const dark = paintGrid(s, 'dark')(249, 80);
    expect(light[0]).toBeLessThan(255);
    expect(dark[0]).toBeLessThan(light[0] ?? 0);
  });

  it('clips at the view when the page is scrolled off the top left', () => {
    const s = session('fixed', { zoom: 1, tx: -30, ty: -20 });
    const px = paintGrid(s);
    expect(px(0, 0)[3]).toBe(255);
    expect(px(169, 79)[3]).toBe(255);
    expect(px(171, 81)[3]).toBe(0); // beyond 200 - 30, 100 - 20
  });

  it('an infinite page fills the view', () => {
    const s = session('infinite', { zoom: 1, tx: 50, ty: 40 });
    const px = paintGrid(s);
    expect(px(10, 10)[3]).toBe(255);
    expect(px(390, 290)[3]).toBe(255);
  });

  it('clips the drawing layer to the page', () => {
    const s = session('fixed', { zoom: 1, tx: 50, ty: 40 });
    const canvas = createCanvas(400, 300);
    const ctx = canvas.getContext('2d');
    s.paint('drawing', ctx);
    // Nothing to draw, but the clip must not leak: a fill after paint() is unclipped again.
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 400, 300);
    expect(Array.from(ctx.getImageData(5, 5, 1, 1).data)).toEqual([255, 0, 0, 255]);
  });
});
