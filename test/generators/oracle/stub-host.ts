// The deterministic host the generator suites share (spec 04 §13): the real `split`,
// `splitLines`, `parseSizeSpec` and `monthInfo`, with a stub text measure (7 per character of the
// longest line, 14 per line) and stroke width 1.5.
import { monthInfo, parseSizeSpec, split, splitLines } from '../../../src/generators';
import type { GeneratorContext } from '../../../src/template';

/** The stub measure both sides use. */
export function stubMeasure(s: string): { w: number; h: number } {
  const lines = s.split('\n');
  return { w: 7 * Math.max(...lines.map((l) => Array.from(l).length)), h: 14 * lines.length };
}

export const STUB_HOST: GeneratorContext = Object.freeze({
  textSize: stubMeasure,
  strokeWidth: () => 1.5,
  splitLines,
  split: (s: string, o: Parameters<GeneratorContext['split']>[1]) => split(s, o, stubMeasure),
  parseSizeSpec,
  monthInfo,
});
