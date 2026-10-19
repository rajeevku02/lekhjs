// Defensive input handling (Work 01M4X7TCHFB862XGT68GPY071C, IN1): a gesture whose end the host
// never delivered — a lost Up followed by a new Down for the same pointer, a pointercancel, a
// host reset (window blur, a hidden page; since IN2 not a lost pointer capture, which the web host
// follows to its Up instead) — ends the way the C++ recogniser's `onCancel`
// ends it: a cancellable drag handler (connect drag) is cancelled and its preview cleared; one
// that cannot cancel (move, library drop) gets its End at the gesture's last point. The router
// forgets the handler and the next press is processed normally. Plus the opt-in input trace.
import { describe, expect, it } from 'vitest';
import type { Point } from '../../src/geometry';
import { handleCentres } from '../../src/interaction';
import { isConnector } from '../../src/model';
import type { ContextAction } from '../../src/session';
import { A, B, drag, ptr, tap, viewHarness, type ViewHarness } from './helpers';

const store = (h: ViewHarness) => h.session.editor.doc.activePage().objectStore;

/** Down on A's right connect handle and moves onto B, with no Up. */
function connectDragWithoutUp(h: ViewHarness): Point {
  h.bv.overlay.select(h.obj(A));
  const right = handleCentres(h.bv.overlay.rect.corners())[1] as Point;
  const to = h.v(450, 300);
  h.bv.input(ptr('down', right.x, right.y));
  for (let i = 1; i <= 6; i++)
    h.bv.input(ptr('move', right.x + ((to.x - right.x) * i) / 6, right.y + ((to.y - right.y) * i) / 6));
  expect(h.bv.router.dragHandler()?.kind).toBe('ConnectDragger');
  expect(h.bv.overlay.transients().length).toBe(1);
  return to;
}

describe('a lost Up, then a new Down for the same pointer', () => {
  it('a connect drag is cancelled: no connector, preview gone, router clear; the new press works', () => {
    const h = viewHarness();
    const n = store(h).size;
    connectDragWithoutUp(h);
    // The new press (same pointer id 1) on empty canvas: the stale gesture ends first.
    h.bv.input(ptr('down', h.v(700, 550).x, h.v(700, 550).y));
    expect(h.bv.router.dragHandler()).toBeNull();
    expect(h.bv.overlay.transients().length).toBe(0);
    expect(store(h).size).toBe(n);
    expect(h.bv.router.recognizer.stateName).toBe('Down');
    h.bv.input(ptr('up', h.v(700, 550).x, h.v(700, 550).y, { buttons: 0 }));
    h.scheduler.advance(300);
    // That press was a tap on empty canvas: it deselected, as a normal tap does.
    expect(h.session.selection).toEqual([]);
    // And a following tap selects as usual.
    tap(h, h.v(150, 150));
    expect(h.session.selection).toEqual([A]);
  });

  it('a move drag (cannot cancel) ends at its last point: one undo step, then the new press', () => {
    const h = viewHarness({ config: { snapToGrid: false } });
    tap(h, h.v(150, 150));
    expect(h.session.selection).toEqual([A]);
    const depth = h.session.editor.undo.undoDepth;
    const from = h.v(150, 150);
    const to = h.v(190, 170);
    h.bv.input(ptr('down', from.x, from.y));
    for (let i = 1; i <= 6; i++)
      h.bv.input(ptr('move', from.x + ((to.x - from.x) * i) / 6, from.y + ((to.y - from.y) * i) / 6));
    expect(h.bv.router.dragHandler()?.kind).toBe('SelectionDragger');
    h.bv.input(ptr('down', h.v(700, 550).x, h.v(700, 550).y));
    expect(h.bv.router.dragHandler()).toBeNull();
    expect(h.tobj(A).ds.cx()).toBeCloseTo(190, 6);
    expect(h.tobj(A).ds.cy()).toBeCloseTo(170, 6);
    expect(h.session.editor.undo.undoDepth - depth).toBe(1);
  });

  it('a lost Up during a press that had not moved: the new Down starts a fresh gesture', () => {
    const h = viewHarness();
    h.bv.input(ptr('down', h.v(150, 150).x, h.v(150, 150).y));
    h.bv.input(ptr('down', h.v(150, 150).x, h.v(150, 150).y));
    expect(h.bv.router.recognizer.stateName).toBe('Down');
    h.bv.input(ptr('up', h.v(150, 150).x, h.v(150, 150).y, { buttons: 0 }));
    h.scheduler.advance(300);
    expect(h.session.selection).toEqual([A]);
  });
});

describe('pointercancel and host resets', () => {
  it('pointercancel mid connect drag: nothing created, preview gone, router clear', () => {
    const h = viewHarness();
    const n = store(h).size;
    const to = connectDragWithoutUp(h);
    h.bv.input(ptr('cancel', to.x, to.y, { buttons: 0 }));
    expect(h.bv.router.dragHandler()).toBeNull();
    expect(h.bv.overlay.transients().length).toBe(0);
    expect(h.bv.router.recognizer.inProgress()).toBe(false);
    // A late Up of the cancelled pointer does nothing.
    h.bv.input(ptr('up', to.x, to.y, { buttons: 0 }));
    expect(store(h).size).toBe(n);
    // The next connect drag works.
    const right = handleCentres(h.bv.overlay.rect.corners())[1] as Point;
    drag(h, right, h.v(450, 300), {}, 8);
    expect(store(h).size).toBe(n + 1);
    const sel = store(h).getObject(h.session.selection[0] ?? '');
    expect(sel !== null && isConnector(sel)).toBe(true);
  });

  it('a reset (blur, hidden page, pagehide) mid connect drag ends it the same way', () => {
    for (const reason of ['blur', 'visibilitychange', 'pagehide']) {
      const h = viewHarness();
      const n = store(h).size;
      connectDragWithoutUp(h);
      h.bv.input({ type: 'reset', reason });
      expect(h.bv.router.dragHandler()).toBeNull();
      expect(h.bv.overlay.transients().length).toBe(0);
      expect(store(h).size).toBe(n);
      expect(h.bv.router.recognizer.inProgress()).toBe(false);
    }
  });

  it('a reset while a press waits for its long press: the long press never fires afterwards', () => {
    const menus: (readonly ContextAction[])[] = [];
    const h = viewHarness();
    (h.session.options as { ui?: unknown }).ui = {
      contextMenu: (_at: Point, items: readonly ContextAction[]) => {
        menus.push(items);
      },
      toast: () => undefined,
    };
    const at = h.v(700, 550);
    // Control: a held press opens the context menu after the long-press time.
    h.bv.input(ptr('down', at.x, at.y, { kind: 'touch', buttons: 1 }));
    h.scheduler.advance(600);
    h.bv.input(ptr('up', at.x, at.y, { kind: 'touch', buttons: 0 }));
    const control = menus.length;
    expect(control).toBe(1);
    h.scheduler.advance(300);
    // A press, then a reset before the long press is due.
    h.bv.input(ptr('down', at.x, at.y, { kind: 'touch', buttons: 1 }));
    h.bv.input({ type: 'reset', reason: 'blur' });
    h.scheduler.advance(600);
    expect(menus.length).toBe(control);
    expect(h.bv.router.recognizer.inProgress()).toBe(false);
  });
});

describe('the input trace', () => {
  it('is off by default and, with a sink, records the gesture, the handler and the drop decision', () => {
    const h = viewHarness();
    expect(h.bv.board.trace.on).toBe(false);
    const got: { kind: string; data: Readonly<Record<string, unknown>> }[] = [];
    h.bv.board.trace.sink = (kind, data) => {
      got.push({ kind, data });
    };
    h.bv.overlay.select(h.obj(A));
    const right = handleCentres(h.bv.overlay.rect.corners())[1] as Point;
    drag(h, right, h.v(450, 300), {}, 8);
    const kinds = got.map((g) => g.kind);
    expect(kinds).toContain('rec.state');
    expect(kinds).toContain('router.pan_start');
    expect(got.find((g) => g.kind === 'router.drag')?.data['set']).toBe('ConnectDragger');
    const drop = got.find((g) => g.kind === 'connect.drop');
    expect(drop?.data['mode']).toBe('target');
    expect(drop?.data['target']).toBe(B);
    expect(typeof got.find((g) => g.kind === 'connect.created')?.data['connector']).toBe('string');
  });

  it('records a stale Down and the reset reason', () => {
    const h = viewHarness();
    const got: string[] = [];
    h.bv.board.trace.sink = (kind, data) => {
      const v = data['reason'] ?? data['state'];
      got.push(`${kind}:${typeof v === 'string' ? v : ''}`);
    };
    connectDragWithoutUp(h);
    h.bv.input(ptr('down', 10, 10));
    expect(got).toContain('rec.stale_down:Moving');
    h.bv.input({ type: 'reset', reason: 'blur' });
    expect(got).toContain('router.reset:blur');
  });

  it('a throwing sink never breaks input', () => {
    const h = viewHarness();
    h.bv.board.trace.sink = () => {
      throw new Error('log failed');
    };
    tap(h, h.v(150, 150));
    expect(h.session.selection).toEqual([A]);
  });
});
