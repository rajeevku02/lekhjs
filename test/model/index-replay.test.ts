// AC-ENG-03 with real object kinds: a replay of board edits (add, move, resize, rotate, group,
// drag with lift/land, delete, connect) interleaved with every spatial query, under the shadow
// mode (verifyIndex): each query also runs the linear scan and throws index_mismatch on a
// difference. Seeded, so a failure reproduces.
import { describe, expect, it } from 'vitest';
import { Point, Rect } from '../../src/geometry';
import { AutoType, ConnectionObject, GroupObject, type LekhObject, type TemplatedObject } from '../../src/model';
import { rng } from './helpers';
import { ellipse, kindsEnv, kindsStore, modCtx, polyRect, rect } from './kinds';

describe('index shadow replay (AC-ENG-03)', () => {
  it.each([1, 2, 3])('seed %i: 400 edits, every query matches the linear scan', (seed) => {
    const env = kindsEnv();
    const store = kindsStore(env);
    const r = rng(seed);
    const span = 1500;
    const shapes: TemplatedObject[] = [];
    const queries = () => {
      const p = new Point(r() * span, r() * span);
      store.hit.objectNear(p, 16);
      store.hit.selectableAt(p, 16);
      store.hit.objectContaining(p, { flattenGroup: r() < 0.5, checkContainer: r() < 0.5 });
      store.hit.objectForConnection(p, new Set(), 0.5 + r() * 2);
      store.hit.isInsideOtherObject(p, null);
      store.hit.erasableAt(p);
      store.hit.editableAt(p);
      store.hit.movableTextNear(p);
      store.hit.objectsIn(new Rect(p.x, p.y, r() * 300, r() * 300), r() < 0.5);
      store.hit.boundsOfAll();
    };
    for (let step = 0; step < 400; step++) {
      const k = r();
      const live = shapes.filter((s) => store.contains(s));
      if (k < 0.3 || live.length < 4) {
        const x = r() * span;
        const y = r() * span;
        const w = 20 + r() * 300;
        const h = 20 + r() * 200;
        const kind = r();
        const o =
          kind < 0.4
            ? rect(env, x, y, w, h, r() < 0.2 ? r() : 0, r() < 0.3 ? 'Text' : '')
            : kind < 0.7
              ? ellipse(env, x, y, w, h)
              : polyRect(env, x, y, w, h);
        shapes.push(o);
        store.add(o);
      } else if (k < 0.45) {
        const a = live[Math.floor(r() * live.length)] as TemplatedObject;
        const b = live[Math.floor(r() * live.length)] as TemplatedObject;
        const c = ConnectionObject.getAutoConnection(
          env,
          a,
          b,
          [AutoType.AutoLine, AutoType.Auto2LineA, AutoType.Auto3LineB][Math.floor(r() * 3)] as number,
        );
        if (r() < 0.5) c.setTexts([{ text: 'lbl', param: r() }]);
        store.add(c);
      } else if (k < 0.65) {
        const o = live[Math.floor(r() * live.length)] as TemplatedObject;
        o.setRect(Rect.fromCenter(new Point(r() * span, r() * span), 20 + r() * 200, 20 + r() * 200));
      } else if (k < 0.75) {
        // An interactive drag: lifted while it moves, landed at the end.
        const o = live[Math.floor(r() * live.length)] as TemplatedObject;
        store.lift([o]);
        o.startModification(modCtx(env, store));
        for (let i = 0; i < 3; i++) {
          o.translate((r() - 0.5) * 100, (r() - 0.5) * 100);
          queries();
        }
        store.land();
      } else if (k < 0.82 && live.length >= 6) {
        const a = live[0] as TemplatedObject;
        const b = live[1] as TemplatedObject;
        store.remove(a);
        store.remove(b);
        const g = new GroupObject(env, [a, b]);
        store.add(g);
      } else if (k < 0.92) {
        const o = live[Math.floor(r() * live.length)] as LekhObject;
        store.remove(o);
        for (const c of store.connectionsOf(o)) store.remove(c);
      } else {
        const o = live[Math.floor(r() * live.length)] as TemplatedObject;
        o.ds.setAngle(r() * Math.PI);
        o.generateData();
      }
      queries();
    }
    expect(store.size).toBeGreaterThan(0);
  });
});
