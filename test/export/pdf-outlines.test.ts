// AC-EXP-19 (unit half): a platform font whose fsType forbids embedding or subsetting, or a
// variable font, is drawn as outlines: no text object and no embedded font for that run, filled
// paths instead, one `font_outlined` warning (no toast). Plus the §6.4 fsType table and the
// variable instance at the requested weight. (The image bar inside the box is F2's parity run.)
import { describe, expect, it } from 'vitest';
import type { FontDataProvider } from '../../src/export/pdf';
import {
  FS_TYPE_BITMAP_ONLY,
  FS_TYPE_EDITABLE,
  FS_TYPE_NO_SUBSETTING,
  FS_TYPE_PREVIEW_PRINT,
  FS_TYPE_RESTRICTED,
  fsTypeAllowsEmbedding,
  openFont,
  pdfModules,
} from '../../src/export/pdf';
import { recordingSink, run } from './helpers';
import {
  FixtureProvider,
  OPS,
  bundledSource,
  fixtureFont,
  hostSession,
  parsePdf,
  pdfEnv,
  textBoard,
} from './pdf-helpers';

async function exportPlatform(file: string, embeddable = true, bold = false) {
  const platform: FontDataProvider = new FixtureProvider(
    (r) => (r.family === '' ? fixtureFont(file, { embeddable }) : null),
    'native',
  );
  const s = hostSession(
    'android',
    textBoard([
      [
        { text: 'Outlined text', cx: 200, cy: 50, family: '', bold },
        { text: 'Embedded text', cx: 200, cy: 120, family: 'Noto Sans' },
      ],
    ]),
    'Outline',
  );
  const { sink, rec } = recordingSink();
  const e = pdfEnv([bundledSource(), platform], { sink });
  const r = await run(s, { format: 'pdf' }, e);
  if (r.status !== 'done') throw new Error(JSON.stringify(r));
  const { pages, raw } = await parsePdf(rec.file('Outline.pdf'));
  return { r, raw, page: pages[0], logs: e.logs };
}

const fonts = (raw: string): string[] => [
  ...new Set([...raw.matchAll(/\/BaseFont \/[A-Z]{6}\+([\w-]+)/g)].map((m) => m[1] ?? '')),
];

describe('outlined runs (AC-EXP-19)', () => {
  it.each([
    ['a restricted font (fsType 2)', 'Restricted-fsType2.ttf', true],
    ['a font the host reports as not embeddable', 'Restricted-fsType2.ttf', false],
    ['a variable font', 'NotoSansVariable-ascii.ttf', true],
  ])('%s is drawn as filled outlines with no text object', async (_n, file, embeddable) => {
    const { r, raw, page, logs } = await exportPlatform(file, embeddable);
    expect((page?.items ?? []).map((i) => i.str)).toEqual(['Embedded text']);
    expect(fonts(raw)).toEqual(['NotoSans-Regular']);
    expect(raw).not.toContain('LekhRestrictedTest');
    expect(page?.ops.some((o) => o.fn === OPS.constructPath)).toBe(true);
    // pdf.js ≥ 4 folds the painting operator into `constructPath` (its first argument).
    const painted = (page?.ops ?? []).filter((o) => o.fn === OPS.constructPath).map((o) => (o.args as unknown[])[0]);
    expect(painted).toContain(OPS.fill);
    expect(r.warnings).toEqual([{ code: 'font_outlined', count: 1 }]);
    expect(logs).toContain('font_outlined {"count":1}');
  });

  it('the fsType table of spec 08 §6.4', () => {
    expect(fsTypeAllowsEmbedding(0)).toBe(true);
    expect(fsTypeAllowsEmbedding(FS_TYPE_PREVIEW_PRINT)).toBe(true);
    expect(fsTypeAllowsEmbedding(FS_TYPE_EDITABLE)).toBe(true);
    expect(fsTypeAllowsEmbedding(FS_TYPE_RESTRICTED)).toBe(false);
    expect(fsTypeAllowsEmbedding(FS_TYPE_NO_SUBSETTING | FS_TYPE_EDITABLE)).toBe(false);
    expect(fsTypeAllowsEmbedding(FS_TYPE_BITMAP_ONLY)).toBe(false);
  });

  it('a variable font is outlined at the requested weight', () => {
    const m = pdfModules();
    const data = fixtureFont('NotoSansVariable-ascii.ttf');
    const regular = openFont(m.fontkit, data, 'F1', false);
    const bold = openFont(m.fontkit, data, 'F2', true);
    expect(regular?.mode).toBe('outline');
    expect(bold?.mode).toBe('outline');
    const w = (f: typeof regular): number => f?.font.layout('Hamburgefonts', []).advanceWidth ?? 0;
    expect(w(bold)).toBeGreaterThan(w(regular) * 1.03);
  });

  it('an embeddable static font is embedded', () => {
    const f = openFont(pdfModules().fontkit, fixtureFont('NotoSansArabic-subset.ttf'), 'F1', false);
    expect(f?.mode).toBe('embed');
    expect(f?.postscriptName).toBe('NotoSansArabic-Regular');
  });
});
