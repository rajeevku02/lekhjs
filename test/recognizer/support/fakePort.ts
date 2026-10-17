// A fake `RecognitionSessionPort` that records what the client asks of a session.
import { RECOGNIZER_CONFIG_DEFAULTS } from '../../../src/recognizer/core';
import type { CapturedStroke, RecognitionSessionPort } from '../../../src/recognizer/client';
import type { RecMutation, SceneSnapshot } from '../../../src/recognizer/worker';

export type PortCall =
  | { readonly kind: 'hold' | 'release' | 'snapshot'; readonly stroke?: CapturedStroke; readonly at: number }
  | {
      readonly kind: 'apply';
      readonly stroke: CapturedStroke;
      readonly mutations: readonly RecMutation[];
      readonly at: number;
    }
  | { readonly kind: 'ink'; readonly stroke: CapturedStroke; readonly at: number };

const EMPTY: SceneSnapshot = {
  region: { x: 0, y: 0, w: 0, h: 0 },
  objects: [],
  arrowEnds: [],
  connections: [],
  docTemplates: {},
  textSizes: {},
};

export class FakePort implements RecognitionSessionPort {
  readonly sessionId: string;
  readonly calls: PortCall[] = [];
  holds = 0;
  private readonly now_: () => number;

  constructor(sessionId = 's1', now: () => number = () => 0) {
    this.sessionId = sessionId;
    this.now_ = now;
  }

  buildSnapshot(stroke: CapturedStroke): SceneSnapshot {
    this.calls.push({ kind: 'snapshot', stroke, at: this.now_() });
    return EMPTY;
  }
  currentConfig() {
    return RECOGNIZER_CONFIG_DEFAULTS;
  }
  beginRecognitionHold(): void {
    this.holds++;
    this.calls.push({ kind: 'hold', at: this.now_() });
  }
  endRecognitionHold(): void {
    this.holds--;
    this.calls.push({ kind: 'release', at: this.now_() });
  }
  apply(mutations: readonly RecMutation[], stroke: CapturedStroke): void {
    this.calls.push({ kind: 'apply', stroke, mutations, at: this.now_() });
  }
  applyInk(stroke: CapturedStroke): void {
    this.calls.push({ kind: 'ink', stroke, at: this.now_() });
  }

  /** The strokes settled (applied or ink), in order. */
  settled(): Extract<PortCall, { kind: 'apply' | 'ink' }>[] {
    return this.calls.filter(
      (c): c is Extract<PortCall, { kind: 'apply' | 'ink' }> => c.kind === 'apply' || c.kind === 'ink',
    );
  }
}

/** A stroke whose first x is `tag` (to tell strokes apart). */
export function tagged(tag: number, n = 8): CapturedStroke {
  const pts = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    pts[2 * i] = tag + i * 10;
    pts[2 * i + 1] = 100 + (i % 2) * 7;
  }
  return { points: pts, view: { zoom: 1, tx: 0, ty: 0 }, strokeWidth: 2 };
}

export function tagOf(s: CapturedStroke): number {
  return s.points[0] ?? -1;
}
