// AC-REC-21: panning or zooming between stroke end and result places the recognised shape where
// the stroke was drawn: geometry is mapped with the CAPTURED transform, not the current one
// (canvas coords within 0.05 px of the no-pan case). The new shape's grid snap is therefore applied
// in canvas space (DR-REC-06; C++ snapped in view space before scaling the shape in).
import { describe, expect, it } from 'vitest';
import type { RecViewTransform } from '../../../src/recognizer/worker';
import { applierRig, rectDTO } from './applierRig';
import { rectStroke, sessionRig } from './sessionRig';

const V: RecViewTransform = { zoom: 2, tx: -120, ty: 60 };

function boundsOfOnly(r: ReturnType<typeof applierRig>): { x: number; y: number; w: number; h: number } {
  const o = r.h.session.editor.doc.activePage().objectStore.objects[0];
  const b = o?.selectionRect();
  return { x: b?.x ?? NaN, y: b?.y ?? NaN, w: b?.width ?? NaN, h: b?.height ?? NaN };
}

describe('the captured transform (AC-REC-21)', () => {
  it('MutationApplier maps with the job view whatever the current view is', () => {
    const still = applierRig();
    still.h.session.dispatch({ type: 'command', command: { kind: 'view', zoom: 2, tx: -60, ty: 30 }, origin: 'ui' });
    still.run((ctx) => still.applier.apply(ctx, [{ op: 'add', shapes: [rectDTO(200, 160, 120, 80)] }], still.job(V)));
    const moved = applierRig();
    moved.h.session.dispatch({ type: 'command', command: { kind: 'view', zoom: 0.7, tx: 400, ty: -90 }, origin: 'ui' });
    moved.run((ctx) => moved.applier.apply(ctx, [{ op: 'add', shapes: [rectDTO(200, 160, 120, 80)] }], moved.job(V)));
    const a = boundsOfOnly(still);
    const b = boundsOfOnly(moved);
    for (const k of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(a[k] - b[k])).toBeLessThanOrEqual(0.05);
    // view → canvas: (200 - (-120)) / 2 = 160, (160 - 60) / 2 = 50 (before grid snapping)
    expect(Math.abs(a.x - 160)).toBeLessThanOrEqual(8);
    expect(Math.abs(a.y - 50)).toBeLessThanOrEqual(8);
  });

  it('end to end: a zoom during the job does not move the recognised shape', async () => {
    const run = async (zoomDuring: boolean): Promise<{ x: number; y: number; w: number; h: number }> => {
      const r = await sessionRig();
      r.session.dispatch({ type: 'command', command: { kind: 'view', zoom: 1.5, tx: 20, ty: -10 }, origin: 'ui' });
      r.client.submit(r.port, r.stroke(rectStroke(150, 120)));
      await r.tick(50);
      if (zoomDuring)
        r.session.dispatch({ type: 'command', command: { kind: 'view', zoom: 3, tx: -300, ty: 75 }, origin: 'ui' });
      await r.tick(400);
      const o = r.session.editor.doc.activePage().objectStore.objects[0];
      const bb = o?.selectionRect();
      return { x: bb?.x ?? NaN, y: bb?.y ?? NaN, w: bb?.width ?? NaN, h: bb?.height ?? NaN };
    };
    const a = await run(false);
    const b = await run(true);
    expect(Number.isNaN(a.x)).toBe(false);
    for (const k of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(a[k] - b[k])).toBeLessThanOrEqual(0.05);
  });
});
