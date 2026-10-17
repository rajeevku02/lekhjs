// `WebScriptFontProvider` (spec 08 §6.3, spec 02; spec 08's `WebNotoFontSource`): on the web, a
// Noto font for a run's script, downloaded on demand from the `lekhboard` static host
// (`fonts/noto/`, beside the stencils, OQ-55) and kept in Cache Storage. DOM-free: the host
// passes `fetch`, the cache (`caches.open('lekh-pdf-fonts-v1')`) and SHA-256 (`crypto.subtle`).
//
// - `manifest.json` maps `<script>` and `<script>-bold` to `{file, weight, bytes, sha256}`; it is
//   fetched from the network first and falls back to its cached copy. Without one, every script
//   run of the export goes to the image fallback (`null` here).
// - A body comes from the cache first, then the network. Its SHA-256 is checked against the
//   manifest before use; on a mismatch the body is discarded, its cache entry deleted, the file
//   is not retried in this export, and `font_hash_mismatch` is logged with the script only.
// - Han: kana in the text → JP; Hangul → KR; otherwise by `lang` (`zh-TW`/`zh-HK`/`zh-Hant` → TC,
//   `ja` → JP, `ko` → KR, else SC).
// - Bold asks for `<script>-bold` first; there is no italic (the writer skews).
// One instance per export: what failed is not retried within it.
import { utf8Decode } from '../bytes';
import type { ExportSignalLike, FontData, FontDataProvider, FontRequest } from '../types';

export const PDF_FONT_CACHE = 'lekh-pdf-fonts-v1';

export interface ScriptFontEntry {
  readonly file: string;
  readonly weight: number;
  readonly bytes: number;
  readonly sha256: string;
}

export interface ScriptFontManifest {
  readonly version?: number;
  readonly fonts: Readonly<Record<string, ScriptFontEntry>>;
}

/** Cache Storage reduced to bytes by URL. */
export interface ScriptFontCache {
  match(url: string): Promise<Uint8Array | null>;
  put(url: string, bytes: Uint8Array): Promise<void>;
  delete(url: string): Promise<void>;
}

export interface WebScriptFontProviderOptions {
  /** The `fonts/noto/` folder URL (ends with `/`). */
  readonly baseUrl: string;
  /** The body of a successful GET, or null (non-2xx, offline, aborted). */
  readonly fetch: (url: string, signal: ExportSignalLike) => Promise<Uint8Array | null>;
  readonly cache?: ScriptFontCache;
  /** Lower-case hex SHA-256. */
  readonly sha256: (bytes: Uint8Array) => Promise<string>;
  /** Bytes downloaded so far in this export (the progress modal's "Downloading fonts (3.2 MB)…"). */
  readonly onBytes?: (total: number) => void;
  /** Codes and counts only. */
  readonly log?: (code: string, fields?: Record<string, number | string | boolean>) => void;
}

/** The manifest key of a run's script (`null`: no Noto file for it). */
export function scriptFontKey(script: string, text: string, lang: string | undefined): string | null {
  switch (script) {
    case 'Han':
    case 'Hiragana':
    case 'Katakana':
    case 'Bopomofo': {
      if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return 'jp';
      if (/\p{Script=Hangul}/u.test(text)) return 'kr';
      const l = (lang ?? '').toLowerCase();
      if (l.startsWith('zh-tw') || l.startsWith('zh-hk') || l.startsWith('zh-hant') || l.startsWith('zh-mo'))
        return 'tc';
      if (l === 'ja' || l.startsWith('ja-')) return 'jp';
      if (l === 'ko' || l.startsWith('ko-')) return 'kr';
      return 'sc';
    }
    case 'Hangul':
      return 'kr';
    case 'Other':
    case 'Common':
    case 'Latin':
      return null;
    default:
      return script.toLowerCase();
  }
}

export class WebScriptFontProvider implements FontDataProvider {
  readonly id = 'noto-web';
  private readonly o: WebScriptFontProviderOptions;
  private manifest_: Promise<ScriptFontManifest | null> | null = null;
  private readonly bodies = new Map<string, Promise<Uint8Array | null>>();
  private readonly failed = new Set<string>();
  private downloaded = 0;
  private manifestFailureLogged = false;

  constructor(opts: WebScriptFontProviderOptions) {
    this.o = opts;
  }

  downloadedBytes(): number {
    return this.downloaded;
  }

  private url(file: string): string {
    return this.o.baseUrl.endsWith('/') ? this.o.baseUrl + file : `${this.o.baseUrl}/${file}`;
  }

  /** The manifest: network first, then the cached copy; null when neither exists. */
  manifest(signal: ExportSignalLike): Promise<ScriptFontManifest | null> {
    this.manifest_ ??= this.loadManifest(signal);
    return this.manifest_;
  }

  private async loadManifest(signal: ExportSignalLike): Promise<ScriptFontManifest | null> {
    const url = this.url('manifest.json');
    const cache = this.o.cache;
    let body = await this.o.fetch(url, signal).catch(() => null);
    if (body !== null) {
      const parsed = parseManifest(body);
      if (parsed !== null) {
        await cache?.put(url, body).catch(() => undefined);
        return parsed;
      }
    }
    body = (await cache?.match(url).catch(() => null)) ?? null;
    const parsed = body !== null ? parseManifest(body) : null;
    if (parsed === null && !this.manifestFailureLogged) {
      this.manifestFailureLogged = true;
      this.o.log?.('font_manifest_unavailable');
    }
    return parsed;
  }

  async resolve(req: FontRequest, signal: ExportSignalLike): Promise<FontData | null> {
    if (req.script === undefined) return null; // only uncovered runs (spec 08 §6.1 source 3)
    const key = scriptFontKey(req.script, req.text, req.lang);
    if (key === null) return null;
    const m = await this.manifest(signal);
    if (m === null) return null;
    const entry = (req.bold ? m.fonts[`${key}-bold`] : undefined) ?? m.fonts[key];
    if (entry === undefined) return null;
    const bytes = await this.body(entry, req.script, signal);
    if (bytes === null) return null;
    return { bytes, postscriptName: '', embeddable: true, variable: false, source: 'noto-web' };
  }

  private body(entry: ScriptFontEntry, script: string, signal: ExportSignalLike): Promise<Uint8Array | null> {
    const url = this.url(entry.file);
    if (this.failed.has(url)) return Promise.resolve(null);
    let p = this.bodies.get(url);
    if (p === undefined) {
      p = this.loadBody(url, entry, script, signal);
      this.bodies.set(url, p);
    }
    return p;
  }

  private async loadBody(
    url: string,
    entry: ScriptFontEntry,
    script: string,
    signal: ExportSignalLike,
  ): Promise<Uint8Array | null> {
    const cache = this.o.cache;
    const want = entry.sha256.toLowerCase();
    const cached = (await cache?.match(url).catch(() => null)) ?? null;
    if (cached !== null) {
      if ((await this.o.sha256(cached)) === want) return cached;
      return this.mismatch(url, script);
    }
    const body = await this.o.fetch(url, signal).catch(() => null);
    if (body === null) {
      this.failed.add(url);
      this.bodies.delete(url);
      return null;
    }
    this.downloaded += body.length;
    this.o.onBytes?.(this.downloaded);
    if ((await this.o.sha256(body)) !== want) return this.mismatch(url, script);
    await cache?.put(url, body).catch(() => undefined);
    return body;
  }

  private async mismatch(url: string, script: string): Promise<null> {
    this.failed.add(url);
    this.o.log?.('font_hash_mismatch', { script });
    await this.o.cache?.delete(url).catch(() => undefined);
    return null;
  }
}

function parseManifest(bytes: Uint8Array): ScriptFontManifest | null {
  try {
    const v: unknown = JSON.parse(utf8Decode(bytes));
    if (typeof v !== 'object' || v === null) return null;
    const fonts = (v as { fonts?: unknown }).fonts;
    if (typeof fonts !== 'object' || fonts === null) return null;
    return v as ScriptFontManifest;
  } catch {
    return null;
  }
}
