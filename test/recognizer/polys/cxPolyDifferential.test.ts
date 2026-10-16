// AC-REC-08 (spec 07 §7.3): the optimised CxPolyAggregator (R1-R5) against the eager reference
// (the C++ algorithm translated as is), on every LineSetGenerators set and 1,000 seeded random
// sets: the same polys — line ids in part order, part ends, closed, turn direction — in the same
// order, the same budget outcome and the same produced count.
import { describe, expect, it } from 'vitest';
import { LineColl } from '../../../src/recognizer/lines';
import { CxPolyAggregator } from '../../../src/recognizer/polys';
import { ORDER_CASES, PATHOLOGICAL_CASES } from '../support/cases';
import { eagerAggregate } from '../support/eagerAggregator';
import { makeEnv } from '../support/env';
import { randomSet, type LineSet } from '../support/lineSets';

const env = makeEnv();

type Summary = { ids: number[]; pts: number[]; closed: boolean; turn: number }[];

function optimised(
  set: LineSet,
  inOrder: boolean,
  maxPolys: number,
): { s: Summary; exceeded: boolean; produced: number } {
  const e = maxPolys === env.config.cxPolyMaxPolys ? env : makeEnv({}, { cxPolyMaxPolys: maxPolys });
  const lc = new LineColl(e.config);
  lc.addLines(set.lines());
  lc.setLineSearchInOrder(inOrder);
  const aggr = new CxPolyAggregator(lc, e);
  aggr.process();
  const s = aggr.polys().map((p) => ({
    ids: p.lines.map((lp) => lp.line.id),
    pts: p.lines.flatMap((lp) => [lp.start.x, lp.start.y, lp.end.x, lp.end.y]),
    closed: p.closed(),
    turn: p.turnDir,
  }));
  return { s, exceeded: aggr.budgetExceeded(), produced: aggr.producedCount() };
}

function eager(set: LineSet, inOrder: boolean, maxPolys: number): { s: Summary; exceeded: boolean; produced: number } {
  const lc = new LineColl(env.config);
  lc.addLines(set.lines());
  lc.setLineSearchInOrder(inOrder);
  const r = eagerAggregate(lc, maxPolys, env.config.linePartEqualityDelta);
  const s = r.polys.map((p) => ({
    ids: p.lines.map((lp) => lp.line.id),
    pts: p.lines.flatMap((lp) => [lp.start.x, lp.start.y, lp.end.x, lp.end.y]),
    closed: p.closed,
    turn: p.turnDir,
  }));
  return { s, exceeded: r.budgetExceeded, produced: r.produced };
}

function compare(set: LineSet, inOrder: boolean, maxPolys = env.config.cxPolyMaxPolys): number {
  const a = optimised(set, inOrder, maxPolys);
  const b = eager(set, inOrder, maxPolys);
  expect(a.exceeded, set.name).toBe(b.exceeded);
  expect(a.produced, set.name).toBe(b.produced);
  expect(a.s, set.name).toEqual(b.s);
  return a.s.length;
}

describe('CxPolyAggregator vs the eager reference', () => {
  it.each(ORDER_CASES.map((c) => [c.label, c] as const))('LineSetGenerators %s, both modes', (_l, c) => {
    compare(c.make(), true);
    compare(c.make(), false);
  });

  it.each(PATHOLOGICAL_CASES.map((c) => [c.label, c] as const))(
    'pathological %s under a 400-poly budget (both stop at the same poly)',
    (_l, c) => {
      compare(c.make(), false, 400);
    },
  );

  it('1,000 seeded random sets (3-16 lines), both modes', () => {
    let polys = 0;
    let exceeded = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const n = 3 + (seed % 14);
      const set = randomSet(seed, n);
      polys += compare(set, true);
      // The all-nearby search under a smaller budget keeps the eager run short.
      const r = optimised(set, false, 600);
      if (r.exceeded) exceeded++;
      polys += compare(set, false, 600);
    }
    // The sets exercise the search (not all trivial) without all hitting the budget.
    expect(polys).toBeGreaterThan(5000);
    expect(exceeded).toBeLessThan(500);
  });
});
