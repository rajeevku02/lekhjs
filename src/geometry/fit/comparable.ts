// `recognizer::Util::areComparableLenght`, which the fitters call. A copy of the one function they
// need, so that `geometry/fit` does not import the recognizer (spec 01 §2.1); the recognizer's
// `RecUtil` keeps its own.

/** Are the two lengths within `max / factor` of each other? */
export function areComparableLength(len1: number, len2: number, factor: number): boolean {
  if (len1 === len2) return true;
  let min = len1;
  let max = len2;
  if (min > max) {
    min = len2;
    max = len1;
  }
  const err = max / factor;
  return max <= min + err;
}
