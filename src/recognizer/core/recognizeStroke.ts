// The pure entry of the recognizer (spec 07 §6.8): one stroke against a scene delegate, returning
// the recorded mutations and, on request, the stage dump the parity harness uses to localise the
// first divergent stage (`lines`, in-order `polys`, `closedPolys`, the recognised paths, the shapes
// before and after regularisation; the accessors of C++ `Recognizer.h:31-38`). The worker calls it
// with a `RecordingCanvasDelegate` over its `SnapshotCanvasDelegate`; the dump is off there.
import { Point, type GeoShape, type SimplePath } from '../../geometry';
import type { CanvasDelegate } from '../delegate/CanvasDelegate';
import type { RecMutation } from '../delegate/RecMutation';
import type { StrokeLine } from '../lines/StrokeLine';
import type { CxPoly } from '../polys/CxPoly';
import { Recognizer } from './Recognizer';
import { createRecognizerContext, type RecognizerContextInit } from './RecognizerContext';

/** A delegate that records its mutations (`RecordingCanvasDelegate`). */
export interface RecordingDelegate extends CanvasDelegate {
  mutations(): readonly RecMutation[];
}

export interface RecognizeStrokeOptions extends RecognizerContextInit {
  /** Return the stage dump (tests and the parity harness; off in the worker). */
  readonly dumpStages?: boolean;
}

/** The pipeline's intermediate results (C++ `Recognizer` accessors), read after `process()`. */
export interface StageDump {
  /** The pre-processed stroke. */
  readonly stroke: readonly Point[];
  readonly lines: readonly StrokeLine[];
  /** C++ `polys()`: the poly collection as the last stage left it. */
  readonly polys: readonly CxPoly[];
  /** C++ `closedPolys()` (never filled in C++). */
  readonly closedPolys: readonly CxPoly[];
  /** C++ `paths()`: the recognised paths left after `recognize()`. */
  readonly paths: readonly SimplePath[];
  readonly shapesBeforeRegularization: readonly GeoShape[];
  /** C++ `shapes()`: after regularisation and placement. */
  readonly shapes: readonly GeoShape[];
}

export interface RecognitionOutcome {
  readonly mutations: RecMutation[];
  /** Lines the recognizer logged (e.g. the closed-shape budget line). */
  readonly logs: readonly string[];
  readonly stages?: StageDump;
}

/** The flat `x0,y0,x1,y1,…` run as points. */
export function strokePoints(stroke: Float64Array): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i + 1 < stroke.length; i += 2) pts.push(new Point(stroke[i] ?? 0, stroke[i + 1] ?? 0));
  return pts;
}

/**
 * Recognise one stroke (view px, the canvas displacement already removed). B3: a stroke of fewer
 * than two points yields no mutation.
 */
export function recognizeStroke(
  stroke: Float64Array,
  delegate: RecordingDelegate,
  options: RecognizeStrokeOptions,
): RecognitionOutcome {
  const ctx = createRecognizerContext(options);
  const points = strokePoints(stroke);
  if (points.length < 2) return { mutations: [], logs: ctx.logs };

  const rec = new Recognizer(ctx, delegate);
  rec.addPoints(points);
  rec.process();

  const outcome: RecognitionOutcome = { mutations: delegate.mutations().slice(), logs: ctx.logs };
  if (options.dumpStages !== true) return outcome;
  return {
    ...outcome,
    stages: {
      stroke: rec.strokePoints(),
      lines: rec.lines(),
      polys: rec.polys(),
      closedPolys: rec.closedPolys(),
      paths: rec.paths(),
      shapesBeforeRegularization: rec.shapesBeforeRegularization(),
      shapes: rec.shapes(),
    },
  };
}
