import { describe, expect, it } from 'vitest';
import { Lru } from '../../src/base';

describe('Lru', () => {
  it('evicts the least recently used entry and never exceeds its capacity', () => {
    const l = new Lru<string, number>(3);
    l.set('a', 1);
    l.set('b', 2);
    l.set('c', 3);
    expect(l.get('a')).toBe(1); // a is now the most recent
    l.set('d', 4);
    expect(l.has('b')).toBe(false);
    expect(l.keys()).toEqual(['c', 'a', 'd']);
    for (let i = 0; i < 100; i++) {
      l.set(`k${String(i)}`, i);
      expect(l.size).toBeLessThanOrEqual(3);
    }
  });

  it('peek and has do not refresh recency; set of an existing key does', () => {
    const l = new Lru<string, number>(2);
    l.set('a', 1);
    l.set('b', 2);
    expect(l.peek('a')).toBe(1);
    expect(l.has('a')).toBe(true);
    l.set('c', 3);
    expect(l.has('a')).toBe(false);
    l.set('b', 20);
    l.set('d', 4);
    expect(l.keys()).toEqual(['b', 'd']);
    expect(l.get('b')).toBe(20);
  });

  it('get of a missing key is undefined; undefined values are held', () => {
    const l = new Lru<string, number | undefined>(2);
    expect(l.get('x')).toBeUndefined();
    l.set('u', undefined);
    expect(l.has('u')).toBe(true);
  });

  it('delete, clear and setCapacity', () => {
    const l = new Lru<number, string>(4);
    for (let i = 0; i < 4; i++) l.set(i, String(i));
    expect(l.delete(0)).toBe(true);
    expect(l.delete(0)).toBe(false);
    l.setCapacity(1);
    expect(l.keys()).toEqual([3]);
    expect(l.capacity).toBe(1);
    l.clear();
    expect(l.size).toBe(0);
  });

  it('rejects a non-positive or fractional capacity', () => {
    expect(() => new Lru(0)).toThrow(RangeError);
    expect(() => new Lru(1.5)).toThrow(RangeError);
    expect(() => new Lru(Number.NaN)).toThrow(RangeError);
  });
});
