// The board's stroke recogniser (the `StrokeRecognizer` that `interaction/RecognitionController`
// submits to): captures a stroke with the view transform in force at its end and the current
// stroke width, and queues it on the page's `RecognitionClient` for this session's port.
import { Point } from '../../geometry';
import type { BoardSession } from '../../session';
import { recViewOf } from '../worker/protocol';
import type { RecognitionClient } from './RecognitionClient';
import type { SessionRecognitionPort, SessionStroke } from './SessionRecognitionPort';

/** A stroke the port applies, plus who to tell. */
interface SettlingStroke extends SessionStroke {
  readonly settled: () => void;
}

export class SessionStrokeRecognizer {
  private readonly client_: RecognitionClient;
  private readonly port_: SettlingPort;
  private readonly session_: BoardSession;

  constructor(client: RecognitionClient, port: SessionRecognitionPort, session: BoardSession) {
    this.client_ = client;
    this.port_ = new SettlingPort(port);
    this.session_ = session;
  }

  submit(points: readonly Point[], docGeneration: number, viewPoints: readonly Point[], settled: () => void): void {
    const vt = this.session_.viewTransform;
    const view = recViewOf(vt.zoom, vt.scrollX, vt.scrollY);
    const src =
      viewPoints.length > 0
        ? viewPoints
        : points.map((p) => new Point(p.x * view.zoom + view.tx, p.y * view.zoom + view.ty));
    const flat = new Float64Array(src.length * 2);
    src.forEach((p, i) => {
      flat[2 * i] = p.x;
      flat[2 * i + 1] = p.y;
    });
    const stroke: SettlingStroke = {
      points: flat,
      view,
      strokeWidth: this.session_.currentStyle.effectiveStrokeWidth(),
      docGeneration,
      settled,
    };
    this.client_.submit(this.port_, stroke);
  }
}

/** The session's port, calling the stroke's `settled` once its result or ink is applied. */
class SettlingPort {
  private readonly port_: SessionRecognitionPort;

  constructor(port: SessionRecognitionPort) {
    this.port_ = port;
  }

  get sessionId(): string {
    return this.port_.sessionId;
  }
  buildSnapshot(stroke: SettlingStroke): ReturnType<SessionRecognitionPort['buildSnapshot']> {
    return this.port_.buildSnapshot(stroke);
  }
  currentConfig(): ReturnType<SessionRecognitionPort['currentConfig']> {
    return this.port_.currentConfig();
  }
  beginRecognitionHold(): void {
    this.port_.beginRecognitionHold();
  }
  endRecognitionHold(): void {
    this.port_.endRecognitionHold();
  }
  apply(result: Parameters<SessionRecognitionPort['apply']>[0], stroke: SettlingStroke): void {
    this.port_.apply(result, stroke);
    stroke.settled();
  }
  applyInk(stroke: SettlingStroke): void {
    this.port_.applyInk(stroke);
    stroke.settled();
  }
}
