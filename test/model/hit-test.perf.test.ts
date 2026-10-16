// AC-ENG-05: objectNear and objectForConnection p95 ≤ 1 ms on a synthetic 5,000-object page
// (4,500 shapes, 500 connectors), production config (no shadow scan). Set LEKH_PERF_OUT to a file
// path to record the numbers (the perf runs write under lekhjs/parity/out/).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { Point } from '../../src/geometry';
import { newStore, plainConfig, randomScene, rng } from './helpers';

const QUERIES = 4000;
const WARMUP = 400;
/** Page side: 4,500 shapes of ~80 × 60 on 8,000² is a dense board (several overlaps per point). */
const SPAN = 8000;

function p95(samples: number[]): number {
  const s = [...samples].sort((a, b) => a - b);
  return s[Math.floor(s.length * 0.95)] ?? 0;
}

describe('hit-test latency (AC-ENG-05)', () => {
  it('p95 ≤ 1 ms for objectNear and objectForConnection on 5,000 objects', () => {
    const store = newStore(plainConfig);
    const boxes = randomScene(store, 4500, 42, SPAN, 500);
    expect(store.size).toBe(5000);
    store.flushLayout();

    const r = rng(7);
    // Half the queries on a shape (its centre or just outside an edge), half anywhere on the page.
    const pts = Array.from({ length: QUERIES + WARMUP }, (_, i) => {
      if (i % 2 === 0) return new Point(r() * SPAN, r() * SPAN);
      const b = boxes[Math.floor(r() * boxes.length)];
      if (b === undefined) return new Point();
      return i % 4 === 1 ? b.rect.center() : new Point(b.rect.right() + 5, b.rect.y + 5);
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
