// `paintPage` and `pageVisualBounds` (export/raster; port of the backend binding's `CoreDoc::render`
// and `CoreDoc::visualBounds`): the refusals word for word, the first page by default, a node's
// crop equal to `visualBounds`, a real drawing, and AC-BE-08's paintPage leg (serialize is
// identical before and after a paint).
import { createCanvas } from '@napi-rs/canvas';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Canvas2DLike } from '../../src/base';
import { pageVisualBounds, paintPage } from '../../src/export/raster';
import { Canvas2DDrawingPlatform } from '../../src/render';
import { BoardSession } from '../../src/session';
import { FakeImagePort, FakeScheduler } from '../../src/testing';
import { CORE_FIXTURES, lekhFiles, readText } from '../io/helpers';
import { testRuntime } from '../session/helpers';

const runtime = testRuntime();
const session = (): BoardSession =>
  new BoardSession(runtime, { images: new FakeImagePort(), scheduler: new FakeScheduler() });

function canvas(w = 400, h = 300): { ctx: Canvas2DLike; png: () => Buffer } {
  const c = createCanvas(w, h);
  return { ctx: c.getContext('2d'), png: () => c.toBuffer('image/png') };
}

function loaded(file: string): BoardSession {
  const s = session();
  const r = s.load(readText(path.join(CORE_FIXTURES, file)));
  expect(r.ok).toBe(true);
  return s;
}

const FILES = lekhFiles(CORE_FIXTURES);
const FLOWCHART = 'boards/ipad-flowchart.lekh';

describe('paintPage refusals (CoreDoc::render, word for word)', () => {
  it('refuses invalid options, an unloaded session, no surface, an unknown page and node', () => {
    const { ctx } = canvas();
    const dp = new Canvas2DDrawingPlatform(ctx);
    const unloaded = session();
    expect(paintPage(unloaded, '{', dp)).toEqual({ ok: false, message: 'The render options are not valid JSON.' });
    expect(paintPage(unloaded, { page: 'p' }, dp)).toEqual({
      ok: false,
      message: 'No document is loaded on this handle, so there is nothing to draw.',
      page: 'p',
    });
    const s = loaded(FLOWCHART);
    expect(paintPage(s, {}, null)).toEqual({
      ok: false,
      message: 'No drawing surface was supplied, so there is nothing to draw on.',
    });
    expect(paintPage(s, { page: 'nope' }, dp)).toEqual({
      ok: false,
      message: 'This document has no page with id nope.',
      page: 'nope',
    });
    const first = s.document.pages[0]?.id ?? '';
    expect(paintPage(s, JSON.stringify({ node: 'nobody' }), dp)).toEqual({
      ok: false,
      message: `Page ${first} has no object with id nobody.`,
      page: first,
    });
    expect(pageVisualBounds(s, '', '')).toEqual({
      ok: false,
      message: `Page ${first} has no object with id .`,
      page: first,
    });
    s.dispose();
    unloaded.dispose();
  });
});

describe('paintPage draws', () => {
  it('the first page by default, and a node crop equal to visualBounds', () => {
    const s = loaded(FLOWCHART);
    const first = s.document.pages[0];
    expect(first).toBeDefined();
    const { ctx, png } = canvas();
    const blank = png();
    expect(paintPage(s, '', new Canvas2DDrawingPlatform(ctx))).toEqual({ ok: true, page: first?.id });
    expect(png().equals(blank)).toBe(false);

    const obj = first?.objectStore.objects[0];
    expect(obj).toBeDefined();
    const id = obj?.id ?? '';
    const b = s.visualBounds(first?.id ?? '', id);
    expect(b).not.toBeNull();
    const want = {
      ok: true,
      page: first?.id,
      minx: b?.x,
      miny: b?.y,
      maxx: (b?.x ?? 0) + (b?.width ?? 0),
      maxy: (b?.y ?? 0) + (b?.height ?? 0),
    };
    expect(paintPage(s, { node: id }, new Canvas2DDrawingPlatform(canvas().ctx))).toEqual(want);
    expect(pageVisualBounds(s, '', id)).toEqual(want);
    s.dispose();
  });
});

describe('AC-BE-08: paintPage does not change the document', () => {
  it('serialize is identical before and after a paint, over the fixture set', () => {
    expect(FILES.length).toBeGreaterThan(10);
    for (const f of FILES) {
      const s = loaded(f);
      const before = s.serialize({ stamp: 'cloud' });
      for (const p of s.document.pages) {
        const r = paintPage(s, { page: p.id }, new Canvas2DDrawingPlatform(canvas(64, 64).ctx));
        expect(r.ok, f).toBe(true);
      }
      expect(s.serialize({ stamp: 'cloud' }), f).toBe(before);
      s.dispose();
    }
  });
});
