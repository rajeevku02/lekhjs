// End-to-end flows through `BoardView.input` on a real session: select and move (one undo step,
// one frame), resize, the rubber band, a connect drag (and Escape cancelling it), the context
// menu, the wheel, double-click to edit text, the scroll indicator, the canvas glyphs and the
// layer scheduler.
import { describe, expect, it } from 'vitest';
import { Point, Rect } from '../../src/geometry';
import {
  CANVAS_GLYPHS,
  InputMode,
  LayerScheduler,
  ManualFrameScheduler,
  NO_MODIFIERS,
  glyphSvgPath,
  handleCentres,
  scrollPos,
} from '../../src/interaction';
import { isConnector } from '../../src/model';
import type { ContextAction } from '../../src/session';
import { A, B, drag, ptr, tap, viewHarness, type ViewHarness } from './helpers';

const store = (h: ViewHarness) => h.session.editor.doc.activePage().objectStore;
const frames = (h: ViewHarness, type: string) =>
  h.transport.frames().filter((f) => (f.updates as { type?: string } | undefined)?.type === type).length;

describe('select and move', () => {
  it('a tap selects; a drag moves by the drag, one undo step and one changeattr frame', () => {
    const h = viewHarness({ cloud: true, config: { snapToGrid: false } });
    tap(h, h.v(150, 150));
    expect(h.session.selection).toEqual([A]);
    const depth = h.session.editor.undo.undoDepth;
    h.transport.sent.length = 0;
    drag(h, h.v(150, 150), h.v(190, 170), {}, 6);
    expect(h.tobj(A).ds.cx()).toBeCloseTo(190, 6);
    expect(h.tobj(A).ds.cy()).toBeCloseTo(170, 6);
    expect(h.session.editor.undo.undoDepth - depth).toBe(1);
    expect(frames(h, 'changeattr')).toBe(1);
    h.dispatch({ type: 'command', command: { kind: 'undo' }, origin: 'ui' });
    expect(h.tobj(A).ds.cx()).toBeCloseTo(150, 6);
  });

  it('Cmd/Ctrl + tap toggles shapes in and out of a multi-selection', () => {
    const h = viewHarness();
    tap(h, h.v(150, 150));
    tap(h, h.v(450, 300), { mods: { ctrl: true } });
    expect(new Set(h.session.selection)).toEqual(new Set([A, B]));
    tap(h, h.v(450, 300), { mods: { ctrl: true } });
    expect(h.session.selection).toEqual([A]);
  });

  it('a tap on empty canvas deselects', () => {
    const h = viewHarness();
    tap(h, h.v(150, 150));
    tap(h, h.v(700, 550));
    expect(h.session.selection).toEqual([]);
  });

  it('dragging a corner resizes, one undo step', () => {
    const h = viewHarness();
    h.bv.overlay.select(h.obj(A));
    const c2 = h.bv.overlay.rect.corners()[2] as Point;
    const w = h.tobj(A).ds.width();
    const depth = h.session.editor.undo.undoDepth;
    drag(h, c2, c2.withDelta(40, 20), {}, 5);
    expect(h.tobj(A).ds.width()).toBeGreaterThan(w + 20);
    expect(h.session.editor.undo.undoDepth - depth).toBe(1);
  });

  it('a rubber band over both shapes selects them', () => {
    const h = viewHarness();
    drag(h, h.v(40, 60), h.v(560, 380), {}, 6);
    expect(new Set(h.session.selection)).toEqual(new Set([A, B, '4K5eYQdS7snA1MXucdVzUP']));
  });
});

describe('connect drag', () => {
  it("from A's right handle onto B: one connector, one undo step, selected", () => {
    const h = viewHarness();
    h.bv.overlay.select(h.obj(A));
    const right = handleCentres(h.bv.overlay.rect.corners())[1] as Point;
    const n = store(h).size;
    const depth = h.session.editor.undo.undoDepth;
    drag(h, right, h.v(450, 300), {}, 8);
    expect(store(h).size).toBe(n + 1);
    expect(h.session.editor.undo.undoDepth - depth).toBe(1);
    const sel = store(h).getObject(h.session.selection[0] ?? '');
    expect(sel !== null && isConnector(sel)).toBe(true);
  });

  it('Escape mid-drag cancels it: nothing is created and the selection stays', () => {
    const h = viewHarness();
    h.bv.overlay.select(h.obj(A));
    const right = handleCentres(h.bv.overlay.rect.corners())[1] as Point;
    const n = store(h).size;
    h.bv.input(ptr('down', right.x, right.y));
    const to = h.v(450, 300);
    for (let i = 1; i <= 6; i++)
      h.bv.input(ptr('move', right.x + ((to.x - right.x) * i) / 6, right.y + ((to.y - right.y) * i) / 6));
    expect(h.bv.router.dragHandler()?.kind).toBe('ConnectDragger');
    expect(h.bv.key({ key: 'Escape', shift: false, ctrl: false, alt: false, meta: false })).toBe(true);
    expect(h.bv.router.dragHandler()).toBeNull();
    h.bv.input(ptr('up', to.x, to.y, { buttons: 0 }));
    expect(store(h).size).toBe(n);
    expect(h.session.selection).toEqual([A]);
  });
});

describe('canvas gestures', () => {
  it('a right click opens the context menu: the C++ items for empty canvas', () => {
    let got: readonly ContextAction[] = [];
    const h = viewHarness();
    (h.session.options as { ui?: unknown }).ui = {
      contextMenu: (_at: Point, items: readonly ContextAction[]) => {
        got = items;
      },
      toast: () => undefined,
    };
    const at = h.v(700, 550);
    h.bv.input(ptr('down', at.x, at.y, { button: 2, buttons: 2 }));
    h.bv.input(ptr('up', at.x, at.y, { button: 2, buttons: 0 }));
    h.scheduler.advance(300);
    expect(got.map((i) => i.id)).toEqual([
      'select_all',
      'add_note',
      'add_text',
      'add_rect',
      'add_circle',
      'insert_image',
    ]);
  });

  it('the wheel pans; Cmd/Ctrl + wheel zooms about the pointer', () => {
    const h = viewHarness();
    h.bv.input({ type: 'wheel', x: 100, y: 100, dx: -30, dy: -40, mods: NO_MODIFIERS });
    expect(h.session.view.tx).toBeCloseTo(-30, 9);
    expect(h.session.view.ty).toBeCloseTo(-40, 9);
    const docBefore = h.bv.view.toDoc(new Point(200, 200));
    h.bv.input({ type: 'wheel', x: 200, y: 200, dx: 0, dy: 20, mods: { ...NO_MODIFIERS, ctrl: true } });
    expect(h.session.view.zoom).toBeCloseTo(1.2, 9);
    const docAfter = h.bv.view.toDoc(new Point(200, 200));
    expect(docAfter.x).toBeCloseTo(docBefore.x, 6);
    expect(docAfter.y).toBeCloseTo(docBefore.y, 6);
  });

  it('a trackpad pinch zooms', () => {
    const h = viewHarness();
    h.bv.input({ type: 'scale', phase: 'start', x: 400, y: 300, scale: 1 });
    h.bv.input({ type: 'scale', phase: 'move', x: 400, y: 300, scale: 1.5 });
    h.bv.input({ type: 'scale', phase: 'end', x: 400, y: 300, scale: 1.5 });
    expect(h.session.view.zoom).toBeCloseTo(1.5, 9);
    expect(h.bv.router.dragHandler()).toBeNull();
  });

  it('a double tap on a shape edits its text', () => {
    const h = viewHarness();
    const at = h.v(150, 150);
    h.bv.input(ptr('down', at.x, at.y));
    h.bv.input(ptr('up', at.x, at.y, { buttons: 0 }));
    h.bv.input(ptr('down', at.x, at.y));
    h.bv.input(ptr('up', at.x, at.y, { buttons: 0 }));
    expect(h.bv.textEdit.active).toBe(true);
    expect(h.bv.textEdit.objectId).toBe(A);
    expect(h.bv.ui.get().textEdit?.objectId).toBe(A);
  });

  it('a tap in Text mode creates a text object and edits it; Text mode ends', () => {
    const h = viewHarness();
    h.bv.modes.set(InputMode.Text);
    const n = store(h).size;
    tap(h, h.v(650, 500));
    expect(store(h).size).toBe(n + 1);
    expect(h.bv.textEdit.active).toBe(true);
    expect(h.bv.modes.get()).toBe(InputMode.Select);
  });

  it('a finger tap in Draw mode adds a dot; a pen or mouse press draws at once', () => {
    const h = viewHarness();
    h.bv.modes.set(InputMode.Draw);
    const n = store(h).size;
    tap(h, h.v(650, 500), { kind: 'touch' });
    expect(store(h).size).toBe(n + 1);
    const at = h.v(600, 500);
    h.bv.input(ptr('down', at.x, at.y, { kind: 'pen' }));
    expect(h.bv.router.dragHandler()?.kind).toBe('DrawingDragger');
  });

  it('the scroll indicator flashes on a scroll and hides after 500 ms', () => {
    const h = viewHarness();
    h.bv.input({ type: 'wheel', x: 100, y: 100, dx: 0, dy: -10, mods: NO_MODIFIERS });
    expect(h.bv.overlay.showingScrollIndicator).toBe(true);
    h.scheduler.advance(600);
    expect(h.bv.overlay.showingScrollIndicator).toBe(false);
  });

  it('the UI store follows the mode, the selection and the zoom; no listener after dispose', () => {
    const h = viewHarness();
    let seen = 0;
    const un = h.bv.ui.subscribe(() => seen++);
    h.bv.modes.set(InputMode.Draw);
    expect(h.bv.ui.get().inputMode).toBe(InputMode.Draw);
    h.bv.overlay.select(h.obj(A));
    expect(h.bv.ui.get().selection?.ids).toEqual([A]);
    expect(h.bv.ui.get().selection?.actions[0]?.id).toBe('info');
    expect(seen).toBeGreaterThan(0);
    un();
    h.bv.ui.subscribe(() => undefined);
    h.bv.dispose();
    expect(h.bv.uiListenerCount).toBe(0);
  });
});

describe('scroll indicator geometry, glyphs, layer scheduler', () => {
  it('scrollPos is C++ Scroll::getScrollPos', () => {
    expect(scrollPos(100, 50, 10)).toEqual({ pos: 0, size: 0 });
    const r = scrollPos(100, 300, -100);
    expect(r.size).toBeCloseTo((100 / 300) * 100, 9);
    expect(r.pos).toBeCloseTo((100 - r.size) * (100 / 200), 9);
  });

  it('the three canvas glyphs, as path data', () => {
    expect(Object.keys(CANVAS_GLYPHS).sort()).toEqual([
      'lekhapp.ui.erase_dragger',
      'lekhapp.ui.sel_rect_rotate',
      'lekhapp.ui.zoom_info',
    ]);
    const z = glyphSvgPath('lekhapp.ui.zoom_info', new Rect(0, 0, 140, 30));
    expect(z).toEqual(['M 0 0 L 0 30 L 140 30 L 140 0 L 0 0']);
    expect(glyphSvgPath('lekhapp.ui.sel_rect_rotate', new Rect(0, 0, 30, 30))).toHaveLength(2);
    expect(glyphSvgPath('lekhapp.ui.erase_dragger', new Rect(0, 0, 80, 80))[0]?.startsWith('M 80 40 C')).toBe(true);
  });

  it('LayerScheduler: one frame, layers in grid → drawing → middle order', () => {
    const f = new ManualFrameScheduler();
    const painted: string[] = [];
    const ls = new LayerScheduler(f, (l) => painted.push(l));
    ls.invalidate('middle');
    ls.invalidate('grid');
    ls.invalidate('middle');
    expect(f.pending).toBe(1);
    f.tick();
    expect(painted).toEqual(['grid', 'middle']);
    ls.invalidate('drawing');
    ls.dispose();
    expect(f.pending).toBe(0);
  });
});
