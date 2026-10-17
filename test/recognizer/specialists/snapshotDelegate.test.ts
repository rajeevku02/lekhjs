// SnapshotCanvasDelegate's view <-> canvas mapping and the LekhCanvasDelegate query rules it ports,
// over a GeoScene.
import { describe, expect, it } from 'vitest';
import { LineSegment, Point, Rect, SimplePath } from '../../../src/geometry';
import { RECOGNIZER_CONFIG_DEFAULTS } from '../../../src/recognizer/core';
import { FetchShapeType, SnapshotCanvasDelegate, type RecViewTransform } from '../../../src/recognizer/delegate';
import { GeoScene, geoLine, geoRect } from '../support/geoScene';

// zoom 2, scroll (10, -20): view = (canvas + scroll) * 2
const view: RecViewTransform = { zoom: 2, tx: 20, ty: -40 };
const v = (x: number, y: number): Point => new Point((x + 10) * 2, (y - 20) * 2);

function delegate(scene: GeoScene, vt: RecViewTransform = view): SnapshotCanvasDelegate {
  return new SnapshotCanvasDelegate({ store: scene, view: vt, strokeWidth: 3, config: RECOGNIZER_CONFIG_DEFAULTS });
}

describe('SnapshotCanvasDelegate', () => {
  const scene = (): GeoScene =>
    new GeoScene([
      geoRect('S', 300, 300, 200, 100, new Rect(260, 290, 80, 20)),
      geoLine('L', new Point(100, 500), new Point(300, 500), [false, true]),
    ]);

  it('maps bounds, centre and distances to view (distance × zoom)', () => {
    const d = delegate(scene());
    expect(d.shapeBounds('S')).toEqual(new Rect(420, 460, 400, 200));
    expect(d.shapeCentre('S')).toEqual(v(300, 300));
    expect(d.distanceToOutline('S', v(300, 230))).toBeCloseTo(40);
    expect(d.isInsideShape('S', v(300, 300))).toBe(true);
    expect(d.isInsideShape('S', v(300, 240))).toBe(false);
    expect(d.isInsideTitle('S', v(300, 300))).toBe(true);
    expect(d.isInsideTitle('S', v(300, 330))).toBe(false);
    expect(d.getZoom()).toBe(2);
    expect(d.currentStrokeWidth()).toBe(3);
  });

  it('projects onto the outline and back to view', () => {
    const p = delegate(scene()).projectToOutline('S', v(300, 230));
    expect(p.x).toBeCloseTo(v(300, 250).x, 6);
    expect(p.y).toBeCloseTo(v(300, 250).y, 6);
  });

  // DR-REC-05: C++ intersected the view segment with the canvas outline (right only at zoom 1).
  it('getIntersections: crossings within the view segment, nearest first, in view coordinates', () => {
    const d = delegate(scene());
    const pts = d.getIntersections('S', new LineSegment(v(100, 300), v(450, 300)));
    expect(pts).toHaveLength(2);
    expect(pts[0]?.x).toBeCloseTo(v(200, 300).x, 6);
    expect(pts[1]?.x).toBeCloseTo(v(400, 300).x, 6);
    expect(d.getIntersections('S', new LineSegment(v(100, 300), v(150, 300)))).toEqual([]);
  });

  it('getExistingShapes(Line): open two-vertex lines with an end in a rect, once per rect', () => {
    const d = delegate(scene());
    const around = [Rect.fromCenter(v(300, 500), 10, 10)];
    const found = d.getExistingShapes(around, FetchShapeType.Line, new Set());
    expect(found.map((e) => e.object)).toEqual(['L']);
    expect(found[0]?.path.at(0).segment.point1()).toEqual(v(100, 500));
    expect(d.getExistingShapes([...around, ...around], FetchShapeType.Line, new Set())).toHaveLength(2);
    expect(d.getExistingShapes(around, FetchShapeType.Line, new Set(['L']))).toEqual([]);
    expect(d.getExistingShapes(around, FetchShapeType.All, new Set())).toEqual([]);
  });

  it('getArrowObjects: ends in view, stroke width × zoom', () => {
    const [a] = delegate(scene()).getArrowObjects();
    expect(a).toEqual({
      obj: 'L',
      strokeWidth: 4,
      isSingleCurve: false,
      points: [
        { p1: v(100, 500), p2: v(300, 500), hasArrow: false },
        { p1: v(300, 500), p2: v(100, 500), hasArrow: true },
      ],
    });
  });

  it('getShapesForConnection: two distinct shapes, centre in view and size × zoom', () => {
    const s = scene();
    s.add(geoRect('T', 600, 300, 100, 100));
    const d = delegate(s);
    expect(d.getShapesForConnection(v(400, 300), v(550, 300), new Set())).toEqual([
      { object: 'S', center: v(300, 300), width: 400, height: 200 },
      { object: 'T', center: v(600, 300), width: 200, height: 200 },
    ]);
    expect(d.getShapesForConnection(v(400, 300), v(550, 300), new Set(['T']))).toEqual([]);
  });

  it('getShapeForSelfLoop: the connect threshold is in view px (canvas gap = 32 / zoom)', () => {
    const d = delegate(scene());
    // 15 canvas px off the right edge = 30 view px: within 32
    expect(d.getShapeForSelfLoop(v(415, 300), v(300, 250))).toBe('S');
    // 17 canvas px = 34 view px: not
    expect(d.getShapeForSelfLoop(v(417, 300), v(300, 250))).toBeNull();
    // a line is never a self-loop shape
    expect(d.getShapeForSelfLoop(v(200, 500), v(250, 500))).toBeNull();
  });

  it('getPathsNear: the open line end the new segment can join, both sides as C++ measures them', () => {
    const d = delegate(scene(), { zoom: 1, tx: 0, ty: 0 });
    const near = d.getPathsNear(new LineSegment(new Point(310, 500), new Point(400, 500)));
    expect(near.map((e) => [e.object, e.side, e.dist, e.endPoint.x])).toEqual([
      ['L', 0, 10, 100],
      ['L', 1, 10, 300],
    ]);
    // the closed rectangle outline is never a join candidate
    expect(d.getPathsNear(new LineSegment(new Point(410, 300), new Point(450, 300)))).toEqual([]);
  });

  it('isInsideOtherObject ignores the object itself and non-connectable lines', () => {
    const s = scene();
    s.add(geoRect('N', 300, 185, 30, 20));
    const d = delegate(s);
    expect(d.isInsideOtherObject('S', v(300, 185))).toBe(true);
    expect(d.isInsideOtherObject('N', v(300, 185))).toBe(false);
    expect(d.isInsideOtherObject('S', v(200, 500))).toBe(false);
  });

  it('placePath is false without a placement hook, and delegates to it when present', () => {
    const s = scene();
    const path = new SimplePath();
    expect(delegate(s).placePath(path)).toBe(false);
    const seen: RecViewTransform[] = [];
    const withHook = Object.assign(s, {
      placePath: (_p: SimplePath, vt: RecViewTransform): boolean => {
        seen.push(vt);
        return true;
      },
    });
    expect(delegate(withHook).placePath(path)).toBe(true);
    expect(seen).toEqual([view]);
  });
});
