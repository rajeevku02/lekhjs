// AC-REC-15: a result never has more than two mutations, and two only as `delete` followed by one
// more. Property test over the stroke corpus with the test-only RDP aggregator (the real one after
// H-REC-1), on an empty board, over every C++ fixture scene, and at several zooms and scrolls.
//
// Spec disagreement (reported): AC-REC-15 says the second mutation is always `add`. An EXTENDED
// path that becomes a double-line arrow deletes the extended path and converts the two lines, so
// the pair is `delete` then `doubleLineArrow`. C++ emitted them the other way round
// (`doubleLineArrow`, then `delete`); the port emits the deletion first (same final board) and
// this suite holds it to "`delete` first" (DR-REC-07: the undo order of those two steps differs).
import { describe, expect, it } from 'vitest';
import { Point } from '../../../src/geometry';
import { RECOGNIZER_CONFIG_DEFAULTS, recognizerConfigFrom, recognizeStroke } from '../../../src/recognizer/core';
import { snapshotDelegate, type RecMutation } from '../../../src/recognizer/delegate';
import { WorkerScene, type RecViewTransform } from '../../../src/recognizer/worker';
import { GeoScene, geoLine } from '../support/geoScene';
import { polylineLineAggregatorModule } from '../support/polylineAggregator';
import { bundledCatalog, emptySession, flat, SCENE_BOARDS, sessionOn, workerDelegate } from '../support/scene';
import { STROKE_CORPUS } from '../support/strokes';

function checkShape(ms: readonly RecMutation[], where: string): void {
  expect(ms.length, where).toBeLessThanOrEqual(2);
  if (ms.length === 2) {
    expect(ms[0]?.op, where).toBe('delete');
    expect(['add', 'doubleLineArrow'], where).toContain(ms[1]?.op);
  }
}

const VIEWS: readonly RecViewTransform[] = [
  { zoom: 1, tx: 0, ty: 0 },
  { zoom: 2, tx: -150, ty: 40 },
  { zoom: 0.5, tx: 30, ty: -20 },
];

describe('AC-REC-15: at most two mutations, two only as delete first', () => {
  for (const board of ['(empty)', ...SCENE_BOARDS]) {
    it(board, () => {
      const h = board === '(empty)' ? emptySession() : sessionOn(board);
      const scene = new WorkerScene({ catalog: bundledCatalog() });
      const config = recognizerConfigFrom(h.session.config);
      const objs = h.session.editor.doc.activePage().objectStore.objects;
      const anchors = objs.length > 0 ? objs.slice(0, 3).map((o) => o.selectionRect().center()) : [new Point(100, 100)];
      let ran = 0;
      for (const view of VIEWS) {
        for (const a of anchors) {
          const va = new Point(a.x * view.zoom + view.tx, a.y * view.zoom + view.ty);
          for (const s of STROKE_CORPUS) {
            const pts = flat(s.points.map((p) => new Point(p.x + va.x - 80, p.y + va.y - 60)));
            const job = workerDelegate(h.session, pts, view, scene);
            const out = recognizeStroke(pts, job.delegate, { config, lineAggregator: polylineLineAggregatorModule });
            checkShape(out.mutations, `${board} ${s.name} zoom ${String(view.zoom)}`);
            ran++;
          }
        }
      }
      expect(ran).toBeGreaterThan(0);
    });
  }

  it('an extended path that becomes a double-line arrow: delete first, then the arrow (R2 finding)', () => {
    const along = (a: Point, b: Point): Point[] => {
      const n = Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 4);
      return Array.from(
        { length: n + 1 },
        (_, i) => new Point(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n),
      );
    };
    // Two parallel lines, the first half of an arrowhead drawn earlier (P), and the stroke that
    // extends P into the head.
    const scene = new GeoScene([
      geoLine('L1', new Point(100, 180), new Point(300, 180)),
      geoLine('L2', new Point(100, 220), new Point(300, 220)),
      geoLine('P', new Point(300, 140), new Point(360, 200)),
    ]);
    const d = snapshotDelegate({
      store: scene,
      view: { zoom: 1, tx: 0, ty: 0 },
      strokeWidth: 2,
      config: RECOGNIZER_CONFIG_DEFAULTS,
    });
    const pts = flat(along(new Point(362, 202), new Point(300, 260)));
    const out = recognizeStroke(pts, d, {
      config: RECOGNIZER_CONFIG_DEFAULTS,
      lineAggregator: polylineLineAggregatorModule,
    });
    expect(out.mutations.map((m) => m.op)).toEqual(['delete', 'doubleLineArrow']);
    const [del, arrow] = out.mutations;
    if (del?.op === 'delete') expect(del.ids).toEqual(['P']);
    if (arrow?.op === 'doubleLineArrow') expect([arrow.obj1Id, arrow.obj2Id].sort()).toEqual(['L1', 'L2']);
    checkShape(out.mutations, 'double-line arrow');
  });
});
