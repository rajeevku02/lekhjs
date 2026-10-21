// The client's test gate (`gateNext` / `releaseGate`, behind `__lekhTest.recognizer`): the e2e
// half of AC-REC-19 holds A's job open with it until B's frames have arrived, instead of racing a
// fixed worker spin against them (round REC19). While the gate is closed the worker's answer is
// withheld and no watchdog runs; releasing applies the answer at once, or arms a fresh watchdog
// for a job not answered yet. Strokes not armed are untouched.
import { describe, expect, it } from 'vitest';
import { FakePort, tagOf, tagged } from '../support/fakePort';
import { rig } from './helpers';

describe('RecognitionClient test gate', () => {
  it('withholds the answer (and the hold) past the watchdog until released', async () => {
    const r = rig(() => ({ latencyMs: 20 }));
    const port = new FakePort('s1', () => r.sched.now());
    await r.tick(10);
    r.client.gateNext();
    r.client.submit(port, tagged(1));
    r.client.submit(port, tagged(2)); // queued behind the gated job, not gated
    await r.tick(5000);
    expect(port.settled()).toHaveLength(0);
    expect(port.holds).toBe(1);
    expect(r.events.some((e) => e.kind === 'watchdog')).toBe(false);
    expect(r.workers).toHaveLength(1);

    expect(r.client.releaseGate()).toBe(true);
    // The withheld answer is applied at release, then the hold ends and the next job runs.
    expect(port.settled().map((c) => tagOf(c.stroke))).toEqual([1]);
    expect(port.settled()[0]?.kind).toBe('apply');
    await r.tick(100);
    expect(port.settled().map((c) => tagOf(c.stroke))).toEqual([1, 2]);
    expect(port.holds).toBe(0);
    expect(r.client.releaseGate()).toBe(false);
  });

  it('a gated job released before its answer gets a fresh watchdog', async () => {
    const r = rig();
    const port = new FakePort('s1', () => r.sched.now());
    await r.tick(10);
    r.client.gateNext();
    r.client.armTest({ spinMs: 10_000 });
    r.client.submit(port, tagged(1));
    await r.tick(3000);
    expect(r.client.releaseGate()).toBe(true);
    await r.tick(1490);
    expect(port.settled()).toHaveLength(0);
    await r.tick(20);
    expect(port.settled()[0]?.kind).toBe('ink');
    expect(r.events.filter((e) => e.kind === 'watchdog')).toHaveLength(1);
  });

  it('a crash still ends a gated job as ink', async () => {
    const r = rig();
    const port = new FakePort('s1', () => r.sched.now());
    await r.tick(10);
    r.client.gateNext();
    r.client.armTest({ crash: true });
    r.client.submit(port, tagged(1));
    await r.tick(50);
    expect(port.settled()[0]?.kind).toBe('ink');
    expect(port.holds).toBe(0);
  });
});
