// Undo and redo repaint what they change (owner round UF1 of Work 01M4X7TCHFB862XGT68GPY071C).
// C++ `Command::undo/redo` recompute the canvas size and redraw the whole canvas after every step
// (Command.cpp:125-139), and `Command::changeZOrder` redraws after Move to Front / Back
// (Command.cpp:80-90). In the port an undone canvas size or margin, which changes no object,
// repainted nothing until the next scroll, and Move to Front / Back (and their undo, redo) moved
// the object in the store without a repaint.
import { describe, expect, it } from 'vitest';
import { updatetypes } from '../../src/sync';
import { frame as peerFrame } from '../sync/helpers';
import { A, B, P, viewHarness, type ViewHarness } from './helpers';

type Layer = 'grid' | 'drawing' | 'middle';

/** One frame of the session's and the view's schedulers (the coalesced repaints). */
function tick(h: ViewHarness): void {
  h.scheduler.frame();
  h.frames.tick();
}

/** Runs a board command and the frame its repaint requests wait for. */
function run(h: ViewHarness, id: Parameters<ViewHarness['bv']['commands']['run']>[0]): void {
  h.bv.commands.run(id);
  tick(h);
}

function track(h: ViewHarness): { paints: Set<Layer>; views: number; changed: string[]; reset(): void } {
  tick(h);
  const t = {
    paints: new Set<Layer>(),
    views: 0,
    changed: [] as string[],
    reset(): void {
      t.paints.clear();
      t.views = 0;
      t.changed.length = 0;
    },
  };
  h.session.on('paintRequested', (e) => t.paints.add(e.layer));
  h.session.on('viewChanged', () => {
    t.views++;
  });
  h.session.on('documentChanged', (e) => t.changed.push(...e.changedIds));
  return t;
}

describe('undo / redo of a page attribute repaints and announces the view', () => {
  it('canvas size (Letter, then Infinite): undo and redo', () => {
    const h = viewHarness();
    const p = h.bv.editors.page();
    p.setPageSizeIndex(3);
    const t = track(h);
    const page = h.session.document.activePage();
    const fixedSize = page.size;
    // A second size change from a new panel (a new step, not the continued edit).
    h.bv.editors.page().setPageSizeIndex(1);
    expect(p.pageSizeIndex()).toBe(1);
    t.reset();
    run(h, 'undo');
    expect(page.size).toBe(fixedSize);
    expect(t.views).toBe(1);
    expect([...t.paints].sort()).toEqual(['drawing', 'grid']);
    t.reset();
    run(h, 'redo');
    expect(p.pageSizeIndex()).toBe(1);
    expect(t.views).toBe(1);
    expect([...t.paints].sort()).toEqual(['drawing', 'grid']);
  });

  it('margin: undo and redo', () => {
    const h = viewHarness();
    h.bv.editors.page().setPageSizeIndex(3);
    const p = h.bv.editors.page();
    p.setMargin({ unit: 'inch', width: 1, height: 1 });
    const t = track(h);
    run(h, 'undo');
    expect(p.margin()).toEqual({ unit: 'point', width: 0, height: 0 });
    expect(t.views).toBe(1);
    expect(t.paints.has('drawing')).toBe(true);
    t.reset();
    run(h, 'redo');
    expect(p.margin()).toEqual({ unit: 'inch', width: 1, height: 1 });
    expect(t.views).toBe(1);
    expect(t.paints.has('drawing')).toBe(true);
  });

  it('grid on / off: undo repaints', () => {
    const h = viewHarness();
    const on = h.session.document.grid.present;
    h.bv.editors.page().setGrid(!on);
    const t = track(h);
    run(h, 'undo');
    expect(h.session.document.grid.present).toBe(on);
    expect(t.views).toBe(1);
  });

  it('an object-only undo does not announce a view change', () => {
    const h = viewHarness();
    h.dispatch({ type: 'command', origin: 'ui', command: { kind: 'move', ids: [A], dx: 10, dy: 0 } });
    const t = track(h);
    run(h, 'undo');
    expect(t.views).toBe(0);
    expect(t.paints.has('drawing')).toBe(true);
  });
});

describe('Move to Front / Back repaints (local, undo, redo, remote)', () => {
  const order = (h: ViewHarness): string[] =>
    h.session.document
      .getPage(P)
      ?.objectStore.objects.map((o) => o.id)
      .filter((id) => id === A || id === B) ?? [];

  it('Move To Front (the selection menu), undo, redo: each a changed object and a drawing repaint', () => {
    const h = viewHarness();
    const [bottom = '', upper = ''] = order(h);
    h.bv.overlay.select(h.obj(bottom));
    tick(h);
    const t = track(h);
    h.bv.runSelectionAction('bring_front');
    tick(h);
    expect(order(h)).toEqual([upper, bottom]);
    expect(t.changed).toContain(bottom);
    expect(t.paints.has('drawing')).toBe(true);
    t.reset();
    run(h, 'undo');
    expect(order(h)).toEqual([bottom, upper]);
    expect(t.changed).toContain(bottom);
    expect(t.paints.has('drawing')).toBe(true);
    t.reset();
    run(h, 'redo');
    expect(order(h)).toEqual([upper, bottom]);
    expect(t.changed).toContain(bottom);
    expect(t.paints.has('drawing')).toBe(true);
  });

  it('Move To Back of the top object', () => {
    const h = viewHarness();
    const [bottom = '', upper = ''] = order(h);
    h.bv.overlay.select(h.obj(upper));
    tick(h);
    const t = track(h);
    h.bv.runSelectionAction('send_back');
    tick(h);
    expect(order(h)).toEqual([upper, bottom]);
    expect(t.paints.has('drawing')).toBe(true);
  });

  it("a collaborator's order change repaints", () => {
    const h = viewHarness({ cloud: true });
    const t = track(h);
    const top = h.session.document.getPage(P)?.objectStore.nextOrder() ?? 0;
    const [bottom = '', upper = ''] = order(h);
    tick(h);
    t.reset();
    h.dispatch({
      type: 'remoteFrame',
      text: peerFrame(updatetypes.changeAttr, { [`doc.pages.${P}.objects.${bottom}.order`]: top }, 12),
    });
    tick(h);
    expect(order(h)).toEqual([upper, bottom]);
    expect(t.changed).toContain(bottom);
    expect(t.paints.has('drawing')).toBe(true);
  });
});

describe('Set Size closing after its object went away', () => {
  it('records no step for a removed object', () => {
    const h = viewHarness();
    const o = h.tobj(A);
    h.bv.overlay.select(o);
    // A step to undo: the object's removal (delete), so undo brings it back and redo removes it.
    h.bv.runSelectionAction('delete');
    tick(h);
    run(h, 'undo');
    const back = h.tobj(A);
    h.bv.overlay.select(back);
    const ss = h.bv.editors.setSize();
    ss.set('width', 77);
    // Redo removes it again while the panel is open; then the panel closes.
    run(h, 'redo');
    expect(h.session.document.activePage().objectStore.getObject(A)).toBeNull();
    const depth = h.session.editor.undo.undoDepth;
    ss.close();
    expect(h.session.editor.undo.undoDepth).toBe(depth);
    run(h, 'undo');
    expect(h.session.document.activePage().objectStore.getObject(A)).not.toBeNull();
  });
});
