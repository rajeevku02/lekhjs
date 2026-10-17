// AC-REC-16 (unit half): strokes submitted while a job is in flight are recognised after it, in
// submission order, and none is lost. A fake worker (a real WorkerHost with the stub) answers
// each job after 300 ms; 20 strokes are submitted at once.
import { describe, expect, it } from 'vitest';
import { FakePort, tagOf, tagged } from '../support/fakePort';
import { rig } from './helpers';

describe('RecognitionClient queue (AC-REC-16)', () => {
  it('runs 20 queued strokes one at a time, in submission order, losing none', async () => {
    const r = rig(() => ({ latencyMs: 300 }));
    const port = new FakePort('s1', () => r.sched.now());
    await r.tick(400); // ready (answers come after 300 ms)
    for (let i = 0; i < 20; i++) r.client.submit(port, tagged(i * 1000));
    expect(r.client.busy).toBe(true);
    await r.tick(20 * 300 + 500);
    const settled = port.settled();
    expect(settled).toHaveLength(20);
    expect(settled.map((s) => tagOf(s.stroke))).toEqual(Array.from({ length: 20 }, (_, i) => i * 1000));
    // Each answer was the worker's result (the stub's one `ink` mutation), not the client's fallback.
    expect(settled.every((s) => s.kind === 'apply')).toBe(true);
    for (const s of settled) {
      if (s.kind === 'apply') expect(s.mutations.map((m) => m.op)).toEqual(['ink']);
    }
    // One job in flight at a time: job ids increase, and each hold is released before the next.
    const jobs = r.workers[0]?.jobs ?? [];
    expect(jobs.map((j) => j.jobId)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    let depth = 0;
    for (const c of port.calls) {
      if (c.kind === 'hold') depth++;
      if (c.kind === 'release') depth--;
      expect(depth === 0 || depth === 1).toBe(true);
    }
    expect(port.holds).toBe(0);
    expect(r.client.busy).toBe(false);
    expect(r.workers).toHaveLength(1);
  });

  it('builds each snapshot when the job is dispatched, not when the stroke is submitted', async () => {
    const r = rig(() => ({ latencyMs: 300 }));
    const port = new FakePort('s1', () => r.sched.now());
    await r.tick(400); // ready (answers come after 300 ms)
    r.client.submit(port, tagged(1));
    r.client.submit(port, tagged(2));
    const snaps = (): number[] => port.calls.filter((c) => c.kind === 'snapshot').map((c) => c.at);
    expect(snaps()).toHaveLength(1);
    await r.tick(400);
    expect(snaps()).toHaveLength(2);
    expect((snaps()[1] ?? 0) - (snaps()[0] ?? 0)).toBeGreaterThanOrEqual(300);
  });

  it('queues strokes submitted before the worker is ready and runs them once it is', async () => {
    const r = rig(() => ({ latencyMs: 10 }));
    const port = new FakePort();
    r.client.submit(port, tagged(1));
    r.client.submit(port, tagged(2));
    expect(port.settled()).toHaveLength(0);
    await r.tick(200);
    expect(port.settled().map((s) => [s.kind, tagOf(s.stroke)])).toEqual([
      ['apply', 1],
      ['apply', 2],
    ]);
  });

  it('transfers the stroke and sends a full config copy with each job', async () => {
    const r = rig();
    const port = new FakePort();
    await r.tick();
    const s = tagged(5);
    r.client.submit(port, s);
    await r.tick(10);
    const job = r.workers[0]?.jobs[0];
    expect(job?.sessionId).toBe('s1');
    expect(Array.from(job?.stroke ?? [])).toEqual(Array.from(s.points));
    expect(job?.config.cxPolyMaxPolys).toBe(3000);
    expect(s.points.length).toBeGreaterThan(0); // the client transfers a copy, the stroke stays usable for ink
  });
});
