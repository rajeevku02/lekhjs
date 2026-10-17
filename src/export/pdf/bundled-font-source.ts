// `BundledFontSource` (spec 08 §6.1 source 1, spec 02): the bundled TTFs (Noto Sans, Noto Serif,
// Noto Sans Mono, Caveat) for a request whose family is one of them. The face is the registry's
// (`FontRegistry.faceFor`: the closest weight; the italic only where it exists — Noto Sans Mono
// and Caveat have none, so the writer synthesises it). The bytes come through the host's `load`:
// a fetch of the asset URL in the app (`FontRegistry.ttfFor`), a file read on Node. Never a path
// handed to PDFKit: fonts are registered from a `Uint8Array` on every host.
//
// Offline (W10 FX-B): the web serves the TTFs no-cache and a host builds a new source for every
// export, so a fetch that fails offline used to lose the font even after an online export. With
// `cache` (the web's Cache Storage), a successful load is stored and a failed one is answered from
// the store; the network stays first, so a redeployed asset at the same URL is picked up online.
import type { FontRegistry } from '../../text';
import type { ExportSignalLike, FontData, FontDataProvider, FontRequest } from '../types';

/** A persistent byte store keyed by URL (the web's Cache Storage; the same shape as `ScriptFontCache`). */
export interface BundledFontCache {
  match(url: string): Promise<Uint8Array | null>;
  put(url: string, bytes: Uint8Array): Promise<void>;
}

export interface BundledFontSourceOptions {
  /** The runtime's registry (its faces carry the TTF URLs or paths). */
  readonly registry: FontRegistry;
  /** Reads a TTF by the registry's URL/path; rejects or resolves null when it cannot. */
  readonly load: (url: string, signal: ExportSignalLike) => Promise<Uint8Array | null>;
  /** Keeps loaded bytes and answers a failed load (offline) from them. Errors are ignored. */
  readonly cache?: BundledFontCache;
}

export class BundledFontSource implements FontDataProvider {
  readonly id = 'bundled';
  private readonly registry: FontRegistry;
  private readonly load: BundledFontSourceOptions['load'];
  private readonly cache: BundledFontCache | undefined;
  private readonly bytes = new Map<string, Promise<Uint8Array | null>>();

  constructor(opts: BundledFontSourceOptions) {
    this.registry = opts.registry;
    this.load = opts.load;
    this.cache = opts.cache;
  }

  /** Whether `family` is a bundled family. */
  has(family: string): boolean {
    return this.registry.find(family) !== undefined;
  }

  async resolve(req: FontRequest, signal: ExportSignalLike): Promise<FontData | null> {
    const fam = this.registry.find(req.family);
    if (fam === undefined) return null;
    const face = this.registry.faceFor(fam.family, req.bold ? 700 : 400, req.italic);
    if (face === undefined || face.ttf === '') return null;
    let p = this.bytes.get(face.ttf);
    if (p === undefined) {
      p = this.loadBytes(face.ttf, signal);
      this.bytes.set(face.ttf, p);
    }
    const bytes = await p;
    if (bytes === null) {
      this.bytes.delete(face.ttf);
      return null;
    }
    return { bytes, postscriptName: '', embeddable: true, variable: false, source: 'bundled' };
  }

  /** The network (the host's `load`) first; a success is stored, a failure is answered from the store. */
  private async loadBytes(url: string, signal: ExportSignalLike): Promise<Uint8Array | null> {
    const cache = this.cache;
    const bytes = await this.load(url, signal).catch(() => null);
    if (bytes !== null && bytes.length > 0) {
      if (cache !== undefined) await cache.put(url, bytes).catch(() => undefined);
      return bytes;
    }
    if (cache === undefined) return null;
    return (await cache.match(url).catch(() => null)) ?? null;
  }
}
