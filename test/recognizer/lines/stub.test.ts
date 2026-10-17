// The LineAggregator seam (spec 07 §5.1-§5.2): the stub module finds no lines, never returns null,
// and stays exported for tests that need no lines (the default binding since M1 is the owner's
// module, test/recognizer/lines/impl.test.ts).
import { describe, expect, it } from 'vitest';
import { Span } from '../../../src/base';
import { Point } from '../../../src/geometry';
import { RECOGNIZER_CONFIG_DEFAULTS, recognizerConfigWith } from '../../../src/recognizer/core/RecognizerConfig';
import {
  LinePart,
  StrokeLine,
  StubLineAggregator,
  defaultLineAggregatorModule,
  stubLineAggregatorModule,
} from '../../../src/recognizer/lines';

describe('StubLineAggregator', () => {
  it('is no longer the default module (M1), and keeps its id', () => {
    expect(defaultLineAggregatorModule).not.toBe(stubLineAggregatorModule);
    expect(stubLineAggregatorModule.id).toBe('stub');
  });

  it('turns any stroke into no lines, and lines() is never null', () => {
    const agg = stubLineAggregatorModule.create(RECOGNIZER_CONFIG_DEFAULTS);
    expect(agg).toBeInstanceOf(StubLineAggregator);
    expect(agg.lines()).toEqual([]);
    const pts = [new Point(0, 0), new Point(10, 0), new Point(20, 5)];
    agg.setPoints(Span.of(pts));
    agg.process();
    expect(agg.lines()).toEqual([]);
    agg.reset();
    expect(agg.lines()).toEqual([]);
  });

  it('starts minCost at lineAggregatorMaxJoinCost and gives a fresh state per create()', () => {
    const a = stubLineAggregatorModule.create(recognizerConfigWith({ lineAggregatorMaxJoinCost: 9 }));
    const b = stubLineAggregatorModule.create(RECOGNIZER_CONFIG_DEFAULTS);
    expect(a.minCost()).toBe(9);
    a.setMinCost(3);
    expect(a.minCost()).toBe(3);
    expect(b.minCost()).toBe(7);
  });

  it('getCost is RangeNumber(0, 0) and isSingleLine is false', () => {
    const pts = [new Point(0, 0), new Point(10, 0), new Point(20, 0)];
    const cost = stubLineAggregatorModule.getCost(Span.of(pts));
    expect([cost.start, cost.end]).toEqual([0, 0]);
    const l1 = new StrokeLine(new Span(pts, 0, 1));
    const l2 = new StrokeLine(new Span(pts, 1, 2));
    expect(stubLineAggregatorModule.isSingleLine(new LinePart(l1), new LinePart(l2))).toBe(false);
  });
});
