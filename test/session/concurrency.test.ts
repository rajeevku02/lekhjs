// AC-ENG-14 (spec 03 §12.4): 64 headless-session operations on 8 boards (at least the 32 the
// criterion asks for), interleaved with seeded random awaits between their synchronous calls, give
// exactly the results of the same operations run one after another. All sessions share one runtime
// (as in a kashi pool worker); see `withOwnIds` for ids.
//
// The operations: load, layoutAll, serialize (both stamps), visualBounds, paint (a PNG through
// @napi-rs/canvas), and the MCP's semantic calls `project`, `compile` and `lint` and the raster
// export `paintPage` (task B1).
import { createCanvas } from '@napi-rs/canvas';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Canvas2DLike } from '../../src/base';
import { paintPage } from '../../src/export/raster';
import { Canvas2DDrawingPlatform } from '../../src/render';
import { compile, lint, project } from '../../src/semantic';
import { BoardSession, type Runtime } from '../../src/session';
import { FakeImagePort, FakeScheduler, sequentialIds } from '../../src/testing';
import { CORE_FIXTURES } from '../io/helpers';
import { testRuntime } from './helpers';

const BOARDS = Object.freeze([
  'boards/android-shapes-and-connectors.lekh',
  'boards/ipad-block-diagram.lekh',
  'boards/ipad-flowchart.lekh',
  'boards/iphone-flowchart.lekh',
  'boards/iphone-recognised-sketch.lekh',
  'boards/iphone-wireframe.lekh',
  'format/04-group.lekh',
  'format/05-multi-page.lekh',
]);
const KINDS = Object.freeze([
  'offline',
  'cloud',
  'bounds',
  'paint',
  'project',
  'compile',
  'lint',
  'paintPage',
] as const);
type Kind = (typeof KINDS)[number];

/** mulberry32: a seeded PRNG, so a failing interleaving can be replayed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pause = () => Promise<void>;

/**
 * Ids minted while loading (legacy boards carry integer ids, normalised on load) would depend on
 * the global order of mints if every operation drew from the runtime's one `IdSource`. Each
 * operation therefore sees the shared runtime (catalog, fonts, line-width cache, text layout)
 * with its own sequential `IdSource`, so a result is a function of its board alone.
 */
function withOwnIds(runtime: Runtime): Runtime {
  return Object.freeze({ ...runtime, ids: sequentialIds() });
}

async function operation(runtime: Runtime, text: string, kind: Kind, pause: Pause): Promise<string> {
  const session = new BoardSession(withOwnIds(runtime), {
    images: new FakeImagePort(),
    scheduler: new FakeScheduler(),
  });
  try {
    await pause();
    const r = session.load(text, { kind: 'offline' });
    if (!r.ok) return `load failed ${r.code}`;
    await pause();
    session.layoutAll();
    await pause();
    switch (kind) {
      case 'offline':
      case 'cloud':
        return session.serialize({ stamp: kind });
      case 'bounds': {
        const out: string[] = [];
        for (const p of session.document.pages) {
          for (const o of p.objectStore.objects) {
            const b = session.visualBounds(p.id, o.id);
            out.push(`${o.id}:${b === null ? 'null' : [b.x, b.y, b.width, b.height].join(',')}`);
          }
          await pause();
        }
        return out.join('\n');
      }
      case 'paint': {
        const canvas = createCanvas(320, 240);
        const ctx = canvas.getContext('2d') as unknown as Canvas2DLike;
        session.dispatch({
          type: 'command',
          origin: 'ui',
          command: { kind: 'view', zoom: 0.5, canvasW: 320, canvasH: 240 },
        });
        await pause();
        session.paint('grid', ctx);
        await pause();
        session.paint('drawing', ctx);
        return Buffer.from(canvas.toBuffer('image/png')).toString('base64');
      }
      case 'project':
        return JSON.stringify(project(session, { include_style: true }));
      case 'compile': {
        const page = session.document.pages[0]?.id ?? '';
        await pause();
        return JSON.stringify(
          compile(session, {
            version: 1,
            page,
            ops: [{ op: 'add_node', ref: 'n', shape: 'avabodh.basic.rectangle', cx: 40, cy: 40, texts: ['x'] }],
          }),
        );
      }
      case 'lint': {
        const out: string[] = [];
        for (const p of session.document.pages) {
          out.push(JSON.stringify(lint(session, { page: p.id })));
          await pause();
        }
        return out.join('\n');
      }
      case 'paintPage': {
        const canvas = createCanvas(320, 240);
        const ctx = canvas.getContext('2d') as unknown as Canvas2DLike;
        ctx.scale(0.5, 0.5);
        const answer = paintPage(session, {}, new Canvas2DDrawingPlatform(ctx));
        await pause();
        return JSON.stringify(answer) + Buffer.from(canvas.toBuffer('image/png')).toString('base64');
      }
    }
  } finally {
    session.dispose();
  }
}

describe('AC-ENG-14: many sessions in one process', () => {
  it('64 interleaved operations with random awaits equal the serial run', async () => {
    const texts = BOARDS.map((b) => readFileSync(path.join(CORE_FIXTURES, b), 'utf8'));
    const ops = BOARDS.flatMap((_, bi) => KINDS.map((kind) => ({ bi, kind })));
    expect(ops).toHaveLength(64);

    const serialRuntime = testRuntime();
    const serial: string[] = [];
    for (const op of ops)
      serial.push(await operation(serialRuntime, texts[op.bi] as string, op.kind, () => Promise.resolve()));
    expect(serial.filter((s) => s.startsWith('load failed'))).toEqual([]);
    // The paints are real pictures of different boards, not one blank canvas.
    expect(new Set(serial.filter((_, i) => ops[i]?.kind === 'paint')).size).toBeGreaterThanOrEqual(6);
    expect(new Set(serial.filter((_, i) => ops[i]?.kind === 'paintPage')).size).toBeGreaterThanOrEqual(6);
    expect(new Set(serial.filter((_, i) => ops[i]?.kind === 'project')).size).toBe(8);

    for (const seed of [1, 2, 3]) {
      const rand = rng(seed);
      const pause: Pause = () =>
        new Promise((resolve) => {
          const r = rand();
          if (r < 0.3) resolve();
          else if (r < 0.6) queueMicrotask(resolve);
          else setTimeout(resolve, Math.floor(rand() * 3));
        });
      const runtime = testRuntime();
      const interleaved = await Promise.all(
        ops.map((op) => operation(runtime, texts[op.bi] as string, op.kind, pause)),
      );
      for (let i = 0; i < ops.length; i++) {
        expect(
          interleaved[i],
          `seed ${String(seed)} op ${String(i)} (${BOARDS[ops[i]?.bi ?? 0] ?? ''} ${ops[i]?.kind ?? ''})`,
        ).toBe(serial[i]);
      }
    }
  });
});
