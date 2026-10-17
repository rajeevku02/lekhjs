// AC-REC-25: the worker never measures text. Every C++ fixture board's page is snapshotted as a
// job would see it, read into the worker's scene (whose TextMeasurer throws), and every delegate
// query is asked of every object; then the stroke corpus runs through the recognizer against it.
import { describe, expect, it } from 'vitest';
import { LineSegment, Point, Rect } from '../../../src/geometry';
import { recognizerConfigFrom, recognizeStroke } from '../../../src/recognizer/core';
import { FetchShapeType } from '../../../src/recognizer/delegate';
import { WorkerScene, type RecViewTransform } from '../../../src/recognizer/worker';
import { polylineLineAggregatorModule } from '../support/polylineAggregator';
import { bundledCatalog, flat, jobView, SCENE_BOARDS, sessionOn, workerDelegate } from '../support/scene';
import { STROKE_CORPUS } from '../support/strokes';

class CountingThrowingMeasurer {
  calls = 0;
  measureLine(): never {
    this.calls++;
    throw new Error('measured');
  }
}

describe('AC-REC-25: the worker never measures text', () => {
  for (const board of SCENE_BOARDS) {
    it(board, () => {
      const h = sessionOn(board);
      const measurer = new CountingThrowingMeasurer();
      const scene = new WorkerScene({ catalog: bundledCatalog(), measurer });
      const view: RecViewTransform = jobView(h.session);
      // A stroke spanning the page's objects: the snapshot holds them all.
      const all = h.session.editor.doc.activePage().objectStore.objects;
      let r = new Rect(0, 0, 1, 1);
      for (const o of all) r = r.includeRect(o.selectionRect());
      const stroke = flat([new Point(r.x, r.y), new Point(r.x + r.width, r.y + r.height)]);
      const { delegate, failed, built } = workerDelegate(h.session, stroke, view, scene);
      expect(failed).toBe(0);
      expect(built.snapshot.objects.length).toBeGreaterThan(0);
      for (const so of built.snapshot.objects) {
        const c = delegate.shapeCentre(so.id);
        delegate.shapeBounds(so.id);
        delegate.distanceToOutline(so.id, c);
        delegate.isInsideShape(so.id, c);
        delegate.isInsideTitle(so.id, c);
        delegate.isInsideOtherObject(so.id, c);
        delegate.projectToOutline(so.id, new Point(c.x + 5, c.y + 3));
        delegate.getIntersections(so.id, new LineSegment(new Point(c.x - 500, c.y), new Point(c.x + 500, c.y)));
        delegate.getPathsNear(new LineSegment(c, new Point(c.x + 40, c.y + 40)));
        delegate.getShapesForConnection(c, new Point(c.x + 200, c.y), new Set());
        delegate.getShapeForSelfLoop(c, new Point(c.x + 3, c.y));
      }
      delegate.getExistingShapes(
        [new Rect(r.x - 50, r.y - 50, r.width + 100, r.height + 100)],
        FetchShapeType.Line,
        new Set(),
      );
      delegate.getArrowObjects();
      // The corpus, shifted onto the board's objects.
      const config = recognizerConfigFrom(h.session.config);
      for (const s of STROKE_CORPUS) {
        const pts = flat(s.points.map((p) => new Point(p.x + r.x, p.y + r.y)));
        const job = workerDelegate(h.session, pts, view, scene);
        expect(() =>
          recognizeStroke(pts, job.delegate, { config, lineAggregator: polylineLineAggregatorModule }),
        ).not.toThrow();
      }
      expect(measurer.calls).toBe(0);
    });
  }
});
