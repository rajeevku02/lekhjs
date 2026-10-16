// The LineAggregator contract (spec 07 §5.1; OQ-49: "the interface in §5.1 is the contract").
//
// THIS FILE IS THE HANDOFF SEAM FOR THE OWNER (human step H-REC-1). The real line aggregator is
// hand-translated by the owner into `lines/LineAggregatorImpl.ts`, which exports a
// `LineAggregatorModule`. Nothing else in the recognizer imports a concrete aggregator: the module
// reaches the pipeline through `RecognizerContext.lineAggregator` (AC-REC-06), and
// `lines/index.ts` binds `defaultLineAggregatorModule` to the stub until the handoff (a one-line
// change afterwards).
//
// C++ origin: `recognizer/LineAggreagtor.{h,cpp}` (file name misspelt in C++), class
// `recognizer::LineAggregator`. Its C++ instance API maps to `LineAggregator` below; its two C++
// statics (`getCost`, `isSingleLine`) map to the module's methods.
//
// Rules for an implementation (spec 07 §5.1):
//   - It may use any ported type in `recognizer/lines/` (`StrokeLine`, `LinePart`, `LinePoint`,
//     `Parts`, `RangeNumber`, `Probability`, `RecognizerUtil`), `geometry/` and `base/`. It must not
//     import `core/` (other than the `RecognizerConfig` type), `polys/` or anything outside
//     `base/` and `geometry/` (lint zone).
//   - It must be deterministic and must not read or write global or module-level state (lint
//     rule `lekhjs/no-module-state`). Every `create()` returns a fresh, independent instance.
//   - Numbers are JS doubles throughout; `PI` is `Math.PI` (OQ-46). No `Math.fround`.
//   - Points are view coordinates, already pre-processed by `GeoUtil.preProcess` (points closer
//     than 4 px to the last kept one dropped, intermediate points inserted).
import type { RecognizerConfig } from '../core/RecognizerConfig';
import type { RangeNumber } from './RangeNumber';
import type { LinePart, Points, StrokeLine } from './StrokeLine';

export type { Points } from './StrokeLine';

/**
 * Per-stroke segmentation of pre-processed points into `StrokeLine`s (C++ `LineAggregator`
 * instance methods). One instance per recognition job, made by `LineAggregatorModule.create`.
 *
 * The recognizer calls, in order: `setPoints(points)`, `process()`, then reads `lines()` once and
 * hands them to `LineColl.addLines`, which assigns `StrokeLine.id` = 1, 2, … in the returned
 * order. An aggregator must therefore not rely on `id` while it runs (use `gid` if it needs a
 * tag of its own; `LinePart.overlapSize` compares both `id` and `gid`).
 */
export interface LineAggregator {
  /**
   * C++ `setPoints(const Points&)`: reset, then take the stroke. `points` is a `Span<Point>`
   * (C++ `geometry::Points`, an inclusive index range) over the pre-processed point array; the
   * lines produced must be spans over the same array (`new StrokeLine(new Span(points.items, a, b),
   * cost)`), because later stages map line parts back to stroke points through it.
   */
  setPoints(points: Points): void;

  /** C++ `process()`: segment the points given to `setPoints`. */
  process(): void;

  /**
   * C++ `lines()`: the lines in drawing order (first point of the stroke first). Never null or
   * undefined: return `[]` when there is nothing (the C++ stub dereferences a null pointer here).
   * Each line's `cost` is its fitting cost (`RangeNumber`), compared by `LineRelation` with the
   * join cost `getCost` gives; lines made by joining two lines keep them as `subLines`
   * (`StrokeLine.merge`), which `LinePart.getSegments` descends into when the cost start exceeds
   * `lineAggregatorMaxJoinCost + 2`.
   */
  lines(): readonly StrokeLine[];

  /** C++ `reset()`: drop the points and lines of the previous stroke. */
  reset(): void;

  /** C++ `minCost()`: the join-cost threshold; starts at `config.lineAggregatorMaxJoinCost`. */
  minCost(): number;

  /** C++ `setMinCost(number_t)`. */
  setMinCost(cost: number): void;
}

/** What the recognizer needs from the module: a factory plus the two static cost functions. */
export interface LineAggregatorModule {
  /**
   * Identifies the implementation (`'stub'`, `'owner-v1'`, …). Recorded in the worker's `ready`
   * message and in the parity reference `MANIFEST.json` (`lineAggregatorId`, AC-REC-33).
   */
  readonly id: string;

  /**
   * A fresh aggregator for one job. `config` is the job's `RecognizerConfig`; the C++ constructor
   * reads `Config::instance().lineAggregatorMaxJoinCost` into `minCost`, so the implementation
   * reads it from `config` instead. Must not keep state between calls.
   */
  create(config: RecognizerConfig): LineAggregator;

  /**
   * C++ `static RangeNumber LineAggregator::getCost(const Points&)`: the cost of fitting one
   * straight line through `points` (a span over a temporary array of at least one point).
   * Called by `LineRelation` (C++ `LineRelation.cpp:71,186`) while it grows the join between
   * two adjacent line parts; the join stops once this cost exceeds both lines' own `cost`
   * (`RangeNumber.greaterThan(...).boolValue()`). It feeds `CxPoly.smoothness()`/`smoothness2()`,
   * and therefore curve-versus-polygon decisions. Pure: must not depend on any `create()`d state.
   */
  getCost(points: Points): RangeNumber;

  /**
   * C++ `static bool LineAggregator::isSingleLine(const LinePart&, const LinePart&)`: whether two
   * consecutive parts of a poly are really one straight line (then `LineRelation` skips the
   * corner between them in the smoothing factor, C++ `LineRelation.cpp:205`). `part1` ends where
   * `part2` starts, in poly order. Pure.
   */
  isSingleLine(part1: LinePart, part2: LinePart): boolean;
}
