// Small recognizer helpers (port of C++ `recognizer::Util`; `RecUtil` in spec 07, named
// `RecognizerUtil` under OQ-08). The helpers that read C++ `Config` take the job's config.
import { getDistance, type Point } from '../../geometry';
import type { RecognizerConfig } from '../core/RecognizerConfig';

/** Thrown when the recognizer reaches a state C++ treats as undefined behaviour (B6, `at`). */
export class RecInternalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecInternalError';
  }
}

/** C++ `Util::getErrSize`: range / 12. */
export function getErrSize(range: number): number {
  return range / 12;
}

/** C++ `Util::getErrSize2`: range / 7. */
export function getErrSize2(range: number): number {
  return range / 7;
}

/** C++ `Util::getConnectDistance`. */
export function getConnectDistance(entitySize: number, config: RecognizerConfig): number {
  return getErrSize2(entitySize) + config.closePointDistanceShort;
}

/** C++ `Util::canClose`: whether a gap closes a figure of the given size. */
export function canClose(gap: number, forSize: number, config: RecognizerConfig): boolean {
  if (gap > config.maxDistForPolygonClosing) return false;
  return gap < getErrSize2(forSize) + config.closePointDistanceShort;
}

/** C++ `Util::getErrSizeForLine`: the nearer end distance / 24. */
export function getErrSizeForLine(p1: Point, p2: Point, p: Point): number {
  const d1 = getDistance(p1, p);
  const d2 = getDistance(p, p2);
  return (d2 < d1 ? d2 : d1) / 24;
}

/** C++ `Util::isNegelctable` (spelling fixed): |x| within the error size of `context`. */
export function isNegligible(x: number, context: number, level: number): boolean {
  const err = level === 1 ? getErrSize(context) : getErrSize2(context);
  return Math.abs(x) <= Math.abs(err);
}

/** C++ `Util::areAlmostEqual`. */
export function areAlmostEqual(x: number, y: number, level: number): boolean {
  let min = x;
  let max = y;
  if (min > max) {
    min = y;
    max = x;
  }
  const err = level === 1 ? getErrSize(max) : getErrSize2(max);
  return max - min <= err;
}

/** C++ `Util::areComparableLenght` (spelling fixed): within max / factor of each other. */
export function areComparableLength(len1: number, len2: number, factor: number): boolean {
  if (len1 === len2) return true;
  let min = len1;
  let max = len2;
  if (min > max) {
    min = len2;
    max = len1;
  }
  return max <= min + max / factor;
}

/**
 * Asserting element access (C++ `base::Coll::at` / `std::vector::at` throw): an out-of-range
 * index throws `RecInternalError` instead of yielding `undefined`.
 */
export function at<T>(items: readonly T[], index: number): T {
  if (!Number.isInteger(index) || index < 0 || index >= items.length) {
    throw new RecInternalError(`index ${String(index)} out of range (size ${String(items.length)})`);
  }
  return items[index] as T;
}

/** The helpers as one object, for C++-style `RecognizerUtil.canClose(…)` calls. */
export const RecognizerUtil = Object.freeze({
  getErrSize,
  getErrSize2,
  getConnectDistance,
  canClose,
  getErrSizeForLine,
  isNegligible,
  areAlmostEqual,
  areComparableLength,
  at,
});
