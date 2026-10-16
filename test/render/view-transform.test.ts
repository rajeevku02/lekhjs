// ViewTransform (spec 03 §6, §9): the canvas matrix, the C++ mapPoint/mapRect formulas, the
// visible rect from the code (screen = zoom·(doc + scroll)) and the 32/zoom culling margin.
import { describe, expect, it } from 'vitest';
import { Point, Rect } from '../../src/geometry';
import { CULL_MARGIN_PX, ViewTransform } from '../../src/render';
import { recordingCanvas } from './helpers';

describe('ViewTransform', () => {
  const v = new ViewTransform({ zoom: 2, scrollX: 10, scrollY: -5, dpr: 3, canvasW: 800, canvasH: 600 });

  it('matrix is [d·z, 0, 0, d·z, d·z·sx, d·z·sy]', () => {
    expect(v.matrix()).toEqual([6, 0, 0, 6, 60, -30]);
    expect(v.screenMatrix()).toEqual([3, 0, 0, 3, 0, 0]);
    expect(v.viewScale).toBe(6);
    const { ctx, log } = recordingCanvas();
    v.apply(ctx);
    v.applyScreen(ctx);
    expect(log).toEqual(['setTransform 6 0 0 6 60 -30', 'setTransform 3 0 0 3 0 0']);
  });

  it('toDoc is C++ mapPoint (screen/zoom − scroll) and toScreen its inverse (mapPointR)', () => {
    const doc = v.toDoc(new Point(100, 40));
    expect([doc.x, doc.y]).toEqual([100 / 2 - 10, 40 / 2 + 5]);
    const back = v.toScreen(doc);
    expect([back.x, back.y]).toEqual([100, 40]);
  });

  it('toDocRect / toScreenRect follow mapRect / mapRectR', () => {
    const r = v.toDocRect(new Rect(20, 30, 100, 50));
    expect([r.x, r.y, r.width, r.height]).toEqual([0, 20, 50, 25]);
    const s = v.toScreenRect(r);
    expect([s.x, s.y, s.width, s.height]).toEqual([20, 30, 100, 50]);
    expect(v.toDocLength(10)).toBe(5);
  });

  it('a document point drawn through the matrix lands where toScreen says, times the DPR', () => {
    const [a, , , d, e, f] = v.matrix();
    const p = new Point(7, 11);
    const s = v.toScreen(p);
    expect(a * p.x + e).toBeCloseTo(s.x * v.dpr, 12);
    expect(d * p.y + f).toBeCloseTo(s.y * v.dpr, 12);
  });

  it.each([0.1, 1, 4])('visible rect at zoom %s is { −scroll, canvas / zoom }, cull rect grows by 32/zoom', (zoom) => {
    const t = new ViewTransform({ zoom, scrollX: -100, scrollY: 50, canvasW: 1000, canvasH: 500 });
    const vis = t.visibleRect();
    expect([vis.x, vis.y, vis.width, vis.height]).toEqual([100, -50, 1000 / zoom, 500 / zoom]);
    const m = CULL_MARGIN_PX / zoom;
    const c = t.cullRect();
    expect(c.x).toBeCloseTo(100 - m, 9);
    expect(c.y).toBeCloseTo(-50 - m, 9);
    expect(c.width).toBeCloseTo(1000 / zoom + 2 * m, 9);
    expect(c.height).toBeCloseTo(500 / zoom + 2 * m, 9);
  });

  it('fromPercent, forExport and with', () => {
    expect(ViewTransform.fromPercent(150).zoom).toBe(1.5);
    expect(ViewTransform.forExport(-20, -30, 2).matrix()).toEqual([2, 0, 0, 2, -40, -60]);
    const w = v.with({ zoom: 1 });
    expect([w.zoom, w.scrollX, w.dpr, w.canvasW]).toEqual([1, 10, 3, 800]);
    expect(Object.isFrozen(w)).toBe(true);
  });
});
