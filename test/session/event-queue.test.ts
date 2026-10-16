// The serial event queue (spec 03 §12.2, §14): AC-ENG-15, AC-ENG-33, E-36 and the
// `internal_error` row of verification 04.
import { describe, expect, it } from 'vitest';
import { A, B, C, cmd, harness } from './helpers';
import { registerThrowing } from './fixtures';

describe('serial event queue', () => {
  it('AC-ENG-15: a dispatch from a listener runs after the current event; listeners see no dirty object', () => {
    const h = harness();
    const order: string[] = [];
    const dirtySeen: string[] = [];
    h.session.registerCommand('mark', (_ctx, arg) => {
      order.push(`handled ${String(arg)}`);
    });
    h.session.on('documentChanged', () => {
      order.push('listener');
      for (const p of h.session.document.pages)
        for (const o of p.objectStore.objects) if (o.layoutState.dirty) dirtySeen.push(o.id);
    });
    h.session.registerCommand('move-and-chain', (ctx) => {
      order.push('handled e1');
      ctx.select([A]);
    });
    let chained = false;
    h.session.on('selectionChanged', () => {
      order.push('e1 listeners');
      if (!chained) {
        chained = true;
        h.dispatch(cmd({ kind: 'custom', name: 'mark', arg: 'e2' }));
        order.push('dispatched e2');
      }
    });
    h.dispatch(cmd({ kind: 'custom', name: 'move-and-chain' }));
    expect(order).toEqual(['handled e1', 'e1 listeners', 'dispatched e2', 'handled e2']);
    // A move dirties A and the connector; the listener runs only after the flush.
    h.dispatch(cmd({ kind: 'move', ids: [A], dx: 3, dy: 4 }));
    expect(order.at(-1)).toBe('listener');
    expect(dirtySeen).toEqual([]);
  });

  it('documentChanged names the moved shape and its connector', () => {
    const h = harness();
    h.dispatch(cmd({ kind: 'move', ids: [A], dx: 3, dy: 4 }));
    const dc = h.seen.find((s) => s.k === 'documentChanged')?.e as { changedIds: string[]; removedIds: string[] };
    expect(dc.changedIds).toEqual(expect.arrayContaining([A, C]));
    expect(dc.changedIds).not.toContain(B);
    expect(dc.removedIds).toEqual([]);
  });

  it('AC-ENG-33 / E-36: a command that throws after mutating sends no frame and emits error; the next frame goes out', () => {
    const h = harness({ cloud: true });
    registerThrowing(h.session);
    const before = h.session.serialize({ stamp: 'cloud' });
    h.dispatch(cmd({ kind: 'custom', name: 'mutate-then-throw', ids: [A] }));
    expect(h.transport.sent).toHaveLength(0);
    expect(h.seen.filter((s) => s.k === 'error').map((s) => s.e)).toEqual([
      { code: 'internal_error', eventType: 'command' },
    ]);
    // No rollback: the partial mutation stays in the local document.
    expect(h.session.serialize({ stamp: 'cloud' })).not.toBe(before);
    h.dispatch(cmd({ kind: 'move', ids: [B], dx: 1, dy: 0 }));
    expect(h.transport.sent).toHaveLength(1);
    expect(h.transport.sent[0]).toContain(B);
  });

  it('internal_error: logged with the event type and no board content; later events still run', () => {
    const h = harness({ cloud: true });
    registerThrowing(h.session);
    h.dispatch(cmd({ kind: 'custom', name: 'mutate-then-throw', ids: [A] }));
    const err = h.runtime.logs.find((l) => l.m === 'engine_error');
    expect(err?.f).toEqual({ code: 'internal_error', eventType: 'command', name: 'Error' });
    expect(JSON.stringify(h.runtime.logs)).not.toContain('handler bug');
    h.dispatch(cmd({ kind: 'select', ids: [A] }));
    expect(h.session.selection).toEqual([A]);
  });

  it('re-entrant dispatches run in FIFO order', () => {
    const h = harness();
    const ran: number[] = [];
    h.session.registerCommand('n', (_c, arg) => {
      ran.push(arg as number);
      if (arg === 1) {
        h.dispatch(cmd({ kind: 'custom', name: 'n', arg: 2 }));
        h.dispatch(cmd({ kind: 'custom', name: 'n', arg: 3 }));
        ran.push(10);
      }
    });
    h.dispatch(cmd({ kind: 'custom', name: 'n', arg: 1 }));
    expect(ran).toEqual([1, 10, 2, 3]);
  });

  it('requestPaint is coalesced: one frame, one notification per layer', () => {
    const h = harness();
    h.scheduler.frame(); // the open's repaint
    h.dispatch(cmd({ kind: 'move', ids: [A], dx: 1, dy: 0 }));
    h.dispatch(cmd({ kind: 'move', ids: [A], dx: 1, dy: 0 }));
    h.dispatch(cmd({ kind: 'view', zoom: 2, canvasW: 800, canvasH: 600 }));
    expect(h.scheduler.pendingFrames).toBe(1);
    h.seen.length = 0;
    h.scheduler.frame();
    expect(h.seen.filter((s) => s.k === 'paintRequested').map((s) => s.e)).toEqual([
      { layer: 'grid' },
      { layer: 'drawing' },
    ]);
  });
});
