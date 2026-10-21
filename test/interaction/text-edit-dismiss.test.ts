// Owner round UI11 (Work 01M4X7TCHFB862XGT68GPY071C). The press that finishes a text edit is used
// up (C++ InputHandler::onPointerEvent, InputHandler.cpp:171-182) and the rest of its sequence
// finds the recogniser idle, so it draws nothing and does not pan, even when the view moves under a
// finger as a phone keyboard closes (these pass before and after UI11: the owner's stray strokes
// came from the web host blurring the editor before delivering the press, PointerSource). The
// editor's geometry: the first line's top and baseline as the canvas places them (a floating
// text's box is a unit taller than its lines).
import { describe, expect, it } from 'vitest';
import { Point } from '../../src/geometry';
import { InputMode } from '../../src/interaction';
import { A, ptr, viewHarness, type ViewHarness } from './helpers';

const store = (h: ViewHarness) => h.session.editor.doc.activePage().objectStore;

function editA(h: ViewHarness): void {
  const o = h.tobj(A);
  h.bv.board.edit(() => {
    o.startTextEditing(o.getTextEditCenter());
    h.bv.textEdit.began(o);
  });
  expect(h.bv.textEdit.active).toBe(true);
}

describe('the press that finishes a text edit', () => {
  it('Draw mode, pen: the press and its moves are used up; no stroke; the next press draws', () => {
    const h = viewHarness();
    editA(h);
    h.bv.modes.set(InputMode.Draw);
    const n = store(h).size;
    const from = h.v(600, 450);
    h.bv.input(ptr('down', from.x, from.y, { kind: 'pen' }));
    expect(h.bv.textEdit.active).toBe(false);
    for (let i = 1; i <= 8; i++) h.bv.input(ptr('move', from.x + i * 6, from.y + i * 25, { kind: 'pen' }));
    expect(h.bv.router.dragHandler()).toBeNull();
    expect(h.bv.router.recognizer.stateName).toBe('Init');
    h.bv.input(ptr('up', from.x + 48, from.y + 200, { kind: 'pen', buttons: 0 }));
    h.scheduler.advance(300);
    expect(store(h).size).toBe(n);
    // The next press of the same pointer is a normal one.
    h.bv.input(ptr('down', from.x, from.y, { kind: 'pen' }));
    expect(h.bv.router.dragHandler()?.kind).toBe('DrawingDragger');
  });

  it('SmartDraw, finger: the dismissing touch is not a dot, and its moves do not pan', () => {
    const h = viewHarness();
    editA(h);
    h.bv.modes.set(InputMode.SmartDraw);
    const n = store(h).size;
    const v0 = h.bv.board.view();
    const view0 = { x: v0.scrollX, y: v0.scrollY };
    const at = h.v(600, 450);
    h.bv.input(ptr('down', at.x, at.y, { kind: 'touch' }));
    for (let i = 1; i <= 8; i++) h.bv.input(ptr('move', at.x, at.y - i * 30, { kind: 'touch' }));
    h.bv.input(ptr('up', at.x, at.y - 240, { kind: 'touch', buttons: 0 }));
    h.scheduler.advance(300);
    expect(h.bv.textEdit.active).toBe(false);
    expect(store(h).size).toBe(n);
    expect(h.bv.board.view().scrollX).toBe(view0.x);
    expect(h.bv.board.view().scrollY).toBe(view0.y);
    // The next press reaches the recogniser as usual.
    h.bv.input(ptr('down', at.x, at.y, { kind: 'touch' }));
    expect(h.bv.router.recognizer.stateName).toBe('Down');
  });
});

describe('the editor geometry (TextEditView)', () => {
  it('a floating text: its first line half a unit below the box top, the baseline below that', () => {
    const h = viewHarness();
    h.bv.board.setView({ zoom: 2 });
    h.bv.canvas.editTextAt(new Point(700, 500), false);
    h.bv.textEdit.update('Hello');
    const v = h.bv.ui.get().textEdit;
    expect(v).not.toBeNull();
    expect(v?.textTop).toBeCloseTo(0.5 * 2, 6);
    expect(v?.baseline ?? 0).toBeGreaterThan(v?.textTop ?? 0);
    expect(v?.baseline ?? 0).toBeLessThan((v?.textTop ?? 0) + (v?.lineHeight ?? 0));
  });

  it('a shape label: the first line starts at the box top', () => {
    const h = viewHarness();
    editA(h);
    const v = h.bv.ui.get().textEdit;
    expect(v?.textTop).toBeCloseTo(0, 6);
    expect(v?.baseline).toBeDefined();
  });
});
