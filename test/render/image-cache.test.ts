// ImageCache (spec 03 §7): per-entry TTL after the last paint use, one sweep timer, B11 (a
// re-added entry is never evicted by an older timer), ref-counted pins, the C++ failure cap,
// close on eviction/replacement/dispose and timers cancelled by dispose (AC-ENG-26).
import { describe, expect, it } from 'vitest';
import { IMAGE_TTL_MS, ImageCache, type DecodedImage } from '../../src/render';
import { ManualTime } from './helpers';

function img(name: string, closed: string[]): DecodedImage {
  return { width: 1, height: 1, source: name, close: () => closed.push(name) };
}

function setup() {
  const time = new ManualTime();
  const cache = new ImageCache({ clock: time.clock, scheduler: time });
  const closed: string[] = [];
  return { time, cache, closed };
}

describe('ImageCache', () => {
  it('evicts 60 s after the last paint use, and closes the image', () => {
    const { time, cache, closed } = setup();
    cache.put('a', img('A', closed));
    time.advance(40_000);
    expect(cache.get('a')?.source).toBe('A'); // a paint use at t=40 s
    time.advance(59_000);
    expect(cache.has('a')).toBe(true);
    time.advance(1_000);
    expect(cache.has('a')).toBe(false);
    expect(closed).toEqual(['A']);
    expect(time.timers.size).toBe(0);
    expect(IMAGE_TTL_MS).toBe(60_000);
  });

  it('peek does not extend the TTL', () => {
    const { time, cache } = setup();
    cache.put('a', img('A', []));
    time.advance(50_000);
    cache.peek('a');
    time.advance(10_000);
    expect(cache.has('a')).toBe(false);
  });

  it('B11: re-adding an entry is not evicted by the earlier timer', () => {
    const { time, cache, closed } = setup();
    cache.put('a', img('A1', closed));
    time.advance(30_000);
    cache.put('a', img('A2', closed)); // replaced: A1 closed
    expect(closed).toEqual(['A1']);
    time.advance(30_000); // the first entry's expiry
    expect(cache.peek('a')?.source).toBe('A2');
    time.advance(30_000);
    expect(cache.has('a')).toBe(false);
    expect(closed).toEqual(['A1', 'A2']);
  });

  it('re-putting the same image does not close it', () => {
    const { cache, closed } = setup();
    const a = img('A', closed);
    cache.put('a', a);
    cache.put('a', a);
    expect(closed).toEqual([]);
  });

  it('keeps one timer for many entries', () => {
    const { time, cache } = setup();
    for (let i = 0; i < 50; i++) {
      cache.put(`u${String(i)}`, img(String(i), []));
      time.advance(100);
    }
    expect(time.timers.size).toBe(1);
    time.advance(IMAGE_TTL_MS);
    expect(cache.size).toBe(0);
  });

  it('pins are ref-counted; unpin is idempotent and restarts the TTL', () => {
    const { time, cache } = setup();
    cache.put('a', img('A', []));
    const u1 = cache.pin(['a']);
    const u2 = cache.pin(['a', 'a']);
    time.advance(5 * IMAGE_TTL_MS);
    expect(cache.has('a')).toBe(true);
    u1();
    u1();
    expect(cache.isPinned('a')).toBe(true);
    time.advance(IMAGE_TTL_MS);
    expect(cache.has('a')).toBe(true);
    u2();
    expect(cache.isPinned('a')).toBe(false);
    time.advance(IMAGE_TTL_MS - 1);
    expect(cache.has('a')).toBe(true);
    time.advance(1);
    expect(cache.has('a')).toBe(false);
  });

  it('a pin taken before the image arrives holds when it does', () => {
    const { time, cache } = setup();
    const unpin = cache.pin(['late']);
    expect(cache.isPinned('late')).toBe(true);
    cache.put('late', img('L', []));
    time.advance(3 * IMAGE_TTL_MS);
    expect(cache.has('late')).toBe(true);
    unpin();
    time.advance(IMAGE_TTL_MS);
    expect(cache.has('late')).toBe(false);
  });

  it('missing: distinct, not loaded, not pending, not given up after more than 3 failures', () => {
    const { cache } = setup();
    cache.put('loaded', img('L', []));
    cache.markPending(['pending']);
    expect(cache.missing(['x', 'loaded', 'pending', 'x', 'y'])).toEqual(['x', 'y']);
    expect(cache.state('pending')).toBe('pending');
    for (let i = 1; i <= 3; i++) {
      cache.markPending(['bad']);
      cache.fail('bad', 'http');
      expect(cache.missing(['bad'])).toEqual(['bad']);
    }
    cache.fail('bad', 'decode');
    expect(cache.missing(['bad'])).toEqual([]);
    expect(cache.failure('bad')).toEqual({ count: 4, reason: 'decode' });
    expect(cache.state('bad')).toBe('failed');
    cache.put('bad', img('B', []));
    expect(cache.state('bad')).toBe('loaded');
    expect(cache.failure('bad')).toBeUndefined();
    expect(cache.state('nothing')).toBe('absent');
  });

  it('dispose closes every image, cancels the timer, and refuses later arrivals', () => {
    const { time, cache, closed } = setup();
    cache.put('a', img('A', closed));
    cache.put('b', img('B', closed));
    cache.pin(['b']);
    expect(time.timers.size).toBe(1);
    cache.dispose();
    cache.dispose();
    expect(closed.sort()).toEqual(['A', 'B']);
    expect(time.timers.size).toBe(0);
    cache.put('c', img('C', closed));
    expect(cache.has('c')).toBe(false);
    expect(closed).toContain('C');
  });

  it('images without close() are fine', () => {
    const { time, cache } = setup();
    cache.put('a', { width: 1, height: 1, source: null });
    time.advance(IMAGE_TTL_MS);
    expect(cache.size).toBe(0);
  });
});
