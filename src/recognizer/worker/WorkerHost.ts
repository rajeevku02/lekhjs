// The worker side of the recognition protocol (spec 07 §6.1, §6.2, §6.9): one long-lived host per
// worker. `init` loads the `TemplateCatalog` once (the only long-lived state, read-only) and runs
// the warm-up stroke; each `job` builds a throw-away scene from its snapshot, recognises the
// stroke and posts the mutations. Nothing carries over from one job to the next.
//
// Errors: a malformed message or a protocol mismatch is `rec_protocol`; a catalog that does not
// load is `rec_init`; a snapshot object that does not read is `rec_snapshot`; anything thrown by
// the recognizer is `rec_internal`. A job's handler is synchronous, so a top-level throw (the
// `crash` test hook) reaches the worker's `error` event, which the client treats as `rec_crash`.
import type { Clock, PortLike } from '../../base';
import { BUDGET_LOG_LINE, recognizeStroke, type RecognizerConfig } from '../core';
import { snapshotDelegate } from '../delegate/SnapshotCanvasDelegate';
import type { LineAggregatorModule } from '../lines';
import type { TemplateCatalog } from '../../template';
import {
  REC_PROTOCOL,
  isRecRequest,
  type ErrorMsg,
  type InitMsg,
  type JobMsg,
  type ReadyMsg,
  type RecErrorCode,
  type ResultMsg,
  type SceneSnapshot,
} from './protocol';
import { TextMeasureInWorkerError, WorkerScene } from './WorkerScene';

export interface WorkerHostOptions {
  /** Loads the worker's base catalog (the host bundles or fetches the stencils). */
  readonly catalog: (init: InitMsg) => TemplateCatalog | Promise<TemplateCatalog>;
  readonly lineAggregator: LineAggregatorModule;
  /** The worker bundle's build id, reported in `ready` (default: the one `init` names). */
  readonly buildId?: string;
  /** Monotonic ms for the timings and the `spinMs` hook (the worker's `performance.now`). */
  readonly clock: Clock;
}

/** The warm-up stroke: the 64-point circle of C++ `LekhUtil::benchMarkRecognizer` (`LekhUtil.cpp:807`). */
export const WARM_UP_STROKE: readonly number[] = Object.freeze([
  181.5, 142.5, 159, 142.5, 142.5, 144.5, 142.5, 144.5, 116, 155, 99, 168, 84.5, 190, 73.5, 218, 70.5, 235.5, 70.5, 244,
  70.5, 258.5, 70.5, 270.5, 74, 279, 79, 287, 86, 295, 99.5, 306, 116, 315, 134, 321, 149.5, 323.5, 168.5, 324.5, 186,
  324.5, 207, 318, 222, 308.5, 236.5, 295, 250, 279, 259.5, 264, 263.5, 252, 264, 243.5, 264, 240.5, 264, 234.5, 263,
  229.5, 259.5, 222.5, 256.5, 217, 253, 211, 247.5, 204.5, 243.5, 200.5, 235.5, 192.5, 226.5, 186.5, 219, 181, 212,
  175.5, 206, 170.5, 200, 165.5, 195, 161.5, 191, 158.5, 187.5, 156, 185.5, 154.5, 184.5, 154.5, 182, 153, 180.5, 152.5,
  180, 152, 179.5, 151, 179, 150.5, 178.5, 150.5, 178, 150, 177.5, 150, 177, 150, 176.5, 149.5, 175.5, 148.5, 174,
  147.5, 173, 146.5, 172.5, 146.5, 172, 146, 172, 145.5, 172, 145.5,
]);

const EMPTY_SCENE: SceneSnapshot = Object.freeze({
  region: { x: 0, y: 0, w: 0, h: 0 },
  objects: [],
  arrowEnds: [],
  connections: [],
  docTemplates: {},
  textSizes: {},
});

/** The error's class name only (content-free). */
function nameOf(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

/** A crash requested by the `crash` test hook. */
export class RequestedCrashError extends Error {
  constructor() {
    super('recognizer worker crash requested by a test hook');
    this.name = 'RequestedCrashError';
  }
}

export class WorkerHost {
  private readonly port_: PortLike;
  private readonly o_: WorkerHostOptions;
  private scene_: WorkerScene | null = null;
  private closed_ = false;

  constructor(port: PortLike, opts: WorkerHostOptions) {
    this.port_ = port;
    this.o_ = opts;
    port.onmessage = (e) => {
      this.onMessage(e.data);
    };
  }

  get ready(): boolean {
    return this.scene_ !== null;
  }

  private post(m: ReadyMsg | ResultMsg | ErrorMsg): void {
    if (!this.closed_) this.port_.postMessage(m);
  }

  private fail(code: RecErrorCode, message: string, jobId?: number): void {
    this.post({ type: 'error', code, message, ...(jobId !== undefined ? { jobId } : {}) });
  }

  /** Synchronous for jobs: a throw here is an uncaught worker error. */
  onMessage(data: unknown): void {
    if (this.closed_) return;
    if (!isRecRequest(data)) {
      this.fail('rec_protocol', 'malformed message');
      return;
    }
    switch (data.type) {
      case 'init':
        void this.init(data);
        return;
      case 'job':
        this.job(data);
        return;
      case 'shutdown':
        this.closed_ = true;
        this.port_.onmessage = null;
        return;
    }
  }

  private async init(m: InitMsg): Promise<void> {
    // A page from another bundle may send any protocol number (hence the widening).
    if ((m.protocol as number) !== REC_PROTOCOL) {
      this.fail('rec_protocol', 'protocol version');
      return;
    }
    let catalog: TemplateCatalog;
    try {
      catalog = await this.o_.catalog(m);
    } catch (err) {
      this.fail('rec_init', nameOf(err));
      return;
    }
    this.scene_ = new WorkerScene({ catalog });
    let warmUpMs = 0;
    if (m.warmUp) {
      const t0 = this.o_.clock.now();
      try {
        this.recognize(new Float64Array(WARM_UP_STROKE), { zoom: 1, tx: 0, ty: 0 }, 2, m.config, EMPTY_SCENE);
      } catch {
        // A warm-up failure is not fatal: the first job reports its own error.
      }
      warmUpMs = this.o_.clock.now() - t0;
    }
    this.post({
      type: 'ready',
      protocol: REC_PROTOCOL,
      buildId: this.o_.buildId ?? m.buildId,
      lineAggregator: this.o_.lineAggregator.id,
      warmUpMs,
    });
  }

  private recognize(
    stroke: Float64Array,
    view: JobMsg['view'],
    strokeWidth: number,
    config: RecognizerConfig,
    snap: SceneSnapshot,
  ): { result: ReturnType<typeof recognizeStroke>; loadMs: number; failed: number } {
    const scene = this.scene_;
    if (scene === null) throw new Error('recognizer worker not initialised');
    const t0 = this.o_.clock.now();
    const loaded = scene.load(snap, view.zoom);
    const loadMs = this.o_.clock.now() - t0;
    if (loaded.failed > 0) return { result: { mutations: [], logs: [] }, loadMs, failed: loaded.failed };
    const delegate = snapshotDelegate({ store: loaded.scene, view, strokeWidth, config });
    const result = recognizeStroke(stroke, delegate, { config, lineAggregator: this.o_.lineAggregator });
    return { result, loadMs, failed: 0 };
  }

  private job(m: JobMsg): void {
    if (m.test?.crash === true) throw new RequestedCrashError();
    if (this.scene_ === null) {
      this.fail('rec_protocol', 'job before init', m.jobId);
      return;
    }
    const clock = this.o_.clock;
    const t0 = clock.now();
    const spin = m.test?.spinMs ?? 0;
    if (spin > 0) {
      const until = t0 + spin;
      while (clock.now() < until) {
        // busy-wait: the watchdog tests
      }
    }
    let out: ReturnType<WorkerHost['recognize']>;
    let phase: 'snapshot' | 'recognize' = 'snapshot';
    try {
      const scene = this.scene_;
      const t1 = clock.now();
      const loaded = scene.load(m.scene, m.view.zoom);
      const loadMs = clock.now() - t1;
      if (loaded.failed > 0) {
        this.fail('rec_snapshot', `${String(loaded.failed)} objects`, m.jobId);
        return;
      }
      phase = 'recognize';
      const delegate = snapshotDelegate({
        store: loaded.scene,
        view: m.view,
        strokeWidth: m.strokeWidth,
        config: m.config,
      });
      const result = recognizeStroke(m.stroke, delegate, { config: m.config, lineAggregator: this.o_.lineAggregator });
      out = { result, loadMs, failed: 0 };
    } catch (err) {
      const code: RecErrorCode =
        phase === 'snapshot' && !(err instanceof TextMeasureInWorkerError) ? 'rec_snapshot' : 'rec_internal';
      this.fail(code, nameOf(err), m.jobId);
      return;
    }
    const total = clock.now() - t0;
    this.post({
      type: 'result',
      jobId: m.jobId,
      mutations: out.result.mutations,
      timings: {
        snapshotLoadMs: out.loadMs,
        recognizeMs: total - out.loadMs,
        totalMs: total,
        budgetExceeded: out.result.logs.includes(BUDGET_LOG_LINE),
      },
      logs: [...out.result.logs],
    });
  }
}
