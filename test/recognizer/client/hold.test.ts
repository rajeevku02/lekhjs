// The recognition hold (spec 07 §6.5) with a real session, port and worker host:
//  - AC-REC-19: remote realtime frames arriving during a job are applied after the result, in
//    arrival order;
//  - AC-REC-37: an undo pressed during a job undoes the recognised result (and redo restores it);
//  - AC-REC-42: a selection move started before and released during a hold is committed after the
//    result as one undo step, and the result is applied (no rec_stale).
import { describe, expect, it } from 'vitest';
import { Point } from '../../../src/geometry';
import { TranslateObjectAction } from '../../../src/edit';
import { ConnectionObject, TemplatedObject, modificationContext } from '../../../src/model';
import { updatetypes } from '../../../src/sync';
import { A, B, P, frame } from '../../sync/helpers';
import { lineStroke, rectStroke, sessionRig } from './sessionRig';

function dispatchOf(
  r: Awaited<ReturnType<typeof sessionRig>>,
  command: { kind: 'undo' } | { kind: 'redo' } | { kind: 'delete'; ids: string[] },
): void {
  r.session.dispatch({ type: 'command', command, origin: 'keyboard' });
}

describe('remote frames during a job (AC-REC-19)', () => {
  it('are buffered and applied after the result, in arrival order', async () => {
    const r = await sessionRig({ board: 'format/03-connector.lekh', cloud: true });
    const seen: { cx: number; changed: readonly string[] }[] = [];
    r.session.on('documentChanged', (e) => {
      const a = r.session.editor.doc.activePage().objectStore.getObject(A) as TemplatedObject;
      seen.push({ cx: a.ds.cx(), changed: e.changedIds });
    });
    const before = r.objects().length;
    const cx0 = (r.session.editor.doc.activePage().objectStore.getObject(A) as TemplatedObject).ds.cx();
    r.client.submit(r.port, r.stroke(rectStroke(600, 400)));
    await r.tick(50);
    expect(r.session.recognitionHeld).toBe(true);
    const values = [50, 60, 70];
    values.forEach((cx, i) => {
      r.session.dispatch({
        type: 'remoteFrame',
        text: frame(updatetypes.changeAttr, { [`doc.pages.${P}.objects.${A}.params.cx`]: cx }, 8 + i),
      });
    });
    // nothing applied yet
    expect((r.session.editor.doc.activePage().objectStore.getObject(A) as TemplatedObject).ds.cx()).toBe(cx0);
    expect(seen).toEqual([]);
    await r.tick(400);
    expect(r.session.recognitionHeld).toBe(false);
    expect(r.objects().length).toBe(before + 1);
    // first the result (the new shape), then the three frames in order
    expect(seen.map((s) => s.cx)).toEqual([cx0, 50, 60, 70]);
    expect(seen[0]?.changed.length).toBe(1);
  });
});

describe('undo during a job (AC-REC-37)', () => {
  it('undoes the recognised result; redo restores it', async () => {
    const r = await sessionRig();
    r.client.submit(r.port, r.stroke(rectStroke(100, 100)));
    await r.tick(50);
    dispatchOf(r, { kind: 'undo' });
    expect(r.objects()).toEqual([]);
    await r.tick(400);
    // after the job: no rectangle and no stroke ink
    expect(r.objects()).toEqual([]);
    expect(r.session.editor.undo.redoDepth).toBe(1);
    dispatchOf(r, { kind: 'redo' });
    const objs = r.session.editor.doc.activePage().objectStore.objects;
    expect(objs).toHaveLength(1);
    expect(objs[0]).toBeInstanceOf(TemplatedObject);
    expect(r.stats.calls).toEqual(['markRecognized']);
  });

  it('a Delete pressed during the job runs after the result, in order', async () => {
    const r = await sessionRig({ board: 'format/03-connector.lekh' });
    r.client.submit(r.port, r.stroke(rectStroke(600, 400)));
    await r.tick(50);
    dispatchOf(r, { kind: 'delete', ids: [A] });
    expect(r.objects()).toContain(A);
    await r.tick(400);
    expect(r.objects()).not.toContain(A);
    // undo restores A first (the delete was the last step), then removes the shape
    dispatchOf(r, { kind: 'undo' });
    expect(r.objects()).toContain(A);
    expect(r.objects()).toHaveLength(4);
  });
});

describe('a selection move released during a hold (AC-REC-42)', () => {
  it('is committed after the result as one undo step, and the result is applied', async () => {
    const r = await sessionRig({ board: 'format/03-connector.lekh' });
    const store = () => r.session.editor.doc.activePage().objectStore;
    const a0 = store().getObject(A)?.selectionRect().center() ?? new Point();
    const b0 = store().getObject(B)?.selectionRect().center() ?? new Point();
    r.session.registerCommand('t', (ctx, fn) => {
      (fn as (c: typeof ctx) => void)(ctx);
    });
    const edit = (fn: (ctx: Parameters<Parameters<typeof r.session.registerCommand>[1]>[0]) => void): void => {
      r.session.dispatch({ type: 'command', command: { kind: 'custom', name: 't', arg: fn }, origin: 'ui' });
    };
    // the drag starts before the job
    edit((ctx) => {
      const o = ctx.page.objectStore.getObject(B);
      o?.startModification(
        modificationContext(ctx.editor.env.codec.env.objects, ctx.page.objectStore, ctx.doc.snapStep()),
      );
      o?.translate(10, 0);
    });
    // a connector stroke from A to B: the result names A and B
    r.client.submit(r.port, r.stroke(lineStroke(a0, b0, 30)));
    await r.tick(50);
    expect(r.session.recognitionHeld).toBe(true);
    // the drag continues and ends during the hold (live preview, then the commit)
    edit((ctx) => {
      ctx.page.objectStore.getObject(B)?.translate(20, 0);
    });
    edit((ctx) => {
      const o = ctx.page.objectStore.getObject(B);
      if (o === null) return;
      o.translate(10, 0);
      const fin = o.finishTranslating();
      ctx.editor.tx.record(new TranslateObjectAction(ctx.editor.env, ctx.doc, [o], fin.x, fin.y));
    });
    const depthDuringHold = r.session.editor.undo.undoDepth;
    expect(depthDuringHold).toBe(0); // the move's step waits behind the result
    await r.tick(400);
    // result applied (a new connector between A and B), no rec_stale
    const cons = store().objects.filter((o): o is ConnectionObject => o instanceof ConnectionObject);
    expect(cons).toHaveLength(2);
    expect(r.h.runtime.logs.some((l) => l.m === 'rec_stale')).toBe(false);
    expect(r.stats.calls).toContain('onConnectorAdded');
    expect(r.session.editor.undo.undoDepth).toBe(2);
    const moved = store().getObject(B)?.selectionRect().center().x ?? 0;
    expect(moved - b0.x).toBeGreaterThan(30); // 40 px, snapped to the grid
    // one undo reverts the move only
    dispatchOf(r, { kind: 'undo' });
    expect(store().getObject(B)?.selectionRect().center().x).toBeCloseTo(b0.x, 6);
    expect(store().objects.filter((o) => o instanceof ConnectionObject)).toHaveLength(2);
  });
});
