// Assembles a poly collection into paths (port of C++ `recognizer::PathAggregator`): each round
// grows one path from the remaining polys until none can be absorbed, removes the absorbed line
// ranges from the collection, and repeats while polys remain. Dropped: the unused
// `setContextRect`, `findNear` and `closedPolys` (never filled).
import type { RecognizerConfig } from '../core/RecognizerConfig';
import type { CxPoly } from '../polys/CxPoly';
import type { PolyColl } from '../polys/PolyColl';
import { RecInternalError } from '../lines/RecognizerUtil';
import { Path } from './Path';

/** Rounds after which the loop is taken to be stuck (C++ would spin forever). */
const MAX_ROUNDS = 10000;

export class PathAggregator {
  private readonly config: RecognizerConfig;
  private polyColl: PolyColl | null = null;
  private items: Path[] = [];

  constructor(config: RecognizerConfig) {
    this.config = config;
  }

  setPolyColl(polyColl: PolyColl): void {
    this.polyColl = polyColl;
  }

  reset(): void {
    this.items = [];
  }

  paths(): readonly Path[] {
    return this.items;
  }

  process(): void {
    const coll = this.polyColl;
    if (coll === null) throw new Error('PathAggregator.process() before setPolyColl()');
    for (let round = 0; ; round++) {
      if (round > MAX_ROUNDS) throw new RecInternalError('PathAggregator: polys are not being consumed');
      const polys = coll.polys();
      if (polys.length === 0) break;
      const path = new Path(this.config);
      const absorbed: CxPoly[] = [];
      let canAbsorb = true;
      while (canAbsorb) {
        canAbsorb = false;
        for (const poly of polys) {
          if (path.absorb(poly)) {
            absorbed.push(poly);
            canAbsorb = true;
          }
        }
      }
      for (const item of absorbed) coll.remove(item);
      path.finalize();
      if (path.path().length > 0) this.items.push(path);
      coll.assignIds();
    }
  }
}
