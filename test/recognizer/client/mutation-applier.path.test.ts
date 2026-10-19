// RC1: a recognised generic path (lines and curves mixed, or several curves) becomes a drawable
// `avabodh.basic.path` object. C++ `ShapeToLekh::getLekhObject` loads the `PathTemplate` before
// building the object (`ShapeToLekh.cpp:131-137`: `PathTemplate::from`, `tmpl->load()`,
// `TemplatedObject`, `generateData`); without the load the template has path data but no path
// elements, so the object has bounds (selectable) and paints nothing.
import { describe, expect, it } from 'vitest';
import { TemplatedObject } from '../../../src/model';
import type { RecShapeDTO } from '../../../src/recognizer/worker';
import { PathCaptureDrawingPlatform } from '../../../src/render';
import { PathTemplate } from '../../../src/template';
import { applierRig, lineDTO } from './applierRig';

const mixedDTO = (closed: boolean): RecShapeDTO => ({
  kind: 'path',
  closed,
  snap: false,
  components: [
    { curve: false, p1: { x: 100, y: 100 }, p2: { x: 300, y: 100 } },
    { curve: true, p1: { x: 300, y: 100 }, c1: { x: 380, y: 100 }, c2: { x: 380, y: 220 }, p2: { x: 300, y: 220 } },
    { curve: false, p1: { x: 300, y: 220 }, p2: { x: 100, y: 220 } },
    ...(closed ? [{ curve: false as const, p1: { x: 100, y: 220 }, p2: { x: 100, y: 100 } }] : []),
  ],
});

const twoCurvesDTO: RecShapeDTO = {
  kind: 'path',
  closed: false,
  snap: false,
  components: [
    { curve: true, p1: { x: 100, y: 100 }, c1: { x: 150, y: 20 }, c2: { x: 200, y: 20 }, p2: { x: 250, y: 100 } },
    { curve: true, p1: { x: 250, y: 100 }, c1: { x: 300, y: 180 }, c2: { x: 350, y: 180 }, p2: { x: 400, y: 100 } },
  ],
};

type Applied = { o: TemplatedObject; r: ReturnType<typeof applierRig> };

function applyOne(shape: RecShapeDTO, op: 'add' | 'convert'): TemplatedObject {
  const r = applierRig();
  let deleteIds: string[] = [];
  if (op === 'convert') {
    // An extended path: the stroke's earlier line is replaced by the whole path.
    r.run((ctx) => r.applier.apply(ctx, [{ op: 'add', shapes: [lineDTO(100, 100, 300, 100)] }], r.job()));
    deleteIds = r.ids();
    expect(deleteIds).toHaveLength(1);
  }
  r.run((ctx) =>
    r.applier.apply(
      ctx,
      [op === 'add' ? { op: 'add', shapes: [shape] } : { op: 'convert', deleteIds, shape }],
      r.job(),
    ),
  );
  const objs = r.h.session.editor.doc.activePage().objectStore.objects;
  expect(objs).toHaveLength(1);
  const o = objs[0];
  expect(o).toBeInstanceOf(TemplatedObject);
  last = { o: o as TemplatedObject, r };
  return o as TemplatedObject;
}

let last: Applied | null = null;

/** What the object paints: the components a capture platform records (C++ `PathCaptureDrawingPlatform`). */
function painted(): { paths: number; components: number } {
  const a = last;
  if (a === null) throw new Error('nothing applied');
  const page = a.r.h.session.editor.doc.activePage();
  page.objectStore.ensureLayout(a.o);
  const dp = new PathCaptureDrawingPlatform();
  a.o.paint(dp, { config: a.r.h.session.editor.env.codec.env.objects.config, zoom: 1, forExport: true, images: null });
  return { paths: dp.paths().length, components: dp.paths().reduce((n, p) => n + p.size, 0) };
}

function expectDrawablePath(o: TemplatedObject, components: number, closed: boolean): void {
  const t = o.shapeTemplate();
  expect(t).toBeInstanceOf(PathTemplate);
  const pt = t as PathTemplate;
  expect(pt.templateId).toBe('avabodh.basic.path');
  expect(pt.closedPath()).toBe(closed);
  // The loaded path elements are what paints and hit-tests.
  expect(o.paths()?.length).toBe(1);
  const parts = pt.getPathParts(o.ds);
  expect(parts.size).toBe(components);
  for (const pc of parts.components) {
    const pts = pc.isCurve
      ? [pc.curve.point1, pc.curve.point2, pc.curve.point3, pc.curve.point4]
      : [pc.segment.point1(), pc.segment.point2()];
    for (const p of pts) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  }
  const p = painted();
  expect(p.paths).toBe(1);
  expect(p.components).toBeGreaterThanOrEqual(components);
  const b = o.selectionRect();
  expect(b.width).toBeGreaterThan(10);
  expect(b.height).toBeGreaterThan(10);
}

describe('a recognised generic path is drawable (RC1)', () => {
  it('open line + curve + line (add)', () => {
    expectDrawablePath(applyOne(mixedDTO(false), 'add'), 3, false);
  });
  it('closed mixed path (add)', () => {
    expectDrawablePath(applyOne(mixedDTO(true), 'add'), 4, true);
  });
  it('several curves (add)', () => {
    expectDrawablePath(applyOne(twoCurvesDTO, 'add'), 2, false);
  });
  it('mixed path through convert (an extended path)', () => {
    expectDrawablePath(applyOne(mixedDTO(false), 'convert'), 3, false);
  });
  // The data strings are %g-formatted (6 significant digits), as C++, so 1e-3 is the round trip.
  it('mixed path keeps its curve control points (C++ point layout)', () => {
    const o = applyOne(mixedDTO(false), 'add');
    const parts = (o.shapeTemplate() as PathTemplate).getPathParts(o.ds);
    const c = parts.at(1).curve;
    expect(c.point1.x).toBeCloseTo(300, 3);
    expect(c.point2.x).toBeCloseTo(380, 3);
    expect(c.point3.y).toBeCloseTo(220, 3);
    expect(c.point4.x).toBeCloseTo(300, 3);
  });
});
