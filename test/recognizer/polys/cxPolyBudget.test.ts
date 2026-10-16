// The budget cases of the ported C++ CxPolyBudgetTest (V-R1, V-R4, V-R5; AC-REC-07): the
// pathological sets hit `cxPolyMaxPolys` quickly and within the bound, the one-stroke closed
// shapes stay under it and still close, and the edge cases.
import { describe, expect, it } from 'vitest';
import { Span } from '../../../src/base';
import { Point } from '../../../src/geometry';
import { LineColl, MAX_LINES, RecInternalError, StrokeLine } from '../../../src/recognizer/lines';
import { PolyColl } from '../../../src/recognizer/polys';
import { PATHOLOGICAL_CASES } from '../support/cases';
import { makeEnv, runPolys } from '../support/env';
import { ellipse, overtrace, rect, rectTwice, triangle, zigzag, type LineSet } from '../support/lineSets';

/** cxPolyMaxPolys plus one poly's extensions (two per line at each end) plus the poly itself. */
function polyBound(set: LineSet, max = 3000): number {
  return max + 2 * set.lines().length + 1;
}

function timed(set: LineSet, inOrder: boolean, env = makeEnv()): { pc: PolyColl; ms: number } {
  const t0 = performance.now();
  const { pc } = runPolys(set, inOrder, env);
  return { pc, ms: performance.now() - t0 };
}

describe('CxPoly budget', () => {
  it('bounds the exponential blow-up of an over-traced circle (overtrace18)', () => {
    const set = overtrace(18);
    const { pc, ms } = timed(set, false);
    expect(pc.budgetExceeded()).toBe(true);
    expect(ms).toBeLessThan(500);
    expect(pc.polys().length).toBeLessThanOrEqual(polyBound(set));
  });

  it.each(PATHOLOGICAL_CASES.map((c) => [c.label, c] as const))('%s hits the budget within the bound', (_l, c) => {
    const set = c.make();
    const { pc, ms } = timed(set, false);
    expect(pc.budgetExceeded()).toBe(true);
    expect(pc.polys().length).toBeLessThanOrEqual(polyBound(set));
    expect(ms).toBeLessThan(500);
  });

  it('one-stroke closed shapes stay under the budget and still close', () => {
    for (const set of [rect(), triangle(), ellipse(8), ellipse(12), rectTwice()]) {
      const { pc } = runPolys(set, false);
      expect(pc.budgetExceeded(), set.name).toBe(false);
      // closed() is completed by features().
      const anyClosed = pc.polys().some((p) => {
        p.features();
        return p.closed();
      });
      expect(anyClosed, set.name).toBe(true);
    }
  });

  it('no lines: no polys, no budget', () => {
    const env = makeEnv();
    const lc = new LineColl(env.config);
    const pc = new PolyColl(env);
    pc.setLines(lc);
    pc.process();
    expect(pc.budgetExceeded()).toBe(false);
    expect(pc.polys()).toEqual([]);
  });

  it('one line never exceeds', () => {
    const env = makeEnv();
    const lc = new LineColl(env.config);
    lc.addLines([zigzag(2).lines()[0] as StrokeLine]);
    lc.setLineSearchInOrder(false);
    const pc = new PolyColl(env);
    pc.setLines(lc);
    pc.process();
    expect(pc.budgetExceeded()).toBe(false);
    expect(pc.polys().length).toBe(1);
  });

  it('a limit of 1 is exceeded on the first extension', () => {
    const set = rect();
    const { pc } = runPolys(set, false, makeEnv({}, { cxPolyMaxPolys: 1 }));
    expect(pc.budgetExceeded()).toBe(true);
    expect(pc.polys().length).toBeLessThanOrEqual(polyBound(set, 1));
  });

  it(`LineColl refuses more than ${String(MAX_LINES)} lines (the bitmask limit, R1)`, () => {
    const env = makeEnv();
    const pts = Array.from({ length: 64 }, (_, i) => new Point(i * 10, 0));
    const lines = Array.from({ length: MAX_LINES + 1 }, (_, i) => new StrokeLine(new Span(pts, i, i + 1)));
    const lc = new LineColl(env.config);
    expect(() => {
      lc.addLines(lines);
    }).toThrow(RecInternalError);
    lc.addLines(lines.slice(0, MAX_LINES));
    expect(lc.lines().map((l) => l.id)).toEqual(Array.from({ length: MAX_LINES }, (_, i) => i + 1));
  });
});
