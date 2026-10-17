// `RecognitionSessionPort` over a `BoardSession` (spec 07 §6.5; spec 01 says "implemented by
// BoardSession": it is this adapter, so the session itself stays free of recognizer types).
//
// - `buildSnapshot` runs `SceneSnapshotBuilder` on the session's document and keeps the revs and
//   page of the job, keyed by the captured stroke, for the apply-time validation.
// - `apply` / `applyInk` go through the session's serial queue as one `recognitionResult` event,
//   so they run after whatever the session is doing, with the undo steps going straight on the
//   stack (the hold defers only the live local edits' steps).
// - The registered `RecognitionApplier` validates (`rec_stale` → ink) and applies through
//   `MutationApplier`.
import type { BoardSession, CommandContext } from '../../session';
import { recognizerConfigFrom, type RecognizerConfig } from '../core/RecognizerConfig';
import type { RecMutation } from '../delegate/RecMutation';
import type { SceneSnapshot } from '../worker/protocol';
import { MutationApplier, type AppliedJob, type RecognitionStats } from './MutationApplier';
import type { CapturedStroke, RecognitionSessionPort } from './RecognitionClient';
import { SceneSnapshotBuilder } from './SceneSnapshotBuilder';

/** A captured stroke plus the document generation it was drawn on. */
export interface SessionStroke extends CapturedStroke {
  /** `BoardSession.docGeneration` at capture: a result for an older document is dropped. */
  readonly docGeneration: number;
}

export interface SessionRecognitionPortOptions {
  readonly sessionId: string;
  readonly stats?: RecognitionStats;
  /** Called with `rec_stale` when a result was turned into ink (telemetry). */
  readonly onStale?: () => void;
}

interface Job extends AppliedJob {
  readonly id: string;
  readonly stroke: CapturedStroke;
  readonly docGeneration: number;
  /** Ink regardless of the mutations (`applyInk`). */
  ink: boolean;
}

export class SessionRecognitionPort implements RecognitionSessionPort {
  readonly sessionId: string;
  private readonly session_: BoardSession;
  private readonly builder_: SceneSnapshotBuilder;
  private readonly applier_: MutationApplier;
  private readonly o_: SessionRecognitionPortOptions;
  private readonly jobs_ = new Map<string, Job>();
  private readonly byStroke_ = new WeakMap<CapturedStroke, Job>();
  private seq_ = 0;

  constructor(session: BoardSession, opts: SessionRecognitionPortOptions) {
    this.sessionId = opts.sessionId;
    this.session_ = session;
    this.o_ = opts;
    this.builder_ = new SceneSnapshotBuilder({
      get doc() {
        return session.editor.doc;
      },
      codec: session.codec,
      overlay: session.overlay,
      text: session.text,
      config: session.config,
      fontEpoch: () => session.runtime.fonts.fontEpoch,
    });
    this.applier_ = new MutationApplier({
      currentStyle: () => session.currentStyle,
      ...(opts.stats !== undefined ? { stats: opts.stats } : {}),
    });
    session.setRecognitionApplier((ctx, ev) => {
      this.onResult(ctx, ev.strokeId, ev.mutations);
    });
  }

  /** The applier (tests). */
  get applier(): MutationApplier {
    return this.applier_;
  }

  private jobOf(stroke: CapturedStroke): Job {
    let j = this.byStroke_.get(stroke);
    if (j === undefined) {
      const gen = (stroke as Partial<SessionStroke>).docGeneration ?? this.session_.docGeneration;
      j = {
        id: `${this.sessionId}:${String(++this.seq_)}`,
        stroke,
        docGeneration: gen,
        view: stroke.view,
        revs: new Map(),
        pageId: this.session_.editor.doc.activePage().id,
        ink: false,
      };
      this.byStroke_.set(stroke, j);
    }
    return j;
  }

  buildSnapshot(stroke: CapturedStroke): SceneSnapshot {
    const built = this.builder_.build(stroke.points, stroke.view);
    const prev = this.jobOf(stroke);
    const j: Job = { ...prev, revs: built.revs, pageId: built.pageId };
    this.byStroke_.set(stroke, j);
    return built.snapshot;
  }

  currentConfig(): RecognizerConfig {
    return recognizerConfigFrom(this.session_.config);
  }

  beginRecognitionHold(): void {
    this.session_.beginRecognitionHold();
  }

  endRecognitionHold(): void {
    this.session_.endRecognitionHold();
  }

  apply(result: readonly RecMutation[], stroke: CapturedStroke): void {
    this.dispatch(this.jobOf(stroke), result);
  }

  applyInk(stroke: CapturedStroke): void {
    const j = this.jobOf(stroke);
    j.ink = true;
    this.dispatch(j, []);
  }

  private dispatch(j: Job, mutations: readonly RecMutation[]): void {
    this.jobs_.set(j.id, j);
    this.session_.dispatch({ type: 'recognitionResult', strokeId: j.id, docGeneration: j.docGeneration, mutations });
  }

  private onResult(ctx: CommandContext, strokeId: string, mutations: readonly RecMutation[]): void {
    const j = this.jobs_.get(strokeId);
    if (j === undefined) return;
    this.jobs_.delete(strokeId);
    if (j.ink) {
      this.applier_.applyInk(ctx, j.stroke.points, j.view);
      return;
    }
    const r = this.applier_.apply(ctx, mutations, j, this.session_.holdTouched());
    if (!r.ok) {
      this.session_.runtime.logger.warn('rec_stale', {});
      this.o_.onStale?.();
      this.applier_.applyInk(ctx, j.stroke.points, j.view);
    }
  }

  /** Detaches from the session. */
  dispose(): void {
    this.session_.setRecognitionApplier(null);
    this.jobs_.clear();
  }
}
