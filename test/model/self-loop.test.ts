// Self-loops (port of the C++ SelfLoopTest suite, the route and side cases): on a
// 200 × 100 rectangle centred at (400, 250), unrotated and rotated 30°.
import { describe, expect, it } from 'vitest';
import { CONFIG_DEFAULTS } from '../../src/base';
import { Point, normalizeAngleInPI, rotatePoint } from '../../src/geometry';
import {
  Bend,
  ConnectionObject,
  ConnectionType,
  SelfLoopError,
  Side,
  SideRelation,
  relationOf,
  selfLoopDefaults,
  selfLoopParams,
  sideOfAngle,
  worldSideOf,
  type ParamMap,
} from '../../src/model';
import { kindsEnv, layOut, rect, type KindsEnv } from './kinds';

const PI = Math.PI;
const ROT30 = PI / 6;
const C = new Point(400, 250);
const HW = 100;
const HH = 50;
const END_GAP = 6;

function makeRect(env: KindsEnv, rotation = 0) {
  const r = rect(env, C.x, C.y, 2 * HW, 2 * HH, rotation);
  layOut(r);
  return r;
}

function sideNormal(s: Side): number {
  return s === Side.Right ? 0 : s === Side.Bottom ? PI / 2 : s === Side.Left ? PI : -PI / 2;
}
const unit = (a: number) => new Point(Math.cos(a), Math.sin(a));
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
function local(p: Point, rotation: number): Point {
  const q = rotatePoint(p, C, -rotation);
  return new Point(q.x - C.x, q.y - C.y);
}
function angleOn(side: Side, along = 0): number {
  switch (side) {
    case Side.Right:
      return Math.atan2(along * HH, HW);
    case Side.Left:
      return Math.atan2(along * HH, -HW);
    case Side.Bottom:
      return Math.atan2(HH, along * HW);
    case Side.Top:
      return Math.atan2(-HH, along * HW);
  }
}
function onSide(p: Point, side: Side, rotation: number): boolean {
  const q = local(p, rotation);
  switch (side) {
    case Side.Right:
      return Math.abs(q.x - HW) <= END_GAP && Math.abs(q.y) <= HH;
    case Side.Left:
      return Math.abs(q.x + HW) <= END_GAP && Math.abs(q.y) <= HH;
    case Side.Bottom:
      return Math.abs(q.y - HH) <= END_GAP && Math.abs(q.x) <= HW;
    case Side.Top:
      return Math.abs(q.y + HH) <= END_GAP && Math.abs(q.x) <= HW;
  }
}
function worldDir(s: Side): Point {
  return s === Side.Right
    ? new Point(1, 0)
    : s === Side.Bottom
      ? new Point(0, 1)
      : s === Side.Left
        ? new Point(-1, 0)
        : new Point(0, -1);
}

function routeSamples(con: ConnectionObject): Point[] {
  layOut(con);
  const pts: Point[] = [];
  const bz = con.routeCurves()[0];
  if (bz !== undefined) {
    for (let i = 0; i <= 64; i++) pts.push(bz.getPoint(i / 64));
    return pts;
  }
  const r = con.routePoints();
  for (let i = 0; i + 1 < r.length; i++) {
    const a = r[i] as Point;
    const b = r[i + 1] as Point;
    for (let k = 0; k < 16; k++) pts.push(new Point(a.x + (b.x - a.x) * (k / 16), a.y + (b.y - a.y) * (k / 16)));
  }
  const last = r[r.length - 1];
  if (last !== undefined) pts.push(last);
  return pts;
}

interface LoopCase {
  label: string;
  from: Side;
  to: Side;
  alongFrom: number;
  alongTo: number;
  bend: Bend;
  relation: SideRelation;
  bendSide: Side;
}
const CASES: LoopCase[] = [
  {
    label: 'same_right_right',
    from: Side.Right,
    to: Side.Right,
    alongFrom: -0.5,
    alongTo: 0.5,
    bend: Bend.Auto,
    relation: SideRelation.Same,
    bendSide: Side.Top,
  },
  {
    label: 'adjacent_right_top',
    from: Side.Right,
    to: Side.Top,
    alongFrom: 0,
    alongTo: 0,
    bend: Bend.Auto,
    relation: SideRelation.Adjacent,
    bendSide: Side.Top,
  },
  {
    label: 'opposite_right_left_top',
    from: Side.Right,
    to: Side.Left,
    alongFrom: 0,
    alongTo: 0,
    bend: Bend.Top,
    relation: SideRelation.Opposite,
    bendSide: Side.Top,
  },
  {
    label: 'opposite_right_left_bottom',
    from: Side.Right,
    to: Side.Left,
    alongFrom: 0,
    alongTo: 0,
    bend: Bend.Bottom,
    relation: SideRelation.Opposite,
    bendSide: Side.Bottom,
  },
  {
    label: 'opposite_top_bottom_left',
    from: Side.Top,
    to: Side.Bottom,
    alongFrom: 0,
    alongTo: 0,
    bend: Bend.Left,
    relation: SideRelation.Opposite,
    bendSide: Side.Left,
  },
  {
    label: 'opposite_top_bottom_right',
    from: Side.Top,
    to: Side.Bottom,
    alongFrom: 0,
    alongTo: 0,
    bend: Bend.Right,
    relation: SideRelation.Opposite,
    bendSide: Side.Right,
  },
];

const ROWS = [ConnectionType.Curve, ConnectionType.MultiLine].flatMap((type) =>
  [0, ROT30].flatMap((rotation) => CASES.map((c) => ({ type, rotation, c }))),
);

describe('self-loop routes (AC-S1)', () => {
  it.each(
    ROWS.map(
      (r) =>
        [
          `${r.type === ConnectionType.Curve ? 'curve' : 'orthogonal'}_${r.c.label}${r.rotation !== 0 ? '_rot30' : ''}`,
          r,
        ] as const,
    ),
  )('%s draws a visible loop outside the shape', (_name, { type, rotation, c }) => {
    const env = kindsEnv();
    const shape = makeRect(env, rotation);
    const opts = { ...selfLoopDefaults(env.config), bend: c.bend };
    const r = selfLoopParams(
      type,
      shape,
      angleOn(c.from, c.alongFrom) + rotation,
      angleOn(c.to, c.alongTo) + rotation,
      opts,
      env.config,
    );
    expect(r.error).toBe(SelfLoopError.None);
    const con = ConnectionObject.getConnection(env, shape, shape, type, r.params);
    expect(con.isSelfLoop()).toBe(true);
    const pts = routeSamples(con);
    expect(pts.length).toBeGreaterThanOrEqual(3);
    expect(onSide(pts[0] as Point, c.from, rotation)).toBe(true);
    expect(onSide(pts[pts.length - 1] as Point, c.to, rotation)).toBe(true);
    for (let i = 1; i + 1 < pts.length; i++) expect(shape.isPointInside(pts[i] as Point)).toBe(false);
    let reach = 0;
    for (const p of pts) {
      const q = local(p, rotation);
      reach = Math.max(reach, Math.abs(q.x) - HW, Math.abs(q.y) - HH);
    }
    expect(reach).toBeGreaterThan(15);
    const params = con.getParams();
    if (type === ConnectionType.MultiLine) {
      const want = c.relation === SideRelation.Same ? 3 : c.relation === SideRelation.Adjacent ? 4 : 5;
      expect(params).toHaveLength(want);
      expect((params[0] as ParamMap)['autotype']).toBe(0);
      const route = con.routePoints();
      const wFrom = worldSideOf(shape, c.from);
      const wTo = worldSideOf(shape, c.to);
      const r0 = route[0] as Point;
      const r1 = route[1] as Point;
      const rl = route[route.length - 1] as Point;
      const rl2 = route[route.length - 2] as Point;
      const first = new Point(r1.x - r0.x, r1.y - r0.y);
      const last = new Point(rl.x - rl2.x, rl.y - rl2.y);
      expect(dot(first, worldDir(wFrom))).toBeCloseTo(Math.hypot(first.x, first.y), 6);
      expect(dot(last, worldDir(wTo))).toBeCloseTo(-Math.hypot(last.x, last.y), 6);
      if (c.relation === SideRelation.Opposite) {
        const bn = worldDir(c.bendSide);
        const box = shape.selectionRect().getPoints();
        const edge = Math.max(...box.map((p) => dot(p, bn)));
        const furthest = Math.max(...route.map((p) => dot(p, bn)));
        expect(Math.abs(furthest - edge - CONFIG_DEFAULTS.selfLoopClearance)).toBeLessThanOrEqual(1);
      }
    } else {
      for (const pm of params) {
        expect(pm['angleauto']).toBe(0);
        expect(pm['cdistauto']).toBe(0);
      }
      const bz = con.routeCurves()[0];
      if (bz === undefined) throw new Error('no curve');
      if (c.relation !== SideRelation.Opposite) {
        const out1 = Math.atan2(bz.point2.y - bz.point1.y, bz.point2.x - bz.point1.x);
        const out2 = Math.atan2(bz.point3.y - bz.point4.y, bz.point3.x - bz.point4.x);
        expect(Math.abs(normalizeAngleInPI(out1 - sideNormal(c.from) - rotation))).toBeLessThan(0.01);
        expect(Math.abs(normalizeAngleInPI(out2 - sideNormal(c.to) - rotation))).toBeLessThan(0.01);
      } else {
        const bn = unit(sideNormal(c.bendSide) + rotation);
        const edge = c.bendSide === Side.Left || c.bendSide === Side.Right ? HW : HH;
        let towards = -1e9;
        let away = -1e9;
        for (const p of pts) {
          const d = new Point(p.x - C.x, p.y - C.y);
          towards = Math.max(towards, dot(d, bn));
          away = Math.max(away, -dot(d, bn));
        }
        expect(towards).toBeGreaterThan(edge);
        expect(away).toBeLessThan(edge);
      }
    }
  });
});

describe('self-loop sides', () => {
  it('sideOfAngle, worldSideOf, relationOf', () => {
    const env = kindsEnv();
    const shape = makeRect(env);
    expect(sideOfAngle(shape, 0)).toBe(Side.Right);
    expect(sideOfAngle(shape, PI / 2)).toBe(Side.Bottom);
    expect(sideOfAngle(shape, PI)).toBe(Side.Left);
    expect(sideOfAngle(shape, (3 * PI) / 2)).toBe(Side.Top);
    expect(sideOfAngle(shape, 0.4)).toBe(Side.Right);
    expect(sideOfAngle(shape, 0.5)).toBe(Side.Bottom);
    const rotated = makeRect(env, ROT30);
    expect(sideOfAngle(rotated, ROT30)).toBe(Side.Right);
    expect(sideOfAngle(rotated, ROT30 - PI / 2)).toBe(Side.Top);
    expect(worldSideOf(rotated, Side.Right)).toBe(Side.Right);
    expect(worldSideOf(rotated, Side.Top)).toBe(Side.Top);
    const steep = makeRect(env, PI / 3);
    expect(worldSideOf(steep, Side.Right)).toBe(Side.Bottom);
    expect(worldSideOf(steep, Side.Top)).toBe(Side.Right);
    expect(relationOf(Side.Top, Side.Top)).toBe(SideRelation.Same);
    expect(relationOf(Side.Top, Side.Left)).toBe(SideRelation.Adjacent);
    expect(relationOf(Side.Left, Side.Right)).toBe(SideRelation.Opposite);
  });

  it('line and path types are not loop types; ends too close are refused', () => {
    const env = kindsEnv();
    const shape = makeRect(env);
    const opts = selfLoopDefaults(env.config);
    expect(selfLoopParams(ConnectionType.GenericLine, shape, 0, PI, opts, env.config).error).toBe(
      SelfLoopError.TypeNotAllowed,
    );
    expect(selfLoopParams(ConnectionType.Path, shape, 0, PI, opts, env.config).error).toBe(
      SelfLoopError.TypeNotAllowed,
    );
    expect(selfLoopParams(ConnectionType.Curve, shape, 0, 0.01, { ...opts, minEndDist: 40 }, env.config).error).toBe(
      SelfLoopError.EndsTooClose,
    );
  });

  it('a loop changing type keeps its ends; a change to a straight line is a no-op', () => {
    const env = kindsEnv();
    const shape = makeRect(env);
    const r = selfLoopParams(
      ConnectionType.Curve,
      shape,
      angleOn(Side.Right),
      angleOn(Side.Top),
      selfLoopDefaults(env.config),
      env.config,
    );
    const con = ConnectionObject.getConnection(env, shape, shape, ConnectionType.Curve, r.params);
    const before = con.selfLoopEndAngles();
    con.changeTypeTo(ConnectionType.MultiLine);
    expect(con.getType()).toBe(ConnectionType.MultiLine);
    const after = con.selfLoopEndAngles();
    expect(after.from).toBeCloseTo(before.from);
    expect(after.to).toBeCloseTo(before.to);
    con.changeTypeTo(ConnectionType.GenericLine);
    expect(con.getType()).toBe(ConnectionType.MultiLine);
  });
});
