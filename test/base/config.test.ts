import { describe, expect, it } from 'vitest';
import { CONFIG_DEFAULTS, CONFIG_KEYS, EngineConfig, PencilBehavior, ScreenMode } from '../../src/base';

describe('EngineConfig', () => {
  it('has the C++ defaults, with PI = Math.PI', () => {
    const c = new EngineConfig();
    expect(c.closePointDistance).toBe(28);
    expect(c.parallelogramRegularizeAngle).toBe(12);
    expect(c.snapAngleStep).toBe(Math.PI / 36);
    expect(c.minSelectRectDimention).toBe(80);
    expect(c.cxPolyMaxPolys).toBe(3000);
    expect(c.closedShapeMaxLines).toBe(16);
    expect(c.screenMode).toBe(ScreenMode.AsSystem);
    expect(c.pencilBehavior).toBe(PencilBehavior.SameAsTouch);
    expect(c.enableMultiStroke).toBe(false);
    // The product default; the vitest setup turns the shadow check on for every suite (AC-ENG-03).
    expect(CONFIG_DEFAULTS.debug.verifyIndex).toBe(false);
    expect(c.debug.verifyIndex).toBe(true);
    expect(c.render).toEqual({ lowZoomSimplify: false, minGlyphPx: 2 });
  });

  it('keeps colours as signed 32-bit values', () => {
    expect(new EngineConfig().resizeIndicatorColor).toBe(0xfff0f0f0 | 0);
    expect(new EngineConfig().resizeIndicatorColor).toBeLessThan(0);
  });

  it('carries all 129 C++ fields plus the debug and render groups', () => {
    expect(CONFIG_KEYS.length).toBe(131);
    const c = new EngineConfig({ debug: { verifyIndex: false } });
    for (const k of CONFIG_KEYS) expect(c[k]).toEqual(CONFIG_DEFAULTS[k]);
  });

  it('is immutable', () => {
    const c = new EngineConfig();
    expect(Object.isFrozen(c)).toBe(true);
    expect(Object.isFrozen(c.debug)).toBe(true);
    expect(Object.isFrozen(CONFIG_DEFAULTS)).toBe(true);
    expect(() => {
      (c as unknown as Record<string, number>)['closePointDistance'] = 1;
    }).toThrow(TypeError);
  });

  it('withOverrides returns a new config and merges groups field by field', () => {
    const a = new EngineConfig({ closePointDistance: 30 });
    const b = a.withOverrides({ tapToSelectDistance: 20, debug: { verifyIndex: true } });
    expect(a.tapToSelectDistance).toBe(16);
    expect(b.closePointDistance).toBe(30);
    expect(b.tapToSelectDistance).toBe(20);
    expect(b.debug.verifyIndex).toBe(true);
    const c = b.withOverrides({ render: { minGlyphPx: 3 } });
    expect(c.render).toEqual({ lowZoomSimplify: false, minGlyphPx: 3 });
    expect(c.debug.verifyIndex).toBe(true);
  });

  it('rejects unknown keys', () => {
    expect(() => new EngineConfig({ nope: 1 } as never)).toThrow(/Unknown config key 'nope'/);
  });

  it('toValues is a plain copy', () => {
    const c = new EngineConfig({ debug: { verifyIndex: true } });
    const v = c.toValues();
    v.debug.verifyIndex = false;
    expect(c.debug.verifyIndex).toBe(true);
    expect(new EngineConfig(v).debug.verifyIndex).toBe(false);
  });
});
