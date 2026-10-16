// The event-queue edges of spec 03 §14: E-50 … E-54.
import { describe, expect, it } from 'vitest';
import { updatetypes } from '../../src/sync';
import { fakeImage } from '../../src/testing';
import { A, B, P, cmd, frame, harness } from './helpers';
import { ThrowingBox, registerThrowing } from './fixtures';

describe('event-queue edges (spec 03 §14)', () => {
  it('E-50: flush() throws after handle(): no frame, error emitted, the next flush lays out what is still dirty', () => {
    const h = harness({ cloud: true });
    const box = new ThrowingBox('BOX');
    h.session.registerCommand('frame-and-box', (ctx) => {
      h.session.commands.changeZOrder(ctx.objects[0] ?? null, 1); // raises an update
      ctx.page.objectStore.add(box);
    });
    h.dispatch(cmd({ kind: 'custom', name: 'frame-and-box', ids: [A] }));
    expect(h.transport.sent).toHaveLength(0);
    expect(h.seen.filter((s) => s.k === 'error').map((s) => s.e)).toEqual([
      { code: 'internal_error', eventType: 'command' },
    ]);
    expect(box.layoutState.dirty).toBe(true);
    h.seen.length = 0;
    h.dispatch(cmd({ kind: 'move', ids: [B], dx: 1, dy: 0 }));
    expect(box.layoutState.dirty).toBe(false);
    expect(box.layouts).toBe(1);
    expect(
      h.session.document
        .getPage(P)
        ?.objectStore.objectsIn(box.extent())
        .map((o) => o.id),
    ).toContain('BOX');
    expect(h.transport.sent).toHaveLength(1);
    expect(h.seen.some((s) => s.k === 'error')).toBe(false);
    // Control: the same z-order change without the throwing layout does send its frame.
    h.session.registerCommand('frame-only', (ctx) => {
      h.session.commands.changeZOrder(ctx.objects[0] ?? null, 1);
    });
    h.dispatch(cmd({ kind: 'custom', name: 'frame-only', ids: [A] }));
    expect(h.transport.sent).toHaveLength(2);
  });

  it('E-51: a throwing listener does not stop the others, the drain, or an already-sent frame', () => {
    const h = harness({ cloud: true });
    const second: number[] = [];
    h.session.on('documentChanged', () => {
      throw new Error('listener bug');
    });
    h.session.on('documentChanged', (e) => {
      second.push(e.changedIds.length);
    });
    h.dispatch(cmd({ kind: 'move', ids: [A], dx: 1, dy: 0 }));
    h.dispatch(cmd({ kind: 'move', ids: [B], dx: 1, dy: 0 }));
    expect(second).toHaveLength(2);
    expect(h.transport.sent).toHaveLength(2);
    const logged = h.runtime.logs.filter((l) => l.m === 'listener_error');
    expect(logged).toHaveLength(2);
    expect(logged[0]?.f).toMatchObject({ notification: 'documentChanged' });
    expect(h.seen.some((s) => s.k === 'error')).toBe(false);
  });

  it('E-52: a command that throws pushes nothing onto undo and leaves redo unchanged', () => {
    const h = harness();
    registerThrowing(h.session);
    h.dispatch(cmd({ kind: 'move', ids: [A], dx: 10, dy: 0 }));
    h.dispatch(cmd({ kind: 'move', ids: [B], dx: 10, dy: 0 }));
    h.dispatch(cmd({ kind: 'undo' }));
    const undo = h.session.editor.undo;
    expect([undo.undoDepth, undo.redoDepth]).toEqual([1, 1]);
    const top = undo.topUndo();
    h.dispatch(cmd({ kind: 'custom', name: 'mutate-then-throw', ids: [A] }));
    expect([undo.undoDepth, undo.redoDepth]).toEqual([1, 1]);
    expect(undo.topUndo()).toBe(top);
    // Redo still redoes the move of B.
    h.dispatch(cmd({ kind: 'redo' }));
    expect([undo.undoDepth, undo.redoDepth]).toEqual([2, 0]);
  });

  it('E-53: a frame for another docid and a stale continuation are dropped with a debug log and no error', () => {
    const h = harness({ cloud: true });
    const before = h.session.serialize({ stamp: 'cloud' });
    h.transport.deliver(
      frame(updatetypes.changeAttr, { [`doc.pages.${P}.objects.${A}.params.cx`]: 999 }, 8, 'other-doc'),
    );
    const gen = h.session.docGeneration;
    h.dispatch(cmd({ kind: 'move', ids: [A], dx: 50, dy: 0 }, gen - 1));
    expect(h.session.serialize({ stamp: 'cloud' })).toBe(before);
    expect(h.transport.sent).toHaveLength(0);
    expect(h.seen.some((s) => s.k === 'error' || s.k === 'documentChanged')).toBe(false);
    const debug = h.runtime.logs.filter((l) => l.level === 'debug').map((l) => l.m);
    expect(debug).toContain('frame_docid_mismatch');
    expect(debug).toContain('stale_continuation');
  });

  it('E-54: dispose() mid-drain finishes the current event, drops the rest, cancels timers and frames, releases images', () => {
    const h = harness({ cloud: true });
    const img = fakeImage();
    h.dispatch({ type: 'imageLoaded', url: 'https://x/a.png', image: img });
    h.session.setTimer('cursor', 5000, () => undefined);
    h.session.requestPaint('middle');
    expect(h.scheduler.pendingTimers).toBeGreaterThan(0);
    const ran: string[] = [];
    h.session.registerCommand('dispose-here', () => {
      h.session.dispatch(cmd({ kind: 'custom', name: 'never' }));
      h.session.dispose();
      ran.push('current finished');
    });
    h.session.registerCommand('never', () => {
      ran.push('never');
    });
    h.dispatch(cmd({ kind: 'custom', name: 'dispose-here' }));
    expect(ran).toEqual(['current finished']);
    expect(h.session.isDisposed).toBe(true);
    expect(h.session.pendingTimers).toBe(0);
    expect(h.scheduler.pendingTimers).toBe(0);
    expect(h.scheduler.pendingFrames).toBe(0);
    expect(img.closed).toBe(1);
    expect(h.transport.subscribers).toBe(0);
    // Later dispatches are no-ops, logged once.
    expect(() => {
      h.dispatch(cmd({ kind: 'move', ids: [A], dx: 1, dy: 0 }));
      h.dispatch(cmd({ kind: 'move', ids: [A], dx: 1, dy: 0 }));
    }).not.toThrow();
    expect(h.transport.sent).toHaveLength(0);
    expect(h.runtime.logs.filter((l) => l.m === 'dispatch_after_dispose')).toHaveLength(1);
    h.session.dispose();
    expect(img.closed).toBe(1);
  });
});
