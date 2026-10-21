// The main-thread client of the recognition worker (spec 07 §6.5): one per page, created at app
// start. It owns the worker's lifecycle (spawn, init, warm-up, respawn), a FIFO queue of strokes
// (never dropped), one job in flight, the watchdog, the restart limit and the drain on board
// close. Everything time-based goes through the `Scheduler` and `Clock` ports, so the tests drive
// it with a fake clock and a fake `WorkerLike`.
//
//  - Queue: `{session, stroke}` in submission order; one job in flight; jobs numbered by a
//    monotonically increasing `jobId`. The snapshot is built when a job is DISPATCHED, under the
//    session's recognition hold.
//  - Watchdog (1,500 ms, visible time only): `setHidden(true)` pauses it; `setHidden(false)`
//    restarts it with the full time. On expiry: terminate, ink for the stroke (raw captured
//    points), end the hold, respawn, continue.
//  - Crash (`onerror` / `messageerror`): as the watchdog. A job-level `rec_internal` or
//    `rec_snapshot`: ink for the stroke, no respawn.
//  - Restart limit: every respawn counts (crash, watchdog, init timeout, init-time `rec_init`);
//    the failure that would need a 4th respawn inside 60 s switches the page to ink-only.
//  - Init: `ready` must arrive within 5 s of spawn; a wrong protocol or build id (`rec_protocol`)
//    means ink-only at once, with no respawn.
//  - Drain: `drain(sessionId)` lets that session's jobs run normally, capped at 3 s; at the cap
//    the in-flight one is abandoned and every remaining stroke of the session becomes ink.
//  - Test gate (`gateNext` / `releaseGate`, behind `__lekhTest.recognizer`; production never
//    arms it): the next stroke's job is held open by the caller instead of the worker. Its answer
//    is withheld, and no watchdog runs, until `releaseGate()`; so a test can make things happen
//    "during a job" without racing a fixed spin against the watchdog.
import type { Clock, Handle, Logger, Scheduler, WorkerLike } from '../../base';
import type { RecognizerConfig } from '../core/RecognizerConfig';
import type { RecMutation } from '../delegate/RecMutation';
import type { RecViewTransform } from '../delegate/SceneStore';
import {
  REC_PROTOCOL,
  isRecResponse,
  type InitMsg,
  type JobMsg,
  type JobTestHooks,
  type ErrorMsg,
  type RecErrorCode,
  type RecResponse,
  type ResultMsg,
  type SceneSnapshot,
} from '../worker/protocol';

/** A stroke as captured at its end. */
export interface CapturedStroke {
  /** x0,y0,x1,y1,… view px (the canvas displacement removed). */
  readonly points: Float64Array;
  readonly view: RecViewTransform;
  /** `currentStrokeWidth()` at capture. */
  readonly strokeWidth: number;
}

/** Implemented per board session (`SessionRecognitionPort`). */
export interface RecognitionSessionPort {
  readonly sessionId: string;
  buildSnapshot(stroke: CapturedStroke): SceneSnapshot;
  currentConfig(): RecognizerConfig;
  /** Hold remote frames and queue mutating local commands. */
  beginRecognitionHold(): void;
  /** Apply a result (validated; stale → ink). */
  apply(result: readonly RecMutation[], stroke: CapturedStroke): void;
  /** The unrecognised fallback. */
  applyInk(stroke: CapturedStroke): void;
  endRecognitionHold(): void;
}

/** What the client reports for telemetry and the `__lekhTest.recognizer.events()` hook. */
export interface RecognitionClientEvent {
  readonly kind: 'submit' | 'result' | 'ink' | 'restart' | 'watchdog' | 'disabled' | 'cost';
  readonly jobId?: number;
  readonly code?: RecErrorCode | 'rec_disabled';
  readonly at: number;
  /**
   * `cost` only, after a job's answer was applied: the main-thread milliseconds the job took
   * (spec 07 §7.6, AC-REC-30): `dispatchMs` (snapshot build + post) and `applyMs` (apply or ink,
   * and the end of the hold), measured with the client's clock.
   */
  readonly dispatchMs?: number;
  readonly applyMs?: number;
}

export interface RecognitionClientOptions {
  /** The host passes `() => new Worker(…)` (or the inline fallback). */
  readonly workerFactory: () => WorkerLike;
  /** The page bundle's build id; the worker's `ready` must report the same. */
  readonly buildId: string;
  readonly scheduler: Pick<Scheduler, 'setTimeout' | 'clearTimeout'>;
  readonly clock: Clock;
  readonly logger?: Logger;
  /** Default 1500 (OQ-41). */
  readonly watchdogMs?: number;
  /** Default 3. */
  readonly maxRestartsPerMinute?: number;
  /** Default 5000 (3 × the 1.5 s cold-start target). */
  readonly initTimeoutMs?: number;
  /** Default 3000 (OQ-45). */
  readonly drainCapMs?: number;
  readonly catalog?: InitMsg['catalog'];
  /** Run the warm-up stroke at init (default true). */
  readonly warmUp?: boolean;
  readonly onEvent?: (e: RecognitionClientEvent) => void;
}

interface QueuedJob {
  readonly session: RecognitionSessionPort;
  readonly stroke: CapturedStroke;
  /** Test hooks armed for this stroke. */
  readonly test?: JobTestHooks;
  /** The test gate is armed for this stroke (`gateNext`). */
  gate?: boolean;
}

interface InFlight extends QueuedJob {
  readonly jobId: number;
  timer: Handle | null;
  /** Main-thread ms of the dispatch (snapshot build + post). */
  dispatchMs: number;
  /** The worker's answer, withheld while the test gate is closed. */
  withheld: ResultMsg | ErrorMsg | null;
}

interface Spawned {
  readonly worker: WorkerLike;
  ready: boolean;
  initTimer: Handle | null;
}

interface Drain {
  readonly sessionId: string;
  readonly resolve: () => void;
  timer: Handle | null;
}

const WINDOW_MS = 60_000;

export class RecognitionClient {
  private readonly o_: RecognitionClientOptions;
  private readonly watchdogMs_: number;
  private readonly maxRestarts_: number;
  private readonly initTimeoutMs_: number;
  private readonly drainCapMs_: number;
  private readonly queue_: QueuedJob[] = [];
  private inflight_: InFlight | null = null;
  private worker_: Spawned | null = null;
  private nextJobId_ = 1;
  private respawns_: number[] = [];
  private inkOnly_ = false;
  private hidden_ = false;
  private config_: RecognizerConfig | null = null;
  private disposed_ = false;
  private nextTest_: JobTestHooks | null = null;
  private nextGate_ = false;
  private readonly drains_: Drain[] = [];

  constructor(opts: RecognitionClientOptions) {
    this.o_ = opts;
    this.watchdogMs_ = opts.watchdogMs ?? 1500;
    this.maxRestarts_ = opts.maxRestartsPerMinute ?? 3;
    this.initTimeoutMs_ = opts.initTimeoutMs ?? 5000;
    this.drainCapMs_ = opts.drainCapMs ?? 3000;
  }

  // ---- public surface ----

  /** Spawn + init + warm-up, at app start. */
  start(initialConfig: RecognizerConfig): void {
    if (this.disposed_ || this.worker_ !== null || this.inkOnly_) return;
    this.config_ = initialConfig;
    this.spawn();
  }

  /** Queues a stroke; never drops one. */
  submit(session: RecognitionSessionPort, stroke: CapturedStroke): void {
    if (this.disposed_) return;
    this.emit({ kind: 'submit' });
    const test = this.nextTest_;
    this.nextTest_ = null;
    const gate = this.nextGate_;
    this.nextGate_ = false;
    if (this.inkOnly_) {
      this.ink(session, stroke);
      return;
    }
    this.queue_.push({ session, stroke, ...(test !== null ? { test } : {}), ...(gate ? { gate } : {}) });
    this.pump();
  }

  /** A job is in flight or strokes are queued. */
  get busy(): boolean {
    return this.inflight_ !== null || this.queue_.length > 0;
  }

  /** The page went ink-only for its lifetime. */
  get inkOnly(): boolean {
    return this.inkOnly_;
  }

  /** Strokes waiting (not counting the one in flight). */
  get queued(): number {
    return this.queue_.length;
  }

  /** The in-flight job id (tests). */
  get inflightJobId(): number | null {
    return this.inflight_?.jobId ?? null;
  }

  /** The page was hidden (`visibilitychange`, `to_background`) or shown again. */
  setHidden(hidden: boolean): void {
    if (this.hidden_ === hidden) return;
    this.hidden_ = hidden;
    const f = this.inflight_;
    if (f === null) return;
    this.clearTimer(f);
    if (!hidden && f.gate !== true) this.armWatchdog(f);
  }

  /** Test hooks for the next submitted stroke (`__lekhTest.recognizer`). */
  armTest(hooks: JobTestHooks): void {
    this.nextTest_ = { ...this.nextTest_, ...hooks };
  }

  /**
   * Test gate (`__lekhTest.recognizer.gateNext`): the next submitted stroke's job stays in flight
   * (its session held) until `releaseGate()`, whatever the worker does: its answer is withheld and
   * no watchdog runs for it. A crash still ends it as usual.
   */
  gateNext(): void {
    this.nextGate_ = true;
  }

  /**
   * Opens the gate: a withheld answer is applied now; a job not answered yet continues with a
   * fresh watchdog; a gated stroke still queued (or not yet submitted) is no longer gated.
   * Whether a gated job or stroke was found.
   */
  releaseGate(): boolean {
    let found = this.nextGate_;
    this.nextGate_ = false;
    for (const j of this.queue_) {
      if (j.gate === true) {
        j.gate = false;
        found = true;
      }
    }
    const f = this.inflight_;
    if (f === null || f.gate !== true) return found;
    f.gate = false;
    const m = f.withheld;
    f.withheld = null;
    if (m !== null) this.onAnswer(f, m);
    else this.armWatchdog(f);
    return true;
  }

  /**
   * Closing a board: its queued strokes are dispatched normally and the in-flight one finishes,
   * capped at `drainCapMs`; at the cap the in-flight one is abandoned and the rest become ink.
   * Resolves when the session has nothing left in the client.
   */
  drain(sessionId: string): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.hasJobsOf(sessionId)) {
        resolve();
        return;
      }
      const d: Drain = { sessionId, resolve, timer: null };
      d.timer = this.o_.scheduler.setTimeout(() => {
        d.timer = null;
        this.capDrain(d);
      }, this.drainCapMs_);
      this.drains_.push(d);
    });
  }

  dispose(): void {
    if (this.disposed_) return;
    const f = this.inflight_;
    if (f !== null) this.clearTimer(f);
    this.inflight_ = null;
    for (const j of this.queue_.splice(0)) this.ink(j.session, j.stroke);
    if (f !== null) {
      this.ink(f.session, f.stroke);
      f.session.endRecognitionHold();
    }
    this.disposed_ = true;
    this.kill();
    for (const d of this.drains_.splice(0)) {
      if (d.timer !== null) this.o_.scheduler.clearTimeout(d.timer);
      d.resolve();
    }
  }

  // ---- the worker ----

  private spawn(): void {
    const cfg = this.config_;
    if (cfg === null || this.disposed_) return;
    let worker: WorkerLike;
    try {
      worker = this.o_.workerFactory();
    } catch {
      this.disable('rec_crash');
      return;
    }
    const s: Spawned = { worker, ready: false, initTimer: null };
    this.worker_ = s;
    worker.onmessage = (e) => {
      if (this.worker_ === s) this.onMessage(s, e.data);
    };
    worker.onerror = () => {
      if (this.worker_ === s) this.onCrash();
    };
    s.initTimer = this.o_.scheduler.setTimeout(() => {
      s.initTimer = null;
      if (this.worker_ === s && !s.ready) this.onInitTimeout();
    }, this.initTimeoutMs_);
    const init: InitMsg = {
      type: 'init',
      protocol: REC_PROTOCOL,
      buildId: this.o_.buildId,
      config: cfg,
      catalog: this.o_.catalog ?? { stencilBaseUrl: '', coreStencilIds: [] },
      warmUp: this.o_.warmUp ?? true,
    };
    worker.postMessage(init);
  }

  /** Terminates the current worker (its late messages are ignored). */
  private kill(): void {
    const s = this.worker_;
    this.worker_ = null;
    if (s === null) return;
    if (s.initTimer !== null) this.o_.scheduler.clearTimeout(s.initTimer);
    s.worker.onmessage = null;
    s.worker.onerror = null;
    try {
      s.worker.postMessage({ type: 'shutdown' });
    } catch {
      // a dead worker
    }
    s.worker.terminate();
  }

  /** Respawns within the limit; the failure that needs one more goes ink-only. */
  private respawn(): void {
    this.kill();
    if (this.disposed_ || this.inkOnly_) return;
    const now = this.o_.clock.now();
    this.respawns_ = this.respawns_.filter((t) => now - t < WINDOW_MS);
    if (this.respawns_.length >= this.maxRestarts_) {
      this.disable('rec_disabled');
      return;
    }
    this.respawns_.push(now);
    this.emit({ kind: 'restart' });
    this.spawn();
  }

  /** Ink-only for the page's lifetime; every queued (and later) stroke becomes ink. */
  private disable(code: RecErrorCode | 'rec_disabled'): void {
    if (this.inkOnly_) return;
    this.inkOnly_ = true;
    this.o_.logger?.warn('rec_disabled', { code });
    this.emit({ kind: 'disabled', code });
    this.kill();
    const f = this.inflight_;
    this.inflight_ = null;
    if (f !== null) {
      this.clearTimer(f);
      this.ink(f.session, f.stroke);
      f.session.endRecognitionHold();
    }
    this.flushQueueToInk();
  }

  private flushQueueToInk(sessionId?: string): void {
    const keep: QueuedJob[] = [];
    for (const j of this.queue_.splice(0)) {
      if (sessionId !== undefined && j.session.sessionId !== sessionId) keep.push(j);
      else this.ink(j.session, j.stroke);
    }
    this.queue_.push(...keep);
    this.settleDrains();
  }

  // ---- messages ----

  private onMessage(s: Spawned, data: unknown): void {
    if (!isRecResponse(data)) {
      if (!s.ready) this.disable('rec_protocol');
      return;
    }
    const m: RecResponse = data;
    if (m.type === 'ready') {
      if (s.initTimer !== null) this.o_.scheduler.clearTimeout(s.initTimer);
      s.initTimer = null;
      // A worker from another bundle may report any protocol number (hence the widening).
      const protocolOk = (m.protocol as number) === REC_PROTOCOL;
      if (!protocolOk || m.buildId !== this.o_.buildId) {
        this.o_.logger?.warn('rec_protocol', { reason: protocolOk ? 'build' : 'protocol' });
        this.disable('rec_protocol');
        return;
      }
      s.ready = true;
      this.pump();
      return;
    }
    if (m.type === 'error' && m.jobId === undefined) {
      if (!s.ready && m.code === 'rec_init') {
        this.o_.logger?.warn('rec_init', {});
        this.respawn();
        return;
      }
      if (m.code === 'rec_protocol') {
        this.disable('rec_protocol');
        return;
      }
      this.onCrash();
      return;
    }
    const f = this.inflight_;
    if (f === null || m.jobId !== f.jobId) return; // a late answer for an abandoned job
    if (f.gate === true) {
      f.withheld = m;
      return;
    }
    this.onAnswer(f, m);
  }

  /** The in-flight job's `result` or job-level `error`: apply (or ink), end the hold, go on. */
  private onAnswer(f: InFlight, m: ResultMsg | ErrorMsg): void {
    this.clearTimer(f);
    this.inflight_ = null;
    const t0 = this.o_.clock.now();
    if (m.type === 'result') {
      this.emit({ kind: 'result', jobId: f.jobId });
      f.session.apply(m.mutations, f.stroke);
    } else {
      this.o_.logger?.warn(m.code, {});
      this.emit({ kind: 'ink', jobId: f.jobId, code: m.code });
      f.session.applyInk(f.stroke);
    }
    f.session.endRecognitionHold();
    this.emit({ kind: 'cost', jobId: f.jobId, dispatchMs: f.dispatchMs, applyMs: this.o_.clock.now() - t0 });
    this.settleDrains();
    this.pump();
  }

  /** `error` / `messageerror` / an init-less `rec_internal`: ink for the in-flight job, respawn. */
  private onCrash(): void {
    this.o_.logger?.warn('rec_crash', {});
    this.failInflight('rec_crash');
    this.respawn();
    this.pump();
  }

  private onInitTimeout(): void {
    this.o_.logger?.warn('rec_init_timeout', {});
    this.flushQueueToInk();
    this.respawn();
  }

  private failInflight(code: RecErrorCode): void {
    const f = this.inflight_;
    if (f === null) return;
    this.clearTimer(f);
    this.inflight_ = null;
    this.emit({ kind: 'ink', jobId: f.jobId, code });
    f.session.applyInk(f.stroke);
    f.session.endRecognitionHold();
    this.settleDrains();
  }

  // ---- the queue ----

  private pump(): void {
    if (this.disposed_ || this.inflight_ !== null) return;
    if (this.inkOnly_) {
      this.flushQueueToInk();
      return;
    }
    const s = this.worker_;
    if (s === null || !s.ready) return;
    const next = this.queue_.shift();
    if (next === undefined) return;
    const t0 = this.o_.clock.now();
    const cfg = next.session.currentConfig();
    next.session.beginRecognitionHold();
    let scene: SceneSnapshot;
    try {
      scene = next.session.buildSnapshot(next.stroke);
    } catch {
      this.o_.logger?.warn('rec_snapshot', { side: 'main' });
      this.ink(next.session, next.stroke);
      next.session.endRecognitionHold();
      this.pump();
      return;
    }
    const f: InFlight = { ...next, jobId: this.nextJobId_++, timer: null, dispatchMs: 0, withheld: null };
    this.inflight_ = f;
    const stroke = next.stroke.points.slice();
    const job: JobMsg = {
      type: 'job',
      jobId: f.jobId,
      sessionId: next.session.sessionId,
      stroke,
      view: next.stroke.view,
      strokeWidth: next.stroke.strokeWidth,
      config: cfg,
      scene,
      ...(next.test !== undefined ? { test: next.test } : {}),
    };
    try {
      s.worker.postMessage(job, [stroke.buffer]);
    } catch {
      // a non-cloneable snapshot or a dead worker: as a crash
      this.onCrash();
      return;
    }
    f.dispatchMs = this.o_.clock.now() - t0;
    if (f.gate !== true) this.armWatchdog(f);
  }

  private armWatchdog(f: InFlight): void {
    if (this.hidden_) return;
    f.timer = this.o_.scheduler.setTimeout(() => {
      f.timer = null;
      if (this.inflight_ !== f) return;
      this.o_.logger?.warn('rec_timeout', {});
      this.emit({ kind: 'watchdog', jobId: f.jobId });
      this.failInflight('rec_timeout');
      this.respawn();
      this.pump();
    }, this.watchdogMs_);
  }

  private clearTimer(f: InFlight): void {
    if (f.timer !== null) this.o_.scheduler.clearTimeout(f.timer);
    f.timer = null;
  }

  private ink(session: RecognitionSessionPort, stroke: CapturedStroke): void {
    this.emit({ kind: 'ink' });
    session.applyInk(stroke);
  }

  // ---- drains ----

  private hasJobsOf(sessionId: string): boolean {
    return (
      this.inflight_?.session.sessionId === sessionId || this.queue_.some((j) => j.session.sessionId === sessionId)
    );
  }

  private settleDrains(): void {
    for (const d of this.drains_.slice()) {
      if (this.hasJobsOf(d.sessionId)) continue;
      this.finishDrain(d);
    }
  }

  private finishDrain(d: Drain): void {
    const i = this.drains_.indexOf(d);
    if (i >= 0) this.drains_.splice(i, 1);
    if (d.timer !== null) this.o_.scheduler.clearTimeout(d.timer);
    d.timer = null;
    d.resolve();
  }

  /** The cap: abandon the session's in-flight job (its worker is replaced), the rest to ink. */
  private capDrain(d: Drain): void {
    const f = this.inflight_;
    if (f !== null && f.session.sessionId === d.sessionId) {
      this.failInflight('rec_timeout');
      // The worker may still be busy with the abandoned job: replace it so the next job is not
      // stuck behind it (counted as a respawn).
      this.respawn();
    }
    this.flushQueueToInk(d.sessionId);
    this.finishDrain(d);
    this.pump();
  }

  private emit(e: Omit<RecognitionClientEvent, 'at'>): void {
    this.o_.onEvent?.({ ...e, at: this.o_.clock.now() });
  }
}
