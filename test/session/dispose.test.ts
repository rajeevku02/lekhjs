// dispose(): AC-ENG-26, E-35.
import { describe, expect, it } from 'vitest';
import { fakeImage } from '../../src/testing';
import { DOCID, harness } from './helpers';

describe('dispose', () => {
  it('AC-ENG-26: cancels every timer and closes every cached image once; a second dispose is a no-op', () => {
    const h = harness({ cloud: true });
    const imgs = [fakeImage(), fakeImage(), fakeImage()];
    imgs.forEach((image, i) => {
      h.dispatch({ type: 'imageLoaded', url: `https://img/${String(i)}.png`, image });
    });
    // A remote pointer arms the presence tracker's expiry timers.
    h.transport.deliver(
      JSON.stringify({
        version: 0,
        docid: DOCID,
        type: 'update',
        user: { id: '5', name: 'x' },
        updates: { type: 'trackpointer', changes: {}, pointer: [{ x: 1, y: 2 }] },
      }),
    );
    h.session.setTimer('a', 100, () => undefined);
    h.session.setTimer('b', 200, () => undefined);
    expect(h.scheduler.pendingTimers).toBeGreaterThanOrEqual(3);
    h.session.dispose();
    expect(h.scheduler.pendingTimers).toBe(0);
    expect(h.scheduler.pendingFrames).toBe(0);
    expect(imgs.map((i) => i.closed)).toEqual([1, 1, 1]);
    h.session.dispose();
    expect(imgs.map((i) => i.closed)).toEqual([1, 1, 1]);
  });

  it('a session timer fires as a timer event', () => {
    const h = harness();
    const fired: number[] = [];
    h.session.setTimer('t', 50, () => fired.push(h.scheduler.now()));
    h.scheduler.advance(49);
    expect(fired).toEqual([]);
    h.scheduler.advance(1);
    expect(fired).toHaveLength(1);
    expect(h.session.pendingTimers).toBe(0);
  });
});
