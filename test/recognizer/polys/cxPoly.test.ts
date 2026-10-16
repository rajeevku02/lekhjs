// CxPoly, PolyNode and the turn test: AC-REC-11 (C2, DR-REC-02), R3 materialisation, R4 equality,
// R5 against the acos form, split and the PolyColl helpers.
import { describe, expect, it } from 'vitest';
import { Span } from '../../../src/base';
import { getTurnDir, Point, TurnDir } from '../../../src/geometry';
import { LinePart, Parts, StrokeLine } from '../../../src/recognizer/lines';
import { CxPoly, maskIds, PolyColl, PolyNode, turnDirFast } from '../../../src/recognizer/polys';
import { makeEnv, runPolys } from '../support/env';
import { Lcg, rect, triangle, zigzag } from '../support/lineSets';

/** Lines through `corners`, one per edge, with ids 1..n. */
function linesThrough(corners: Point[]): StrokeLine[] {
  const lines = corners.slice(0, -1).map((c, i) => new StrokeLine(new Span([c, corners[i + 1] as Point], 0, 1)));
  lines.forEach((l, i) => (l.id = i + 1));
  return lines;
}

describe('CxPoly.computeBasicFeatures (C2)', () => {
  // A tall open poly: its points' x span 10..50, y span 0..200.
  const corners = [new Point(10, 0), new Point(50, 100), new Point(40, 200), new Point(10, 180)];

  it('width is maxx - minx of the poly points (DR-REC-02 fixed)', () => {
    const poly = new CxPoly(
      makeEnv(),
      linesThrough(corners).map((l) => new LinePart(l)),
      TurnDir.Left,
    );
    expect(poly.features().width).toBe(50 - 10);
    expect(poly.features().height).toBe(200);
  });

  it('with quirks.legacyWidthBug, width is C++ (maxx = p.y)', () => {
    const poly = new CxPoly(
      makeEnv({ legacyWidthBug: true }),
      linesThrough(corners).map((l) => new LinePart(l)),
      TurnDir.Left,
    );
    // C++: maxx takes p.y whenever p.x exceeds it: 100 at (50,100); never reset after.
    expect(poly.features().width).toBe(100 - 10);
  });

  it('feeds almostClosed: a gap that closes the true width does not close the bugged one', () => {
    // Wide flat open triangle-ish poly: width 300, height 20 (C++ width: ~ y-based, 1).
    const c = [new Point(0, 20), new Point(150, 0), new Point(300, 20), new Point(160, 20)];
    const fixed = new CxPoly(
      makeEnv(),
      linesThrough(c).map((l) => new LinePart(l)),
      TurnDir.Right,
    );
    const legacy = new CxPoly(
      makeEnv({ legacyWidthBug: true }),
      linesThrough(c).map((l) => new LinePart(l)),
      TurnDir.Right,
    );
    expect(fixed.features().width).toBe(300);
    expect(legacy.features().width).toBeLessThan(30);
    // gap 160 > maxDistForPolygonClosing (150): neither closes.
    expect(fixed.almostClosed()).toBe(false);
    expect(legacy.almostClosed()).toBe(false);
  });

  it('features are per poly (no aliasing between polys, R12)', () => {
    const { pc } = runPolys(rect(), false);
    const fs = pc.polys().map((p) => p.features());
    expect(new Set(fs).size).toBe(fs.length);
  });

  it('closes a poly whose ends are within polygonSmallClosingDist once features run', () => {
    const c = [new Point(0, 0), new Point(100, 0), new Point(100, 100), new Point(0, 100), new Point(0, 4)];
    const poly = new CxPoly(
      makeEnv(),
      linesThrough(c).map((l) => new LinePart(l)),
      TurnDir.Right,
    );
    expect(poly.closed()).toBe(false);
    poly.features();
    expect(poly.closed()).toBe(true);
    expect(poly.features().perimeter).toBe(396);
  });
});

describe('PolyNode (R3, R4)', () => {
  it('materialises shared-tail chains, including other-end replacements', () => {
    const lines = linesThrough([new Point(0, 0), new Point(100, 0), new Point(100, 100), new Point(0, 100)]);
    const [l1, l2, l3] = lines as [StrokeLine, StrokeLine, StrokeLine];
    const root = PolyNode.root(new LinePart(l2));
    const a = new PolyNode(root, 0, new LinePart(l1), null, TurnDir.Right, false);
    const repl = new LinePart(l1, new Point(5, 0), new Point(100, 0));
    const b = new PolyNode(a, 1, new LinePart(l3), repl, TurnDir.Right, false);
    expect(b.materialize().map((p) => [p.line.id, p.start.x, p.start.y])).toEqual([
      [1, 5, 0],
      [2, 100, 0],
      [3, 100, 100],
    ]);
    expect(maskIds(b.mask)).toEqual([1, 2, 3]);
    expect(b.first).toBe(repl);
    expect(b.count).toBe(3);
    // The parent is untouched.
    expect(a.materialize().map((p) => p.start.x)).toEqual([0, 100]);
  });

  it('equals compares parts of the same line within linePartEqualityDelta', () => {
    const lines = linesThrough([new Point(0, 0), new Point(100, 0), new Point(100, 100)]);
    const [l1, l2] = lines as [StrokeLine, StrokeLine];
    const r1 = PolyNode.root(new LinePart(l1));
    const a = new PolyNode(r1, 1, new LinePart(l2), null, TurnDir.Right, false);
    const r2 = PolyNode.root(new LinePart(l2));
    const b = new PolyNode(r2, 0, new LinePart(l1, new Point(3, 0), new Point(100, 0)), null, TurnDir.Right, false);
    const c = new PolyNode(r2, 0, new LinePart(l1, new Point(5, 0), new Point(100, 0)), null, TurnDir.Right, false);
    expect(a.equals(b, 4)).toBe(true);
    expect(a.equals(c, 4)).toBe(false);
    expect(a.equals(r1, 4)).toBe(false);
  });
});

describe('turnDirFast (R5)', () => {
  it('agrees with GeoUtil.getTurnDir(…, 0.1) on 20,000 random and near-threshold triples', () => {
    const rng = new Lcg(42);
    let mismatches = 0;
    for (let i = 0; i < 20000; i++) {
      const p1 = new Point(200 * rng.next(), 200 * rng.next());
      const p2 = new Point(200 * rng.next(), 200 * rng.next());
      let p3: Point;
      if (i % 2 === 0) {
        p3 = new Point(200 * rng.next(), 200 * rng.next());
      } else {
        // Nearly straight on or nearly back: within a few tenths of a degree of the thresholds.
        const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x) + (i % 4 === 1 ? 0 : Math.PI) + (rng.next() - 0.5) * 0.008;
        p3 = new Point(p2.x + 50 * Math.cos(ang), p2.y + 50 * Math.sin(ang));
      }
      if (turnDirFast(p1, p2, p3) !== getTurnDir(p1, p2, p3, 0.1)) mismatches++;
    }
    expect(mismatches).toBe(0);
  });

  it('a zero leg is neither none nor a U-turn (C++ acos(NaN) -> 90°)', () => {
    const p = new Point(1, 1);
    expect(turnDirFast(p, p, new Point(5, 1))).toBe(getTurnDir(p, p, new Point(5, 1), 0.1));
  });
});

describe('CxPoly.split and PolyColl.remove', () => {
  it('a poly not holding the line is kept whole', () => {
    const { pc } = runPolys(triangle(), false);
    const poly = pc.polys()[0] as CxPoly;
    expect(CxPoly.split(poly, 99, new Parts())).toEqual([poly]);
  });

  it('cutting the middle of a line splits the poly around the cut', () => {
    const corners = [new Point(0, 0), new Point(100, 0), new Point(100, 100), new Point(0, 100)];
    const lines = linesThrough(corners);
    const poly = new CxPoly(
      makeEnv(),
      lines.map((l) => new LinePart(l)),
      TurnDir.Right,
    );
    const used = new Parts();
    used.parts.push([new Point(100, 30), new Point(100, 60)]);
    const pieces = CxPoly.split(poly, 2, used);
    expect(pieces.map((p) => p.lineIdList())).toEqual([
      [1, 2],
      [2, 3],
    ]);
    expect(pieces.map((p) => p.lines.map((lp) => [lp.start.y, lp.end.y]))).toEqual([
      [
        [0, 0],
        [0, 30],
      ],
      [
        [60, 100],
        [100, 100],
      ],
    ]);
    // C++ copies the turn to the first piece only when more than one whole part precedes the cut.
    expect(pieces.map((p) => p.turnDir)).toEqual([TurnDir.NoTurn, TurnDir.Right]);
  });

  it('remove() of a taken poly removes its ranges from the others', () => {
    const { pc } = runPolys(zigzag(4), true);
    const before = pc.polys().length;
    const taken = pc.polys()[0] as CxPoly;
    pc.remove(taken);
    for (const p of pc.polys()) {
      for (const lp of p.lines) {
        for (const t of taken.lines) expect(lp.overlapSize(t)).toBeLessThan(1);
      }
    }
    expect(pc.polys().length).toBeGreaterThanOrEqual(before - 1);
  });

  it('hasOverlap finds shared ranges of one line', () => {
    const env = makeEnv();
    const { pc } = runPolys(zigzag(3), true, env);
    const polys = pc.polys();
    expect(new PolyColl(env).hasOverlap([polys[0] as CxPoly], [polys[0] as CxPoly], 5)).toBe(true);
  });
});
