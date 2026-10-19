// L-03 (verification 03 §5, AC-ENG-27, E-45): 1,000 sessions opened, loaded, laid out, painted,
// serialized and disposed in one Node process, over one shared runtime (as a kashi pool worker
// holds it), keep `heapUsed` after a full GC within 5 % of the value after a warm-up of 100
// sessions (verification 03 L-03 measures at session 100 and 1,000; the AC's own warm-up is 50).
//
// The board is synthetic: the shapes of a C++-written fixture (connectors left out, so no id
// references need rewriting) tiled until the text is at least 0.25 MiB, in the legacy array form
// that mints ids on read. One @napi-rs/canvas surface is reused for every paint, so the native
// side of the canvas library (outside the V8 heap) does not enter the measure.
import { createCanvas } from '@napi-rs/canvas';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import v8 from 'node:v8';
import { describe, expect, it } from 'vitest';
import type { Canvas2DLike } from '../../src/base';
import { BoardSession } from '../../src/session';
import { FakeImagePort, FakeScheduler } from '../../src/testing';
import { CORE_FIXTURES } from '../io/helpers';
import { testRuntime } from './helpers';

const WARM_UP = 100;
const SESSIONS = 1000;
const TARGET_BYTES = 256 * 1024;

/** `global.gc`, exposed at run time when the fork was started without `--expose-gc`. */
function gcFunction(): () => void {
  const g = globalThis as { gc?: () => void };
  if (typeof g.gc === 'function') return g.gc;
  v8.setFlagsFromString('--expose-gc');
  return vm.runInNewContext('gc') as () => void;
}

/** A board of at least TARGET_BYTES: the fixture's non-connector objects tiled on one page. */
function syntheticBoard(): string {
  const src = JSON.parse(readFileSync(path.join(CORE_FIXTURES, 'boards', 'iphone-recognised-sketch.lekh'), 'utf8')) as {
    pages: Record<string, { objects: Record<string, unknown>[] }>;
  };
  const pageKey = Object.keys(src.pages)[0] ?? '';
  const page = src.pages[pageKey];
  if (page === undefined) throw new Error('fixture without a page');
  const shapes = page.objects.filter((o) => !/connect/i.test(JSON.stringify(o)));
  const objects: Record<string, unknown>[] = [];
  let n = 0;
  for (let tile = 0; JSON.stringify(objects).length < TARGET_BYTES; tile++) {
    const dx = (tile % 8) * 900;
    const dy = Math.floor(tile / 8) * 700;
    for (const o of shapes) {
      const c = structuredClone(o) as { id?: unknown; params?: { cx?: number; cy?: number } };
      c.id = ++n;
      if (c.params !== undefined) {
        c.params.cx = (c.params.cx ?? 0) + dx;
        c.params.cy = (c.params.cy ?? 0) + dy;
      }
      objects.push(c);
    }
  }
  page.objects = objects;
  return JSON.stringify(src);
}

describe('session heap (L-03)', () => {
  it(`AC-ENG-27: ${String(SESSIONS)} open / layout / paint / serialize / dispose cycles grow heapUsed by at most 5 %`, () => {
    const gc = gcFunction();
    const runtime = testRuntime();
    const board = syntheticBoard();
    expect(board.length).toBeGreaterThanOrEqual(TARGET_BYTES);
    const canvas = createCanvas(640, 480);
    const ctx = canvas.getContext('2d') as unknown as Canvas2DLike;
    let objects = 0;
    const cycle = (): void => {
      const session = new BoardSession(runtime, { images: new FakeImagePort(), scheduler: new FakeScheduler() });
      try {
        const r = session.load(board, { kind: 'offline' });
        if (!r.ok) throw new Error(`load failed: ${r.code}`);
        session.layoutAll();
        session.dispatch({
          type: 'command',
          origin: 'ui',
          command: { kind: 'view', zoom: 0.25, canvasW: 640, canvasH: 480 },
        });
        ctx.clearRect(0, 0, 640, 480);
        session.paint('drawing', ctx);
        objects = session.document.pages[0]?.objectStore.objects.length ?? 0;
        expect(session.serialize({ stamp: 'offline' }).length).toBeGreaterThan(0);
      } finally {
        session.dispose();
      }
    };
    const heap = (): number => {
      gc();
      gc();
      return process.memoryUsage().heapUsed;
    };
    for (let i = 0; i < WARM_UP; i++) cycle();
    const base = heap();
    for (let i = WARM_UP; i < SESSIONS; i++) cycle();
    const end = heap();
    const ratio = end / base;
    process.stdout.write(
      `L-03: ${String(objects)} objects, ${(board.length / 1024).toFixed(0)} KiB; heapUsed at ${String(WARM_UP)}: ` +
        `${(base / 1048576).toFixed(2)} MiB, at ${String(SESSIONS)}: ${(end / 1048576).toFixed(2)} MiB, ratio ${ratio.toFixed(4)}\n`,
    );
    expect(objects).toBeGreaterThan(100);
    expect(ratio).toBeLessThanOrEqual(1.05);
  }, 900_000);
});
