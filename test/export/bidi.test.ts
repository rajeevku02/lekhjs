// AC-EXP-18 (unit half): the visual run order of mixed-direction lines in the PDF, with the base
// direction of the line's paragraph (its first strong character, as the canvas's `ctx.direction`):
// Arabic only; Arabic + digits; Arabic first with trailing Latin (base RTL); Latin first with
// Arabic inside (base LTR); Hebrew in a Latin sentence; brackets in an RTL line (mirrored).
// Also `TextRunSplitter` (clusters, scripts, emoji) and the L2 reordering itself.
import { describe, expect, it } from 'vitest';
import {
  BidiResolver,
  PdfFontResolver,
  RunImageFallback,
  TextCollectingPlatform,
  TextRunSplitter,
  isEmojiCluster,
  pdfModules,
  scriptOf,
  type LineRun,
} from '../../src/export/pdf';
import { planExport } from '../../src/export';
import { boardSession, napiFactory, recordingSink, run } from './helpers';
import { bundledSource, parsePdf, pdfEnv, scriptFixtures, textBoard } from './pdf-helpers';

const NEVER = new AbortController().signal;

async function plansOf(texts: readonly string[]): Promise<{ text: string; dir: string; runs: LineRun[] }[]> {
  const s = boardSession(textBoard([texts.map((text, i) => ({ text, cx: 300, cy: 40 + i * 50, w: 500 }))]));
  const plan = planExport(s, { format: 'pdf', region: 'full', padding: 0, scale: 1, includeBackground: false })[0];
  if (plan === undefined) throw new Error('plan');
  const c = new TextCollectingPlatform();
  s.drawForExport(c, 0, false, { scale: 1, tx: plan.translateX, ty: plan.translateY });
  const m = pdfModules();
  const resolver = new PdfFontResolver({
    fontkit: m.fontkit,
    bidi: new BidiResolver(m.bidi),
    providers: [bundledSource(), scriptFixtures()],
    images: new RunImageFallback(napiFactory()),
  });
  await resolver.prepare(c.texts, () => 'rgb(0, 0, 0)', NEVER);
  return c.texts.flatMap((t) =>
    t.text.lines.map((l) => ({ text: l.text, dir: l.dir, runs: [...resolver.plan(t.text, l, 'rgb(0, 0, 0)').runs] })),
  );
}

const visual = (runs: readonly LineRun[]): string[] => runs.map((r) => r.text);
const kinds = (runs: readonly LineRun[]): string[] =>
  runs.map((r) => (r.kind === 'image' ? 'img' : r.font.postscriptName.replace('NotoSans', '') || 'Sans'));

describe('bidi run order in the PDF (AC-EXP-18)', () => {
  it('orders the six reference lines visually', async () => {
    const lines = await plansOf(['مرحبا', 'مرحبا 123', 'مرحبا abc', 'abc مرحبا def', 'say שלום now', '(مرحبا)']);
    expect(lines.map((l) => l.dir)).toEqual(['rtl', 'rtl', 'rtl', 'ltr', 'ltr', 'rtl']);
    const [ar, digits, trailing, inside, hebrew, brackets] = lines.map((l) => l.runs);
    expect(visual(ar ?? [])).toEqual(['مرحبا']);
    // Digits stay left to right inside the right-to-left line, to the left of the Arabic.
    expect(visual(digits ?? [])).toEqual(['123', ' ', 'مرحبا']);
    expect(visual(trailing ?? [])).toEqual(['abc', ' ', 'مرحبا']);
    // The space after the Arabic word takes its script (a neutral joins the run before it).
    expect(visual(inside ?? [])).toEqual(['abc ', 'مرحبا', ' ', 'def']);
    expect(kinds(inside ?? [])).toEqual(['-Regular', 'Arabic-Regular', '-Regular', '-Regular']);
    // Hebrew has no font here: an image run, still in its visual place.
    expect(visual(hebrew ?? [])).toEqual(['say ', 'שלום', ' ', 'now']);
    expect(kinds(hebrew ?? [])).toEqual(['-Regular', 'img', '-Regular', '-Regular']);
    // RTL brackets are mirrored (L4) and swap sides (L2): "(" stays left of the word on screen.
    expect(visual(brackets ?? [])).toEqual(['(', 'مرحبا', ')']);
  });

  it('places runs left to right with their PDF advances', async () => {
    const s = boardSession(
      textBoard([[{ text: 'abc مرحبا def', cx: 300, cy: 40, w: 500, align: 0 }]]),
      undefined,
      'Bidi',
    );
    const { sink, rec } = recordingSink();
    const r = await run(s, { format: 'pdf' }, pdfEnv([bundledSource(), scriptFixtures()], { sink }));
    expect(r.status).toBe('done');
    const { pages } = await parsePdf(rec.file('Bidi.pdf'));
    const items = (pages[0]?.items ?? []).filter((i) => i.str.trim() !== '');
    expect(items.map((i) => i.str.trim().replace(/\p{Cc}/gu, ''))).toEqual(['abc', 'مرحبا', 'def']);
    const xs = items.map((i) => i.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    // Each run starts where the previous one ended (within 0.5 pt).
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1];
      const cur = items[i];
      if (prev === undefined || cur === undefined) continue;
      expect(cur.x).toBeGreaterThanOrEqual(prev.x + prev.width - 0.5);
    }
  });

  it('L2 reverses from the highest level down to the lowest odd level', () => {
    expect(BidiResolver.visualOrder([0, 1, 1, 0])).toEqual([0, 2, 1, 3]);
    expect(BidiResolver.visualOrder([1, 2, 1])).toEqual([2, 1, 0]);
    expect(BidiResolver.visualOrder([1, 2, 2, 1])).toEqual([3, 1, 2, 0]);
    expect(BidiResolver.visualOrder([0, 0])).toEqual([0, 1]);
  });
});

describe('TextRunSplitter', () => {
  const sp = new TextRunSplitter();

  it('keeps combining marks, ZWJ sequences and Devanagari conjuncts in one cluster', () => {
    expect(sp.clusters('é').length).toBe(1);
    expect(sp.clusters('👩‍💻').length).toBe(1);
    const dev = sp.clusters('नमस्ते');
    expect(dev.map((c) => c.text).join('')).toBe('नमस्ते');
    expect(dev.every((c) => c.script === 'Devanagari')).toBe(true);
  });

  it('neutrals take the script before them, else the one after', () => {
    const c = sp.clusters('(abc) 123 مرحبا!');
    expect(c[0]?.script).toBe('Latin'); // "(" before any letter: the following script
    expect(c.find((k) => k.text === '1')?.script).toBe('Latin');
    expect(c[c.length - 1]?.script).toBe('Arabic');
  });

  it('kana run with Han (one CJK run)', () => {
    const c = sp.clusters('日本語のテキスト');
    expect(new Set(c.map((k) => k.script))).toEqual(new Set(['Han']));
  });

  it('emoji: presentation emoji, VS16 and keycaps; not © or digits', () => {
    expect(isEmojiCluster('😀')).toBe(true);
    expect(isEmojiCluster('❤️')).toBe(true);
    expect(isEmojiCluster('1️⃣')).toBe(true);
    expect(isEmojiCluster('🇮🇳')).toBe(true);
    expect(isEmojiCluster('©')).toBe(false);
    expect(isEmojiCluster('1')).toBe(false);
    expect(isEmojiCluster('❤')).toBe(false);
  });

  it('names scripts', () => {
    expect(scriptOf(0x41)).toBe('Latin');
    expect(scriptOf(0x627)).toBe('Arabic');
    expect(scriptOf(0x4f60)).toBe('Han');
    expect(scriptOf(0x20)).toBe('Common');
  });
});
