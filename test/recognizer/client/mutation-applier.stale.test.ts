// AC-REC-20: a mutation referencing an object that no longer exists, or has another `rev` than
// the snapshot saw, is not applied (nothing partial), and the stroke becomes ink (`rec_stale`).
// The hold is bypassed on purpose (the object is changed directly between snapshot and apply).
import { describe, expect, it } from 'vitest';
import { SessionRecognitionPort } from '../../../src/recognizer/client';
import { Point } from '../../../src/geometry';
import { UnrecognizedObject } from '../../../src/model';
import { A, B } from '../../sync/helpers';
import { applierRig, rectDTO } from './applierRig';
import { statsLog } from './sessionRig';
import { flat } from '../support/scene';

describe('apply-time validation (AC-REC-20)', () => {
  it('a changed rev: nothing applied', () => {
    const r = applierRig('format/03-connector.lekh');
    const job = r.job();
    r.h.session.editor.doc.activePage().objectStore.getObject(A)?.invalidate();
    const before = r.ids();
    const out = r.run((ctx) =>
      r.applier.apply(
        ctx,
        [
          { op: 'delete', ids: [B] },
          { op: 'add', shapes: [rectDTO(0, 0, 40, 40)] },
          { op: 'convert', deleteIds: [A], shape: rectDTO(0, 0, 10, 10) },
        ],
        job,
      ),
    );
    expect(out).toEqual({ ok: false, code: 'rec_stale' });
    expect(r.ids()).toEqual(before);
    expect(r.undoDepth()).toBe(0);
  });

  it('a missing object: nothing applied', () => {
    const r = applierRig('format/03-connector.lekh');
    const job = r.job();
    const out = r.run((ctx) =>
      r.applier.apply(ctx, [{ op: 'arrow', objId: 'gone', at: { x: 0, y: 0 }, add: true, solid: true }], job),
    );
    expect(out.ok).toBe(false);
  });

  it('an object changed only by the session’s own live edits during the hold is not stale', () => {
    const r = applierRig('format/03-connector.lekh');
    const job = r.job();
    r.h.session.editor.doc.activePage().objectStore.getObject(B)?.invalidate();
    const out = r.run((ctx) => r.applier.apply(ctx, [{ op: 'delete', ids: [B] }], job, new Set([B])));
    expect(out.ok).toBe(true);
    expect(r.ids()).not.toContain(B);
  });

  it('through the session port: the stroke becomes one ink object and rec_stale is logged', () => {
    const r = applierRig('format/03-connector.lekh');
    const stats = statsLog();
    let stale = 0;
    const port = new SessionRecognitionPort(r.h.session, { sessionId: 's', stats, onStale: () => stale++ });
    const stroke = {
      points: flat([new Point(500, 500), new Point(540, 520), new Point(580, 560)]),
      view: { zoom: 1, tx: 0, ty: 0 },
      strokeWidth: 2,
      docGeneration: r.h.session.docGeneration,
    };
    port.buildSnapshot(stroke);
    // a peer changes B between snapshot and result
    r.h.session.editor.doc.activePage().objectStore.getObject(B)?.invalidate();
    const before = r.ids();
    port.apply(
      [
        { op: 'delete', ids: [B] },
        { op: 'add', shapes: [rectDTO(0, 0, 40, 40)] },
      ],
      stroke,
    );
    const added = r.ids().filter((id) => !before.includes(id));
    expect(r.ids()).toContain(B);
    expect(added).toHaveLength(1);
    expect(r.h.session.editor.doc.activePage().objectStore.getObject(added[0] ?? '')).toBeInstanceOf(
      UnrecognizedObject,
    );
    expect(stats.calls).toEqual(['markInk']);
    expect(stale).toBe(1);
    expect(r.h.runtime.logs.some((l) => l.m === 'rec_stale')).toBe(true);
  });
});
