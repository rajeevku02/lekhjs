// AC-TXT-08: a `fontEpoch` change invalidates both the per-object memo and the shared LRU.
// AC-ENG-12: `LineWidthCache` (capacity 2,000) never exceeds its capacity and holds only strings
// and numbers.
import { describe, expect, it } from 'vitest';
import { Rect } from '../../src/geometry';
import { Style } from '../../src/style';
import { RecordedWidthMeasurer, createTestTextStack } from '../../src/testing';
import {
  FontRegistry,
  LINE_WIDTH_CACHE_CAPACITY,
  LineWidthCache,
  TextMeasureMemo,
  textStyleSnapshot,
  type FontLoader,
} from '../../src/text';
import { prng } from './helpers';

describe('LineWidthCache (AC-ENG-12)', () => {
  it('defaults to 2,000 entries', () => {
    expect(LINE_WIDTH_CACHE_CAPACITY).toBe(2000);
    expect(new LineWidthCache().capacity).toBe(2000);
  });

  it('never exceeds its capacity and holds only strings and numbers', () => {
    const c = new LineWidthCache();
    const rnd = prng(42);
    for (let i = 0; i < 10_000; i++) {
      const key = `normal 400 ${String(8 + Math.floor(rnd() * 40))}px "Noto Sans", sans-serif`;
      c.width(key, `line ${String(Math.floor(rnd() * 5000))}`, 0, () => rnd() * 100);
      expect(c.size).toBeLessThanOrEqual(2000);
    }
    expect(c.size).toBe(2000);
    for (const [k, v] of c.entries()) {
      expect(typeof k).toBe('string');
      expect(typeof v).toBe('number');
    }
  });

  it('keys by fontKey + U+0000 + line', () => {
    const c = new LineWidthCache(4);
    c.set('k', 'a', 0, 1);
    expect(c.entries()).toEqual([['k\u0000a', 1]]);
    expect(c.get('k', 'a', 0)).toBe(1);
    expect(c.get('k2', 'a', 0)).toBeUndefined();
  });
});

describe('fontEpoch invalidation (AC-TXT-08)', () => {
  it('a newer epoch makes every LRU entry a miss; a stale write is dropped', () => {
    const c = new LineWidthCache();
    c.set('k', 'a', 0, 1);
    c.set('k', 'b', 0, 2);
    expect(c.get('k', 'a', 1)).toBeUndefined();
    expect(c.size).toBe(0);
    c.set('k', 'a', 1, 3);
    c.set('k', 'z', 0, 9); // a measurement started before the epoch bump
    expect(c.get('k', 'a', 1)).toBe(3);
    expect(c.get('k', 'z', 1)).toBeUndefined();
    expect(c.epoch).toBe(1);
  });

  it('bumping the registry epoch re-measures through both the memo and the LRU', () => {
    const measurer = new RecordedWidthMeasurer(new Map(), 8);
    const stack = createTestTextStack({ measurer });
    const memo = new TextMeasureMemo();
    const style = new Style();
    const input = {
      text: 'alpha beta gamma',
      style: textStyleSnapshot(style, stack.resolver),
      box: new Rect(0, 0, 50, 50),
      wrapWidth: 50,
      angle: 0,
    };
    stack.layout.layout(input, memo);
    const firstKey = memo.key;
    const calls = measurer.calls;
    stack.layout.layout(input, memo);
    expect(measurer.calls).toBe(calls); // memo hit
    // A second element with the same text and style: no memo, but every line width is an LRU hit.
    stack.layout.layout(input, new TextMeasureMemo());
    const hits = stack.cache.hits;
    expect(hits).toBeGreaterThan(0);

    stack.registry.bumpEpoch();
    const before = measurer.calls;
    const missesBefore = stack.cache.misses;
    stack.layout.layout(input, memo);
    expect(memo.key).not.toBe(firstKey);
    expect(memo.key?.startsWith('1\u0000')).toBe(true);
    expect(measurer.calls).toBeGreaterThan(before);
    expect(stack.cache.misses).toBeGreaterThan(missesBefore);
    expect(stack.cache.epoch).toBe(1);
  });

  it('a FontLoader reporting new fonts bumps the epoch once and notifies every listener', () => {
    const reg = new FontRegistry();
    let fire: () => void = () => undefined;
    const loader: FontLoader = {
      ensureLoaded: () => Promise.resolve(),
      epoch: 0,
      onFontsChanged: (cb) => {
        fire = cb;
        return () => undefined;
      },
    };
    const seen: number[][] = [[], []];
    reg.onFontsChanged((e) => seen[0]?.push(e));
    const off = reg.onFontsChanged((e) => seen[1]?.push(e));
    reg.attachLoader(loader);
    fire();
    off();
    fire();
    expect(reg.fontEpoch).toBe(2);
    expect(seen).toEqual([[1, 2], [1]]);
  });
});
