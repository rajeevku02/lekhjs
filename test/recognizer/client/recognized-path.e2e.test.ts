// RC1, end to end: SmartDraw strokes that recognise as a generic path (a line then a curve, an S
// of two curves) go through the real worker host and the session's applier and come out as an
// `avabodh.basic.path` object that paints. Before the fix the object was added with bounds (so it
// could be selected) but painted nothing: `MutationApplier` built the `PathTemplate` without
// `load()` (C++ `ShapeToLekh.cpp:132-136` loads it).
//
// Runs on the production line aggregator (`lineAggregatorImplModule`, through its API only) and on
// the test-only RDP aggregator. The strokes are the ones the browser repro drew (view px).
import { describe, expect, it } from 'vitest';
import { Point } from '../../../src/geometry';
import { TemplatedObject } from '../../../src/model';
import { PathCaptureDrawingPlatform } from '../../../src/render';
import { lineAggregatorImplModule, type LineAggregatorModule } from '../../../src/recognizer/lines';
import { polylineLineAggregatorModule } from '../support/polylineAggregator';
import { sessionRig, type SessionRig } from './sessionRig';

/** A 200 px straight run, then a half circle of radius 70 bulging right. */
function lineThenArc(x: number, y: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= 50; i++) pts.push(new Point(x + 4 * i, y));
  for (let i = 1; i <= 60; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / 60;
    pts.push(new Point(x + 200 + 70 * Math.cos(a), y + 70 + 70 * Math.sin(a)));
  }
  return pts;
}

/** One sine period, 360 × ±60 px: two curves. */
function sCurve(x: number, y: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= 120; i++) {
    const t = i / 120;
    pts.push(new Point(x + 360 * t, y + 60 * Math.sin(2 * Math.PI * t)));
  }
  return pts;
}

/** A line, a half circle, a line back and up to the start: a closed mixed outline. */
function closedMixed(x: number, y: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= 50; i++) pts.push(new Point(x + 4 * i, y));
  for (let i = 1; i <= 60; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / 60;
    pts.push(new Point(x + 200 + 60 * Math.cos(a), y + 60 + 60 * Math.sin(a)));
  }
  for (let i = 1; i <= 50; i++) pts.push(new Point(x + 200 - 4 * i, y + 120));
  for (let i = 1; i <= 30; i++) pts.push(new Point(x, y + 120 - 4 * i));
  pts.push(new Point(x + 2, y));
  return pts;
}

async function recognise(r: SessionRig, pts: Point[]): Promise<TemplatedObject> {
  const before = new Set(r.objects());
  r.client.submit(r.port, r.stroke(pts));
  await r.tick(800);
  const store = r.session.editor.doc.activePage().objectStore;
  const added = store.objects.filter((o) => !before.has(o.id));
  expect(added).toHaveLength(1);
  const o = added[0];
  expect(o).toBeInstanceOf(TemplatedObject);
  return o as TemplatedObject;
}

/** Path components the object paints, through the capture platform. */
function paintedComponents(r: SessionRig, o: TemplatedObject): number {
  r.session.editor.doc.activePage().objectStore.ensureLayout(o);
  const dp = new PathCaptureDrawingPlatform();
  o.paint(dp, { config: r.session.editor.env.codec.env.objects.config, zoom: 1, forExport: true, images: null });
  return dp.paths().reduce((n, p) => n + p.size, 0);
}

const AGGREGATORS: [string, LineAggregatorModule][] = [
  ['production aggregator', lineAggregatorImplModule],
  ['RDP aggregator', polylineLineAggregatorModule],
];

describe.each(AGGREGATORS)('a recognised generic path paints (RC1, %s)', (_name, lineAggregator) => {
  it('a line then a curve becomes a drawable avabodh.basic.path', async () => {
    const r = await sessionRig({ lineAggregator });
    const o = await recognise(r, lineThenArc(150, 150));
    expect(o.shapeTemplate()?.id()).toBe('avabodh.basic.path');
    expect(o.paths()?.length).toBe(1);
    expect(paintedComponents(r, o)).toBeGreaterThanOrEqual(2);
    const b = o.selectionRect();
    expect(Number.isFinite(b.width) && b.width > 100).toBe(true);
  });

  it('an S of two curves becomes a drawable avabodh.basic.path', async () => {
    const r = await sessionRig({ lineAggregator });
    const o = await recognise(r, sCurve(150, 420));
    expect(o.shapeTemplate()?.id()).toBe('avabodh.basic.path');
    expect(paintedComponents(r, o)).toBeGreaterThanOrEqual(2);
  });

  it('a closed mixed outline paints, whatever it is recognised as', async () => {
    const r = await sessionRig({ lineAggregator });
    const o = await recognise(r, closedMixed(700, 150));
    expect(paintedComponents(r, o)).toBeGreaterThanOrEqual(3);
  });
});
