// AC-UI-02: `GESTURE_CONSTANTS` are the C++ values (`GestureRecognizer.cpp:30-35`, the multi-touch
// recognisers, `Config::closePointDistanceShort` / `vertexHandleRadius`), and frozen.
import { describe, expect, it } from 'vitest';
import { CONFIG_DEFAULTS } from '../../src/base';
import { GESTURE_CONSTANTS, GestureRecognizer, hitRadius, PointerType } from '../../src/interaction';
import { EngineConfig } from '../../src/base';

describe('GESTURE_CONSTANTS (AC-UI-02)', () => {
  it('equal the C++ values', () => {
    const c = GESTURE_CONSTANTS;
    expect(c.doubleTapMs).toBe(250);
    expect(c.longPressMs).toBe(500);
    expect(c.moveThreshold).toBe(10);
    expect(c.doubleClickTolerance).toBe(50);
    expect(c.hitRadius.mouse).toBe(15);
    expect(c.hitRadius.pen).toBe(15);
    expect(c.hitRadius.touch).toBe(16);
    expect(c.maxTouches).toBe(3);
    expect(c.scaleThreshold).toBe(16);
    expect(c.scrollThreshold).toBe(12);
    expect(c.rotateThreshold).toBe(0.26);
  });

  it('are frozen', () => {
    expect(Object.isFrozen(GESTURE_CONSTANTS)).toBe(true);
    expect(Object.isFrozen(GESTURE_CONSTANTS.hitRadius)).toBe(true);
  });

  it('the recogniser and the handle hit radii use them', () => {
    const noop = () => false;
    const gr = new GestureRecognizer(
      {
        canDoAt: () => ({ canHandle: false, shouldBlock: false, param: 0 }),
        isDrawOnlyMode: noop,
        onDown: noop,
        onUp: noop,
        onClick: noop,
        onDoubleClick: noop,
        onPan: noop,
        onScale: noop,
        onRotate: noop,
        onLongPress: noop,
        cancelDrag: () => undefined,
      },
      { setTimer: () => 0, clearTimer: () => undefined },
    );
    expect(gr.doubleTapGap).toBe(250);
    expect(gr.longPressTime).toBe(500);
    expect(gr.moveThreshold).toBe(10);
    expect(gr.doubleClickMoveThreshold).toBe(50);
    const cfg = new EngineConfig();
    expect(CONFIG_DEFAULTS.closePointDistanceShort).toBe(GESTURE_CONSTANTS.hitRadius.mouse);
    expect(CONFIG_DEFAULTS.vertexHandleRadius).toBe(GESTURE_CONSTANTS.hitRadius.touch);
    expect(hitRadius(cfg, PointerType.Mouse)).toBe(15);
    expect(hitRadius(cfg, PointerType.Pen)).toBe(15);
    expect(hitRadius(cfg, PointerType.Finger)).toBe(16);
  });
});
