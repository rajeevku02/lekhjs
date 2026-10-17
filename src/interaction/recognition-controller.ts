// The stroke gate (spec 02 `RecognitionController`; C++ `IntelligentDrawing::addPoints`, the
// `newRecognizer` path, and `addObjects`): a finished stroke goes to the recogniser when the mode
// recognises shapes (SmartDraw, C++ `Config::recognizeShape`) and a recogniser is attached, and is
// plain ink otherwise — one `UnrecognizedObject` in the current style, one undo step. The
// recogniser itself (`recognizer/client`: `RecognitionClient` over `SessionRecognitionPort`, spec 07
// §6) is attached by the host; until then every stroke is ink.
//
// While a submitted stroke waits for its result (queued behind another job, or in flight), its ink
// stays on the Middle canvas as a transient (C++ `MiddleWidget::pendingTransientRemoval_`), drawn
// from its document points so it follows pan and zoom.
//
// `logRawPoints` (C++ `Config::logRawPoints`, dev-only, OQ-48): every stroke's view points also go
// to the host's raw-stroke sink, which the board's "record strokes" toggle saves as corpus files.
import { AddObjectAction } from '../edit';
import type { Point } from '../geometry';
import { UnrecognizedObject } from '../model';
import type { DrawingPlatform } from '../render';
import type { Style } from '../style';
import type { InteractionBoard } from './board';
import type { CanvasView } from './canvas-view';
import { InputMode, type InputModeState } from './input-mode';
import type { StrokeSink } from './overlay-layer';
import type { Transient } from './selection/types';

/** Where a stroke to recognise goes (spec 07 §6: the worker client's queue). */
export interface StrokeRecognizer {
  /**
   * Document points of one stroke, the session's document generation and the stroke's view
   * points (view px of the transform in force now). `settled` is called once the stroke's result
   * (or its ink) has been applied.
   */
  submit(points: readonly Point[], docGeneration: number, viewPoints: readonly Point[], settled: () => void): void;
}

/** Where the pending strokes' ink is drawn (the overlay layer). */
export interface PendingInkHost {
  addTransient(t: Transient): void;
  removeTransient(t: Transient): void;
  invalidate(): void;
}

export interface RecognitionControllerOptions {
  readonly board: InteractionBoard;
  readonly view: CanvasView;
  readonly modes: InputModeState;
  /** The session's document generation (a result for an older document is dropped). */
  readonly docGeneration?: () => number;
}

/** A submitted stroke's ink until its result is applied, in document coordinates. */
export class PendingInkTransient implements Transient {
  readonly points: readonly Point[];
  private readonly style_: Style;
  private readonly view_: CanvasView;
  private readonly zoom_: () => number;

  constructor(points: readonly Point[], style: Style, view: CanvasView, zoom: () => number) {
    this.points = points;
    this.style_ = style;
    this.view_ = view;
    this.zoom_ = zoom;
  }

  draw(dp: DrawingPlatform): void {
    const first = this.points[0];
    if (first === undefined) return;
    const style = this.style_.clone();
    style.setNoFill();
    style.setStrokeWidth(this.style_.effectiveStrokeWidth() * this.zoom_());
    dp.startDrawing(this.view_.toView(first), style);
    for (let i = 1; i < this.points.length; i++) dp.addLineTo(this.view_.toView(this.points[i] as Point));
    dp.endDrawing();
  }
}

export class RecognitionController implements StrokeSink {
  private readonly o_: RecognitionControllerOptions;
  private recognizer_: StrokeRecognizer | null = null;
  private ink_: PendingInkHost | null = null;
  private rawSink_: ((viewPoints: readonly Point[]) => void) | null = null;
  private readonly pending_ = new Set<PendingInkTransient>();

  constructor(opts: RecognitionControllerOptions) {
    this.o_ = opts;
  }

  /** Attaches (or with null detaches) the recogniser. */
  setRecognizer(r: StrokeRecognizer | null): void {
    this.recognizer_ = r;
  }

  /** Where pending strokes are drawn (the overlay; set by `BoardView`). */
  setPendingInkHost(host: PendingInkHost | null): void {
    this.ink_ = host;
  }

  /** The raw-stroke sink of `logRawPoints` (the board's dev-only "record strokes"). */
  setRawStrokeSink(sink: ((viewPoints: readonly Point[]) => void) | null): void {
    this.rawSink_ = sink;
  }

  /** Whether a stroke now would be recognised. */
  recognizes(): boolean {
    return this.o_.modes.get() === InputMode.SmartDraw && this.recognizer_ !== null;
  }

  /** Strokes waiting for their result (tests). */
  get pendingCount(): number {
    return this.pending_.size;
  }

  addStroke(viewPoints: readonly Point[]): void {
    if (viewPoints.length === 0) return;
    if (this.o_.board.config.logRawPoints) this.rawSink_?.(viewPoints.slice());
    const pts = viewPoints.map((p) => this.o_.view.toDoc(p));
    const rec = this.recognizer_;
    if (this.o_.modes.get() === InputMode.SmartDraw && rec !== null) {
      const t = new PendingInkTransient(
        pts,
        this.o_.board.currentStyle().clone(),
        this.o_.view,
        () => this.o_.board.view().zoom,
      );
      const host = this.ink_;
      this.pending_.add(t);
      host?.addTransient(t);
      host?.invalidate();
      let done = false;
      rec.submit(pts, this.o_.docGeneration?.() ?? 0, viewPoints, () => {
        if (done) return;
        done = true;
        this.pending_.delete(t);
        host?.removeTransient(t);
        host?.invalidate();
      });
      return;
    }
    this.addInk(pts);
  }

  /** Plain ink: one freehand object in the current style. */
  addInk(docPoints: readonly Point[]): void {
    const b = this.o_.board;
    b.edit((ctx) => {
      const obj = new UnrecognizedObject(b.objectEnv(), docPoints);
      obj.getDrawingProfile().copyFrom(b.currentStyle());
      ctx.editor.tx.run(new AddObjectAction(ctx.editor.env, ctx.doc, [obj]));
    });
    b.requestPaint('drawing');
  }
}
