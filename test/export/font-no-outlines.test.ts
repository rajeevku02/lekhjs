// Owner round EX2, fix 2 (export suite EXP-30 / EXP-45 on the Mac): a PDF with Han text failed with
// "An unexpected error occurred while exporting". CoreText on macOS 15.6 hands out PingFang SC,
// whose outlines are Apple's `hvgl` table (no `glyf`, `CFF ` or `CFF2`); fontkit opens it, but
// `layout` throws "Cannot read properties of null (reading 'id')", and `layout` ran unguarded in
// the resolver and the text writer, so the whole job ended in `export_internal`. Now such a face is
// not opened (the chain goes on to the next source, or the image fallback), and a face whose
// `layout` still throws degrades its runs instead of failing the export.
import { describe, expect, it } from 'vitest';
import type { FontData } from '../../src/export';
import {
  PdfExporter,
  hasUsableOutlines,
  openFont,
  pdfModules,
  type FontkitFont,
  type FontkitModule,
} from '../../src/export/pdf';
import { boardSession, recordingSink, run } from './helpers';
import {
  FixtureProvider,
  bundledSource,
  fixtureFont,
  fontBytes,
  parsePdf,
  pdfEnv,
  textBoard,
  type TextSpec,
} from './pdf-helpers';

/**
 * The fixture with its outline tables renamed away (as PingFang SC on macOS 15: `hvgl` and no
 * `glyf` / `CFF ` / `CFF2`). The rest of the face (cmap, metrics) is untouched.
 */
function withoutOutlines(bytes: Uint8Array): Uint8Array {
  const out = bytes.slice();
  const v = new DataView(out.buffer);
  const n = v.getUint16(4);
  const rename: Record<string, string> = { glyf: 'hvgl', loca: 'hvgm', 'CFF ': 'hvgl', CFF2: 'hvgn' };
  for (let i = 0; i < n; i++) {
    const at = 12 + 16 * i;
    const tag = String.fromCharCode(out[at] ?? 0, out[at + 1] ?? 0, out[at + 2] ?? 0, out[at + 3] ?? 0);
    const to = rename[tag];
    if (to !== undefined) for (let k = 0; k < 4; k++) out[at + k] = to.charCodeAt(k);
  }
  v.setUint32(0, 0x00010000);
  return out;
}

const hvglSC = (): FontData => ({
  ...fixtureFont('NotoSansSC-subset.otf'),
  bytes: withoutOutlines(fontBytes('NotoSansSC-subset.otf')),
  postscriptName: 'PingFangSC-Regular',
});

async function exportWith(specs: readonly TextSpec[], env: ReturnType<typeof pdfEnv>, name = 'NoOutlines') {
  const s = boardSession(textBoard([specs]), undefined, name);
  const r = await run(s, { format: 'pdf' }, env);
  return { r, env };
}

describe('a face fontkit cannot draw (EX2 fix 2)', () => {
  it('fontkit opens the hvgl-only face but cannot lay it out (the bug), and openFont now refuses it', () => {
    const fk = pdfModules().fontkit;
    const face = fk.create(hvglSC().bytes) as FontkitFont;
    expect(face.hasGlyphForCodePoint('中'.codePointAt(0) ?? 0)).toBe(true);
    expect(() => face.layout('中文', [])).toThrow();
    expect(hasUsableOutlines(face)).toBe(false);
    const logs: string[] = [];
    expect(openFont(fk, hvglSC(), 'F1', false, (c) => logs.push(c))).toBeNull();
    expect(logs).toEqual(['font_no_outlines']);
    expect(openFont(fk, fixtureFont('NotoSansSC-subset.otf'), 'F2', false)).not.toBeNull();
  });

  it('the next source answers the run: the Han text is embedded and extractable', async () => {
    const native = new FixtureProvider((q) => (q.script === 'Han' ? hvglSC() : null), 'native');
    const second = new FixtureProvider(
      (q) => (q.script === 'Han' ? fixtureFont('NotoSansSC-subset.otf') : null),
      'second',
    );
    const { sink, rec } = recordingSink();
    const e = pdfEnv([bundledSource(), native, second], { sink });
    const { r } = await exportWith([{ text: 'Hello 中文', cx: 200, cy: 50 }], e);
    expect(r.status).toBe('done');
    if (r.status !== 'done') return;
    expect(r.warnings).toEqual([]);
    const { pages } = await parsePdf(rec.file('NoOutlines.pdf'));
    expect((pages[0]?.items ?? []).map((i) => i.str).join('')).toContain('中文');
    expect(e.logs).toContain('font_no_outlines');
  });

  it('no other source: the Han run is an image with the font toast, and the export succeeds', async () => {
    const native = new FixtureProvider((q) => (q.script === 'Han' ? hvglSC() : null), 'native');
    const { sink, rec } = recordingSink();
    const { r } = await exportWith(
      [{ text: 'Hello 中文', cx: 200, cy: 50 }],
      pdfEnv([bundledSource(), native], { sink }),
    );
    expect(r.status).toBe('done');
    if (r.status !== 'done') return;
    expect(r.warnings).toContainEqual({ code: 'font_unavailable', count: 1 });
    const { pages } = await parsePdf(rec.file('NoOutlines.pdf'));
    expect((pages[0]?.items ?? []).map((i) => i.str).join('')).toContain('Hello');
  });

  it('a face whose layout throws on some text degrades those runs instead of failing the export', async () => {
    // A fontkit whose Han face lays out ' ' (so it opens) but throws on a Han run.
    const real = pdfModules();
    const fontkit: FontkitModule = {
      create(bytes, ps) {
        const f = real.fontkit.create(bytes, ps);
        if (f === null || 'fonts' in f || f.postscriptName === null || !f.postscriptName.includes('SC')) return f;
        return new Proxy(f, {
          get(t, k, rcv) {
            if (k === 'layout')
              return (text: string, feats?: string[]) => {
                if (/\p{Script=Han}/u.test(text)) throw new TypeError("Cannot read properties of null (reading 'id')");
                return t.layout(text, feats);
              };
            const v: unknown = Reflect.get(t, k, rcv);
            return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
          },
        });
      },
    };
    const native = new FixtureProvider(
      (q) => (q.script === 'Han' ? fixtureFont('NotoSansSC-subset.otf') : null),
      'native',
    );
    const { sink, rec } = recordingSink();
    const e = pdfEnv([], {
      sink,
      loadPdf: () => Promise.resolve(new PdfExporter({ ...real, fontkit }, { fonts: [bundledSource(), native] })),
    });
    const { r } = await exportWith([{ text: 'Hello 中文', cx: 200, cy: 50 }], e);
    expect(r.status).toBe('done');
    if (r.status !== 'done') return;
    expect(r.warnings).toContainEqual({ code: 'font_unavailable', count: 1 });
    expect(e.logs).toContain('font_layout_failed');
    const { pages } = await parsePdf(rec.file('NoOutlines.pdf'));
    expect((pages[0]?.items ?? []).map((i) => i.str).join('')).toContain('Hello');
  });
});
