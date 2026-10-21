// The commands the React toolbars call (task W4; spec 05 §7.1): Clear Canvas, Reset Zoom, the
// web zoom control's 5 % steps, Move to beginning; and the selection-menu state the React menu
// reads (hidden while the selection moves, AC-UI-23), and the erase/laser toasts' point.
import { describe, expect, it } from 'vitest';
import { Point } from '../../src/geometry';
import { InputMode } from '../../src/interaction';
import type { ToastRequest, UiRequests } from '../../src/session';
import { A, ptr, viewHarness } from './helpers';

describe('toolbar commands', () => {
  it('Clear Canvas deselects and empties the page in one undo step', () => {
    const h = viewHarness();
    h.bv.overlay.select(h.obj(A));
    const depth = h.session.editor.undo.undoDepth;
    h.bv.commands.clearCanvas();
    expect(h.session.editor.doc.activePage().objectStore.size).toBe(0);
    expect(h.session.selection).toEqual([]);
    expect(h.session.editor.undo.undoDepth - depth).toBe(1);
  });

  it('the zoom control steps on multiples of 5 % (C++ setZoom)', () => {
    const h = viewHarness();
    expect(h.bv.commands.zoomPercent()).toBe(100);
    h.bv.commands.setZoomPercent(h.bv.commands.zoomPercent() + 5);
    expect(h.bv.commands.zoomPercent()).toBe(105);
    h.bv.commands.setZoomPercent(h.bv.commands.zoomPercent() - 5);
    h.bv.commands.setZoomPercent(h.bv.commands.zoomPercent() - 5);
    expect(h.bv.commands.zoomPercent()).toBe(95);
    // 97 % snaps down to 95 % before the step, as C++ `(zm / 5) * 5`.
    h.bv.board.setView({ zoom: 0.97 });
    h.bv.commands.setZoomPercent(h.bv.commands.zoomPercent() + 5);
    expect(h.bv.commands.zoomPercent()).toBe(100);
    h.bv.commands.resetZoom();
    expect(h.session.view.zoom).toBe(1);
  });

  it('Move to beginning: 100 % and the content top-left in view', () => {
    const h = viewHarness();
    h.bv.board.setView({ zoom: 2, tx: -5000, ty: -4000 });
    h.bv.commands.goToBeginning(false);
    const v = h.session.view;
    expect(v.zoom).toBe(1);
    const all = h.session.editor.doc.activePage().objectStore.hit.boundsOfAll();
    const tl = h.bv.view.toView(new Point(all.x, all.y));
    // The fixture is smaller than the 800 × 600 view: centred on both axes.
    expect(tl.x).toBeCloseTo((800 - all.width) / 2, 6);
    expect(tl.y).toBeCloseTo((600 - all.height) / 2, 6);
  });
});

describe('selection menu state', () => {
  it('is hidden while the selection moves and shown again after', () => {
    const h = viewHarness({ config: { snapToGrid: false } });
    const at = h.v(150, 150);
    h.bv.input(ptr('down', at.x, at.y));
    h.bv.input(ptr('up', at.x, at.y, { buttons: 0 }));
    h.scheduler.advance(300);
    expect(h.bv.ui.get().selection?.menuHidden).toBe(false);
    h.bv.input(ptr('down', at.x, at.y));
    h.bv.input(ptr('move', at.x + 20, at.y + 10));
    h.bv.input(ptr('move', at.x + 40, at.y + 20));
    h.bv.layers.flush();
    expect(h.bv.overlay.rect.isMoving).toBe(true);
    expect(h.bv.ui.get().selection?.menuHidden).toBe(true);
    h.bv.input(ptr('up', at.x + 40, at.y + 20, { buttons: 0 }));
    h.bv.layers.flush();
    expect(h.bv.ui.get().selection?.menuHidden).toBe(false);
  });

  it('the erase and laser toasts carry the tap point (C++ Toast::show(at, msg))', () => {
    const h = viewHarness();
    const toasts: ToastRequest[] = [];
    const ui: Partial<UiRequests> = { toast: (t) => toasts.push(t) };
    (h.bv.board as unknown as { ui: () => unknown }).ui = () => ui;
    h.bv.modes.set(InputMode.Erase);
    const at = h.v(700, 550);
    h.bv.input(ptr('down', at.x, at.y));
    h.bv.input(ptr('up', at.x, at.y, { buttons: 0 }));
    h.scheduler.advance(300);
    expect(toasts.map((t) => [t.message, t.at?.x, t.at?.y])).toEqual([['Erase mode is on', at.x, at.y]]);
  });
});
