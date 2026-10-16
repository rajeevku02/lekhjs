// Tidies a recognised path (port of C++ `regularizer::Regularizer`): snaps it to the closest
// regular figure for its line count, or straightens the near-axis segments of a non-convex
// polyline. Runs after the shape is chosen (C++ `Recognizer.cpp:83-84`).
//
// The C++ dispatch is a chain of independent `if (path->size() == n)` tests, not an else-if:
// a regularizer that changes the line count hands the path on to the next one. The one case that
// reaches it is a closed two-line path, which TwoLine rewrites as a closed triangle (three lines)
// that ThreeLine then sees. `curveCount` is read once, before any rewriting, as in C++.
import type { Point, SimplePath } from '../../geometry';
import type { RecognizerConfig } from '../core/RecognizerConfig';
import { CurveRegularizer } from './CurveRegularizer';
import { EightLineRegularizer } from './EightLineRegularizer';
import { FiveLineRegularizer } from './FiveLineRegularizer';
import { FourLineRegularizer } from './FourLineRegularizer';
import { OneLineRegularizer } from './OneLineRegularizer';
import { PolyLineRegularizer } from './PolyLineRegularizer';
import type { PolyRegularizer } from './PolyRegularizer';
import { SixLineRegularizer } from './SixLineRegularizer';
import { ThreeLineRegularizer } from './ThreeLineRegularizer';
import { TwoLineRegularizer } from './TwoLineRegularizer';

/** The feature regularizers by the line count they take (C++ dispatch order). */
const POLY_BY_SIZE: readonly (readonly [number, string, () => PolyRegularizer])[] = Object.freeze([
  [2, 'two', () => new TwoLineRegularizer()],
  [3, 'three', () => new ThreeLineRegularizer()],
  [4, 'four', () => new FourLineRegularizer()],
  [5, 'five', () => new FiveLineRegularizer()],
  [6, 'six', () => new SixLineRegularizer()],
  [8, 'eight', () => new EightLineRegularizer()],
] as const);

export class Regularizer {
  /** The job's config. No C++ regularizer reads `Config`; kept for the pipeline's contract. */
  readonly config: RecognizerConfig;

  constructor(config: RecognizerConfig) {
    this.config = config;
  }

  /** C++ `Regularizer::regularize(SimplePath*, const std::vector<Point>&, bool convex)`: rewrites `path` in place. */
  regularize(path: SimplePath, points: readonly Point[], convex: boolean): void {
    this.regularizeTraced(path, points, convex);
  }

  /**
   * `regularize`, returning which regularizers ran, in order: `polyline`, `one`, `curve`, or
   * `<count>:<feature>` (e.g. `four:1`; the feature is -1 when none was accepted and -2 when the
   * regularizer had none, its open path then going to PolyLine). For tests and the goldens.
   */
  regularizeTraced(path: SimplePath, points: readonly Point[], convex: boolean): string[] {
    const trace: string[] = [];
    const curveCount = path.curveCount();

    if (!convex) {
      if (curveCount === 0 && path.size > 0) {
        new PolyLineRegularizer().regularize(path);
        trace.push('polyline');
      }
      return trace;
    }

    if (curveCount === 0) {
      if (path.size === 1) {
        new OneLineRegularizer().regularize(path, points);
        trace.push('one');
      }
      for (const [size, name, make] of POLY_BY_SIZE) {
        if (path.size === size) {
          const fid = make().regularize(path, points);
          trace.push(`${name}:${String(fid)}`);
        }
      }
    } else if (curveCount === 1) {
      new CurveRegularizer().regularize(path);
      trace.push('curve');
    }
    return trace;
  }
}
