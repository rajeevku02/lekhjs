// AC-REC-02 (spec 07 §10): the geometry/fit Quadrilateral and Triangle give the same answers and
// vertices as the C++ akaar versions they replace, on a 200-case golden each, within 1e-6 px.
// The golden is written by parity/tools/fit-golden/regen.mjs: `expect` is the C++ built with
// doubles and PI = π (the port's numeric model, OQ-46); `shipped` is the C++ as shipped (float).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Point, Quadrilateral, Triangle } from '../../../src/geometry';

type XY = [number, number];
interface QuadOut {
  isRectangle: boolean;
  isSquare: boolean;
  makeSquare: XY[];
  polish: XY[];
  polishAngle: number;
  regularize: XY[];
  regularizeAngle: number;
}
interface TriOut {
  isEquilateral: boolean;
  makeEquilateral: XY[];
}
interface Golden {
  cases: number;
  quads: { in: XY[]; expect: QuadOut; shipped: QuadOut }[];
  triangles: { in: XY[]; expect: TriOut; shipped: TriOut }[];
}

const golden = JSON.parse(
  readFileSync(path.join(import.meta.dirname, '../../fixtures/golden/fit-akaar.json'), 'utf8'),
) as Golden;

const TOL = 1e-6;
const pts = (a: XY[]): Point[] => a.map(([x, y]) => new Point(x, y));
const quad = (a: XY[]): Quadrilateral => {
  const [p1, p2, p3, p4] = pts(a);
  if (p4 === undefined || p1 === undefined || p2 === undefined || p3 === undefined) throw new Error('bad case');
  return new Quadrilateral(p1, p2, p3, p4);
};
const tri = (a: XY[]): Triangle => {
  const [p1, p2, p3] = pts(a);
  if (p3 === undefined || p1 === undefined || p2 === undefined) throw new Error('bad case');
  return new Triangle(p1, p2, p3);
};
function maxDiff(got: Point[], want: XY[]): number {
  let m = 0;
  want.forEach(([x, y], i) => {
    const g = got[i];
    m = Math.max(m, Math.abs((g?.x ?? NaN) - x), Math.abs((g?.y ?? NaN) - y));
  });
  return Number.isNaN(m) ? Infinity : m;
}

describe('AC-REC-02: geometry/fit against the C++ akaar golden', () => {
  it('has 200 cases of each, covering both answers', () => {
    expect(golden.cases).toBe(200);
    expect(golden.quads.length).toBe(200);
    expect(golden.triangles.length).toBe(200);
    const rect = golden.quads.filter((q) => q.expect.isRectangle).length;
    const sq = golden.quads.filter((q) => q.expect.isSquare).length;
    const eq = golden.triangles.filter((t) => t.expect.isEquilateral).length;
    for (const n of [rect, sq, eq]) {
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThan(200);
    }
  });

  it('Quadrilateral.isRectangle (implicit containers) and isSquare match on every case', () => {
    for (const [i, c] of golden.quads.entries()) {
      expect(quad(c.in).isRectangle(), `quad ${String(i)}`).toBe(c.expect.isRectangle);
      expect(quad(c.in).isSquare(), `quad ${String(i)}`).toBe(c.expect.isSquare);
    }
  });

  it('Quadrilateral.makeSquare gives the same vertices within 1e-6 px', () => {
    let worst = 0;
    for (const c of golden.quads) {
      const q = quad(c.in);
      q.makeSquare();
      worst = Math.max(worst, maxDiff(q.points(), c.expect.makeSquare));
    }
    expect(worst).toBeLessThanOrEqual(TOL);
  });

  it('Quadrilateral.regularize matches fitter::Quadrilateral::regualarize (1e-6 px, angle 1e-9)', () => {
    let worst = 0;
    for (const [i, c] of golden.quads.entries()) {
      const q = quad(c.in);
      q.regularize();
      worst = Math.max(worst, maxDiff(q.points(), c.expect.regularize));
      expect(Math.abs(q.angle() - c.expect.regularizeAngle), `quad ${String(i)}`).toBeLessThanOrEqual(1e-9);
    }
    expect(worst).toBeLessThanOrEqual(TOL);
  });

  it('akaar polish gives the same vertices; its angle differs only where areHorizontalLine does', () => {
    // fitter::Quadrilateral::areHorizontalLine tests the members p1_/p2_ and ignores its
    // arguments; the akaar one tests its arguments. Only the reported rotation can differ.
    let worst = 0;
    let angleDiffers = 0;
    for (const c of golden.quads) {
      const q = quad(c.in);
      q.regularize();
      worst = Math.max(worst, maxDiff(q.points(), c.expect.polish));
      if (Math.abs(q.angle() - c.expect.polishAngle) > 1e-9) angleDiffers++;
    }
    expect(worst).toBeLessThanOrEqual(TOL);
    expect(angleDiffers).toBe(1);
  });

  it('Triangle.isEquilateral matches and makeEquilateral gives the same vertices within 1e-6 px', () => {
    let worst = 0;
    for (const [i, c] of golden.triangles.entries()) {
      expect(tri(c.in).isEquilateral(), `triangle ${String(i)}`).toBe(c.expect.isEquilateral);
      const t = tri(c.in);
      t.makeEquilateral();
      worst = Math.max(worst, maxDiff([t.p1, t.p2, t.p3], c.expect.makeEquilateral));
    }
    expect(worst).toBeLessThanOrEqual(TOL);
  });

  it('the shipped float C++ takes the same decisions (information: coordinates differ by float rounding)', () => {
    let worst = 0;
    for (const c of golden.quads) {
      expect(c.shipped.isRectangle).toBe(c.expect.isRectangle);
      expect(c.shipped.isSquare).toBe(c.expect.isSquare);
      const q = quad(c.in);
      q.makeSquare();
      worst = Math.max(worst, maxDiff(q.points(), c.shipped.makeSquare));
    }
    for (const c of golden.triangles) expect(c.shipped.isEquilateral).toBe(c.expect.isEquilateral);
    // float has ~7 significant digits; the cases reach ~1,000 px
    expect(worst).toBeLessThan(1e-3);
  });
});
