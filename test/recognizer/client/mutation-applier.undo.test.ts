// AC-REC-22: undo granularity and SessionStats calls for each mutation type match spec 07 §6.6
// (`LekhCanvasDelegate.cpp`): convert one step; delete + add two; add one; connect one (+ the
// connector stat); doubleLineArrow one; arrow one; ink one (`markInk`).
import { describe, expect, it } from 'vitest';
import { ConnectionObject, TemplatedObject, UnrecognizedObject } from '../../../src/model';
import { PolygonTemplate } from '../../../src/template';
import { A, B } from '../../sync/helpers';
import { applierRig, inkOf, lineDTO, rectDTO } from './applierRig';

/** An ink stroke on the board (one step, `markInk`), returning its id. */
function addInk(r: ReturnType<typeof applierRig>): string {
  const before = new Set(r.ids());
  r.run((ctx) => {
    r.applier.applyInk(
      ctx,
      inkOf([
        [10, 10],
        [40, 12],
        [80, 30],
      ]).points,
      { zoom: 1, tx: 0, ty: 0 },
    );
  });
  return r.ids().find((id) => !before.has(id)) ?? '';
}

function addLine(r: ReturnType<typeof applierRig>, x1: number, y1: number, x2: number, y2: number): string {
  const before = new Set(r.ids());
  r.run((ctx) => r.applier.apply(ctx, [{ op: 'add', shapes: [lineDTO(x1, y1, x2, y2)] }], r.job()));
  return r.ids().find((id) => !before.has(id)) ?? '';
}

describe('MutationApplier undo granularity and stats (AC-REC-22)', () => {
  it('convert: one step, markRecognized; undo restores the strokes', () => {
    const r = applierRig();
    const ink = addInk(r);
    r.stats.calls.length = 0;
    const d0 = r.undoDepth();
    const out = r.run((ctx) =>
      r.applier.apply(ctx, [{ op: 'convert', deleteIds: [ink], shape: rectDTO(100, 100, 120, 80) }], r.job()),
    );
    expect(out.ok).toBe(true);
    expect(r.undoDepth() - d0).toBe(1);
    expect(r.stats.calls).toEqual(['markRecognized']);
    expect(r.ids()).not.toContain(ink);
    expect(r.ids()).toHaveLength(1);
    r.undo();
    expect(r.ids()).toEqual([ink]);
  });

  it('delete then add: two steps, one markRecognized', () => {
    const r = applierRig();
    const ink = addInk(r);
    r.stats.calls.length = 0;
    const d0 = r.undoDepth();
    r.run((ctx) =>
      r.applier.apply(
        ctx,
        [
          { op: 'delete', ids: [ink] },
          { op: 'add', shapes: [rectDTO(100, 100, 120, 80)] },
        ],
        r.job(),
      ),
    );
    expect(r.undoDepth() - d0).toBe(2);
    expect(r.stats.calls).toEqual(['markRecognized']);
    r.undo();
    expect(r.ids()).toEqual([]);
    r.undo();
    expect(r.ids()).toEqual([ink]);
  });

  it('add: one step, markRecognized; several shapes are one step', () => {
    const r = applierRig();
    r.run((ctx) =>
      r.applier.apply(ctx, [{ op: 'add', shapes: [rectDTO(0, 0, 50, 50), rectDTO(100, 0, 50, 50)] }], r.job()),
    );
    expect(r.undoDepth()).toBe(1);
    expect(r.ids()).toHaveLength(2);
    expect(r.stats.calls).toEqual(['markRecognized']);
    const o = r.h.session.editor.doc.activePage().objectStore.objects[0];
    expect(o).toBeInstanceOf(TemplatedObject);
    expect((o as TemplatedObject).shapeTemplate()).toBeInstanceOf(PolygonTemplate);
  });

  it('connect: one step, markRecognized + onConnectorAdded; with deleted strokes it is a convert', () => {
    const r = applierRig('format/03-connector.lekh');
    const d0 = r.undoDepth();
    const params = [
      { angle: Math.PI / 2, autotype: 0 },
      { angle: Math.PI, autotype: 0 },
    ];
    r.run((ctx) =>
      r.applier.apply(
        ctx,
        [{ op: 'connect', obj1Id: A, obj2Id: B, type: 1, autoType: 0, params, val: 0, deletedIds: [] }],
        r.job(),
      ),
    );
    expect(r.undoDepth() - d0).toBe(1);
    expect(r.stats.calls).toEqual(['markRecognized', 'onConnectorAdded']);
    const cons = r.h.session.editor.doc.activePage().objectStore.objects.filter((o) => o instanceof ConnectionObject);
    expect(cons).toHaveLength(2);
    // the drawn connector has the default end arrow (defaultArrowType 2: solid)
    expect((cons[1] as ConnectionObject).arrows.end()).not.toBeNull();
    r.undo();
    expect(
      r.h.session.editor.doc.activePage().objectStore.objects.filter((o) => o instanceof ConnectionObject),
    ).toHaveLength(1);

    const ink = addInk(r);
    r.stats.calls.length = 0;
    const d1 = r.undoDepth();
    r.run((ctx) =>
      r.applier.apply(
        ctx,
        [{ op: 'connect', obj1Id: A, obj2Id: B, type: 2, autoType: 1, params, val: 0, deletedIds: [ink] }],
        r.job(),
      ),
    );
    expect(r.undoDepth() - d1).toBe(1);
    expect(r.ids()).not.toContain(ink);
    expect(r.stats.calls).toEqual(['markRecognized', 'onConnectorAdded']);
  });

  it('doubleLineArrow: the two lines become the arrow shape in one step', () => {
    const r = applierRig();
    const l1 = addLine(r, 100, 180, 300, 180);
    const l2 = addLine(r, 100, 220, 300, 220);
    r.stats.calls.length = 0;
    const d0 = r.undoDepth();
    r.run((ctx) =>
      r.applier.apply(
        ctx,
        [
          {
            op: 'doubleLineArrow',
            obj1Id: l1,
            obj2Id: l2,
            seg1: { p1: { x: 100, y: 180 }, p2: { x: 300, y: 180 } },
            seg2: { p1: { x: 100, y: 220 }, p2: { x: 300, y: 220 } },
            center: { x: 200, y: 200 },
            lineDist: 40,
            len: 200,
            firstSide: false,
          },
        ],
        r.job(),
      ),
    );
    expect(r.undoDepth() - d0).toBe(1);
    expect(r.stats.calls).toEqual(['markRecognized']);
    const objs = r.h.session.editor.doc.activePage().objectStore.objects;
    expect(objs).toHaveLength(1);
    expect((objs[0] as TemplatedObject).shapeTemplate()?.templateId).toBe('avabodh.basic.arrow_forward');
    r.undo();
    expect(r.ids().sort()).toEqual([l1, l2].sort());
  });

  it('arrow: adding and erasing an arrowhead are one step each, with markRecognized', () => {
    const r = applierRig();
    const l = addLine(r, 100, 100, 300, 100);
    const line = r.h.session.editor.doc.activePage().objectStore.getObject(l) as TemplatedObject;
    const end = line.getArrowPoints()[1]?.[0];
    expect(end).toBeDefined();
    r.stats.calls.length = 0;
    const d0 = r.undoDepth();
    r.run((ctx) =>
      r.applier.apply(
        ctx,
        [{ op: 'arrow', objId: l, at: { x: end?.x ?? 0, y: end?.y ?? 0 }, add: true, solid: true }],
        r.job(),
      ),
    );
    expect(r.undoDepth() - d0).toBe(1);
    expect(line.arrows.end()).not.toBeNull();
    r.run((ctx) =>
      r.applier.apply(
        ctx,
        [{ op: 'arrow', objId: l, at: { x: end?.x ?? 0, y: end?.y ?? 0 }, add: false, solid: true }],
        r.job(),
      ),
    );
    expect(r.undoDepth() - d0).toBe(2);
    expect(line.arrows.end()).toBeNull();
    expect(r.stats.calls).toEqual(['markRecognized', 'markRecognized']);
    r.undo();
    expect(line.arrows.end()).not.toBeNull();
  });

  it('ink: one freehand object, one step, markInk', () => {
    const r = applierRig();
    r.run((ctx) =>
      r.applier.apply(
        ctx,
        [
          inkOf([
            [0, 0],
            [30, 5],
            [60, 40],
          ]),
        ],
        r.job(),
      ),
    );
    expect(r.undoDepth()).toBe(1);
    expect(r.stats.calls).toEqual(['markInk']);
    expect(r.h.session.editor.doc.activePage().objectStore.objects[0]).toBeInstanceOf(UnrecognizedObject);
  });
});
