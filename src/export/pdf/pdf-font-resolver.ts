// `PdfFontResolver` (spec 08 §6, spec 02; spec 08's `pdf/FontResolver.ts`): the font chain per
// text run, resolved before the first page so the drawing pass stays synchronous.
//
// Primary font of a text box (its resolved family, weight and style): the first provider that
// answers the request with the box's whole text — the bundled family (source 1), else on native
// the platform font (source 2) — else the bundled default, Noto Sans (source 4).
//
// Each line is cut into grapheme clusters (`TextRunSplitter`). A cluster the primary font does
// not cover asks the providers again with its run's text and script ({text, family, bold,
// italic, script, lang}); the first answer whose font covers the run's first cluster is taken.
// Answers are cached per export by (source, PostScript name), and requests de-duplicated per
// (script, family, bold, italic). A partial answer (a native font covering a prefix) leaves the
// rest of the run uncovered, which asks again, so runs split at coverage boundaries. What no font
// covers, and every emoji, is an image run (`RunImageFallback`, source 5).
//
// Runs end where the covering font, the script, the emoji flag or the bidi level changes; they
// are ordered visually by `BidiResolver` (L2) with the line's paragraph direction. A provider
// with `timeoutMs` (native `getFontData`, 10 s) that rejects or does not answer in time counts as
// no answer; a late answer is ignored.
import type { Handle, Scheduler } from '../../base';
import type { LaidOutLine, LaidOutText } from '../../text';
import { DEFAULT_FONT_FAMILY } from '../../text';
import type { ExportSignalLike, ExportWarning, FontData, FontDataProvider, FontRequest } from '../types';
import { BidiResolver } from './bidi-resolver';
import { openFont, type OpenedFont } from './font-embedding';
import type { FontkitModule } from './ports';
import type { RunImageFallback, RunImage } from './run-image-fallback';
import type { CollectedText } from './text-collecting-platform';
import { TextRunSplitter, type TextCluster } from './text-run-splitter';

/** One run of a line, in visual order. */
export type LineRun =
  | {
      readonly kind: 'font';
      /** What PDFKit receives (logical; mirrored, or reversed when RTL without a strong RTL character). */
      readonly text: string;
      readonly font: OpenedFont;
      /** Advance in board units, from the PDF font. */
      readonly width: number;
      /** Italic requested and the face has none: a 12° skew. */
      readonly synthItalic: boolean;
      readonly level: number;
    }
  | {
      readonly kind: 'image';
      /** Logical text, drawn by the canvas in its direction. */
      readonly text: string;
      readonly image: RunImage | null;
      readonly width: number;
      readonly emoji: boolean;
      readonly level: number;
    };

export interface LinePlan {
  readonly runs: readonly LineRun[];
  /** Sum of the run advances (board units). */
  readonly width: number;
}

/** The family and traits a `buildCanvasFont` string names: `${style} ${weight} ${px}px ${families}`. */
export function fontTraits(font: string): { family: string; bold: boolean; italic: boolean } {
  const m = /^(\S+) (\S+) [^ ]+px (.+)$/.exec(font);
  if (m === null) return { family: '', bold: false, italic: false };
  const style = m[1] ?? 'normal';
  const weight = m[2] === 'bold' ? 700 : Number(m[2]);
  const first = (m[3] ?? '').split(',')[0]?.trim() ?? '';
  let family = '';
  if (first.startsWith('"')) family = first.slice(1, -1).replace(/\\(["\\])/g, '$1');
  return { family, bold: weight >= 600, italic: style === 'italic' || style === 'oblique' };
}

export interface PdfFontResolverOptions {
  readonly fontkit: FontkitModule;
  readonly bidi: BidiResolver;
  readonly providers: readonly FontDataProvider[];
  readonly images: RunImageFallback;
  readonly lang?: string;
  readonly timers?: Pick<Scheduler, 'setTimeout' | 'clearTimeout'>;
  readonly log?: (code: string, fields?: Record<string, number | string | boolean>) => void;
  /** Font bytes downloaded so far (the providers' `downloadedBytes`), when it grows. */
  readonly onBytes?: (total: number) => void;
}

interface FallbackState {
  readonly fonts: OpenedFont[];
  exhausted: boolean;
}

const HAN_KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;

export class PdfFontResolver {
  private readonly o: PdfFontResolverOptions;
  private readonly splitter = new TextRunSplitter();
  private readonly primaries = new Map<string, OpenedFont | null>();
  private readonly fallbacks = new Map<string, FallbackState>();
  private readonly opened = new Map<string, OpenedFont>();
  private readonly fonts_: OpenedFont[] = [];
  private readonly clusterCache = new Map<string, TextCluster[]>();
  private readonly plans = new Map<string, LinePlan>();
  private readonly fontUnavailable = new Set<string>();
  private readonly emojiRuns = new Set<string>();
  private reportedBytes = 0;

  constructor(opts: PdfFontResolverOptions) {
    this.o = opts;
  }

  /** Every font opened in this export, in order (each embedded or outlined once). */
  get fonts(): readonly OpenedFont[] {
    return this.fonts_;
  }

  /**
   * Resolves the primary and fallback fonts of every collected text, then renders every image
   * run. After it settles, `plan` is synchronous.
   */
  async prepare(
    texts: readonly CollectedText[],
    color: (c: CollectedText) => string,
    signal: ExportSignalLike,
  ): Promise<void> {
    for (const c of texts) {
      const t = c.text;
      const traits = fontTraits(t.font);
      const full = t.lines.map((l) => l.text).join('\n');
      const primary = await this.primaryFor(traits, full, signal);
      for (const line of t.lines) {
        const clusters = this.clustersOf(line.text);
        const uncovered = clusters.filter((k) => !k.emoji && !covers(primary, k));
        if (uncovered.length === 0) continue;
        for (const group of groupsByScript(clusters, (k) => !k.emoji && !covers(primary, k))) {
          await this.ensureFallback(traits, group, primary, signal);
        }
      }
    }
    // Every line's runs are final now; render the image runs.
    for (const c of texts) {
      const css = color(c);
      for (const line of c.text.lines) {
        const plan = this.structural(c.text, line);
        for (const r of plan) {
          if (r.kind !== 'image') continue;
          await this.o.images.render(r.text, c.text.font, c.text.px, css, r.level % 2 === 1);
        }
      }
    }
  }

  /** The runs of a laid-out line in visual order, with their advances (after `prepare`). */
  plan(t: LaidOutText, line: LaidOutLine, color: string): LinePlan {
    const key = `${t.font}\u0000${line.text}\u0000${line.dir}\u0000${color}`;
    const hit = this.plans.get(key);
    if (hit !== undefined) return hit;
    const runs: LineRun[] = [];
    let width = 0;
    for (const r of this.structural(t, line)) {
      if (r.kind === 'font') {
        const w = (r.font.font.layout(r.text, []).advanceWidth / r.font.font.unitsPerEm) * t.px;
        runs.push({ ...r, width: w });
        width += w;
      } else {
        const image = this.o.images.get(r.text, t.font, color, r.level % 2 === 1);
        const w = image?.advance ?? 0;
        runs.push({ ...r, image, width: w });
        width += w;
        const id = `${t.font}\u0000${r.text}`;
        if (r.emoji) this.emojiRuns.add(id);
        else this.fontUnavailable.add(id);
      }
    }
    const plan = { runs, width };
    this.plans.set(key, plan);
    return plan;
  }

  /** `font_unavailable` / `run_as_image` (spec 08 §10.3): emoji runs count with `detail: 'emoji'` and never toast. */
  warnings(): ExportWarning[] {
    const out: ExportWarning[] = [];
    if (this.fontUnavailable.size > 0) {
      out.push({ code: 'font_unavailable', count: this.fontUnavailable.size });
      out.push({ code: 'run_as_image', count: this.fontUnavailable.size });
    }
    if (this.emojiRuns.size > 0) out.push({ code: 'run_as_image', count: this.emojiRuns.size, detail: 'emoji' });
    return out;
  }

  // ---- runs ----

  private clustersOf(text: string): TextCluster[] {
    let c = this.clusterCache.get(text);
    if (c === undefined) {
      c = this.splitter.clusters(text);
      this.clusterCache.set(text, c);
    }
    return c;
  }

  /** The runs of a line without advances. */
  private structural(
    t: LaidOutText,
    line: LaidOutLine,
  ): (
    | { kind: 'font'; text: string; font: OpenedFont; synthItalic: boolean; level: number }
    | { kind: 'image'; text: string; emoji: boolean; level: number }
  )[] {
    const traits = fontTraits(t.font);
    const primary = this.primaries.get(primaryKey(traits)) ?? null;
    const clusters = this.clustersOf(line.text);
    const levels = this.o.bidi.levels(line.text, line.dir);
    const assign = clusters.map((k) => {
      if (k.emoji) return null;
      if (primary !== null && covers(primary, k)) return primary;
      const st = this.fallbacks.get(fallbackKey(traits, k.script, line.text));
      return st?.fonts.find((f) => covers(f, k)) ?? null;
    });
    const spans = this.splitter.runs(clusters, (k, i) => {
      const f = assign[i];
      return `${f === null || f === undefined ? (k.emoji ? 'E' : 'X') : f.key}\u0000${k.script}\u0000${String(levels[k.start] ?? 0)}`;
    });
    const runs = spans.map((s) => {
      const first = clusters[s.from];
      const level = first !== undefined ? (levels[first.start] ?? 0) : 0;
      const parts = clusters.slice(s.from, s.to).map((k) => k.text);
      const font = assign[s.from] ?? null;
      if (font === null) {
        return { kind: 'image' as const, text: parts.join(''), emoji: first?.emoji === true, level };
      }
      return {
        kind: 'font' as const,
        text: this.o.bidi.runText(parts, level),
        font,
        synthItalic: traits.italic && !font.italic,
        level,
      };
    });
    const order = BidiResolver.visualOrder(runs.map((r) => r.level));
    return order.map((i) => runs[i]).filter((r) => r !== undefined);
  }

  // ---- fonts ----

  private async primaryFor(
    traits: { family: string; bold: boolean; italic: boolean },
    text: string,
    signal: ExportSignalLike,
  ): Promise<OpenedFont | null> {
    const key = primaryKey(traits);
    if (this.primaries.has(key)) return this.primaries.get(key) ?? null;
    const req: FontRequest = {
      text,
      family: traits.family,
      bold: traits.bold,
      italic: traits.italic,
      ...this.langOf(),
    };
    let font = await this.first(req, null, signal);
    if (font === null && traits.family !== DEFAULT_FONT_FAMILY) {
      font = await this.first({ ...req, family: DEFAULT_FONT_FAMILY }, null, signal);
    }
    if (font === null) this.o.log?.('font_primary_unavailable');
    this.primaries.set(key, font);
    return font;
  }

  private async ensureFallback(
    traits: { family: string; bold: boolean; italic: boolean },
    group: { script: string; clusters: TextCluster[]; line: string },
    primary: OpenedFont | null,
    signal: ExportSignalLike,
  ): Promise<void> {
    const key = fallbackKey(traits, group.script, group.line);
    let st = this.fallbacks.get(key);
    if (st === undefined) {
      st = { fonts: [], exhausted: false };
      this.fallbacks.set(key, st);
    }
    for (let guard = 0; guard < 8 && !st.exhausted; guard++) {
      const fonts = st.fonts;
      const missing = group.clusters.filter((k) => !fonts.some((f) => covers(f, k)));
      const firstMissing = missing[0];
      if (firstMissing === undefined) return;
      // The run's text from its first uncovered cluster (a partial answer covers a prefix of it).
      const from = group.clusters.indexOf(firstMissing);
      const text = group.clusters
        .slice(from)
        .map((k) => k.text)
        .join('');
      const req: FontRequest = {
        text,
        family: traits.family,
        bold: traits.bold,
        italic: traits.italic,
        script: group.script,
        ...this.langOf(),
      };
      const font = await this.first(req, firstMissing, signal, primary);
      if (font === null || fonts.includes(font)) {
        st.exhausted = true;
        return;
      }
      fonts.push(font);
    }
  }

  private langOf(): { lang?: string } {
    return this.o.lang !== undefined && this.o.lang !== '' ? { lang: this.o.lang } : {};
  }

  /** The first provider answer that opens (and covers `must`, when given). */
  private async first(
    req: FontRequest,
    must: TextCluster | null,
    signal: ExportSignalLike,
    skip: OpenedFont | null = null,
  ): Promise<OpenedFont | null> {
    for (const p of this.o.providers) {
      if (signal.aborted) return null;
      const data = await this.ask(p, req, signal);
      this.reportBytes();
      if (data === null) continue;
      const font = this.open(data, req.bold);
      if (font === null || font === skip) continue;
      if (must !== null && !covers(font, must)) continue;
      return font;
    }
    return null;
  }

  private reportBytes(): void {
    let total = 0;
    for (const p of this.o.providers) total += p.downloadedBytes?.() ?? 0;
    if (total > this.reportedBytes) {
      this.reportedBytes = total;
      this.o.onBytes?.(total);
    }
  }

  /** One provider call; a rejection or a timeout is no answer (`font_unavailable` logged). */
  private ask(p: FontDataProvider, req: FontRequest, signal: ExportSignalLike): Promise<FontData | null> {
    const call = (): Promise<FontData | null> => {
      try {
        return p.resolve(req, signal).catch(() => {
          this.o.log?.('font_request_failed', { provider: p.id });
          return null;
        });
      } catch {
        return Promise.resolve(null);
      }
    };
    const timers = this.o.timers;
    const ms = p.timeoutMs;
    if (ms === undefined || timers === undefined) return call();
    return new Promise((resolve) => {
      let settled = false;
      const h: Handle = timers.setTimeout(() => {
        if (settled) return;
        settled = true;
        this.o.log?.('font_request_timeout', { provider: p.id });
        resolve(null);
      }, ms);
      void call().then((d) => {
        if (settled) return; // a late answer is ignored
        settled = true;
        timers.clearTimeout(h);
        resolve(d);
      });
    });
  }

  /** Opens `data` once per (source, PostScript name, weight). */
  private open(data: FontData, bold: boolean): OpenedFont | null {
    const key = `F${String(this.fonts_.length + 1)}`;
    const font = openFont(this.o.fontkit, data, key, bold, (code) => this.o.log?.(code));
    if (font === null) return null;
    const id = `${data.source}\u0000${font.postscriptName}\u0000${font.mode === 'outline' && bold ? 'b' : ''}`;
    const hit = this.opened.get(id);
    if (hit !== undefined) return hit;
    this.opened.set(id, font);
    this.fonts_.push(font);
    return font;
  }
}

function primaryKey(t: { family: string; bold: boolean; italic: boolean }): string {
  return `${t.family}\u0000${t.bold ? 'b' : ''}\u0000${t.italic ? 'i' : ''}`;
}

/** De-duplication per (script, family, bold, italic); Han also by whether the line has kana (JP). */
function fallbackKey(t: { family: string; bold: boolean; italic: boolean }, script: string, line: string): string {
  const hint = script === 'Han' && HAN_KANA_RE.test(line) ? 'kana' : '';
  return `${script}\u0000${hint}\u0000${primaryKey(t)}`;
}

/** Whether `font` has a glyph for every code point the cluster needs. */
function covers(font: OpenedFont | null, k: TextCluster): boolean {
  if (font === null) return false;
  for (const cp of k.needs) if (!font.font.hasGlyphForCodePoint(cp)) return false;
  return true;
}

/** Maximal groups of consecutive clusters that pass `test`, split where the script changes. */
function groupsByScript(
  clusters: readonly TextCluster[],
  test: (k: TextCluster) => boolean,
): { script: string; clusters: TextCluster[]; line: string }[] {
  const line = clusters.map((k) => k.text).join('');
  type Group = { script: string; clusters: TextCluster[]; line: string };
  const out: Group[] = [];
  let cur: Group | undefined;
  for (const k of clusters) {
    if (!test(k)) {
      cur = undefined;
      continue;
    }
    if (cur === undefined || cur.script !== k.script) {
      const g: Group = { script: k.script, clusters: [], line };
      out.push(g);
      cur = g;
    }
    cur.clusters.push(k);
  }
  return out;
}
