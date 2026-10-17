// `BundledFontSource` (spec 08 §6.1 source 1, spec 02): the bundled TTFs (Noto Sans, Noto Serif,
// Noto Sans Mono, Caveat) for a request whose family is one of them. The face is the registry's
// (`FontRegistry.faceFor`: the closest weight; the italic only where it exists — Noto Sans Mono
// and Caveat have none, so the writer synthesises it). The bytes come through the host's `load`:
// a fetch of the asset URL in the app (`FontRegistry.ttfFor`), a file read on Node. Never a path
// handed to PDFKit: fonts are registered from a `Uint8Array` on every host.
import type { FontRegistry } from '../../text';
import type { ExportSignalLike, FontData, FontDataProvider, FontRequest } from '../types';

export interface BundledFontSourceOptions {
  /** The runtime's registry (its faces carry the TTF URLs or paths). */
  readonly registry: FontRegistry;
  /** Reads a TTF by the registry's URL/path; rejects or resolves null when it cannot. */
  readonly load: (url: string, signal: ExportSignalLike) => Promise<Uint8Array | null>;
}

export class BundledFontSource implements FontDataProvider {
  readonly id = 'bundled';
  private readonly registry: FontRegistry;
  private readonly load: BundledFontSourceOptions['load'];
  private readonly bytes = new Map<string, Promise<Uint8Array | null>>();

  constructor(opts: BundledFontSourceOptions) {
    this.registry = opts.registry;
    this.load = opts.load;
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
      p = this.load(face.ttf, signal).catch(() => null);
      this.bytes.set(face.ttf, p);
    }
    const bytes = await p;
    if (bytes === null) {
      this.bytes.delete(face.ttf);
      return null;
    }
    return { bytes, postscriptName: '', embeddable: true, variable: false, source: 'bundled' };
  }
}
