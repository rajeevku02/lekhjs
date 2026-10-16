// Remote pointers (C++ `CursorTracker`, data half): colours from the user id, trails cut to the
// last point after 300 ms, users dropped after 5 s, timers through the Scheduler and cancelled by
// dispose().
import { describe, expect, it } from 'vitest';
import { Point } from '../../src/geometry';
import { PRESENCE_COLORS, PresenceTracker, colorIndexOf, trailRadius } from '../../src/sync';
import { LEKH_COLORS } from '../../src/style';
import { ManualClock, ManualScheduler } from './helpers';

describe('PresenceTracker', () => {
  it('the palette is getColors() without white and black, 21 entries', () => {
    expect(PRESENCE_COLORS).toHaveLength(21);
    expect(PRESENCE_COLORS[0]).toBe(LEKH_COLORS[2]);
  });

  it('colour index: std::stol(uid) % 21, 0 for a non-numeric id', () => {
    expect(colorIndexOf('42')).toBe(0);
    expect(colorIndexOf('43')).toBe(1);
    expect(colorIndexOf('  7abc')).toBe(7);
    expect(colorIndexOf('abc')).toBe(0);
    expect(colorIndexOf('99999999999999999999999')).toBe(0);
    // A negative id wraps as an unsigned 64-bit value, as `long % size_t` did.
    expect(colorIndexOf('-1')).toBe(Number(BigInt.asUintN(64, -1n) % 21n));
  });

  it('trails shrink after 300 ms and users go after 5 s', () => {
    const clock = new ManualClock();
    const scheduler = new ManualScheduler(clock);
    let changes = 0;
    const t = new PresenceTracker({ clock, scheduler, onChange: () => changes++ });
    t.updatePointer('5', [new Point(1, 1), new Point(2, 2), new Point(3, 3)]);
    expect(t.pointers().get('5')?.points).toHaveLength(3);
    scheduler.advance(301);
    scheduler.advance(300);
    expect(t.pointers().get('5')?.points).toEqual([new Point(3, 3)]);
    scheduler.advance(5000);
    expect(t.hasPoints()).toBe(false);
    expect(changes).toBeGreaterThan(1);
  });

  it('dispose cancels the timer', () => {
    const clock = new ManualClock();
    const scheduler = new ManualScheduler(clock);
    const t = new PresenceTracker({ clock, scheduler });
    t.updatePointer('1', [new Point(0, 0)]);
    expect(scheduler.timers.size).toBe(1);
    t.dispose();
    expect(scheduler.timers.size).toBe(0);
  });

  it('trail radii (C++ drawPoints)', () => {
    expect([0, 1, 5, 10, 11].map(trailRadius)).toEqual([10, 9, 7, 4, 3]);
  });
});
