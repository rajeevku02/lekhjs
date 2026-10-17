// AC-REC-14: with StubLineAggregator, any stroke yields exactly one `ink` mutation and no exception
// — on an empty board and over every C++ fixture scene, through the worker's own scene and
// delegate. (A stroke of fewer than two points yields none (B3); the stroke gate never sends one:
// it drops SmartDraw strokes under 6 × 6 px.)
import { describe, expect, it } from 'vitest';
import { Point } from '../../../src/geometry';
import { recognizerConfigFrom, recognizeStroke } from '../../../src/recognizer/core';
import { stubLineAggregatorModule } from '../../../src/recognizer/lines';
import { WorkerScene } from '../../../src/recognizer/worker';
import { bundledCatalog, emptySession, flat, jobView, SCENE_BOARDS, sessionOn, workerDelegate } from '../support/scene';
import { STROKE_CORPUS } from '../support/strokes';

const STROKES = STROKE_CORPUS.filter((s) => s.points.length >= 2);

describe('AC-REC-14: the stub turns every stroke into one ink', () => {
  const boards = ['(empty)', ...SCENE_BOARDS];
  for (const board of boards) {
    it(board, () => {
      const h = board === '(empty)' ? emptySession() : sessionOn(board);
      const scene = new WorkerScene({ catalog: bundledCatalog() });
      const config = recognizerConfigFrom(h.session.config);
      const view = jobView(h.session);
      const origin =
        h.session.editor.doc.activePage().objectStore.objects[0]?.selectionRect().center() ?? new Point(100, 100);
      for (const s of STROKES) {
        const pts = flat(s.points.map((p) => new Point(p.x + origin.x - 100, p.y + origin.y - 100)));
        const job = workerDelegate(h.session, pts, view, scene);
        const out = recognizeStroke(pts, job.delegate, { config, lineAggregator: stubLineAggregatorModule });
        expect(
          out.mutations.map((m) => m.op),
          s.name,
        ).toEqual(['ink']);
        const ink = out.mutations[0];
        if (ink?.op === 'ink') expect(ink.points.length).toBeGreaterThan(0);
      }
    });
  }

  it('a stroke of fewer than two points yields no mutation (B3)', () => {
    const h = emptySession();
    const pts = flat([new Point(10, 10)]);
    const job = workerDelegate(h.session, pts, jobView(h.session));
    const out = recognizeStroke(pts, job.delegate, {
      config: recognizerConfigFrom(h.session.config),
      lineAggregator: stubLineAggregatorModule,
    });
    expect(out.mutations).toEqual([]);
  });
});
