// AC-REC-30's instrument (spec 07 §7.6: main-thread cost per stroke = snapshot build + post +
// apply): after each answered job the client reports a `cost` event with the main-thread time
// of its dispatch and of its apply, measured with the client's clock. The e2e perf run
// (e2e/perf/recognizer-mainthread.spec.js) reads these events through __lekhTest.
import { describe, expect, it } from 'vitest';
import type { CapturedStroke } from '../../../src/recognizer/client';
import type { RecMutation, SceneSnapshot } from '../../../src/recognizer/worker';
import { FakePort, tagged } from '../support/fakePort';
import { rig } from './helpers';

/** A port whose snapshot build costs 3 ms and whose apply costs 1.5 ms of client-clock time. */
class CostlyPort extends FakePort {
  private readonly spend: (ms: number) => void;
  constructor(spend: (ms: number) => void) {
    super('s1');
    this.spend = spend;
  }
  override buildSnapshot(stroke: CapturedStroke): SceneSnapshot {
    this.spend(3);
    return super.buildSnapshot(stroke);
  }
  override apply(mutations: readonly RecMutation[], stroke: CapturedStroke): void {
    this.spend(1.5);
    super.apply(mutations, stroke);
  }
  override applyInk(stroke: CapturedStroke): void {
    this.spend(1.5);
    super.applyInk(stroke);
  }
}

describe('RecognitionClient main-thread cost events (AC-REC-30 instrument)', () => {
  it('reports dispatch (snapshot + post) and apply time per answered job, after the apply', async () => {
    let extra = 0;
    const spend = (ms: number): void => {
      extra += ms;
    };
    let now = (): number => 0;
    const r = rig(() => ({ latencyMs: 100 }), { clock: { now: () => now() + extra } });
    now = () => r.sched.now();
    const port = new CostlyPort(spend);
    await r.tick(200);
    r.client.submit(port, tagged(0));
    r.client.submit(port, tagged(1000));
    await r.tick(1000);
    const costs = r.events.filter((e) => e.kind === 'cost');
    expect(costs.map((c) => c.jobId)).toEqual([1, 2]);
    for (const c of costs) {
      expect(c.dispatchMs).toBe(3);
      expect(c.applyMs).toBe(1.5);
    }
    // The cost event follows its job's result event.
    const kinds = r.events.filter((e) => e.jobId === 1).map((e) => e.kind);
    expect(kinds).toEqual(['result', 'cost']);
  });

  it('reports a job the worker answered with an error (ink) too', async () => {
    const r = rig();
    const port = new FakePort('s1');
    await r.tick(10);
    r.client.submit(port, tagged(0));
    r.workers[0]?.onmessage?.({ data: { type: 'error', jobId: 1, code: 'rec_internal', message: 'RecInternalError' } });
    const kinds = r.events.filter((e) => e.jobId === 1).map((e) => e.kind);
    expect(kinds).toEqual(['ink', 'cost']);
  });
});
