// The candidate shapes of closed-shape detection (port of C++ `recognizer::ShapeColl`).
//
// `takeOut` picks the winner with `chooseFinalShape` (bug fix C1, DR-REC-01; the test-only quirk
// `legacyTakeOut` restores the C++ choice) and, by speed-up R8 (spec 07 §4.1), does not run the
// C++ `remove()`: `ShapeAggregator.reduce` takes one shape, and nothing reads the state `remove()`
// changes before the collection is reset. Dropped with it: `childShapes`, `findOverlap`, and the
// empty `addShapes`/`getRemainingShapes`.
import type { RecognizerConfig } from '../core/RecognizerConfig';
import type { RecognizerQuirks } from '../core/RecognizerContext';
import type { PolyColl } from '../polys/PolyColl';
import { chooseFinalShape } from './chooseFinalShape';
import { RecShape } from './RecShape';
import { ShapeExtender, type IdSeq } from './ShapeExtender';

export class ShapeColl {
  private items: RecShape[] = [];
  private readonly extender: ShapeExtender;
  private readonly config: RecognizerConfig;
  private readonly quirks: RecognizerQuirks;
  /** C++ `idSeq_`: never reset, so ids stay unique across runs. */
  private readonly idSeq: IdSeq = { value: 1 };

  constructor(config: RecognizerConfig, quirks: RecognizerQuirks) {
    this.config = config;
    this.quirks = quirks;
    this.extender = new ShapeExtender(config);
  }

  reset(): void {
    this.items = [];
  }

  shapes(): readonly RecShape[] {
    return this.items;
  }

  /** C++ `setPolyColl`: one shape per poly, numbered on. */
  setPolyColl(polyColl: PolyColl): void {
    for (const poly of polyColl.polys()) {
      const shape = RecShape.fromPoly(poly, polyColl);
      shape.id = this.idSeq.value;
      this.idSeq.value++;
      this.items.push(shape);
    }
  }

  /** C++ `extend()`: one extension round; true while some new shape can extend further. */
  extend(): boolean {
    let canExtendMore = false;
    const current = this.items;
    const tmp: RecShape[] = [];
    for (const shape of current) {
      if (!shape.extensible) continue;
      const extended = this.extender.extend(current, shape, this.idSeq);
      if (extended.length === 0) {
        shape.extensible = false;
        tmp.push(shape);
      } else {
        let keepOrig = false;
        for (const ex of extended) {
          if (ex.shape.extensible) canExtendMore = true;
          keepOrig = keepOrig || ex.keepOrig;
          tmp.push(ex.shape);
        }
        if (keepOrig) tmp.push(shape);
      }
    }
    this.items = tmp;
    return canExtendMore;
  }

  tryClosePolys(): void {
    for (const shape of this.items) shape.tryClose(this.config);
  }

  /** C++ `takeOut()` with C1 and R8: the winning final shape, or null. */
  takeOut(): RecShape | null {
    return chooseFinalShape(
      this.items,
      (s) => s.isFinal(),
      (s) => s.perimeter,
      this.quirks.legacyTakeOut === true,
    );
  }
}
