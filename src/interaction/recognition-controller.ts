// The stroke gate (spec 02 `RecognitionController`; C++ `IntelligentDrawing::addPoints`, the
// `newRecognizer` path, and `addObjects`): a finished stroke goes to the recogniser when the mode
// recognises shapes (SmartDraw, C++ `Config::recognizeShape`) and a recogniser is attached, and is
// plain ink otherwise — one `UnrecognizedObject` in the current style, one undo step. The
// recogniser itself (`RecognitionWorkerClient` and its `StrokeQueue`, spec 07 §6) is attached
// later; until then every stroke is ink.
import { AddObjectAction } from '../edit';
import type { Point } from '../geometry';
import { UnrecognizedObject } from '../model';
import type { InteractionBoard } from './board';
import type { CanvasView } from './canvas-view';
import { InputMode, type InputModeState } from './input-mode';
import type { StrokeSink } from './overlay-layer';

/** Where a stroke to recognise goes (spec 07 §6: the worker client's queue). */
export interface StrokeRecognizer {
  /** Document points of one stroke and the session's document generation. */
  submit(points: readonly Point[], docGeneration: number): void;
}

export interface RecognitionControllerOptions {
  readonly board: InteractionBoard;
  readonly view: CanvasView;
  readonly modes: InputModeState;
  /** The session's document generation (a result for an older document is dropped). */
  readonly docGeneration?: () => number;
}

export class RecognitionController implements StrokeSink {
  private readonly o_: RecognitionControllerOptions;
  private recognizer_: StrokeRecognizer | null = null;

  constructor(opts: RecognitionControllerOptions) {
    this.o_ = opts;
  }

  /** Attaches (or with null detaches) the recogniser. */
  setRecognizer(r: StrokeRecognizer | null): void {
    this.recognizer_ = r;
  }

  /** Whether a stroke now would be recognised. */
  recognizes(): boolean {
    return this.o_.modes.get() === InputMode.SmartDraw && this.recognizer_ !== null;
  }

  addStroke(viewPoints: readonly Point[]): void {
    if (viewPoints.length === 0) return;
    const pts = viewPoints.map((p) => this.o_.view.toDoc(p));
    const rec = this.recognizer_;
    if (this.o_.modes.get() === InputMode.SmartDraw && rec !== null) {
      rec.submit(pts, this.o_.docGeneration?.() ?? 0);
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
