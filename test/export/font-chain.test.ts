// The PDF font chain (spec 08 §6): AC-EXP-15 (an uncovered run takes the native `getFontData`
// font), AC-EXP-32 (a TTC selects the face by PostScript name, or by `collectionIndex`),
// AC-EXP-34 (a rejecting or a > 10 s provider → the image fallback with `font_unavailable`; a late
// answer changes nothing), AC-EXP-35 (the web Noto manifest and SHA-256 rules), plus the
// de-duplication of requests and the Han choice.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { FontData } from '../../src/export';
import type { FontDataProvider } from '../../src/export/pdf';
import { WebScriptFontProvider, scriptFontKey, type ScriptFontCache } from '../../src/export/pdf';
import { boardSession, recordingSink, run } from './helpers';
import {
  FixtureProvider,
  bundledSource,
  fixtureFont,
  fontBytes,
  hostSession,
  imageCount,
  parsePdf,
  pdfEnv,
  scriptFixtures,
  textBoard,
  type TextSpec,
} from './pdf-helpers';

const NEVER = new AbortController().signal;

/** Scaled timers: a provider's 10 s timeout fires after 10 ms. */
const FAST_TIMERS = {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms / 1000),
  clearTimeout: (h: unknown) => {
    clearTimeout(h as ReturnType<typeof setTimeout>);
  },
};

async function exportWith(
  specs: readonly TextSpec[],
  fonts: readonly FontDataProvider[],
  name = 'Chain',
  host?: 'ios' | 'android',
): Promise<{ raw: string; texts: string[]; images: number; warnings: unknown[]; logs: string[] }> {
  const board = textBoard([specs]);
  const s = host !== undefined ? hostSession(host, board, name) : boardSession(board, undefined, name);
  const { sink, rec } = recordingSink();
  const e = pdfEnv(fonts, { sink }, { timers: FAST_TIMERS });
  const r = await run(s, { format: 'pdf' }, e);
  if (r.status !== 'done') throw new Error(JSON.stringify(r));
  const bytes = rec.file(`${name}.pdf`);
  const { pages, raw } = await parsePdf(bytes);
  return {
    raw,
    texts: (pages[0]?.items ?? []).map((i) => i.str),
    images: imageCount(raw),
    warnings: [...r.warnings],
    logs: e.logs,
  };
}

function baseFonts(raw: string): string[] {
  return [...new Set([...raw.matchAll(/\/BaseFont \/[A-Z]{6}\+([\w-]+)/g)].map((m) => m[1] ?? ''))].sort();
}

describe('native getFontData (AC-EXP-15, AC-EXP-34)', () => {
  it('a run the primary font does not cover is embedded with the provider font', async () => {
    const native = scriptFixtures('native');
    const r = await exportWith([{ text: 'Hello مرحبا', cx: 200, cy: 50 }], [bundledSource(), native]);
    expect(baseFonts(r.raw)).toEqual(['NotoSans-Regular', 'NotoSansArabic-Regular']);
    const arabic = native.requests.filter((q) => q.script === 'Arabic');
    expect(arabic.length).toBe(1);
    expect(arabic[0]).toMatchObject({
      text: 'مرحبا',
      family: 'Noto Sans',
      bold: false,
      italic: false,
      script: 'Arabic',
    });
    expect(r.images).toBe(0);
    expect(r.warnings).toEqual([]);
  });

  it('requests are de-duplicated per (script, family, bold, italic)', async () => {
    const native = scriptFixtures('native');
    await exportWith(
      [
        { text: 'مرحبا one', cx: 200, cy: 50 },
        { text: 'two سلام', cx: 200, cy: 100 },
        { text: 'bold مرحبا', cx: 200, cy: 150, bold: true },
      ],
      [bundledSource(), native],
    );
    const arabic = native.requests.filter((q) => q.script === 'Arabic');
    expect(arabic.map((q) => q.bold)).toEqual([false, true]);
  });

  it('a rejecting provider: the run is an image, with font_unavailable', async () => {
    const native = new FixtureProvider(() => Promise.reject(new Error('plugin')), 'native', 10_000);
    const r = await exportWith([{ text: 'Hi مرحبا', cx: 200, cy: 50 }], [bundledSource(), native]);
    expect(baseFonts(r.raw)).toEqual(['NotoSans-Regular']);
    expect(r.images).toBe(1);
    expect(r.texts).toEqual(['Hi']);
    expect(r.warnings).toContainEqual({ code: 'font_unavailable', count: 1 });
  });

  it('a provider that does not answer within its timeout: image fallback; the late answer is ignored', async () => {
    let late = 0;
    const native = new FixtureProvider(
      () =>
        new Promise<FontData>((resolve) =>
          setTimeout(() => {
            late++;
            resolve(fixtureFont('NotoSansArabic-subset.ttf'));
          }, 40),
        ),
      'native',
      10_000,
    );
    const r = await exportWith([{ text: 'Hi مرحبا', cx: 200, cy: 50 }], [bundledSource(), native]);
    expect(baseFonts(r.raw)).toEqual(['NotoSans-Regular']);
    expect(r.images).toBe(1);
    expect(r.warnings).toContainEqual({ code: 'font_unavailable', count: 1 });
    expect(r.logs).toContain('font_request_timeout {"provider":"native"}');
    await new Promise((res) => setTimeout(res, 60));
    expect(late).toBe(1); // it did answer, after the export had moved on
  });

  it('a partial answer covers a prefix; the rest asks again', async () => {
    // First answer: Arabic only; the Devanagari of the same run asks again.
    const native = new FixtureProvider((r) =>
      r.script === 'Arabic'
        ? fixtureFont('NotoSansArabic-subset.ttf')
        : r.script === 'Devanagari'
          ? fixtureFont('NotoSansDevanagari-subset.ttf')
          : null,
    );
    const r = await exportWith([{ text: 'مرحبا नमस्ते', cx: 200, cy: 50 }], [bundledSource(), native]);
    expect(baseFonts(r.raw)).toEqual(['NotoSans-Regular', 'NotoSansArabic-Regular', 'NotoSansDevanagari-Regular']);
    expect(r.images).toBe(0);
  });
});

describe('TTC collections (AC-EXP-32)', () => {
  const ttc = fontBytes('NotoSans-RegularBold.ttc');
  // On iOS/Android the platform default ("") goes to the native provider with the box's text.
  const asPlatform = (data: Partial<FontData>): FontDataProvider =>
    new FixtureProvider((r) =>
      r.family === ''
        ? { bytes: ttc, postscriptName: '', embeddable: true, variable: false, source: 'platform', ...data }
        : null,
    );

  it('the face named by postscriptName is embedded (as a subset)', async () => {
    const r = await exportWith(
      [{ text: 'TTC face', cx: 200, cy: 50, family: '' }],
      [bundledSource(), asPlatform({ postscriptName: 'NotoSans-Bold' })],
      'Ttc',
      'android',
    );
    expect(baseFonts(r.raw)).toEqual(['NotoSans-Bold']);
    expect(r.texts).toEqual(['TTC face']);
  });

  it('with an empty name, collectionIndex selects; a disagreeing index is logged and the name wins', async () => {
    const byIndex = await exportWith(
      [{ text: 'TTC face', cx: 200, cy: 50, family: '' }],
      [bundledSource(), asPlatform({ collectionIndex: 1 })],
      'Ttc',
      'android',
    );
    expect(baseFonts(byIndex.raw)).toEqual(['NotoSans-Bold']);
    const both = await exportWith(
      [{ text: 'TTC face', cx: 200, cy: 50, family: '' }],
      [bundledSource(), asPlatform({ postscriptName: 'NotoSans-Regular', collectionIndex: 1 })],
      'Ttc',
      'android',
    );
    expect(baseFonts(both.raw)).toEqual(['NotoSans-Regular']);
    expect(both.logs).toContain('font_ttc_mismatch');
  });
});

// ---- the web's Noto script fonts (spec 08 §6.3) ----

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

class MemoryCache implements ScriptFontCache {
  readonly map = new Map<string, Uint8Array>();
  readonly deleted: string[] = [];
  match(url: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.map.get(url) ?? null);
  }
  put(url: string, bytes: Uint8Array): Promise<void> {
    this.map.set(url, bytes);
    return Promise.resolve();
  }
  delete(url: string): Promise<void> {
    this.deleted.push(url);
    this.map.delete(url);
    return Promise.resolve();
  }
}

const BASE = 'https://fonts.test/fonts/noto/';
const FILES: Record<string, Uint8Array> = {
  'NotoSansArabic-Regular.ttf': fontBytes('NotoSansArabic-subset.ttf'),
  'NotoSansDevanagari-Regular.ttf': fontBytes('NotoSansDevanagari-subset.ttf'),
  'NotoSansSC-Regular.otf': fontBytes('NotoSansSC-subset.otf'),
};

function manifest(over: Record<string, string> = {}): Uint8Array {
  const fonts: Record<string, object> = {};
  const add = (k: string, file: string): void => {
    const b = FILES[file];
    if (b === undefined) throw new Error(file);
    fonts[k] = { file, weight: 400, bytes: b.length, sha256: over[file] ?? sha(b) };
  };
  add('arabic', 'NotoSansArabic-Regular.ttf');
  add('devanagari', 'NotoSansDevanagari-Regular.ttf');
  add('sc', 'NotoSansSC-Regular.otf');
  return new TextEncoder().encode(JSON.stringify({ version: 1, fonts }));
}

function webProvider(
  opts: { manifest?: Uint8Array | null; cache?: MemoryCache; body?: (file: string) => Uint8Array | null } = {},
) {
  const fetched: string[] = [];
  const logs: string[] = [];
  const cache = opts.cache ?? new MemoryCache();
  const p = new WebScriptFontProvider({
    baseUrl: BASE,
    cache,
    sha256: (b) => Promise.resolve(sha(b)),
    fetch: (url) => {
      fetched.push(url.slice(BASE.length));
      if (url === `${BASE}manifest.json`)
        return Promise.resolve(opts.manifest === undefined ? manifest() : opts.manifest);
      const file = url.slice(BASE.length);
      return Promise.resolve(opts.body !== undefined ? opts.body(file) : (FILES[file] ?? null));
    },
    log: (code, f) => logs.push(f === undefined ? code : `${code} ${JSON.stringify(f)}`),
  });
  return { p, fetched, cache, logs };
}

const SCRIPTS: readonly TextSpec[] = [
  { text: 'Latin مرحبا', cx: 200, cy: 50 },
  { text: 'नमस्ते text', cx: 200, cy: 100 },
  { text: '你好 world', cx: 200, cy: 150 },
];

describe('web Noto script fonts (AC-EXP-16 unit half, AC-EXP-35)', () => {
  it('Han, Arabic and Devanagari runs embed the downloaded Noto fonts; the next export reads Cache Storage', async () => {
    const cache = new MemoryCache();
    const a = webProvider({ cache });
    const r1 = await exportWith(SCRIPTS, [bundledSource(), a.p]);
    expect(baseFonts(r1.raw)).toEqual([
      'NotoSans-Regular',
      'NotoSansArabic-Regular',
      'NotoSansDevanagari-Regular',
      'NotoSansSC-Regular',
    ]);
    expect(a.fetched.sort()).toEqual([
      'NotoSansArabic-Regular.ttf',
      'NotoSansDevanagari-Regular.ttf',
      'NotoSansSC-Regular.otf',
      'manifest.json',
    ]);
    expect(a.p.downloadedBytes()).toBe(Object.values(FILES).reduce((n, b) => n + b.length, 0));
    // A new export (a new provider) over the same cache: only the manifest goes to the network.
    const b = webProvider({ cache });
    const r2 = await exportWith(SCRIPTS, [bundledSource(), b.p]);
    expect(baseFonts(r2.raw)).toEqual(baseFonts(r1.raw));
    expect(b.fetched).toEqual(['manifest.json']);
    expect(r2.warnings).toEqual([]);
  });

  it('a manifest that cannot be fetched (and is not cached): every script run is an image, one warning', async () => {
    const a = webProvider({ manifest: null });
    const r = await exportWith(SCRIPTS, [bundledSource(), a.p]);
    expect(baseFonts(r.raw)).toEqual(['NotoSans-Regular']);
    expect(r.images).toBe(3);
    expect(r.warnings).toContainEqual({ code: 'font_unavailable', count: 3 });
    expect(a.fetched.filter((f) => f === 'manifest.json').length).toBe(1);
    expect(a.logs).toEqual(['font_manifest_unavailable']);
  });

  it('the cached manifest is used when the network fails', async () => {
    const cache = new MemoryCache();
    await webProvider({ cache }).p.manifest(NEVER);
    const offline = webProvider({ cache, manifest: null });
    const m = await offline.p.manifest(NEVER);
    expect(Object.keys(m?.fonts ?? {}).sort()).toEqual(['arabic', 'devanagari', 'sc']);
  });

  it('a body whose SHA-256 differs is not used, its cache entry is deleted, and it is not fetched again', async () => {
    const cache = new MemoryCache();
    const bad = new Uint8Array(FILES['NotoSansArabic-Regular.ttf'] ?? []);
    bad[100] = (bad[100] ?? 0) ^ 0xff;
    cache.map.set(`${BASE}NotoSansArabic-Regular.ttf`, bad);
    const a = webProvider({ cache });
    const r = await exportWith(
      [
        { text: 'One مرحبا', cx: 200, cy: 50 },
        { text: 'Two مرحبا', cx: 200, cy: 100, bold: true },
      ],
      [bundledSource(), a.p],
    );
    expect(baseFonts(r.raw)).toEqual(['NotoSans-Bold', 'NotoSans-Regular']);
    expect(cache.deleted).toEqual([`${BASE}NotoSansArabic-Regular.ttf`]);
    expect(a.fetched.filter((f) => f.startsWith('NotoSansArabic'))).toEqual([]);
    expect(a.logs).toEqual(['font_hash_mismatch {"script":"Arabic"}']);
    expect(r.images).toBe(2);
    // A network body with the wrong hash: discarded, not cached, not retried.
    const b = webProvider({ body: (f) => (f.startsWith('NotoSansArabic') ? bad : (FILES[f] ?? null)) });
    const r2 = await exportWith(
      [
        { text: 'x مرحبا', cx: 200, cy: 50 },
        { text: 'y مرحبا', cx: 200, cy: 90, bold: true },
      ],
      [bundledSource(), b.p],
    );
    expect(b.fetched.filter((f) => f.startsWith('NotoSansArabic')).length).toBe(1);
    expect(b.cache.map.has(`${BASE}NotoSansArabic-Regular.ttf`)).toBe(false);
    expect(r2.images).toBe(2);
  });

  it('the Han choice: kana → JP, Hangul → KR, else by language', () => {
    expect(scriptFontKey('Han', '日本語のテキスト', 'en')).toBe('jp');
    expect(scriptFontKey('Hangul', '한국어', undefined)).toBe('kr');
    expect(scriptFontKey('Han', '漢字', 'zh-TW')).toBe('tc');
    expect(scriptFontKey('Han', '漢字', 'zh-Hant-HK')).toBe('tc');
    expect(scriptFontKey('Han', '漢字', 'ja-JP')).toBe('jp');
    expect(scriptFontKey('Han', '漢字', 'ko')).toBe('kr');
    expect(scriptFontKey('Han', '汉字', 'en-US')).toBe('sc');
    expect(scriptFontKey('Arabic', 'x', undefined)).toBe('arabic');
    expect(scriptFontKey('Latin', 'x', undefined)).toBeNull();
  });

  it('the provider answers only uncovered runs (a request with a script)', async () => {
    const a = webProvider();
    expect(await a.p.resolve({ text: 'abc', family: 'Arial', bold: false, italic: false }, NEVER)).toBeNull();
    expect(a.fetched).toEqual([]);
  });

  it('logs carry codes and counts only, never text (AC-EXP-31)', async () => {
    const marker = 'MARKERxyz';
    const native = new FixtureProvider(() => Promise.reject(new Error(marker)), 'native', 10_000);
    const r = await exportWith([{ text: `${marker} مرحبا 😀`, cx: 200, cy: 50 }], [bundledSource(), native], marker);
    expect(r.logs.join('\n')).not.toContain(marker);
    expect(JSON.stringify(r.warnings)).not.toContain(marker);
  });
});
