// Reduces the candidate shapes of a poly collection to the chosen one (port of C++
// `recognizer::ShapeAggregator`). It is the `ClosedShapeStage` that `detectClosedShape` runs.
import type { ClosedShapeStage } from '../core/detectClosedShape';
import type { RecognizerConfig } from '../core/RecognizerConfig';
import type { RecognizerQuirks } from '../core/RecognizerContext';
import type { PolyColl } from '../polys/PolyColl';
import type { RecShape } from './RecShape';
import { ShapeColl } from './ShapeColl';

/** C++ `ShapeAggregator::process`'s `while (shapeColl_.extend()) {}`, bounded. */
const MAX_EXTEND_ROUNDS = 10000;

export class ShapeAggregator implements ClosedShapeStage<RecShape> {
  private readonly coll: ShapeColl;
  private chosen: RecShape[] = [];
  private readonly config: RecognizerConfig;
  /** Shapes built by the last run (for the counters and tests). */
  builtShapes = 0;

  constructor(config: RecognizerConfig, quirks: RecognizerQuirks) {
    this.config = config;
    this.coll = new ShapeColl(config, quirks);
  }

  shapes(): readonly RecShape[] {
    return this.chosen;
  }

  reset(): void {
    this.coll.reset();
    this.chosen = [];
  }

  /** C++ `setPolyColl(coll); process(); regualarize();` returning `shapes()`. */
  run(polyColl: PolyColl): readonly RecShape[] {
    this.reset();
    this.process(polyColl);
    this.regularize();
    return this.chosen;
  }

  private process(polyColl: PolyColl): void {
    this.coll.setPolyColl(polyColl);
    this.builtShapes = this.coll.shapes().length;
    // Each round marks a shape inextensible or replaces it by a final one, so this ends; the
    // bound only guards against a regression turning it into a hang.
    let rounds = 0;
    while (this.coll.extend()) {
      if (++rounds > MAX_EXTEND_ROUNDS) break;
    }
    this.coll.tryClosePolys();
    this.reduce();
  }

  /** C++ `reduce()`: one shape (the commented-out C++ loop took all). */
  private reduce(): void {
    const shape = this.coll.takeOut();
    if (shape !== null) this.chosen.push(shape);
  }

  private regularize(): void {
    for (const shape of this.chosen) shape.regularize(this.config);
  }
}
