// AC-ENG-05 with real object kinds: objectNear and objectForConnection p95 ≤ 1 ms on a 5,000-object
// page of TemplatedObjects (rectangles and ellipses, some titled-free text) and 500 automatic
// connectors, production config (no shadow scan). LEKH_PERF_OUT records the numbers.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { EngineConfig } from '../../src/base';
import { Point } from '../../src/geometry';
import { AutoType, ConnectionObject, type TemplatedObject } from '../../src/model';
import { rng } from './helpers';
import { ellipse, kindsEnv, kindsStore, rect } from './kinds';

const SPAN = 8000;
const QUERIES = 4000;
const WARMUP = 400;

function p95(samples: number[]): number {
  const s = [...samples].sort((a, b) => a - b);
  return s[Math.floor(s.length * 0.95)] ?? 0;
}

describe('hit-test latency with real objects (AC-ENG-05)', () => {
  it('p95 ≤ 1 ms for objectNear and objectForConnection on 5,000 objects', () => {
    const env = kindsEnv(new EngineConfig());
    const store = kindsStore(env);
    const r = rng(42);
    const shapes: TemplatedObject[] = [];
    for (let i = 0; i < 4500; i++) {
      const w = 20 + r() * 130;
      const h = 20 + r() * 90;
      const x = r() * SPAN;
      const y = r() * SPAN;
      const o = i % 3 === 0 ? ellipse(env, x, y, w, h) : rect(env, x, y, w, h, 0, i % 5 === 0 ? 'Label' : '');
      o.order = (i + 1) * 100;
      shapes.push(o);
      store.add(o);
    }
    for (let i = 0; i < 500; i++) {
      const a = shapes[Math.floor(r() * shapes.length)] as TemplatedObject;
      const b = shapes[Math.floor(r() * shapes.length)] as TemplatedObject;
      const c = ConnectionObject.getAutoConnection(env, a, b, i % 2 === 0 ? AutoType.AutoLine : AutoType.Auto2LineA);
      c.order = (4500 + i + 1) * 100;
      store.add(c);
    }
    expect(store.size).toBe(5000);
    store.flushLayout();
    const q = rng(7);
    const pts = Array.from({ length: QUERIES + WARMUP }, (_, i) => {
      if (i % 2 === 0) return new Point(q() * SPAN, q() * SPAN);
      const s = shapes[Math.floor(q() * shapes.length)] as TemplatedObject;
      const sel = s.selectionRect();
      return i % 4 === 1 ? sel.center() : new Point(sel.right() + 5, sel.y + 5);
    });
    const none = new Set<never>();
    const near: number[] = [];
    const conn: number[] = [];
    pts.forEach((p, i) => {
      let t = performance.now();
      store.hit.objectNear(p, 16);
      const a = performance.now() - t;
      t = performance.now();
      store.hit.objectForConnection(p, none, 1);
      const b = performance.now() - t;
      if (i >= WARMUP) {
        near.push(a);
        conn.push(b);
      }
    });
    const result = {
      criterion: 'AC-ENG-05',
      objects: store.size,
      kinds: 'TemplatedObject (rectangle, ellipse) + ConnectionObject (auto line, orthogonal)',
      queries: QUERIES,
      page_side: SPAN,
      objectNear_p95_ms: Number(p95(near).toFixed(4)),
      objectForConnection_p95_ms: Number(p95(conn).toFixed(4)),
      node: process.version,
      at: new Date().toISOString(),
    };
    const out = process.env.LEKH_PERF_OUT;
    if (out !== undefined && out !== '') {
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
    }
    expect(result.objectNear_p95_ms).toBeLessThanOrEqual(1);
    expect(result.objectForConnection_p95_ms).toBeLessThanOrEqual(1);
  });
});
