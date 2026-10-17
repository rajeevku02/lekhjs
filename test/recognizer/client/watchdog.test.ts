// AC-REC-17 (unit half) and AC-REC-40: the 1,500 ms watchdog. A job past it becomes ink for its
// stroke (the raw captured points) within watchdog + 100 ms, the worker is replaced and the next
// queued stroke is recognised; a late result for the terminated job is ignored. The watchdog
// counts visible time only: hidden for 10 s with a job in flight, then a fresh 1,500 ms.
import { describe, expect, it } from 'vitest';
import { FakePort, tagOf, tagged } from '../support/fakePort';
import { rig } from './helpers';

describe('RecognitionClient watchdog (AC-REC-17)', () => {
  it('turns a job past 1,500 ms into ink at 1,500 ms, respawns, and recognises the next stroke', async () => {
    const r = rig();
    const port = new FakePort('s1', () => r.sched.now());
    await r.tick(10);
    r.client.armTest({ spinMs: 5000 });
    const a = tagged(1);
    r.client.submit(port, a);
    const t0 = r.sched.now();
    r.client.submit(port, tagged(2));
    await r.tick(1490);
    expect(port.settled()).toHaveLength(0);
    await r.tick(20);
    const first = port.settled()[0];
    expect(first?.kind).toBe('ink');
    expect(first?.stroke).toBe(a); // the raw captured points
    expect((first?.at ?? 0) - t0).toBeLessThanOrEqual(1600);
    expect(r.workers[0]?.terminated).toBe(true);
    expect(r.workers).toHaveLength(2);
    expect(r.logs.some((l) => l.m === 'rec_timeout')).toBe(true);
    expect(r.events.some((e) => e.kind === 'watchdog')).toBe(true);
    await r.tick(100);
    const second = port.settled()[1];
    expect(second?.kind).toBe('apply');
    expect(tagOf(second?.stroke ?? tagged(-1))).toBe(2);
    // The spun job's answer never arrives (its worker is gone) and nothing else is settled.
    await r.tick(6000);
    expect(port.settled()).toHaveLength(2);
    expect(port.holds).toBe(0);
  });

  it('does nothing at 1,499 ms', async () => {
    const r = rig();
    const port = new FakePort();
    await r.tick(10);
    r.client.armTest({ spinMs: 5000 });
    r.client.submit(port, tagged(1));
    await r.tick(1449);
    expect(port.settled()).toHaveLength(0);
    expect(r.workers[0]?.terminated).toBe(false);
  });
});

describe('the watchdog counts visible time only (AC-REC-40)', () => {
  it('a job in flight while hidden for 10 s is not turned into ink, and gets a fresh 1,500 ms on return', async () => {
    const r = rig();
    const port = new FakePort('s1', () => r.sched.now());
    await r.tick(10);
    r.client.armTest({ spinMs: 11_000 });
    r.client.submit(port, tagged(1));
    await r.tick(500);
    r.client.setHidden(true);
    await r.tick(10_000);
    expect(port.settled()).toHaveLength(0);
    r.client.setHidden(false);
    // the result arrives 500 ms after return (11 s after dispatch): applied, no ink
    await r.tick(600);
    expect(port.settled().map((s) => s.kind)).toEqual(['apply']);
    expect(r.workers).toHaveLength(1);
  });

  it('fires only 1,500 ms after the page is visible again when the job is still busy', async () => {
    const r = rig();
    const port = new FakePort('s1', () => r.sched.now());
    await r.tick(10);
    r.client.armTest({ spinMs: 60_000 });
    r.client.submit(port, tagged(1));
    await r.tick(1000);
    r.client.setHidden(true);
    await r.tick(10_000);
    r.client.setHidden(false);
    const back = r.sched.now();
    await r.tick(1450);
    expect(port.settled()).toHaveLength(0);
    await r.tick(100);
    const ink = port.settled()[0];
    expect(ink?.kind).toBe('ink');
    expect((ink?.at ?? 0) - back).toBeGreaterThanOrEqual(1500);
    expect((ink?.at ?? 0) - back).toBeLessThanOrEqual(1600);
  });
});
