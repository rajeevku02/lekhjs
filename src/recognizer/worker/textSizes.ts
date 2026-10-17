// The text sizes a job's snapshot carries (spec 07 §6.4 step 4, §6.7): the worker never measures
// text, but reading some objects back asks for a text's size (auto-sized text boxes, `textwidth`
// / `textheight` data expressions, generator `textSize`). The main thread re-reads the snapshot
// objects with the measurements tapped and ships the answers, keyed by what a measurement depends
// on: the text, the style's effective font (before the host's font resolution, which the main
// thread did) and the constraint.
import type { Size } from '../../geometry';
import { FontSpec, type Style } from '../../style';

/** The key of one measurement. */
export function measureKey(text: string, style: Style, constraint: Size): string {
  const f = FontSpec.of(style);
  return JSON.stringify([
    text,
    f.family,
    f.modifier,
    f.weight,
    f.style,
    f.size,
    f.multiplier,
    constraint.width,
    constraint.height,
  ]);
}
