// PathCaptureDrawingPlatform: the C++ capture rules — one path per startDrawing, lines and curves
// recorded, closePath back to the first point, and what makes a drawing complex.
import { describe, expect, it } from 'vitest';
import { BezierCurve, Point, Rect } from '../../src/geometry';
import { PathCaptureDrawingPlatform } from '../../src/render';
import { Style } from '../../src/style';
import { createTestTextStack } from '../../src/testing';
import { textStyleSnapshot } from '../../src/text';
import { fixedMeasurer } from '../text/helpers';

const pt = (x: number, y: number) => new Point(x, y);

function laidOut(text: string) {
  const stack = createTestTextStack({ measurer: fixedMeasurer(10) });
  return stack.layout.layout({
    text,
    style: textStyleSnapshot(new Style(), stack.resolver),
    box: new Rect(0, 0, 100, 100),
    wrapWidth: 100,
    angle: 0,
  });
}

describe('PathCaptureDrawingPlatform', () => {
  it('records a closed polyline as one plain path', () => {
    const dp = new PathCaptureDrawingPlatform();
    dp.startDrawing(pt(0, 0));
    dp.addLineTo(pt(10, 0));
    dp.addLineTo(pt(10, 10));
    dp.closePath();
    dp.endDrawing();
    expect(dp.isComplex()).toBe(false);
    expect(dp.paths()).toHaveLength(1);
    const p = dp.paths()[0];
    expect(p?.closed()).toBe(true);
    expect(p?.components.map((c) => [c.segment.p1.x, c.segment.p1.y, c.segment.p2.x, c.segment.p2.y])).toEqual([
      [0, 0, 10, 0],
      [10, 0, 10, 10],
      [10, 10, 0, 0],
    ]);
  });

  it('records curves as curve components and continues from their end point', () => {
    const dp = new PathCaptureDrawingPlatform();
    dp.startDrawing(pt(0, 0));
    const c = new BezierCurve(pt(0, 0), pt(1, 5), pt(4, 5), pt(5, 0));
    dp.addCurve(c);
    dp.addLineTo(pt(9, 0));
    dp.closePath();
    const comps = dp.paths()[0]?.components ?? [];
    expect(comps.map((x) => x.isCurve)).toEqual([true, false, false]);
    expect(comps[0]?.curve).not.toBe(c);
    expect([comps[1]?.segment.p1.x, comps[1]?.segment.p1.y]).toEqual([5, 0]);
    expect([comps[2]?.segment.p2.x, comps[2]?.segment.p2.y]).toEqual([0, 0]); // back to curve.point1
  });

  it('closePath on an empty path, and lines before startDrawing, record nothing', () => {
    const dp = new PathCaptureDrawingPlatform();
    dp.addLineTo(pt(1, 1));
    dp.closePath();
    dp.startDrawing(pt(0, 0));
    dp.closePath();
    expect(dp.paths()[0]?.size).toBe(0);
    expect(dp.paths()[0]?.closed()).toBe(false);
  });

  it('a moveTo inside a non-empty path is complex; at its start it is not', () => {
    const dp = new PathCaptureDrawingPlatform();
    dp.startDrawing(pt(0, 0));
    dp.moveTo(pt(1, 1));
    expect(dp.isComplex()).toBe(false);
    dp.addLineTo(pt(2, 2));
    dp.moveTo(pt(3, 3));
    expect(dp.isComplex()).toBe(true);
  });

  it.each<[string, (dp: PathCaptureDrawingPlatform) => void]>([
    [
      'addCircle',
      (dp) => {
        dp.addCircle();
      },
    ],
    [
      'addArc',
      (dp) => {
        dp.addArc();
      },
    ],
    [
      'addEllipse',
      (dp) => {
        dp.addEllipse();
      },
    ],
    [
      'addRoundedRect',
      (dp) => {
        dp.addRoundedRect();
      },
    ],
    [
      'drawImage',
      (dp) => {
        dp.drawImage();
      },
    ],
    [
      'translate',
      (dp) => {
        dp.translate();
      },
    ],
    [
      'clip',
      (dp) => {
        dp.clip();
      },
    ],
  ])('%s makes the drawing complex', (_n, f) => {
    const dp = new PathCaptureDrawingPlatform();
    f(dp);
    expect(dp.isComplex()).toBe(true);
  });

  it('save/restore do not; text does unless empty or ignored', () => {
    const dp = new PathCaptureDrawingPlatform();
    dp.saveContext();
    dp.restoreContext();
    dp.drawText(laidOut(''));
    expect(dp.isComplex()).toBe(false);
    dp.setIgnoreTextDraw(true);
    dp.drawText(laidOut('abc'));
    expect(dp.isComplex()).toBe(false);
    dp.setIgnoreTextDraw(false);
    dp.drawText(laidOut('\n')); // one empty line: the trailing break is dropped by the layout
    expect(dp.isComplex()).toBe(false);
    dp.drawText(laidOut('\nb'));
    expect(dp.isComplex()).toBe(true);
    const dp2 = new PathCaptureDrawingPlatform();
    dp2.drawText(laidOut('abc'));
    expect(dp2.isComplex()).toBe(true);
  });

  it('two startDrawing calls give two paths (the snapshot then treats the object as complex)', () => {
    const dp = new PathCaptureDrawingPlatform();
    dp.startDrawing(pt(0, 0));
    dp.addLineTo(pt(1, 0));
    dp.startDrawing(pt(5, 5));
    dp.addLineTo(pt(6, 5));
    expect(dp.paths()).toHaveLength(2);
  });
});
