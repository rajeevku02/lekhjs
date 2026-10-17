// AC-REC-41 (unit half): closing a board drains its queued strokes, capped at 3 s: with a stalled
// worker the in-flight job is abandoned at the cap and every remaining stroke is stored as ink.
import { describe, expect, it } from 'vitest';
import { FakePort, tagOf, tagged } from '../support/fakePort';
import { rig } from './helpers';

describe('session close drains its strokes (AC-REC-41)', () => {
  it('with a stalled worker: closes within 3 s with the three strokes stored as ink', async () => {
    const r = rig((i) => ({ behaviour: i === 0 ? 'ready-only' : 'silent' }));
    const port = new FakePort('s1', () => r.sched.now());
    await r.tick(10);
    for (let i = 1; i <= 3; i++) r.client.submit(port, tagged(i));
    const t0 = r.sched.now();
    let closedAt = -1;
    void r.client.drain('s1').then(() => {
      closedAt = r.sched.now();
    });
    await r.tick(3100);
    expect(closedAt).toBeGreaterThanOrEqual(0);
    expect(closedAt - t0).toBeLessThanOrEqual(3000);
    expect(port.settled().map((s) => [s.kind, tagOf(s.stroke)])).toEqual([
      ['ink', 1],
      ['ink', 2],
      ['ink', 3],
    ]);
    expect(port.holds).toBe(0);
    expect(r.client.busy).toBe(false);
  });

  it('with a healthy worker: the queued strokes are recognised normally before it resolves', async () => {
    const r = rig(() => ({ latencyMs: 200 }));
    const port = new FakePort('s1', () => r.sched.now());
    await r.tick(300);
    for (let i = 1; i <= 3; i++) r.client.submit(port, tagged(i));
    let closed = false;
    void r.client.drain('s1').then(() => {
      closed = true;
    });
    await r.tick(500);
    expect(closed).toBe(false);
    await r.tick(200);
    expect(closed).toBe(true);
    expect(port.settled().map((s) => s.kind)).toEqual(['apply', 'apply', 'apply']);
  });

  it('only drains its own session', async () => {
    const r = rig(() => ({ latencyMs: 100 }));
    const a = new FakePort('a', () => r.sched.now());
    const b = new FakePort('b', () => r.sched.now());
    await r.tick(200);
    r.client.submit(b, tagged(1));
    r.client.submit(a, tagged(2));
    let closed = false;
    void r.client.drain('a').then(() => {
      closed = true;
    });
    await r.tick(150);
    expect(closed).toBe(false);
    await r.tick(100);
    expect(closed).toBe(true);
    expect(b.settled().map((s) => s.kind)).toEqual(['apply']);
  });

  it('resolves at once with nothing queued', async () => {
    const r = rig();
    await expect(r.client.drain('nobody')).resolves.toBeUndefined();
  });
});
