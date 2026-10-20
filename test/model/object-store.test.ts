// ObjectStore membership, order and lookup, ported from the C++ semantics (ObjectStore.cpp), plus
// the spatial index and the dependency map it keeps.
import { describe, expect, it } from 'vitest';
import { CONFIG_DEFAULTS, EngineConfig } from '../../src/base';
import { Point, Rect } from '../../src/geometry';
import { ConnectionDependencyMap, LINEAR_CANDIDATES_MAX, OrderAllocator, SpatialIndex } from '../../src/model';
import { BoxShape, FakeConnector, FakeGroup, fixedClock, newStore, rng } from './helpers';

const box = (id: string, order = 0, x = 0) => new BoxShape(id, new Rect(x, 0, 10, 10), order);
const ids = (objs: readonly { id: string }[]) => objs.map((o) => o.id);

describe('order (C++ add / getNextOrder / getPrevOrder / moveToOrder)', () => {
  it('an object without an order gets last + 100 + now % 100 and goes last', () => {
    const store = newStore(undefined, fixedClock(12345));
    const a = box('a');
    store.add(a);
    expect(a.order).toBe(145);
    const b = box('b');
    store.add(b);
    expect(b.order).toBe(290);
    // 145 - 100 - 45 is 0, which means "no order": C++ answers -1.
    expect(store.prevOrder()).toBe(-1);
    expect(new OrderAllocator(fixedClock(0)).prev(100)).toBe(-1);
    expect(new OrderAllocator(fixedClock(0)).next(-100)).toBe(1);
  });

  it('an ordered object goes before the first with a greater order', () => {
    const store = newStore();
    for (const [id, o] of [
      ['a', 100],
      ['c', 300],
      ['b', 200],
      ['b2', 200],
      ['z', 50],
    ] as const) {
      store.add(box(id, o));
    }
    expect(ids(store.objects)).toEqual(['z', 'a', 'b', 'b2', 'c']);
    expect(store.isAtBack(store.objects[0] as BoxShape)).toBe(true);
    expect(store.isAtFront(store.objects[4] as BoxShape)).toBe(true);
    const a = store.getObject('a') as BoxShape;
    store.moveToOrder(a, 250);
    expect(ids(store.objects)).toEqual(['z', 'b', 'b2', 'a', 'c']);
    expect(store.positionOf(a)).toBe(3);
    expect(store.objectBefore(a)?.id).toBe('b2');
    expect(store.objectAfter(a)?.id).toBe('c');
    expect(store.lastObject()?.id).toBe('c');
  });
});

describe('membership and lookup', () => {
  it('removeObjects is all or nothing and returns highest position first', () => {
    const store = newStore();
    ['a', 'b', 'c', 'd'].forEach((id, i) => {
      store.add(box(id, (i + 1) * 100));
    });
    const removed: BoxShape[] = [];
    expect(store.removeObjects(['a', 'x'], removed)).toBe(false);
    expect(store.size).toBe(4);
    expect(store.removeObjects(['a', 'c'], removed)).toBe(true);
    expect(ids(removed)).toEqual(['c', 'a']);
    expect(ids(store.objects)).toEqual(['b', 'd']);
    expect(store.getObject('a')).toBeNull();
    expect(store.removeById('d')?.id).toBe('d');
    expect(store.indexOf(removed[0] as BoxShape)).toBe(1);
    expect(store.index.size).toBe(0);
    store.flushLayout();
    expect(store.index.size).toBe(1);
  });

  it('the id map holds nested members with their parent group; top level first in store order', () => {
    const store = newStore();
    const inner = box('m');
    const sub = new FakeGroup('sub', [inner]);
    const g = new FakeGroup('g', [sub, box('n')], 100);
    store.add(g);
    expect(store.getObject('m')).toBeNull();
    expect(store.getObject('m', true)).toBe(inner);
    expect(store.entry(inner)).toEqual({ obj: inner, parentGroup: sub, root: g });
    expect(store.contains(g)).toBe(true);
    expect(store.contains(inner)).toBe(false);
    // A later top-level object with a member's id: the earlier group's member still wins nested.
    const dup = box('m', 200);
    store.add(dup);
    expect(store.getObject('m')).toBe(dup);
    expect(store.getObject('m', true)).toBe(inner);
    // Ungroup `sub` into g directly.
    g.items = [inner, ...g.items.slice(1)];
    store.refreshMembers(g);
    expect(store.entry(inner)?.parentGroup).toBe(g);
    expect(store.getObject('sub', true)).toBeNull();
    expect(inner.owner).toBe(store);
    store.remove(g);
    expect(store.getObject('m', true)).toBe(dup);
    expect(inner.owner).toBeNull();
  });

  it('load replaces the objects, bulk-loads the index at the first flush', () => {
    const store = newStore();
    store.add(box('old', 100));
    store.flushLayout();
    const objs = Array.from({ length: 50 }, (_, i) => box(`o${String(i)}`, (i + 1) * 10, i * 20));
    store.load(objs);
    expect(store.getObject('old')).toBeNull();
    expect(store.index.size).toBe(0);
    store.flushLayout();
    expect(store.index.size).toBe(50);
    expect(store.hit.objectNear(new Point(205, 5), 4).object?.id).toBe('o10');
    store.clear();
    expect(store.size).toBe(0);
    expect(store.index.size).toBe(0);
    expect(objs[0]?.owner).toBeNull();
  });

  it('the dependency map follows connector ends', () => {
    const store = newStore();
    const c = new FakeConnector('c', 'a', 'b', 100);
    store.add(c);
    expect([...store.deps.connectorsOf('a')]).toEqual([c]);
    c.setEnds('a', 'x');
    expect([...store.deps.connectorsOf('b')]).toEqual([]);
    expect([...store.deps.connectorsOf('x')]).toEqual([c]);
    store.remove(c);
    expect(store.deps.size).toBe(0);
    const m = new ConnectionDependencyMap();
    const self = new FakeConnector('s', 'a', 'a');
    m.set(self);
    expect([...m.connectorsOf('a')]).toEqual([self]);
    m.delete(self);
    expect(m.connectorsOf('a').size).toBe(0);
  });
});

describe('SpatialIndex', () => {
  it('insert, update, remove, search; non-finite extents are kept outside the tree', () => {
    const idx = new SpatialIndex();
    const a = box('a');
    const b = box('b');
    idx.insert(a, new Rect(0, 0, 10, 10));
    idx.insert(b, new Rect(NaN, 0, 10, 10));
    expect(idx.size).toBe(2);
    expect(idx.search(new Rect(5, 5, 1, 1))).toEqual([a, b]);
    expect(idx.search(new Rect(50, 50, 1, 1))).toEqual([b]);
    expect(idx.update(a, new Rect(0, 0, 10, 10))).toBe(false);
    expect(idx.update(a, new Rect(100, 100, 10, 10))).toBe(true);
    expect(idx.search(new Rect(105, 105, 0, 0))).toEqual([a, b]);
    // Edges are inclusive.
    expect(idx.search(new Rect(110, 110, 5, 5))).toContain(a);
    idx.remove(a);
    idx.remove(b);
    expect(idx.size).toBe(0);
    expect(a.indexItem).toBeNull();
  });

  it('verifyIndex is off by default in the engine config (the vitest setup turns it on, AC-ENG-03)', () => {
    expect(CONFIG_DEFAULTS.debug.verifyIndex).toBe(false);
    expect(new EngineConfig().debug.verifyIndex).toBe(true);
  });
});

describe('candidates on a small page (P3)', () => {
  // Up to LINEAR_CANDIDATES_MAX objects, candidates scans the store instead of searching the index
  // (P-03 on the small corpus boards: the tree search, dedup set and sort per hit test cost more
  // than the test itself). It must return what the index returns, in store order.
  for (const n of [1, 5, LINEAR_CANDIDATES_MAX, LINEAR_CANDIDATES_MAX + 1]) {
    it(`gives the index's answer with ${String(n)} objects, lifted and non-finite ones included`, () => {
      const r = rng(n);
      const store = newStore();
      const boxes: BoxShape[] = [];
      for (let i = 0; i < n; i++) {
        const b = new BoxShape(`b${String(i)}`, new Rect(r() * 400, r() * 400, r() * 80, r() * 80), (i + 1) * 100);
        boxes.push(b);
        store.add(b);
      }
      const odd = boxes[0] as BoxShape;
      odd.rect = new Rect(Number.NaN, 0, 10, 10);
      odd.invalidate();
      store.flushLayout();
      const check = () => {
        store.flushLayout();
        for (let i = 0; i < 200; i++) {
          const q = new Rect(r() * 500 - 50, r() * 500 - 50, r() * 120, r() * 120);
          expect(ids(store.candidates(q))).toEqual(ids(store.indexCandidates(q)));
        }
      };
      check();
      store.lift(boxes.slice(1, 3));
      for (const b of boxes.slice(1, 3)) b.translate(60, 60);
      check();
      store.land();
      check();
    });
  }
});
