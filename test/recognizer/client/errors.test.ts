// AC-REC-18 (unit half), AC-REC-38, AC-REC-39: worker crashes and init failures.
import { describe, expect, it } from 'vitest';
import { REC_PROTOCOL } from '../../../src/recognizer/worker';
import { FakePort, tagOf, tagged } from '../support/fakePort';
import { BUILD, rig } from './helpers';

describe('a worker crash (AC-REC-18)', () => {
  it('gives ink for the in-flight stroke, logs rec_crash, respawns, and recognises the next stroke', async () => {
    const r = rig(() => ({ latencyMs: 50 }));
    const port = new FakePort('s1', () => r.sched.now());
    await r.tick(100);
    r.client.armTest({ crash: true });
    r.client.submit(port, tagged(1));
    r.client.submit(port, tagged(2));
    await r.tick(10);
    expect(port.settled()[0]?.kind).toBe('ink');
    expect(tagOf(port.settled()[0]?.stroke ?? tagged(-1))).toBe(1);
    expect(r.logs.some((l) => l.m === 'rec_crash')).toBe(true);
    expect(r.workers[0]?.terminated).toBe(true);
    await r.tick(200);
    expect(port.settled().map((s) => [s.kind, tagOf(s.stroke)])).toEqual([
      ['ink', 1],
      ['apply', 2],
    ]);
    expect(r.workers).toHaveLength(2);
  });

  it('a job-level rec_internal is ink for that stroke without a respawn', async () => {
    const r = rig();
    const port = new FakePort();
    await r.tick(10);
    r.client.submit(port, tagged(1));
    // the worker answers with an error for that job
    const w = r.workers[0];
    w?.onmessage?.({ data: { type: 'error', jobId: 1, code: 'rec_internal', message: 'RecInternalError' } });
    expect(port.settled().map((s) => s.kind)).toEqual(['ink']);
    expect(r.workers).toHaveLength(1);
    await r.tick(10);
    r.client.submit(port, tagged(2));
    await r.tick(10);
    expect(port.settled().map((s) => s.kind)).toEqual(['ink', 'apply']);
  });
});

describe('init failures (AC-REC-38, AC-REC-39)', () => {
  it('a ready with another protocol version: no respawn, ink-only at once, one log line', async () => {
    const r = rig(() => ({ ready: (m) => ({ ...m, protocol: REC_PROTOCOL + 1 }) }));
    const port = new FakePort();
    r.client.submit(port, tagged(1));
    await r.tick(10);
    expect(r.client.inkOnly).toBe(true);
    expect(r.workers).toHaveLength(1);
    expect(r.workers[0]?.terminated).toBe(true);
    expect(port.settled().map((s) => s.kind)).toEqual(['ink']);
    r.client.submit(port, tagged(2));
    expect(port.settled().map((s) => s.kind)).toEqual(['ink', 'ink']);
    await r.tick(60_000);
    expect(r.workers).toHaveLength(1);
    expect(r.logs.filter((l) => l.m === 'rec_disabled')).toHaveLength(1);
  });

  it('a ready with another build id is rec_protocol too', async () => {
    const r = rig(() => ({ ready: (m) => ({ ...m, buildId: `${BUILD}-other` }) }));
    await r.tick(10);
    expect(r.client.inkOnly).toBe(true);
    expect(r.workers).toHaveLength(1);
  });

  it('an init-time rec_init is respawned (counted), then recognition works', async () => {
    const r = rig((i) => ({ failCatalog: i === 0 }));
    const port = new FakePort();
    r.client.submit(port, tagged(1));
    await r.tick(10);
    expect(r.workers).toHaveLength(2);
    expect(r.events.filter((e) => e.kind === 'restart')).toHaveLength(1);
    await r.tick(10);
    expect(port.settled().map((s) => s.kind)).toEqual(['apply']);
    expect(r.client.inkOnly).toBe(false);
  });

  it('no ready within 5 s: terminate at 5 s, queued strokes become ink, a new worker is spawned', async () => {
    const r = rig((i) => ({ behaviour: i === 0 ? 'silent' : 'host' }));
    const port = new FakePort('s1', () => r.sched.now());
    r.client.submit(port, tagged(1));
    r.client.submit(port, tagged(2));
    await r.tick(4990);
    expect(r.workers[0]?.terminated).toBe(false);
    expect(port.settled()).toHaveLength(0);
    await r.tick(20);
    expect(r.workers[0]?.terminated).toBe(true);
    expect(port.settled().map((s) => [s.kind, tagOf(s.stroke)])).toEqual([
      ['ink', 1],
      ['ink', 2],
    ]);
    expect(r.workers).toHaveLength(2);
    await r.tick(10);
    r.client.submit(port, tagged(3));
    await r.tick(10);
    expect(port.settled().at(-1)?.kind).toBe('apply');
  });
});
