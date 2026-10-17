// A fake `WorkerLike` for the client suites, on a `FakeScheduler`: messages each way are delivered
// by timers (structured-cloned, as `postMessage` does), so a test drives time explicitly.
//
// Behaviours:
//  - 'host': a real `WorkerHost` on the far side (the stub or a test line aggregator). A job's
//    answer is delayed by `latencyMs` plus its `spinMs` test hook (the fake turns the hook into
//    time on the fake clock instead of a busy-wait); a `crash` hook throws at the top level, which
//    the fake reports through `onerror` as a browser does;
//  - 'silent': never answers anything (a stalled or never-ready worker);
//  - 'ready-only': answers `init`, then never answers a job (a job stuck past the watchdog).
import type { MessageEventLike, WorkerLike } from '../../../src/base';
import { stubLineAggregatorModule, type LineAggregatorModule } from '../../../src/recognizer/lines';
import {
  WorkerHost,
  type InitMsg,
  type JobMsg,
  type ReadyMsg,
  type RecRequest,
  type RecResponse,
} from '../../../src/recognizer/worker';
import type { FakeScheduler } from '../../../src/testing';
import { bundledCatalog } from './scene';

export type FakeBehaviour = 'host' | 'silent' | 'ready-only';

export interface FakeWorkerOptions {
  readonly behaviour?: FakeBehaviour;
  /** Delay of each answer (ms of fake time). */
  readonly latencyMs?: number;
  readonly lineAggregator?: LineAggregatorModule;
  /** Rewrites the `ready` (wrong protocol or build id). */
  readonly ready?: (r: ReadyMsg) => unknown;
  /** The catalog loader rejects (once per worker when true). */
  readonly failCatalog?: boolean;
  readonly buildId?: string;
}

export class FakeWorker implements WorkerLike {
  onmessage: ((e: MessageEventLike) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  terminated = false;
  readonly received: RecRequest[] = [];
  readonly sent: RecResponse[] = [];
  private readonly sched_: FakeScheduler;
  private readonly o_: FakeWorkerOptions;
  private readonly host_: WorkerHost | null = null;
  private readonly far_: { postMessage(m: unknown): void; onmessage: ((e: MessageEventLike) => void) | null };
  private pendingDelay_ = 0;

  constructor(sched: FakeScheduler, opts: FakeWorkerOptions = {}) {
    this.sched_ = sched;
    this.o_ = opts;
    this.far_ = {
      postMessage: (m: unknown) => {
        let msg = m as RecResponse;
        if (msg.type === 'ready' && opts.ready !== undefined) msg = opts.ready(msg) as RecResponse;
        const delay = this.pendingDelay_;
        this.sched_.setTimeout(() => {
          if (this.terminated) return;
          this.sent.push(msg);
          this.onmessage?.({ data: structuredClone(msg) });
        }, delay);
      },
      onmessage: null,
    };
    const behaviour = opts.behaviour ?? 'host';
    if (behaviour !== 'silent') {
      this.host_ = new WorkerHost(this.far_, {
        catalog: () => (opts.failCatalog === true ? Promise.reject(new Error('stencils')) : bundledCatalog()),
        clock: { now: () => sched.now() },
        lineAggregator: opts.lineAggregator ?? stubLineAggregatorModule,
        ...(opts.buildId !== undefined ? { buildId: opts.buildId } : {}),
      });
    }
  }

  postMessage(message: unknown): void {
    if (this.terminated) return;
    const m = structuredClone(message) as RecRequest;
    this.received.push(m);
    this.sched_.setTimeout(() => {
      if (this.terminated || this.host_ === null) return;
      if (m.type === 'job' && (this.o_.behaviour ?? 'host') === 'ready-only') return;
      let msg: RecRequest = m;
      if (m.type === 'job') {
        const job: JobMsg = m;
        this.pendingDelay_ = (this.o_.latencyMs ?? 0) + (job.test?.spinMs ?? 0);
        if (job.test?.spinMs !== undefined) msg = { ...job, test: { ...job.test, spinMs: 0 } };
      } else {
        this.pendingDelay_ = this.o_.latencyMs ?? 0;
      }
      try {
        this.far_.onmessage?.({ data: msg });
      } catch (err) {
        this.onerror?.(err);
      }
    }, 0);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** The init the client sent. */
  get init(): InitMsg | undefined {
    return this.received.find((m): m is InitMsg => m.type === 'init');
  }

  get jobs(): JobMsg[] {
    return this.received.filter((m): m is JobMsg => m.type === 'job');
  }
}

/** Runs microtasks (the host's async init) and the timers due within `ms`. */
export async function advance(sched: FakeScheduler, ms: number): Promise<void> {
  const step = 1;
  let left = ms;
  for (;;) {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    sched.flushTimers();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    if (left <= 0) break;
    const d = Math.min(step * 50, left);
    sched.advance(d);
    left -= d;
  }
  for (let i = 0; i < 5; i++) await Promise.resolve();
  sched.flushTimers();
}
