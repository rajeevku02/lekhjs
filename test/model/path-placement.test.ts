// PathPlacement: a drawn line's ends snap onto nearby closed polygons and plain ellipses.
import { describe, expect, it } from 'vitest';
import { Point, SimplePath } from '../../src/geometry';
import { PathPlacement } from '../../src/model';
import { ViewTransform } from '../../src/render';
import { ellipse, kindsEnv, kindsStore, polyRect, rect } from './kinds';

function line(a: Point, b: Point): SimplePath {
  const p = new SimplePath();
  p.addLine(a, b);
  return p;
}

describe('PathPlacement', () => {
  it('snaps both ends of a line onto the outlines it points into', () => {
    const env = kindsEnv();
    const store = kindsStore(env);
    store.add(polyRect(env, 0, 0, 100, 100));
    store.add(ellipse(env, 400, 0, 100, 100));
    const path = line(new Point(40, 0), new Point(360, 0));
    expect(new PathPlacement(store).place(path)).toBe(true);
    expect(path.front().segment.point1().x).toBeCloseTo(50);
    expect(path.back().segment.point2().x).toBeCloseTo(350);
  });

  it('leaves the ends where they are when no outline is within reach (true, as C++)', () => {
    const env = kindsEnv();
    const store = kindsStore(env);
    store.add(polyRect(env, 0, 0, 100, 100));
    const path = line(new Point(300, 300), new Point(600, 300));
    expect(new PathPlacement(store).place(path)).toBe(true);
    expect(path.front().segment.point1()).toEqual(new Point(300, 300));
    expect(new PathPlacement(store).place(new SimplePath())).toBe(false);
  });

  it('snaps only to closed polygons and plain ellipses (a stencil rectangle is neither)', () => {
    const env = kindsEnv();
    const store = kindsStore(env);
    store.add(rect(env, 0, 0, 100, 100));
    const path = line(new Point(40, 0), new Point(360, 0));
    new PathPlacement(store).place(path);
    expect(path.front().segment.point1()).toEqual(new Point(40, 0));
  });

  it('works in screen coordinates through the view', () => {
    const env = kindsEnv();
    const store = kindsStore(env);
    store.add(polyRect(env, 0, 0, 100, 100));
    store.add(polyRect(env, 400, 0, 100, 100));
    const view = new ViewTransform({ zoom: 2, scrollX: 100, scrollY: 100 });
    const s1 = view.toScreen(new Point(40, 0));
    const s2 = view.toScreen(new Point(360, 0));
    const path = line(s1, s2);
    expect(new PathPlacement(store, view).place(path)).toBe(true);
    expect(view.toDoc(path.front().segment.point1()).x).toBeCloseTo(50);
    expect(view.toDoc(path.back().segment.point2()).x).toBeCloseTo(350);
  });
});
