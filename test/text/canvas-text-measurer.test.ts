// CanvasTextMeasurer (spec 06 §5.1, §8.4) over @napi-rs/canvas with the bundled fonts: font box
// metrics present (spike b), the font assigned only on a key change, stretch through
// `ctx.fontStretch`, and a rejected font string re-assigned with the default families.
import { describe, expect, it } from 'vitest';
import type { Canvas2DLike, Logger } from '../../src/base';
import { CanvasTextMeasurer } from '../../src/text';
import { napiContext, napiFactory, registerBundledFonts } from './helpers';

describe('CanvasTextMeasurer', () => {
  registerBundledFonts();

  it('returns width and the font box of the bundled face', () => {
    const m = CanvasTextMeasurer.fromFactory(napiFactory);
    const r = m.measureLine('Hello', 'normal 400 20px "Noto Sans", sans-serif');
    expect(r.width).toBeGreaterThan(40);
    expect(r.ascent).toBeCloseTo(1.069 * 20, 3);
    expect(r.descent).toBeCloseTo(0.293 * 20, 3);
  });

  it('bold and italic select their own faces (different widths)', () => {
    const m = CanvasTextMeasurer.fromFactory(napiFactory);
    const reg = m.measureLine('Lekh diagram', 'normal 400 20px "Noto Sans", sans-serif').width;
    const bold = m.measureLine('Lekh diagram', 'normal 700 20px "Noto Sans", sans-serif').width;
    expect(bold).not.toBeCloseTo(reg, 1);
  });

  it('assigns ctx.font only when the key changes, and the stretch through fontStretch', () => {
    const ctx = napiContext();
    let sets = 0;
    const spy = new Proxy(ctx, {
      set(t, p, v) {
        if (p === 'font') sets++;
        return Reflect.set(t, p, v);
      },
      get(t, p) {
        const v = Reflect.get(t, p) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
      },
    });
    const m = new CanvasTextMeasurer(spy);
    const key = 'normal 400 15px "Noto Serif", serif';
    for (let i = 0; i < 10; i++) m.measureLine(`w${String(i)}`, key);
    expect(sets).toBe(1);
    m.measureLine('x', `${key}|condensed`);
    expect(sets).toBe(1); // same font string, only the stretch differs
    expect(ctx.fontStretch).toBe('condensed');
    m.measureLine('x', key);
    expect(ctx.fontStretch).toBe('normal');
    expect(m.calls).toBe(12);
  });

  it('a font string the context rejects is re-assigned with "Noto Sans", sans-serif and logged once', () => {
    const warns: string[] = [];
    const logger: Logger = {
      debug: () => undefined,
      info: () => undefined,
      warn: (m) => warns.push(m),
      error: () => undefined,
    };
    const fake = {
      font: '10px sans-serif',
      measureText: (t: string) => ({ width: t.length }),
    } as unknown as Canvas2DLike;
    let assigned = '10px sans-serif';
    Object.defineProperty(fake, 'font', {
      get: () => assigned,
      set: (v: string) => {
        if (!v.includes('bad')) assigned = v; // a browser ignores an invalid assignment
      },
    });
    const m = new CanvasTextMeasurer(fake, logger);
    m.measureLine('a', 'normal 400 15px bad family');
    expect(assigned).toBe('normal 400 15px "Noto Sans", sans-serif');
    m.measureLine('a', 'normal 400 15px "Other", sans-serif');
    m.measureLine('a', 'normal 400 15px bad family');
    expect(warns).toEqual(['font_rejected']);
  });

  it('@napi-rs/canvas throws on an invalid font: treated as a rejection', () => {
    const m = new CanvasTextMeasurer(napiContext());
    expect(m.measureLine('abc', 'bogus').width).toBeGreaterThan(0);
  });
});
