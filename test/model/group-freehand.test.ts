// GroupObject (members, factors, transform, style, clone, hit tests in a store) and
// UnrecognizedObject (kind freehand: the stroke, distance, never inside, flip).
import { describe, expect, it } from 'vitest';
import { Point, Rect } from '../../src/geometry';
import {
  GroupObject,
  ObjectKind,
  UnrecognizedObject,
  isFreehand,
  isGroup,
  type LekhObject,
  type TemplatedObject,
} from '../../src/model';
import { LogPlatform } from '../template/helpers';
import { paintEnv } from './helpers';
import { kindsEnv, kindsStore, layOut, modCtx, rect } from './kinds';

describe('GroupObject', () => {
  it('members sorted by order, box = union, factors restore positions after a move', () => {
    const env = kindsEnv();
    const a = rect(env, 0, 0, 20, 20);
    const b = rect(env, 100, 50, 20, 20);
    a.order = 200;
    b.order = 100;
    const g = new GroupObject(env, [a, b]);
    expect(g.kind).toBe(ObjectKind.Group);
    expect(isGroup(g)).toBe(true);
    expect(g.objects().map((c) => c.object)).toEqual([b, a]);
    expect(g.selectionRect()).toEqual(new Rect(-10, -10, 120, 70));
    g.setRect(new Rect(-10 + 50, -10, 120, 70));
    expect(a.getCenter().x).toBeCloseTo(50);
    expect(b.getCenter().x).toBeCloseTo(150);
    g.setRect(new Rect(-10, -10, 240, 70)); // twice as wide
    expect(b.ds.width()).toBeCloseTo(40);
    expect(b.getCenter().x).toBeCloseTo(210);
  });

  it('hit tests flatten to members; the group style copies member 0', () => {
    const env = kindsEnv();
    const store = kindsStore(env);
    const a = rect(env, 0, 0, 20, 20);
    const b = rect(env, 100, 0, 20, 20);
    a.getDrawingProfile().setStrokeWidth(3);
    const g = new GroupObject(env, [a, b]);
    store.add(g);
    expect(store.hit.objectContaining(new Point(100, 0), { flattenGroup: true, checkContainer: false })).toBe(b);
    expect(store.hit.objectContaining(new Point(100, 0), { flattenGroup: false, checkContainer: false })).toBe(g);
    expect(store.hit.objectContaining(new Point(50, 0), { flattenGroup: false, checkContainer: false })).toBeNull();
    expect(g.getDrawingProfile().effectiveStrokeWidth()).toBe(3);
    expect(store.getObject(a.id, true)).toBe(a);
    expect(g.extent().containsRect(a.extent())).toBe(true);
  });

  it('a member change re-lays out the group; paint paints members in member order', () => {
    const env = kindsEnv();
    const store = kindsStore(env);
    const a = rect(env, 0, 0, 20, 20, 0, 'A');
    const b = rect(env, 100, 0, 20, 20, 0, 'B');
    const g = new GroupObject(env, [a, b]);
    store.add(g);
    store.flushLayout();
    a.setRect(new Rect(-50, -50, 20, 20));
    expect(g.needsLayout()).toBe(true);
    store.flushLayout();
    expect(g.extent().x).toBeLessThanOrEqual(-50);
    const dp = new LogPlatform();
    g.paint(dp, paintEnv());
    expect(dp.log.filter((l) => l.startsWith('text')).map((l) => l.slice(5))).toEqual(['A', 'B']);
  });

  it('a group drag excludes its members from alignment; translate moves every member', () => {
    const env = kindsEnv();
    const store = kindsStore(env);
    const g = new GroupObject(env, [rect(env, 0, 0, 20, 20), rect(env, 100, 0, 20, 20)]);
    store.add(g);
    g.startModification(modCtx(env, store));
    g.translate(64, 0);
    expect(g.getCenter().x).toBe(114);
    expect((g.members()[1] as TemplatedObject).getCenter().x).toBeCloseTo(164);
  });

  it('clone maps every member and keeps the box', () => {
    const env = kindsEnv();
    const a = rect(env, 0, 0, 20, 20);
    const inner = new GroupObject(env, [rect(env, 50, 50, 10, 10), rect(env, 70, 50, 10, 10)]);
    const g = new GroupObject(env, [a, inner]);
    const map = new Map<LekhObject, LekhObject>();
    const c = g.cloneMapped(map, 5);
    expect(c.selectionRect()).toEqual(g.selectionRect());
    expect(map.size).toBe(3);
    expect(c.objects().map((o) => o.index)).toEqual([6, 5]);
    expect(c.members()[1]).toBeInstanceOf(GroupObject);
  });
});

describe('UnrecognizedObject (kind freehand)', () => {
  const stroke = [new Point(0, 0), new Point(50, 10), new Point(100, 0)];

  it('normalises its points to its box and regenerates them', () => {
    const env = kindsEnv();
    const u = new UnrecognizedObject(env, stroke);
    expect(u.kind).toBe(ObjectKind.Freehand);
    expect(isFreehand(u)).toBe(true);
    expect(u.selectionRect()).toEqual(new Rect(0, 0, 100, 10));
    expect(u.actualPoints()).toEqual(stroke);
    u.setRect(new Rect(0, 0, 200, 20));
    expect(u.actualPoints()[2]).toEqual(new Point(200, 0));
    expect(u.closed).toBe(false);
  });

  it('is near, never inside, not connectable; distance to the polyline', () => {
    const env = kindsEnv();
    const u = new UnrecognizedObject(env, stroke);
    expect(u.isPointInside(new Point(50, 5))).toBe(false);
    expect(u.distanceFrom(new Point(50, 20))).toBeCloseTo(10);
    expect(u.isConnectableKind()).toBe(false);
    expect(new UnrecognizedObject(env).distanceFrom(new Point())).toBe(2147483647);
  });

  it('closes when the ends meet; paints the stroke; flips about the mean', () => {
    const env = kindsEnv();
    const loop = new UnrecognizedObject(env, [new Point(0, 0), new Point(50, 50), new Point(100, 0), new Point(2, 1)]);
    expect(loop.closed).toBe(true);
    layOut(loop);
    const dp = new LogPlatform();
    loop.paint(dp, paintEnv());
    expect(dp.log).toEqual(['start 0 0', 'L 50 50', 'L 100 0', 'L 2 1', 'Z', 'end']);
    const u = new UnrecognizedObject(env, stroke);
    u.flip(2);
    // Mirrored about the mean y (10/3): 0 → 20/3, 10 → -10/3.
    expect(u.actualPoints()[1]?.y).toBeCloseTo(-10 / 3);
    expect(u.actualPoints()[0]?.y).toBeCloseTo(20 / 3);
    expect(u.canFlip()).toBe(false);
    expect(u.interactionKeys()).toEqual(['Unrecognized']);
  });

  it('a stroke takes no part in alignment and has no handles', () => {
    const env = kindsEnv();
    const xs: Point[] = [];
    new UnrecognizedObject(env, stroke).collectAlignmentPoints(xs, []);
    expect(xs).toEqual([]);
  });
});
