// Closed-shape detection (C++ `Recognizer::detectClosedShape`, `Recognizer.cpp:319-361`): the
// all-nearby poly search under its budget, then the shape stage, then the 80 %-of-length rule.
//
// Speed-up R7 (spec 07 §4.1): right after the search, if even the longest poly is under 80 % of the
// stroke's length, no shape can pass the 80 % rule, so the split and the whole shape stage are
// skipped. Every candidate shape's perimeter attribute is the perimeter of a split poly (C++
// `Shape::updateFromPoly`) or is copied from such a shape (`ShapeExtender`); a split piece is a
// sub-range of the poly it was cut from, so it is never longer (checked over the synthetic sets in
// test/recognizer/core); and IEEE division is monotone. So the early `false` is the late one. The
// shape stage (`ShapeAggregator`, `ShapeColl`, `BasicShapeRecognizer`, task R2) comes
// in through `ClosedShapeStage`.
import type { LineColl } from '../lines/LineColl';
import type { PolyColl } from '../polys/PolyColl';
import type { RecognizerContext } from './RecognizerContext';

/** C++ `Recognizer.cpp:331`. */
export const BUDGET_LOG_LINE = 'recognizer: closed-shape search budget exceeded; falling back to path';

/** The share of the stroke's length a closed shape must use. */
const MIN_USED_SHARE = 0.8;

/** What closed-shape detection reads of a candidate shape. */
export interface ClosedShapeCandidate {
  /** The shape's `perimeter` number attribute (C++ `ShapeAttrs::perimeter`), if it has one. */
  readonly perimeter: number | undefined;
}

/** The shape stage (C++ `ShapeAggregator`), supplied by the recognizer. */
export interface ClosedShapeStage<S extends ClosedShapeCandidate> {
  /**
   * C++ `shapeAggregator_.setPolyColl(&polyColl_); process(); regualarize();`, returning
   * `shapes()`: the chosen shapes (zero or one), in order.
   */
  run(polyColl: PolyColl): readonly S[];
  /** C++ `shapeAggregator_.reset()`. */
  reset(): void;
}

export interface ClosedShapeResult<S> {
  /** True when a closed shape was found; `shapes` then holds it. */
  readonly detected: boolean;
  readonly shapes: readonly S[];
  /** The search was abandoned at `cxPolyMaxPolys`. */
  readonly budgetExceeded: boolean;
  /** Returned at the line cap, before any search. */
  readonly overLineCap: boolean;
  /** Returned by the R7 early exit, before the shape stage. */
  readonly earlyExit: boolean;
}

function result<S>(
  detected: boolean,
  shapes: readonly S[],
  flags: Partial<Pick<ClosedShapeResult<S>, 'budgetExceeded' | 'overLineCap' | 'earlyExit'>> = {},
): ClosedShapeResult<S> {
  return {
    detected,
    shapes,
    budgetExceeded: flags.budgetExceeded ?? false,
    overLineCap: flags.overLineCap ?? false,
    earlyExit: flags.earlyExit ?? false,
  };
}

/** Whether a shape of perimeter `pm` uses too little of `totalLen` (C++ `pm / totalLen < 0.8`). */
function usesTooLittle(pm: number, totalLen: number): boolean {
  return totalLen > 0 && pm / totalLen < MIN_USED_SHARE;
}

/**
 * C++ `detectClosedShape`. Leaves `lineColl` in all-nearby mode and `polyColl` holding the search's
 * (split) polys, as C++ does; the caller's later `recognizePath` switches back to in-order.
 */
export function detectClosedShape<S extends ClosedShapeCandidate>(
  lineColl: LineColl,
  polyColl: PolyColl,
  ctx: RecognizerContext,
  stage: ClosedShapeStage<S>,
): ClosedShapeResult<S> {
  if (lineColl.lines().length > ctx.config.closedShapeMaxLines) {
    // Too many lines for the all-nearby search; the in-order result is used.
    return result(false, [], { overLineCap: true });
  }
  lineColl.setLineSearchInOrder(false);
  polyColl.setLines(lineColl);
  polyColl.process();
  if (polyColl.budgetExceeded()) {
    ctx.log(BUDGET_LOG_LINE);
    ctx.counters.budgetExceeded++;
    return result(false, [], { budgetExceeded: true });
  }

  // R7: no shape can be longer than the longest poly.
  const totalLen = lineColl.lenSum();
  let maxPerimeter = 0;
  for (const poly of polyColl.polys()) maxPerimeter = Math.max(maxPerimeter, poly.features().perimeter);
  if (usesTooLittle(maxPerimeter, totalLen)) {
    stage.reset();
    ctx.counters.earlyExits++;
    return result(false, [], { earlyExit: true });
  }

  polyColl.splitExtensions();
  const shapes = stage.run(polyColl);
  ctx.counters.shapeStageRuns++;

  let detected = shapes.length > 0;
  const first = shapes[0];
  if (first !== undefined && first.perimeter !== undefined && usesTooLittle(first.perimeter, totalLen)) {
    // A large part of the lines is not used by the shape.
    detected = false;
  }
  const out = detected ? shapes.slice() : [];
  stage.reset();
  return result(detected, out);
}
