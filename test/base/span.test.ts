import { describe, expect, it } from 'vitest';
import { Span } from '../../src/base';

describe('Span (C++ Coll)', () => {
  const a = [10, 11, 12, 13, 14];

  it('is an inclusive range', () => {
    const s = new Span(a, 1, 3);
    expect(s.size).toBe(3);
    expect(s.at(0)).toBe(11);
    expect(s.first()).toBe(11);
    expect(s.last()).toBe(13);
    expect(s.toArray()).toEqual([11, 12, 13]);
    expect(Span.of(a).size).toBe(5);
  });

  it('defaults to empty (start 1, end 0)', () => {
    const s = new Span(a);
    expect(s.empty).toBe(true);
    expect(s.size).toBe(0);
    expect(s.toArray()).toEqual([]);
    expect(Span.of([]).size).toBe(0);
  });

  it('slice is relative and clamped to the end', () => {
    const s = new Span(a, 1, 3);
    const t = s.slice(1, 10);
    expect([t.startIndex, t.endIndex]).toEqual([2, 3]);
    const u = s.slice(5, 6);
    expect([u.startIndex, u.endIndex]).toEqual([3, 3]);
  });

  it('at throws outside the array, like vector::at', () => {
    const s = new Span(a, 3, 4);
    expect(s.at(1)).toBe(14);
    expect(() => s.at(2)).toThrow(RangeError);
  });

  it('start and end can be moved', () => {
    const s = Span.of(a);
    s.setStartIndex(2);
    s.setEndIndex(2);
    expect(s.toArray()).toEqual([12]);
  });
});
