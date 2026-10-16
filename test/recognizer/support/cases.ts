// The named synthetic cases of the C++ CxPolyBudgetTest and of the ordered golden harness.
import {
  ellipse,
  hatch,
  overtrace,
  rect,
  rectTwice,
  scribble,
  spiral,
  triangle,
  zigzag,
  type LineSet,
} from './lineSets';

export interface NamedCase {
  readonly label: string;
  readonly make: () => LineSet;
  /** False: the all-nearby run is not a golden case (C++ `kCases`). */
  readonly nearby: boolean;
}

/** C++ `kCases` (CxPolyBudgetTest.cpp): the sorted-set golden. */
export const GOLDEN_CASES: readonly NamedCase[] = Object.freeze([
  { label: 'zigzag25', make: () => zigzag(25), nearby: true },
  { label: 'hatch25', make: () => hatch(25), nearby: true },
  { label: 'spiral10', make: () => spiral(10), nearby: true },
  { label: 'spiral15', make: () => spiral(15), nearby: true },
  { label: 'overtrace10', make: () => overtrace(10), nearby: true },
  { label: 'overtrace15', make: () => overtrace(15), nearby: false },
  { label: 'scribble12', make: () => scribble(12, 1234), nearby: true },
  { label: 'rect', make: rect, nearby: true },
  { label: 'triangle', make: triangle, nearby: true },
  { label: 'ellipse8', make: () => ellipse(8), nearby: true },
  { label: 'ellipse12', make: () => ellipse(12), nearby: true },
  { label: 'rect_twice', make: rectTwice, nearby: true },
]);

/** The ordered golden's cases: `GOLDEN_CASES` plus three 16-line sets at the line cap. */
export const ORDER_CASES: readonly NamedCase[] = Object.freeze([
  ...GOLDEN_CASES,
  { label: 'overtrace16', make: () => overtrace(16), nearby: true },
  { label: 'scribble16_98765', make: () => scribble(16, 98765), nearby: true },
  { label: 'spiral16', make: () => spiral(16), nearby: true },
]);

/** C++ `kPathological`: every one must hit the budget. */
export const PATHOLOGICAL_CASES: readonly NamedCase[] = Object.freeze([
  { label: 'overtrace18', make: () => overtrace(18), nearby: true },
  { label: 'overtrace19', make: () => overtrace(19), nearby: true },
  { label: 'overtrace20', make: () => overtrace(20), nearby: true },
  { label: 'overtrace25', make: () => overtrace(25), nearby: true },
  { label: 'scribble20_1234', make: () => scribble(20, 1234), nearby: true },
  { label: 'scribble20_98765', make: () => scribble(20, 98765), nearby: true },
  { label: 'scribble25_1234', make: () => scribble(25, 1234), nearby: true },
  { label: 'scribble25_98765', make: () => scribble(25, 98765), nearby: true },
  { label: 'spiral25', make: () => spiral(25), nearby: true },
]);
