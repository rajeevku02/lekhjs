// AC-REC-36: the restart limit counts respawns (crashes, watchdog terminations, init timeouts):
// three in 60 s are performed; the failure that would need a fourth inside the window is not
// respawned and the page goes ink-only, with one `rec_disabled` log line. Spaced failures keep
// respawning.
import { describe, expect, it } from 'vitest';
import { FakePort, tagged } from '../support/fakePort';
import { rig } from './helpers';

async function crashAt(r: ReturnType<typeof rig>, port: FakePort, at: number): Promise<void> {
  await r.tick(at - r.sched.now());
  r.client.armTest({ crash: true });
  r.client.submit(port, tagged(at));
  await r.tick(5);
}

async function watchdogAt(r: ReturnType<typeof rig>, port: FakePort, at: number): Promise<void> {
  await r.tick(at - r.sched.now());
  r.client.armTest({ spinMs: 10_000 });
  r.client.submit(port, tagged(at));
  await r.tick(1600);
}

describe('restart limit (AC-REC-36)', () => {
  it('failures at 0, 10, 20 and 30 s: three respawns, the fourth goes ink-only', async () => {
    const r = rig();
    const port = new FakePort();
    await r.tick(5);
    await crashAt(r, port, 10);
    await watchdogAt(r, port, 10_000);
    await crashAt(r, port, 20_000);
    expect(r.workers).toHaveLength(4);
    expect(r.client.inkOnly).toBe(false);
    await watchdogAt(r, port, 30_000);
    expect(r.workers).toHaveLength(4);
    expect(r.client.inkOnly).toBe(true);
    await r.tick(31_000 - r.sched.now());
    r.client.submit(port, tagged(31_000));
    expect(port.settled().at(-1)?.kind).toBe('ink');
    expect(r.logs.filter((l) => l.m === 'rec_disabled')).toHaveLength(1);
    expect(r.events.filter((e) => e.kind === 'restart')).toHaveLength(3);
  });

  it('failures 25 s apart keep respawning', async () => {
    const r = rig();
    const port = new FakePort();
    await r.tick(5);
    for (let i = 0; i < 6; i++) await crashAt(r, port, 10 + i * 25_000);
    expect(r.client.inkOnly).toBe(false);
    expect(r.workers).toHaveLength(7);
    await r.tick(10);
    r.client.submit(port, tagged(1));
    await r.tick(10);
    expect(port.settled().at(-1)?.kind).toBe('apply');
  });

  it('init timeouts count as respawns', async () => {
    const r = rig(() => ({ behaviour: 'silent' }));
    await r.tick(5_000 * 4 + 100);
    expect(r.workers).toHaveLength(4);
    expect(r.client.inkOnly).toBe(true);
  });
});
