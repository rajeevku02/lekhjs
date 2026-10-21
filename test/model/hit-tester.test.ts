// HitTester: the C++ predicates and tie-breaks (AC-ENG-04), and the index shadow mode
// (AC-ENG-03): every query on random scenes, with lifted objects, equals the linear scan.
import { describe, expect, it } from 'vitest';
import { LekhError } from '../../src/base';
import { Point, Rect } from '../../src/geometry';
import { BoxShape, FakeConnector, FakeGroup, newStore, randomScene, rng } from './helpers';

describe('objectNear / objectContaining ties (AC-ENG-04)', () => {
  it('equal-distance overlapping shapes: the bottom-most (first in store order) wins', () => {
    const store = newStore();
    const low = new BoxShape('low', new Rect(0, 0, 100, 100), 100);
    const high = new BoxShape('high', new Rect(0, 0, 100, 100), 200);
    store.add(high);
    store.add(low);
    expect(store.objects.map((o) => o.id)).toEqual(['low', 'high']);
    const p = new Point(50, 10);
    expect(store.hit.objectNear(p, 8).object).toBe(low);
    expect(store.hit.objectContaining(p, { flattenGroup: false, checkContainer: false })).toBe(low);
  });

  it('a nearer outline wins over store order', () => {
    const store = newStore();
    const a = new BoxShape('a', new Rect(0, 0, 100, 100), 100);
    const b = new BoxShape('b', new Rect(40, 0, 60, 100), 200);
    store.add(a);
    store.add(b);
    const near = store.hit.objectNear(new Point(45, 50), 8);
    expect(near.object).toBe(b);
    expect(near.distance).toBeCloseTo(5);
  });

  it('a point on a title is distance 0 and beats a body hit', () => {
    const store = newStore();
    const body = new BoxShape('body', new Rect(0, 0, 100, 100), 100);
    const titled = new BoxShape('titled', new Rect(200, 0, 50, 50), 200);
    titled.title = new Rect(0, 40, 100, 20);
    store.add(body);
    store.add(titled);
    const near = store.hit.objectNear(new Point(50, 45), 8);
    expect(near).toEqual({ object: titled, distance: 0 });
  });

  it('selectableAt: near within tolerance plus half the stroke, else containing', () => {
    const store = newStore();
    const a = new BoxShape('a', new Rect(0, 0, 100, 100), 100);
    a.stroke = 4;
    store.add(a);
    expect(store.hit.selectableAt(new Point(-7, 50), 8)).toBe(a);
    expect(store.hit.selectableAt(new Point(50, 50), 8)).toBe(a);
    expect(store.hit.selectableAt(new Point(-20, 50), 8)).toBeNull();
  });

  it('objectContaining flattens groups and skips container areas', () => {
    const store = newStore();
    const m1 = new BoxShape('m1', new Rect(0, 0, 50, 50));
    const m2 = new BoxShape('m2', new Rect(60, 0, 50, 50));
    const g = new FakeGroup('g', [m1, m2], 100);
    const frame = new BoxShape('frame', new Rect(200, 0, 200, 200), 200);
    frame.containerInset = 10;
    store.add(g);
    store.add(frame);
    expect(store.hit.objectContaining(new Point(70, 10), { flattenGroup: true, checkContainer: false })).toBe(m2);
    expect(store.hit.objectContaining(new Point(70, 10), { flattenGroup: false, checkContainer: false })).toBe(g);
    expect(store.hit.objectContaining(new Point(300, 100), { flattenGroup: true, checkContainer: true })).toBeNull();
    expect(store.hit.objectContaining(new Point(300, 100), { flattenGroup: true, checkContainer: false })).toBe(frame);
    expect(store.hit.objectContaining(new Point(203, 100), { flattenGroup: true, checkContainer: true })).toBe(frame);
  });
});

describe('objectForConnection', () => {
  it('inside beats a nearer outside object; groups are flattened; excludes and kinds skipped', () => {
    const store = newStore();
    const outside = new BoxShape('out', new Rect(0, 0, 100, 100), 100);
    const inside = new BoxShape('in', new Rect(102, 0, 100, 100), 200);
    store.add(outside);
    store.add(inside);
    // (101, 50) is outside both, 1 from each: the first in store order keeps it.
    expect(store.hit.objectForConnection(new Point(101, 50), new Set(), 1)).toBe(outside);
    expect(store.hit.objectForConnection(new Point(103, 50), new Set(), 1)).toBe(inside);
    expect(store.hit.objectForConnection(new Point(103, 50), new Set([inside]), 1)).toBe(outside);
    inside.connectable = false;
    expect(store.hit.objectForConnection(new Point(103, 50), new Set(), 1)).toBe(outside);
  });

  it('the gap scales with zoom (connectObjectDistThreshold / zoom)', () => {
    const store = newStore();
    const a = new BoxShape('a', new Rect(0, 0, 100, 100), 100);
    store.add(a);
    expect(store.hit.objectForConnection(new Point(130, 50), new Set(), 1)).toBe(a);
    expect(store.hit.objectForConnection(new Point(130, 50), new Set(), 2)).toBeNull();
  });

  it('returns a group member, never the group; titles never count', () => {
    const store = newStore();
    const m1 = new BoxShape('m1', new Rect(0, 0, 50, 50));
    m1.title = new Rect(0, 60, 50, 10);
    const g = new FakeGroup('g', [m1], 100);
    store.add(g);
    expect(store.hit.objectForConnection(new Point(10, 10), new Set(), 1)).toBe(m1);
    // On the title only (10 below the body): near, not inside.
    expect(store.hit.objectForConnection(new Point(10, 65), new Set(), 1)).toBe(m1);
    expect(store.hit.isInsideOtherObject(new Point(10, 65), null)).toBe(false);
    expect(store.hit.isInsideOtherObject(new Point(10, 10), null)).toBe(true);
    expect(store.hit.isInsideOtherObject(new Point(10, 10), m1)).toBe(false);
  });
});

describe('other queries', () => {
  it('connectionsOf uses the dependency map and includes edges on a group itself (B18c)', () => {
    const store = newStore();
    const m1 = new BoxShape('m1', new Rect(0, 0, 50, 50));
    const g = new FakeGroup('g', [m1], 100);
    const x = new BoxShape('x', new Rect(300, 0, 50, 50), 200);
    const c1 = new FakeConnector('c1', 'x', 'm1', 300);
    const c2 = new FakeConnector('c2', 'g', 'x', 400);
    [g, x, c1, c2].forEach((o) => {
      store.add(o);
    });
    expect(store.connectionsOf(g)).toEqual([c1, c2]);
    expect(store.connectionsOf(m1)).toEqual([c1]);
    expect(store.connectionsOf(x)).toEqual([c1, c2]);
    c1.setEnds('x', 'x');
    expect(store.connectionsOf(m1)).toEqual([]);
  });

  it('erasableAt (DR-ENG-08): near objects in store order, then their connectors', () => {
    const store = newStore();
    const a = new BoxShape('a', new Rect(0, 0, 50, 50), 100);
    const b = new BoxShape('b', new Rect(300, 0, 50, 50), 200);
    const c = new FakeConnector('c', 'a', 'b', 300);
    [a, b, c].forEach((o) => {
      store.add(o);
    });
    expect(store.hit.erasableAt(new Point(55, 45))).toEqual([a, c]);
    // On the connector too: listed as near and again as a's connector, as in C++.
    expect(store.hit.erasableAt(new Point(55, 25))).toEqual([a, c, c]);
  });

  it('objectsIn and boundsOfAll (every stroke counted, B8 / DR-ENG-17)', () => {
    const store = newStore();
    const a = new BoxShape('a', new Rect(0, 0, 50, 50), 100);
    const b = new BoxShape('b', new Rect(100, 100, 50, 50), 200);
    a.stroke = 8;
    b.stroke = 0;
    store.add(a);
    store.add(b);
    expect(store.objectsIn(new Rect(40, 40, 20, 20))).toEqual([a]);
    expect(store.objectsIn(new Rect(-10, -10, 500, 500))).toEqual([a, b]);
    // inflate(8 / 2) grows 2 per side.
    expect(store.hit.boundsOfAll()).toEqual(new Rect(-2, -2, 152, 152));
    expect(newStore().hit.boundsOfAll()).toEqual(new Rect());
  });
});

describe('shadow mode: the index equals the linear scan (AC-ENG-03)', () => {
  it.each([1, 2, 3])('random scene %i, with moves, removals and a lifted set', (seed) => {
    const store = newStore();
    const boxes = randomScene(store, 400, seed);
    const r = rng(seed * 31);
    const q = () => new Point(r() * 4200 - 100, r() * 4200 - 100);
    const queryAll = () => {
      for (let i = 0; i < 150; i++) {
        const p = q();
        store.hit.objectNear(p, r() * 20);
        store.hit.objectContaining(p, { flattenGroup: true, checkContainer: r() < 0.5 });
        store.hit.objectForConnection(p, new Set(), [0.1, 1, 4][i % 3] as number);
        store.hit.isInsideOtherObject(p, null);
        store.hit.erasableAt(p);
        store.hit.objectsIn(new Rect(p.x, p.y, r() * 300, r() * 300));
      }
      for (const b of boxes.slice(0, 20)) store.connectionsOf(b);
    };
    queryAll();
    for (const b of boxes.slice(0, 50)) b.translate(r() * 200 - 100, r() * 200 - 100);
    store.remove(boxes[7] as BoxShape);
    queryAll();
    store.lift(boxes.slice(60, 70));
    for (const b of boxes.slice(60, 70)) b.translate(500, 500);
    queryAll();
    store.land();
    queryAll();
    expect(store.index.size).toBe(store.size);
  });

  it('a non-conservative extent is caught', () => {
    const store = newStore();
    const a = new BoxShape('a', new Rect(0, 0, 100, 100), 100);
    a.brokenExtent = true;
    store.add(a);
    expect(() => store.hit.objectNear(new Point(-5, 50), 8)).toThrow(LekhError);
    try {
      store.hit.objectNear(new Point(-5, 50), 8);
    } catch (e) {
      expect((e as LekhError).code).toBe('index_mismatch');
    }
  });
});
