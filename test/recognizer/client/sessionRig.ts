// A real board session wired to the recognition client as the board does it: the session's
// `SessionRecognitionPort`, a `RecognitionClient` on the session's fake scheduler, and fake
// workers running the real `WorkerHost` (with the test-only RDP aggregator, so strokes are
// recognised before H-REC-1).
import { Point } from '../../../src/geometry';
import { RECOGNIZER_CONFIG_DEFAULTS } from '../../../src/recognizer/core';
import type { LineAggregatorModule } from '../../../src/recognizer/lines';
import {
  RecognitionClient,
  SessionRecognitionPort,
  type RecognitionStats,
  type SessionStroke,
} from '../../../src/recognizer/client';
import { recViewOf, type RecViewTransform } from '../../../src/recognizer/worker';
import type { BoardSession } from '../../../src/session';
import { harness, type Harness, type HarnessOptions } from '../../session/helpers';
import { FakeWorker, advance } from '../support/fakeWorker';
import { polylineLineAggregatorModule } from '../support/polylineAggregator';
import { boardText, flat } from '../support/scene';

export interface StatsLog extends RecognitionStats {
  readonly calls: string[];
}

export function statsLog(): StatsLog {
  const calls: string[] = [];
  return {
    calls,
    markRecognized: () => calls.push('markRecognized'),
    markInk: () => calls.push('markInk'),
    onConnectorAdded: () => calls.push('onConnectorAdded'),
  };
}

export interface SessionRig {
  readonly h: Harness;
  readonly session: BoardSession;
  readonly port: SessionRecognitionPort;
  readonly client: RecognitionClient;
  readonly stats: StatsLog;
  readonly workers: FakeWorker[];
  tick(ms?: number): Promise<void>;
  /** The view transform the stroke is captured with (the session's, unless given). */
  stroke(points: readonly Point[], view?: RecViewTransform): SessionStroke;
  objects(): string[];
}

export async function sessionRig(
  opts: { board?: string; cloud?: boolean; latencyMs?: number; lineAggregator?: LineAggregatorModule } & Pick<
    HarnessOptions,
    'meta'
  > = {},
): Promise<SessionRig> {
  const h = harness({
    board: boardText(opts.board ?? 'format/01-empty.lekh'),
    ...(opts.cloud === true ? { cloud: true } : {}),
    ...(opts.meta !== undefined ? { meta: opts.meta } : {}),
  });
  const session = h.session;
  const stats = statsLog();
  const port = new SessionRecognitionPort(session, { sessionId: 's1', stats });
  const workers: FakeWorker[] = [];
  const client = new RecognitionClient({
    workerFactory: () => {
      const w = new FakeWorker(h.scheduler, {
        latencyMs: opts.latencyMs ?? 300,
        lineAggregator: opts.lineAggregator ?? polylineLineAggregatorModule,
      });
      workers.push(w);
      return w;
    },
    buildId: 'b',
    scheduler: h.scheduler,
    clock: h.scheduler,
  });
  client.start(RECOGNIZER_CONFIG_DEFAULTS);
  const rig: SessionRig = {
    h,
    session,
    port,
    client,
    stats,
    workers,
    tick: (ms = 0) => advance(h.scheduler, ms),
    stroke: (points, view) => {
      const v = session.viewTransform;
      return {
        points: flat(points),
        view: view ?? recViewOf(v.zoom, v.scrollX, v.scrollY),
        strokeWidth: 2,
        docGeneration: session.docGeneration,
      };
    },
    objects: () => session.editor.doc.activePage().objectStore.objects.map((o) => o.id),
  };
  await rig.tick((opts.latencyMs ?? 300) + 50); // ready
  return rig;
}

/** A hand-drawn rectangle stroke (view px) with top-left (x, y). */
export function rectStroke(x: number, y: number, w = 160, h = 100): Point[] {
  const out: Point[] = [];
  const corners = [
    new Point(x, y),
    new Point(x + w, y),
    new Point(x + w, y + h),
    new Point(x, y + h),
    new Point(x, y + 2),
  ];
  out.push(corners[0] as Point);
  for (let i = 1; i < corners.length; i++) {
    const a = corners[i - 1] as Point;
    const b = corners[i] as Point;
    const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 4));
    for (let k = 1; k <= n; k++) out.push(new Point(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n));
  }
  return out;
}

/** A straight stroke from `a` to `b`, 40 samples, bowed by `bow` px. */
export function lineStroke(a: Point, b: Point, bow = 0): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    out.push(new Point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t + bow * Math.sin(Math.PI * t)));
  }
  return out;
}
