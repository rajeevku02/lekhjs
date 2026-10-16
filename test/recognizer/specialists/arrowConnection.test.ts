// Focused tests of ArrowRecognizer and ConnectionRecognizer on synthetic scenes (GeoScene through
// SnapshotCanvasDelegate + RecordingCanvasDelegate). The expectations are derived by hand from the
// C++ (ArrowRecognizer.cpp, ConnectionRecognizer.cpp) with the default Config; each case says which
// branch it drives.
import { describe, expect, it } from 'vitest';
import { BezierCurve, Point, SimplePath } from '../../../src/geometry';
import { RECOGNIZER_CONFIG_DEFAULTS } from '../../../src/recognizer/core';
import { snapshotDelegate, type RecMutation, type RecordingCanvasDelegate } from '../../../src/recognizer/delegate';
import { ArrowRecognizer, ConnectionRecognizer } from '../../../src/recognizer/specialists';
import { GeoScene, geoLine, geoRect } from '../support/geoScene';

const cfg = RECOGNIZER_CONFIG_DEFAULTS;

function delegateFor(scene: GeoScene): RecordingCanvasDelegate {
  return snapshotDelegate({ store: scene, view: { zoom: 1, tx: 0, ty: 0 }, strokeWidth: 2, config: cfg });
}

function pathThrough(...vertices: Point[]): SimplePath {
  const sp = new SimplePath();
  for (let i = 1; i < vertices.length; i++) sp.addLine(vertices[i - 1] as Point, vertices[i] as Point);
  return sp;
}

function only(mutations: readonly RecMutation[]): RecMutation {
  expect(mutations).toHaveLength(1);
  return mutations[0] as RecMutation;
}

describe('ArrowRecognizer', () => {
  const chevron = (): SimplePath => pathThrough(new Point(285, 285), new Point(300, 300), new Point(285, 315));

  it('an open chevron at a bare line end adds an open arrowhead there (recognizeArrow)', () => {
    const scene = new GeoScene([geoLine('L', new Point(100, 300), new Point(300, 300))]);
    const d = delegateFor(scene);
    expect(new ArrowRecognizer(cfg).recognize(chevron(), false, new Set(), d)).toBe(true);
    expect(only(d.mutations())).toEqual({ op: 'arrow', objId: 'L', at: { x: 300, y: 300 }, add: true, solid: false });
  });

  it('the same chevron at an end that has an arrowhead erases it (recognizeArrowErase)', () => {
    const scene = new GeoScene([geoLine('L', new Point(100, 300), new Point(300, 300), [false, true])]);
    const d = delegateFor(scene);
    expect(new ArrowRecognizer(cfg).recognize(chevron(), false, new Set(), d)).toBe(true);
    expect(only(d.mutations())).toEqual({ op: 'arrow', objId: 'L', at: { x: 300, y: 300 }, add: false, solid: false });
  });

  it('a closed triangle at a line end adds a solid arrowhead (recognizeSolidArrow)', () => {
    const scene = new GeoScene([geoLine('L', new Point(100, 300), new Point(300, 300))]);
    const d = delegateFor(scene);
    const tri = pathThrough(new Point(285, 285), new Point(300, 300), new Point(285, 315), new Point(285, 285));
    expect(new ArrowRecognizer(cfg).recognize(tri, false, new Set(), d)).toBe(true);
    expect(only(d.mutations())).toEqual({ op: 'arrow', objId: 'L', at: { x: 300, y: 300 }, add: true, solid: true });
  });

  it('an extended path is not given an arrowhead', () => {
    const scene = new GeoScene([geoLine('L', new Point(100, 300), new Point(300, 300))]);
    const d = delegateFor(scene);
    expect(new ArrowRecognizer(cfg).recognize(chevron(), true, new Set(), d)).toBe(false);
    expect(d.mutations()).toEqual([]);
  });

  it('a chevron past two parallel lines of equal length makes a double-line arrow', () => {
    const scene = new GeoScene([
      geoLine('A', new Point(100, 280), new Point(300, 280)),
      geoLine('B', new Point(100, 320), new Point(300, 320)),
    ]);
    const d = delegateFor(scene);
    const stroke = pathThrough(new Point(290, 260), new Point(330, 300), new Point(290, 340));
    expect(new ArrowRecognizer(cfg).recognize(stroke, false, new Set(), d)).toBe(true);
    // centre = mean of the four ends; lineDist = 40; len = 200; the peak (330, 300) is nearer A's
    // point2 (300, 280) than its point1, so firstSide is false.
    expect(only(d.mutations())).toEqual({
      op: 'doubleLineArrow',
      obj1Id: 'A',
      obj2Id: 'B',
      seg1: { p1: { x: 100, y: 280 }, p2: { x: 300, y: 280 } },
      seg2: { p1: { x: 100, y: 320 }, p2: { x: 300, y: 320 } },
      center: { x: 200, y: 300 },
      lineDist: 40,
      len: 200,
      firstSide: false,
    });
  });

  it('excluded lines do not take part in a double-line arrow', () => {
    const scene = new GeoScene([
      geoLine('A', new Point(100, 280), new Point(300, 280)),
      geoLine('B', new Point(100, 320), new Point(300, 320)),
    ]);
    const d = delegateFor(scene);
    const stroke = pathThrough(new Point(290, 260), new Point(330, 300), new Point(290, 340));
    // with B excluded only A is near: no double-line arrow, and no line end is near the peak
    new ArrowRecognizer(cfg).recognize(stroke, false, new Set(['B']), d);
    expect(d.mutations().filter((m) => m.op === 'doubleLineArrow')).toEqual([]);
  });
});

describe('ConnectionRecognizer', () => {
  // A: x 150..250, y 250..350; B: x 450..550, y 250..350; C: x 450..550, y 450..550.
  const scene = (): GeoScene =>
    new GeoScene([
      geoRect('A', 200, 300, 100, 100),
      geoRect('B', 500, 300, 100, 100),
      geoRect('C', 500, 500, 100, 100),
    ]);

  it('a straight line between two shapes is an auto line (autoType 1) with the end angles', () => {
    const d = delegateFor(scene());
    const path = pathThrough(new Point(250, 300), new Point(450, 300));
    expect(new ConnectionRecognizer(cfg).recognize(path, path, false, new Set(), d)).toBe(true);
    expect(only(d.mutations())).toEqual({
      op: 'connect',
      obj1Id: 'A',
      obj2Id: 'B',
      type: 2,
      autoType: 1,
      params: [
        { angle: 0, autotype: 0 },
        { angle: Math.PI, autotype: 0 },
      ],
      val: 0,
      deletedIds: [],
    });
  });

  it('one right-angle corner is an auto elbow (autoType 2)', () => {
    const d = delegateFor(scene());
    const path = pathThrough(new Point(250, 300), new Point(500, 300), new Point(500, 450));
    expect(new ConnectionRecognizer(cfg).recognize(path, path, false, new Set(), d)).toBe(true);
    const m = only(d.mutations());
    expect(m).toMatchObject({ op: 'connect', obj1Id: 'A', obj2Id: 'C', type: 2, autoType: 2, params: [], val: 0 });
  });

  it('when that auto connection exists, the elbow is stored as orthogonal steps clipped at the outlines', () => {
    const s = scene();
    s.addConnection({ firstId: 'A', secondId: 'C', type: 2, autoType: 2 });
    const d = delegateFor(s);
    const path = pathThrough(new Point(250, 300), new Point(500, 300), new Point(500, 450));
    expect(new ConnectionRecognizer(cfg).recognize(path, path, false, new Set(), d)).toBe(true);
    expect(only(d.mutations())).toEqual({
      op: 'connect',
      obj1Id: 'A',
      obj2Id: 'C',
      type: 2,
      autoType: 0,
      params: [
        { step: 250, dx: 1, dy: 0, angle: 0, autotype: 0 },
        { step: 150, dx: 0, dy: 1, angle: -Math.PI / 2, autotype: 0 },
      ],
      val: 0,
      deletedIds: [],
    });
  });

  it('a reversed auto connection of the paired type (3 for 2) also counts as present', () => {
    const s = scene();
    s.addConnection({ firstId: 'C', secondId: 'A', type: 2, autoType: 3 });
    const d = delegateFor(s);
    expect(d.isAutoConnectionPresent('A', 'C', 2)).toBe(true);
    expect(d.isAutoConnectionPresent('A', 'C', 3)).toBe(false);
  });

  it('one convex curve is a curved connector bent to the curve side', () => {
    const d = delegateFor(scene());
    const curve = new SimplePath();
    curve.addCurve(new BezierCurve(new Point(250, 300), new Point(300, 200), new Point(400, 200), new Point(450, 300)));
    // `path` has a curve, so it is not a poly: the recognised path (here the same) is used
    expect(new ConnectionRecognizer(cfg).recognize(curve, curve, true, new Set(), d)).toBe(true);
    // the peak is above the chord (negative y in view), so the first end's angle is -60 degrees
    const c = { cdist1: 0.4, angle2: 0, angleauto: 1, cdistauto: 1 };
    expect(only(d.mutations())).toEqual({
      op: 'connect',
      obj1Id: 'A',
      obj2Id: 'B',
      type: 0,
      autoType: 0,
      params: [
        { ...c, angle1: -Math.PI / 3 },
        { ...c, angle1: Math.PI / 3 },
      ],
      val: 0,
      deletedIds: [],
    });
  });

  it('a polyline with a U-turn is a free path connector (type 3) with relative steps', () => {
    const d = delegateFor(scene());
    const path = pathThrough(new Point(250, 300), new Point(400, 300), new Point(350, 320), new Point(450, 300));
    expect(new ConnectionRecognizer(cfg).recognize(path, path, false, new Set(), d)).toBe(true);
    expect(only(d.mutations())).toEqual({
      op: 'connect',
      obj1Id: 'A',
      obj2Id: 'B',
      type: 3,
      autoType: 0,
      params: [
        { dx: 150, dy: 0, angle: 0 },
        { dx: -50, dy: 20 },
        { dx: 100, dy: -20, angle: Math.atan2(20, -150) },
      ],
      val: 0,
      deletedIds: [],
    });
  });

  it('declines when the ends are on one shape, or when recognizeConnection is off', () => {
    const d = delegateFor(scene());
    const inside = pathThrough(new Point(160, 300), new Point(240, 300));
    expect(new ConnectionRecognizer(cfg).recognize(inside, inside, false, new Set(), d)).toBe(false);
    const path = pathThrough(new Point(250, 300), new Point(450, 300));
    const off = { ...cfg, recognizeConnection: false };
    expect(new ConnectionRecognizer(off).recognize(path, path, false, new Set(), d)).toBe(false);
    expect(d.mutations()).toEqual([]);
  });

  it('passes the excluded set on as the deleted objects', () => {
    const d = delegateFor(scene());
    const path = pathThrough(new Point(250, 300), new Point(450, 300));
    expect(new ConnectionRecognizer(cfg).recognize(path, path, false, new Set(['ink1']), d)).toBe(true);
    expect(only(d.mutations())).toMatchObject({ op: 'connect', deletedIds: ['ink1'] });
  });
});
