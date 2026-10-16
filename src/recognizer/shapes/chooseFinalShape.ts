// The choice `ShapeColl.takeOut` makes among the candidate shapes (C++ `ShapeColl.cpp:79-95`), with
// bug fix C1 (DR-REC-01). `ShapeColl` itself is ported with the rest of `shapes/` (task R2) and
// calls this.
//
// C++ takes the first final shape without recording its perimeter (`pm` stays 0), so any later
// final shape with a perimeter attribute replaces it: the first final shape can never win when
// another exists. Fixed: the final shape with the largest perimeter attribute wins (a missing
// attribute counts as 0), the first one on ties (strict `>`).

/**
 * The winning final shape, or null when no shape is final. `legacy` (the test-only quirk
 * `RecognizerQuirks.legacyTakeOut`) gives the C++ answer instead.
 */
export function chooseFinalShape<S>(
  shapes: readonly S[],
  isFinal: (shape: S) => boolean,
  perimeterOf: (shape: S) => number | undefined,
  legacy = false,
): S | null {
  let chosen: S | null = null;
  let pm = 0;
  for (const sp of shapes) {
    if (!isFinal(sp)) continue;
    if (legacy) {
      if (chosen === null) {
        chosen = sp;
      } else {
        const p = perimeterOf(sp);
        if (p !== undefined && pm < p) {
          pm = p;
          chosen = sp;
        }
      }
      continue;
    }
    const p = perimeterOf(sp) ?? 0;
    if (chosen === null || p > pm) {
      chosen = sp;
      pm = p;
    }
  }
  return chosen;
}
