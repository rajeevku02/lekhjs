// Layout only for dirty objects (AC-ENG-06), connectors re-route to off-screen ends without a
// paint (AC-ENG-07), connectors after their ends, ancestor restyles, and lifting during a drag.
import { describe, expect, it, vi } from 'vitest';
import { Point, Rect } from '../../src/geometry';
import { ViewTransform } from '../../src/render';
import { Style } from '../../src/style';
import { BoxShape, FakeConnector, FakeGroup, newStore, noopDp, paintEnv } from './helpers';

function scene() {
  const store = newStore();
  const a = new BoxShape('a', new Rect(0, 0, 100, 100), 100);
  const b = new BoxShape('b', new Rect(400, 0, 100, 100), 200);
  const c = new BoxShape('c', new Rect(0, 400, 100, 100), 300);
  const far = new BoxShape('far', new Rect(5000, 5000, 100, 100), 400);
  const ab = new FakeConnector('ab', 'a', 'b', 500);
  const ac = new FakeConnector('ac', 'a', 'c', 600);
  const bfar = new FakeConnector('bfar', 'b', 'far', 700);
  const all = [a, b, c, far, ab, ac, bfar];
  for (const o of all) store.add(o);
  store.flushLayout();
  const reset = () => {
    for (const o of all) o.layouts = 0;
  };
  reset();
  return { store, a, b, c, far, ab, ac, bfar, all, reset };
}

describe('layout only what changed (AC-ENG-06)', () => {
  it('moving one shape with two connectors lays out exactly those three per flush', () => {
    const s = scene();
    for (let i = 0; i < 5; i++) {
      s.a.translate(3, 0);
      expect(s.store.flushLayout()).toBe(3);
      expect(s.all.filter((o) => o.layouts > 0).map((o) => o.id)).toEqual(['a', 'ab', 'ac']);
      expect(s.a.layouts).toBe(1);
      s.reset();
    }
  });

  it('panning (painting at other views) lays out nothing', () => {
    const s = scene();
    for (let i = 0; i < 10; i++) {
      const view = new ViewTransform({ zoom: 1, scrollX: -i * 300, scrollY: -i * 300, canvasW: 800, canvasH: 600 });
      s.store.paint(noopDp, paintEnv(), view.cullRect());
    }
    expect(s.all.every((o) => o.layouts === 0)).toBe(true);
  });

  it('a flush with nothing dirty does nothing; connectors are laid out after their ends', () => {
    const s = scene();
    expect(s.store.flushLayout()).toBe(0);
    const order: string[] = [];
    for (const o of s.all) {
      const orig = o.layout.bind(o);
      vi.spyOn(o, 'layout').mockImplementation((env) => {
        order.push(o.id);
        orig(env);
      });
    }
    s.ab.invalidate();
    s.b.translate(1, 0);
    s.store.flushLayout();
    expect(order).toEqual(['b', 'ab', 'bfar']);
  });

  it('an ancestor restyle re-lays out on demand (Style revision)', () => {
    const s = scene();
    const parent = new Style();
    let rev = parent.revisionSum();
    vi.spyOn(s.c, 'styleRevision').mockImplementation(() => rev);
    s.store.ensureLayout(s.c);
    expect(s.c.layouts).toBe(1);
    s.store.ensureLayout(s.c);
    expect(s.c.layouts).toBe(1);
    parent.setStrokeWidth(3);
    rev = parent.revisionSum();
    s.store.ensureLayout(s.c);
    expect(s.c.layouts).toBe(2);
  });

  it('a nested member change re-lays out its group and the group connectors', () => {
    const store = newStore();
    const m = new BoxShape('m', new Rect(0, 0, 10, 10));
    const g = new FakeGroup('g', [m], 100);
    const x = new BoxShape('x', new Rect(100, 0, 10, 10), 200);
    const gx = new FakeConnector('gx', 'g', 'x', 300);
    const mx = new FakeConnector('mx', 'm', 'x', 400);
    [g, x, gx, mx].forEach((o) => {
      store.add(o);
    });
    store.flushLayout();
    [m, g, x, gx, mx].forEach((o) => (o.layouts = 0));
    m.translate(5, 5);
    store.flushLayout();
    expect([m.layouts, g.layouts, x.layouts, gx.layouts, mx.layouts]).toEqual([1, 1, 0, 1, 1]);
    expect(store.index.size).toBe(4);
    expect(g.extent().x).toBeGreaterThan(3);
  });
});

describe('off-screen ends (AC-ENG-07)', () => {
  it('a remote change to an off-screen end re-routes its connector without painting the end', () => {
    const s = scene();
    const view = new ViewTransform({ zoom: 1, canvasW: 800, canvasH: 600 });
    s.store.paint(noopDp, paintEnv(), view.cullRect());
    expect(s.far.paints).toBe(0);
    // A remote changeattr on `far` (UpdateApplier sets geometry; the object invalidates itself).
    s.far.setRect(new Rect(6000, 6000, 200, 200));
    s.store.paint(noopDp, paintEnv(), view.cullRect());
    expect(s.far.paints).toBe(0);
    expect(s.bfar.route[1]).toEqual(new Point(6100, 6100));
    expect(s.store.hit.objectsIn(new Rect(6050, 6050, 10, 10))).toEqual([s.far, s.bfar]);
  });

  it('a connector added before its end routes once the end arrives', () => {
    const store = newStore();
    const a = new BoxShape('a', new Rect(0, 0, 10, 10), 100);
    const ab = new FakeConnector('ab', 'a', 'b', 300);
    store.add(a);
    store.add(ab);
    store.flushLayout();
    expect(ab.route[1]).toEqual(new Point(0, 0));
    store.add(new BoxShape('b', new Rect(100, 100, 20, 20), 200));
    store.flushLayout();
    expect(ab.route[1]).toEqual(new Point(110, 110));
  });
});

describe('lifting during a drag (spec 03 §3.2)', () => {
  it('nothing reaches the index per pointer move; queries still see the lifted set', () => {
    const s = scene();
    const ins = vi.spyOn(s.store.index, 'insert');
    const upd = vi.spyOn(s.store.index, 'update');
    s.store.lift([s.a]);
    expect([...s.store.lifted].map((o) => o.id)).toEqual(['a', 'ab', 'ac']);
    for (let i = 0; i < 100; i++) {
      s.a.translate(10, 0);
      expect(s.store.hit.objectNear(new Point(s.a.rect.x + 2, 10), 8).object).toBe(s.a);
    }
    expect(ins).not.toHaveBeenCalled();
    expect(upd).not.toHaveBeenCalled();
    s.store.land();
    s.store.flushLayout();
    expect(ins).toHaveBeenCalledTimes(3);
    expect(s.store.index.size).toBe(s.store.size);
    expect(s.store.hit.objectNear(new Point(1002, 10), 8).object).toBe(s.a);
  });
});
