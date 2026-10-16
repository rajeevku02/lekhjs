// TemplatedObject: geometry from the template, the layout/paint split and the extent, transforms,
// alignment snapping (B7, DR-ENG-09), containers (implicit: B16), text editing, arrows, clone.
import { describe, expect, it } from 'vitest';
import { EngineConfig } from '../../src/base';
import { LineEquation, Point, Rect } from '../../src/geometry';
import { TemplatedObject, lowZoomTextFilter } from '../../src/model';
import { PolygonTemplate } from '../../src/template';
import { LogPlatform } from '../template/helpers';
import { paintEnv } from './helpers';
import { kindsEnv, kindsStore, layOut, modCtx, polyRect, rect, verifyCfg } from './kinds';

describe('TemplatedObject geometry', () => {
  it('box, centre, selection rect (rotated), inside and distance', () => {
    const env = kindsEnv();
    const o = rect(env, 100, 50, 40, 20);
    expect(o.getCenter()).toEqual(new Point(100, 50));
    expect(o.selectionRect()).toEqual(new Rect(80, 40, 40, 20));
    layOut(o);
    expect(o.isPointInside(new Point(100, 50))).toBe(true);
    expect(o.isPointInside(new Point(130, 50))).toBe(false);
    expect(o.distanceFrom(new Point(130, 50))).toBeCloseTo(10);
    const r = rect(env, 0, 0, 40, 20, Math.PI / 2);
    const sel = r.selectionRect();
    expect(sel.width).toBeCloseTo(20);
    expect(sel.height).toBeCloseTo(40);
    expect(r.unrotatedRect()).toEqual(new Rect(-20, -10, 40, 20));
  });

  it('a 1 × 1 minimum box (checkMinDimension)', () => {
    const env = kindsEnv();
    const o = new TemplatedObject(env, null, new Rect());
    o.setRect(new Rect(5, 5, 0, 0));
    expect(o.ds.width()).toBe(1);
    expect(o.ds.height()).toBe(1);
  });

  it('intersection with a line through the centre gives two outline points', () => {
    const env = kindsEnv();
    const o = rect(env, 0, 0, 40, 20);
    layOut(o);
    const pts = o.getIntersection(LineEquation.through(new Point(0, 0), new Point(100, 0)));
    expect(pts.map((p) => Math.round(Math.abs(p.point.x)))).toEqual([20, 20]);
  });

  it('extent covers the stroke reach and the visual bounds', () => {
    const env = kindsEnv();
    const o = rect(env, 0, 0, 40, 20);
    o.getDrawingProfile().setStrokeWidth(4);
    layOut(o);
    const e = o.extent();
    expect(e.x).toBeLessThanOrEqual(-20 - 2);
    expect(e.right()).toBeGreaterThanOrEqual(20 + 2);
    expect(o.visualBounds()).toEqual(new Rect(-20, -10, 40, 20));
  });

  it('a change re-lays out; paint draws the layout and no text while it is edited', () => {
    const env = kindsEnv();
    const o = rect(env, 0, 0, 40, 20, 0, 'Hi');
    layOut(o);
    expect(o.needsLayout()).toBe(false);
    o.setRect(new Rect(0, 0, 50, 50));
    expect(o.needsLayout()).toBe(true);
    layOut(o);
    const dp = new LogPlatform();
    o.paint(dp, paintEnv());
    expect(dp.log.some((l) => l.startsWith('text Hi'))).toBe(true);
    o.startTextEditing(new Point(25, 25));
    layOut(o);
    const dp2 = new LogPlatform();
    o.paint(dp2, paintEnv());
    expect(dp2.log.some((l) => l.startsWith('text'))).toBe(false);
  });

  it('interaction keys: template id, then class name', () => {
    const env = kindsEnv();
    expect(rect(env, 0, 0, 10, 10).interactionKeys()).toEqual(['avabodh.basic.rectangle', 'Templated']);
  });
});

describe('TemplatedObject transforms', () => {
  it('translate without snapping moves by the delta and reports it', () => {
    const env = kindsEnv(new EngineConfig({ snapToGrid: false, debug: { verifyIndex: true } }));
    const store = kindsStore(env);
    const o = rect(env, 100, 100, 40, 20);
    store.add(o);
    o.startModification(modCtx(env, store));
    o.translate(13, 7);
    o.translate(1, 1);
    expect(o.getCenter()).toEqual(new Point(114, 108));
    expect(o.finishTranslating()).toEqual({ x: 14, y: 8 });
  });

  it('translate snaps to another shape within the snap step and draws the guide', () => {
    const env = kindsEnv();
    const store = kindsStore(env);
    const a = rect(env, 100, 100, 40, 20);
    const b = rect(env, 300, 203, 40, 20);
    store.add(a);
    store.add(b);
    b.startModification(modCtx(env, store));
    b.translate(-197, 0); // centre x 103: within 8 of a's x 100 (and its edges)
    expect(b.getCenter().x).toBe(100);
    expect(b.alignmentxDraw.length).toBeGreaterThan(0);
  });

  it('B7: y alignment candidates are sorted by y (snap found by binary search)', () => {
    const env = kindsEnv();
    const store = kindsStore(env);
    // Points whose x order differs from their y order.
    store.add(rect(env, 0, 500, 10, 10));
    store.add(rect(env, 100, 50, 10, 10));
    store.add(rect(env, 200, 300, 10, 10));
    const pts = store.alignmentPoints(new Set());
    const ys = pts.ys.map((p) => p.y);
    expect(ys).toEqual([...ys].sort((p, q) => p - q));
    const xs = pts.xs.map((p) => p.x);
    expect(xs).toEqual([...xs].sort((p, q) => p - q));
    const m = rect(env, 600, 600, 10, 30);
    store.add(m);
    m.startModification(modCtx(env, store));
    m.translate(0, -298); // centre y 302: 2 from the shape at y 300, its edges far from others
    expect(m.getCenter().y).toBe(300);
  });

  it('DR-ENG-09: equal-distance candidates snap to the first in store order (stable)', () => {
    const env = kindsEnv();
    const store = kindsStore(env);
    store.add(rect(env, 96, 0, 10, 10)); // centre x 96
    store.add(rect(env, 104, 400, 10, 10)); // centre x 104
    const m = rect(env, 500, 200, 10, 10);
    store.add(m);
    m.startModification(modCtx(env, store));
    m.translate(-400, 0); // x 100: 4 from both; edges 91/101 and 99/109 tie too
    // Every nearest pair is 1 apart; the stable sort keeps the first collected: the moving
    // shape's first corner (x 95) against the first shape's centre (96).
    const x = m.getCenter().x;
    expect(x).toBe(101);
    // Deterministic: the same drag again gives the same answer.
    m.startModification(modCtx(env, store));
    m.translate(0, 0);
    expect(m.getCenter().x).toBe(x);
  });

  it('rotate snaps to the angle step; scale is uniform and snapped', () => {
    const env = kindsEnv();
    const store = kindsStore(env);
    const o = rect(env, 0, 0, 40, 20);
    store.add(o);
    o.startModification(modCtx(env, store));
    o.rotate(0.1);
    expect(o.ds.angle()).toBeCloseTo(Math.PI / 36);
    expect(o.finishRotating()).toBeCloseTo(Math.PI / 36);
    o.startModification(modCtx(env, store));
    o.scale(2, 5);
    expect(o.ds.width()).toBe(80);
    expect(o.ds.height()).toBe(40);
    expect(o.finishScaling()).toEqual({ x: 2, y: 2 });
  });

  it('expand keeps the top-left corner and snaps to twice the step', () => {
    const env = kindsEnv();
    const store = kindsStore(env);
    const o = rect(env, 50, 50, 40, 20);
    store.add(o);
    o.startModification(modCtx(env, store));
    o.expand(15, 3, 0);
    expect(o.ds.width()).toBe(48);
    expect(o.ds.height()).toBe(16);
    expect(o.finishExpanding()).toEqual({ x: 8, y: -4 });
  });
});

describe('containers', () => {
  it('B16: an implicit container is found through the index; same answer as the scan', () => {
    const env = kindsEnv();
    const store = kindsStore(env);
    const box = polyRect(env, 200, 200, 200, 150); // > small size, < implicit size
    store.add(box);
    store.flushLayout();
    expect(box.isImplicitContainer(store)).toBe(false);
    const inner = rect(env, 200, 200, 40, 40);
    store.add(inner);
    store.flushLayout();
    expect(box.isImplicitContainer(store)).toBe(true);
    // A tap deep inside passes through the container; a tap at its edge does not.
    expect(store.hit.objectContaining(new Point(130, 150), { flattenGroup: false, checkContainer: true })).toBeNull();
    expect(store.hit.objectContaining(new Point(101, 200), { flattenGroup: false, checkContainer: true })).toBe(box);
  });

  it('a large rectangle is an implicit container on its own', () => {
    const env = kindsEnv();
    const store = kindsStore(env);
    const big = polyRect(env, 500, 500, 400, 400);
    store.add(big);
    store.flushLayout();
    expect(big.isImplicitContainer(store)).toBe(true);
  });
});

describe('text editing', () => {
  it('editableAt picks the shape with text, and startTextEditing/finish report the slot', () => {
    const env = kindsEnv();
    const store = kindsStore(env);
    const o = rect(env, 100, 100, 80, 40, 0, 'Hello');
    store.add(o);
    expect(store.hit.editableAt(new Point(100, 100))).toBe(o);
    expect(store.hit.editableAt(new Point(500, 500))).toBeNull();
    o.startTextEditing(new Point(100, 100));
    expect(o.getTextForEditing()).toBe('Hello');
    o.updateText('Bye', -1);
    expect(o.finishTextEditing()).toEqual({ text: 'Hello', index: 0 });
    expect(o.shapeTemplate()?.texts()[0]?.text()).toBe('Bye');
  });
});

describe('arrows and clone', () => {
  it('an open polygon carries arrowheads at its ends; the extent covers them', () => {
    const env = kindsEnv();
    const t = new PolygonTemplate(env.tenv, [new Point(0, 0), new Point(100, 0)], false);
    const o = new TemplatedObject(env, t, new Rect(0, -0.5, 100, 1), 0);
    const ends = o.getArrowPoints();
    expect(ends).toHaveLength(2);
    const at = ends[1]?.[0] as Point;
    expect(o.arrows.addAt(ends, at, true)).toBe(true);
    expect(o.arrows.hasArrowAt(ends, at)).toBe(true);
    expect(o.arrows.addAt(ends, at, true)).toBe(false);
    o.generateData();
    layOut(o);
    const dp = new LogPlatform();
    o.paint(dp, paintEnv());
    expect(dp.log.filter((l) => l === 'Z').length).toBeGreaterThan(0); // the solid triangle closes
    expect(o.isConnectableKind()).toBe(false);
  });

  it('clone has a new id, a loaded template copy and the same box', () => {
    const env = kindsEnv();
    const o = rect(env, 10, 20, 30, 40, 0.3, 'T');
    const c = o.clone();
    expect(c).not.toBeNull();
    expect(c?.id).not.toBe(o.id);
    expect(c?.ds.rect()).toEqual(o.ds.rect());
    expect(c?.ds.angle()).toBe(0.3);
    expect(c?.shapeTemplate()).not.toBe(o.shapeTemplate());
    expect(c?.shapeTemplate()?.texts()[0]?.text()).toBe('T');
  });
});

describe('low-zoom simplification (AC-ENG-31)', () => {
  it('with the flag on, text below minGlyphPx is not drawn; paths are', () => {
    const cfg = new EngineConfig({ render: { lowZoomSimplify: true, minGlyphPx: 2 }, debug: { verifyIndex: true } });
    const env = kindsEnv(cfg);
    const o = rect(env, 0, 0, 80, 40, 0, 'Hi');
    layOut(o);
    const dp = new LogPlatform();
    o.paint(dp, paintEnv(cfg, 0.1));
    expect(dp.log.some((l) => l.startsWith('text'))).toBe(false);
    expect(dp.log.some((l) => l.startsWith('start'))).toBe(true);
    const dp2 = new LogPlatform();
    o.paint(dp2, paintEnv(cfg, 1));
    expect(dp2.log.some((l) => l.startsWith('text'))).toBe(true);
    expect(lowZoomTextFilter(dp, paintEnv(verifyCfg, 0.1))).toBe(dp);
  });
});
