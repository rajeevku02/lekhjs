// The ShapeInteraction capability (spec 05 §5): registered per session by template id or class
// name, resolved once per object, consulted only in Select mode on editable boards.
import { describe, expect, it } from 'vitest';
import { Point } from '../../src/geometry';
import {
  MapShapeInteractionRegistry,
  shapeHandles,
  type InputInfo,
  type ShapeInteraction,
} from '../../src/interaction';
import { kindsEnv, rect } from '../model/kinds';

const EV: InputInfo = {
  kind: 'mouse',
  mods: { shift: false, ctrl: false, alt: false, meta: false },
  buttons: 1,
  viewPt: new Point(),
};

describe('ShapeInteractionRegistry', () => {
  it('resolves by template id before class name, one instance per object', () => {
    const env = kindsEnv();
    const reg = new MapShapeInteractionRegistry();
    let made = 0;
    const byClass: ShapeInteraction = { onTap: () => true };
    reg.register('Templated', () => byClass);
    reg.register('avabodh.basic.rectangle', () => {
      made++;
      return { onTap: () => true };
    });
    const o = rect(env, 0, 0, 10, 10);
    const si = reg.get(o);
    expect(si).not.toBe(byClass);
    expect(reg.get(o)).toBe(si);
    expect(made).toBe(1);
    const reg2 = new MapShapeInteractionRegistry();
    expect(reg2.get(o)).toBeUndefined();
  });

  it('only in Select mode on an editable board; hitTest decides when present', () => {
    const tapOnly: ShapeInteraction = { onTap: () => true };
    const st = { selectMode: true, readOnly: false };
    expect(shapeHandles(tapOnly, 'tap', new Point(), EV, st)).toBe(true);
    expect(shapeHandles(tapOnly, 'doubleTap', new Point(), EV, st)).toBe(false);
    expect(shapeHandles(tapOnly, 'tap', new Point(), EV, { selectMode: false, readOnly: false })).toBe(false);
    expect(shapeHandles(tapOnly, 'tap', new Point(), EV, { selectMode: true, readOnly: true })).toBe(false);
    const hit: ShapeInteraction = { hitTest: (_e, p) => ({ handles: p.x > 0 }), onTap: () => true };
    expect(shapeHandles(hit, 'tap', new Point(1, 0), EV, st)).toBe(true);
    expect(shapeHandles(hit, 'tap', new Point(-1, 0), EV, st)).toBe(false);
    expect(shapeHandles(undefined, 'tap', new Point(), EV, st)).toBe(false);
  });
});

// ---- AC-UI-25, AC-UI-26: the capability at router position 3 ----

import { InputMode, Movement } from '../../src/interaction';
import type { TemplatedObject } from '../../src/model';
import { drag, pe, tap, viewHarness, type ViewHarness } from './helpers';

const RECT_A = '4K5eYQdS7snA1MXucdVzUM';

interface Calls {
  tap: number;
  drag: number;
}

/** A fake checkbox: a tap toggles its text between "[ ]" and "[x]" as one change. */
function checkbox(calls: Calls): ShapeInteraction {
  return {
    onTap: (_pt, _ev, ctx) => {
      calls.tap++;
      ctx.beginChange(RECT_A);
      const o = ctx.session.objectById(RECT_A) as TemplatedObject;
      const cur = o.getTextForEditing();
      o.updateText(cur === '[x]' ? '[ ]' : '[x]', 0);
      ctx.commit('toggle');
      return true;
    },
    onDragStart: () => {
      calls.drag++;
      return null;
    },
  };
}

function setup(): { h: ViewHarness; calls: Calls } {
  const calls: Calls = { tap: 0, drag: 0 };
  const registry = new MapShapeInteractionRegistry();
  registry.register('avabodh.basic.rectangle', () => checkbox(calls));
  const h = viewHarness({ cloud: true, registry });
  h.transport.sent.length = 0;
  return { h, calls };
}

const changeattrFrames = (h: ViewHarness) =>
  h.transport.frames().filter((f) => (f.updates as { type?: string } | undefined)?.type === 'changeattr').length;

describe('ShapeInteraction in the router (AC-UI-25)', () => {
  it('a tap in Select mode on an editable board: one undo step, one changeattr frame', () => {
    const { h, calls } = setup();
    h.bv.modes.set(InputMode.Select);
    const depth = h.session.editor.undo.undoDepth;
    tap(h, h.v(150, 150));
    expect(calls.tap).toBe(1);
    expect(h.session.editor.undo.undoDepth - depth).toBe(1);
    expect(changeattrFrames(h)).toBe(1);
    expect(h.tobj(RECT_A).getTextForEditing()).toBe('[x]');
    // The tap went to the shape, not to the selection.
    expect(h.session.selection).toEqual([]);
  });

  it('never on a read-only board', () => {
    const { h, calls } = setup();
    h.readOnly = true;
    const depth = h.session.editor.undo.undoDepth;
    tap(h, h.v(150, 150));
    expect(calls.tap).toBe(0);
    expect(h.session.editor.undo.undoDepth).toBe(depth);
    expect(changeattrFrames(h)).toBe(0);
  });

  for (const mode of [InputMode.Draw, InputMode.Scroll, InputMode.Text, InputMode.SmartDraw]) {
    it(`never in ${mode} mode`, () => {
      const { h, calls } = setup();
      h.bv.modes.set(mode);
      tap(h, h.v(150, 150));
      expect(calls.tap).toBe(0);
      expect(changeattrFrames(h)).toBe(0);
    });
  }
});

describe('handles win over a ShapeInteraction (AC-UI-26)', () => {
  it('a press on a corner handle starts the resize dragger; onTap / onDragStart not called', () => {
    const { h, calls } = setup();
    h.bv.overlay.select(h.obj(RECT_A));
    const c2 = h.bv.overlay.rect.corners()[2];
    if (c2 === undefined) throw new Error('no corner');
    // A point inside the corner handle's 30 × 30 hit area that is also on the fake shape (within
    // the tap-to-select distance of its outline).
    const corner = c2.withDelta(-13, -13);
    const store = h.session.editor.doc.activePage().objectStore;
    expect(store.hit.selectableAt(h.bv.view.toDoc(corner), 16)?.id).toBe(RECT_A);
    expect(h.bv.overlay.onPan(corner, pe(corner.x, corner.y), Movement.Start)).toBe(true);
    expect(h.bv.router.dragHandler()?.kind).toBe('ResizeDragger');
    h.bv.router.setDragHandler(null);
    drag(h, corner, corner.withDelta(30, 20));
    expect(calls.drag).toBe(0);
    expect(calls.tap).toBe(0);
    tap(h, corner);
    expect(calls.tap).toBe(0);
  });

  it('a drag on the shape body without a selection goes to the shape (its onDragStart)', () => {
    const { h, calls } = setup();
    drag(h, h.v(150, 150), h.v(200, 180));
    expect(calls.drag).toBe(1);
  });
});
