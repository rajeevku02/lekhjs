// Owner round UF2: the canvas (i) is shown for the shape a stroke was recognised as, and only
// then. C++ calls `InfoManager::smartModeShapeAdded` from `LekhCanvasDelegate::convert`,
// `addShapes` and `addConnection` (LekhCanvasDelegate.cpp:273, 293, 377), never for an arrow, a
// double-line arrow, ink or anything not recognised (a connect-handle drag, a paste, a remote add).
// `MutationApplierOptions.onShapeAdded` is that call.
import { describe, expect, it } from 'vitest';
import { ConnectionObject, type LekhObject } from '../../../src/model';
import { MutationApplier } from '../../../src/recognizer/client';
import type { RecMutation } from '../../../src/recognizer/worker';
import { A, B } from '../../sync/helpers';
import { applierRig, inkOf, lineDTO, rectDTO, type ApplierRig } from './applierRig';

function withHook(r: ApplierRig): { applier: MutationApplier; added: LekhObject[] } {
  const added: LekhObject[] = [];
  const applier = new MutationApplier({
    currentStyle: () => r.h.session.currentStyle,
    onShapeAdded: (o) => added.push(o),
  });
  return { applier, added };
}

function apply(r: ApplierRig, applier: MutationApplier, m: RecMutation[]): void {
  r.run((ctx) => applier.apply(ctx, m, r.job()));
}

describe('MutationApplier onShapeAdded (C++ InfoManager::smartModeShapeAdded, owner round UF2)', () => {
  it('add: called once, with the first new shape', () => {
    const r = applierRig();
    const { applier, added } = withHook(r);
    apply(r, applier, [{ op: 'add', shapes: [rectDTO(0, 0, 50, 50), rectDTO(100, 0, 50, 50)] }]);
    expect(added).toHaveLength(1);
    expect(added[0]?.id).toBe(r.ids()[0]);
  });

  it('convert: called with the new shape', () => {
    const r = applierRig();
    const { applier, added } = withHook(r);
    r.run((ctx) => {
      applier.applyInk(ctx, inkOf([[10, 10], [40, 12], [80, 30]]).points, { zoom: 1, tx: 0, ty: 0 });
    });
    expect(added).toHaveLength(0);
    const ink = r.ids()[0] as string;
    apply(r, applier, [{ op: 'convert', deleteIds: [ink], shape: rectDTO(100, 100, 120, 80) }]);
    expect(added.map((o) => o.id)).toEqual(r.ids());
  });

  it('connect: called with the connector', () => {
    const r = applierRig('format/03-connector.lekh');
    const { applier, added } = withHook(r);
    const params = [
      { angle: Math.PI / 2, autotype: 0 },
      { angle: Math.PI, autotype: 0 },
    ];
    apply(r, applier, [{ op: 'connect', obj1Id: A, obj2Id: B, type: 1, autoType: 0, params, val: 0, deletedIds: [] }]);
    expect(added).toHaveLength(1);
    expect(added[0]).toBeInstanceOf(ConnectionObject);
  });

  it('not for ink, an arrowhead or a delete', () => {
    const r = applierRig();
    const { applier, added } = withHook(r);
    apply(r, applier, [inkOf([[0, 0], [30, 5], [60, 40]])]);
    r.run((ctx) => r.applier.apply(ctx, [{ op: 'add', shapes: [lineDTO(100, 100, 300, 100)] }], r.job()));
    const l = r.ids()[1] as string;
    apply(r, applier, [{ op: 'arrow', objId: l, at: { x: 300, y: 100 }, add: true, solid: true }]);
    apply(r, applier, [{ op: 'delete', ids: [l] }]);
    expect(added).toHaveLength(0);
  });
});
