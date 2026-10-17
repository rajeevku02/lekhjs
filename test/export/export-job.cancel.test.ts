// AC-EXP-26 (unit half), spec 08 §10.2: Cancel stops the job at its next yield — within one page
// or one band — and the result is `cancelled`: no further sink call, nothing reported. Progress
// runs `preparing` → `rendering` → `encoding` with page numbers and a growing fraction.
import { describe, expect, it } from 'vitest';
import type { ExportProgress } from '../../src/export';
import { boardSession, env, rectBoard, run } from './helpers';

const pages = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `P${String(i + 1)}`, rects: [[40, 40, 30, 30] as const] }));

describe('cancel (AC-EXP-26)', () => {
  it('a 20-page export cancelled during page 3 stops before page 4', async () => {
    const s = boardSession(rectBoard(pages(20)), undefined, 'Twenty');
    const ac = new AbortController();
    const files: string[] = [];
    const e = env({
      sink: (file) => {
        if (!files.includes(file.name)) files.push(file.name);
        if (files.length === 3) ac.abort();
        return Promise.resolve();
      },
    });
    const r = await run(s, { format: 'png' }, e, ac.signal);
    expect(r).toEqual({ status: 'cancelled' });
    expect(files).toEqual(['Twenty-P1.png', 'Twenty-P2.png', 'Twenty-P3.png']);
    expect(e.reports).toEqual([]);
    expect(e.logs).toContain('export_cancelled');
  });

  it('a banded page cancelled after its first band stops there', async () => {
    const s = boardSession(rectBoard([{ rects: [[100, 100, 200, 200]] }]), undefined, 'Band');
    const ac = new AbortController();
    let chunks = 0;
    const e = env({
      canvasBudget: { pixels: 10_000, side: 50 },
      sink: () => {
        chunks++;
        ac.abort();
        return Promise.resolve();
      },
    });
    const r = await run(s, { format: 'jpg' }, e, ac.signal);
    expect(r).toEqual({ status: 'cancelled' });
    expect(chunks).toBe(1);
  });

  it('an export aborted before it starts does nothing', async () => {
    const s = boardSession(rectBoard(pages(2)), undefined, 'X');
    const ac = new AbortController();
    ac.abort();
    let sinks = 0;
    const r = await run(
      s,
      { format: 'svg' },
      env({
        sink: () => {
          sinks++;
          return Promise.resolve();
        },
      }),
      ac.signal,
    );
    expect(r).toEqual({ status: 'cancelled' });
    expect(sinks).toBe(0);
  });

  it('progress: preparing, then rendering/encoding per page with a growing fraction', async () => {
    const s = boardSession(rectBoard(pages(3)), undefined, 'Three');
    const progress: ExportProgress[] = [];
    await run(s, { format: 'png' }, env(), undefined, progress);
    expect(progress[0]).toEqual({ phase: 'preparing', fraction: 0 });
    const rendering = progress.filter((p) => p.phase === 'rendering');
    expect(rendering.map((p) => p.page)).toEqual([1, 2, 3]);
    expect(rendering.every((p) => p.pageCount === 3)).toBe(true);
    const fr = progress.map((p) => p.fraction);
    expect(fr).toEqual([...fr].sort((a, b) => a - b));
    expect(progress[progress.length - 1]).toEqual({ phase: 'encoding', fraction: 1 });
  });
});
