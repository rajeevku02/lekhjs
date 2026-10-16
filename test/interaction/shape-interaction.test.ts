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
