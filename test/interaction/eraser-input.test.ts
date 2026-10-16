// AC-UI-05 (lekhjs half): a pen with `buttons & 32` is an eraser tip (and on Android the S Pen side
// button), and an eraser tip drawn across a stroke erases it with one undo step, in Draw and in
// Select mode. The DOM adapter's half (`PointerSource` maps the DOM event) is lekhboard-capacitor's.
import { describe, expect, it } from 'vitest';
import { Point } from '../../src/geometry';
import { InputMode, isEraserTip } from '../../src/interaction';
import { isFreehand } from '../../src/model';
import { drag, viewHarness, type ViewHarness } from './helpers';

function strokes(h: ViewHarness): number {
  return h.session.editor.doc.activePage().objectStore.objects.filter((o) => isFreehand(o)).length;
}

function drawStroke(h: ViewHarness): void {
  h.bv.modes.set(InputMode.Draw);
  drag(h, new Point(300, 450), new Point(500, 470), { kind: 'pen' }, 10);
  h.scheduler.advance(600);
}

describe('eraser tip (AC-UI-05)', () => {
  it('isEraserTip: pen with buttons & 32; Android also the side button', () => {
    expect(isEraserTip('pen', 32, 'web')).toBe(true);
    expect(isEraserTip('pen', 33, 'ios')).toBe(true);
    expect(isEraserTip('pen', 1, 'web')).toBe(false);
    expect(isEraserTip('pen', 2, 'web')).toBe(false);
    expect(isEraserTip('pen', 2, 'android')).toBe(true);
    expect(isEraserTip('mouse', 32, 'web')).toBe(false);
    expect(isEraserTip('touch', 32, 'android')).toBe(false);
  });

  it('a pen stroke in Draw mode becomes ink (after the 500 ms batch)', () => {
    const h = viewHarness();
    drawStroke(h);
    expect(strokes(h)).toBe(1);
    expect(h.session.editor.undo.canUndo()).toBe(true);
  });

  for (const mode of [InputMode.Draw, InputMode.SmartDraw, InputMode.Select]) {
    it(`an eraser tip across the stroke erases it in ${mode} mode, one undo step`, () => {
      const h = viewHarness();
      drawStroke(h);
      expect(strokes(h)).toBe(1);
      h.bv.modes.set(mode);
      const depth = h.session.editor.undo.undoDepth;
      drag(h, new Point(400, 400), new Point(400, 520), { kind: 'pen', eraser: true, buttons: 33 }, 12);
      expect(strokes(h)).toBe(0);
      expect(h.bv.router.dragHandler()).toBeNull();
      expect(h.session.editor.undo.undoDepth - depth).toBe(1);
      h.dispatch({ type: 'command', command: { kind: 'undo' }, origin: 'ui' });
      expect(strokes(h)).toBe(1);
    });
  }
});
