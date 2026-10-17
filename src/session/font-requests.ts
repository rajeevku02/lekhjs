// The fonts a document needs before its first layout (spec 06 §5.3).
//
// Every distinct (resolved family, weight, style) the document's text uses on any page, plus the
// bundled default, each with the distinct characters drawn in it (so the browser fetches exactly
// the `unicode-range` subsets the text needs). A font that resolves to a generic keyword only
// (the platform default, Android's names) has nothing to load and is left out.
import { ConnectionObject, GroupObject, TemplatedObject, type LekhDocument, type LekhObject } from '../model';
import { FontSpec, FontStyle, FontWeight, type Style } from '../style';
import { DEFAULT_FONT_FAMILY, buildCanvasFont, type FontFaceRequest, type FontNameResolver } from '../text';

/** What a session hands the `FontLoader` before a board's first layout. */
export interface DocumentFonts {
  readonly requests: readonly FontFaceRequest[];
  /** The distinct characters of all the document's text (at most `MAX_SAMPLE` of them). */
  readonly sampleText: string;
}

/** Characters passed as the sample: enough for every subset, small enough for `document.fonts.load`. */
const MAX_SAMPLE = 4096;
/** The px size of a request's font string: any size selects the same faces. */
const REQUEST_PX = 16;

class Collector {
  private readonly byKey_ = new Map<string, FontFaceRequest>();
  private readonly chars_ = new Set<string>();
  private readonly resolver_: FontNameResolver;

  constructor(resolver: FontNameResolver) {
    this.resolver_ = resolver;
  }

  add(style: Style | null, text: string): void {
    if (style === null) return;
    const spec = FontSpec.of(style);
    this.addFont(spec.family, spec.modifier, spec.weight, spec.style);
    for (const ch of text) {
      if (this.chars_.size >= MAX_SAMPLE) break;
      if (ch !== '\n' && ch !== '\r') this.chars_.add(ch);
    }
  }

  addFont(family: string, modifier: string, weight: FontWeight, style: FontStyle): void {
    const r = this.resolver_.resolve({ family, modifier, weight, style });
    if (r.primary === '') return;
    const fontKey = buildCanvasFont(r, REQUEST_PX);
    if (this.byKey_.has(fontKey)) return;
    this.byKey_.set(fontKey, Object.freeze({ fontKey, family: r.primary, weight: r.weight, style: r.style }));
  }

  visit(obj: LekhObject): void {
    if (obj instanceof GroupObject) {
      for (const c of obj.objects()) this.visit(c.object);
      return;
    }
    if (obj instanceof ConnectionObject) {
      for (const t of obj.textInfos()) this.add(obj.getDrawingProfile(), t.text);
      return;
    }
    if (obj instanceof TemplatedObject) {
      const tmpl = obj.shapeTemplate();
      const texts = tmpl?.texts() ?? [];
      for (const te of texts) this.add(te.style() ?? obj.getDrawingProfile(), te.text());
    }
  }

  result(): DocumentFonts {
    return Object.freeze({ requests: Object.freeze([...this.byKey_.values()]), sampleText: [...this.chars_].join('') });
  }
}

/** The fonts `doc` uses (all pages), plus the bundled default, resolved by `resolver`. */
export function documentFontRequests(doc: LekhDocument, resolver: FontNameResolver): DocumentFonts {
  const c = new Collector(resolver);
  c.addFont(DEFAULT_FONT_FAMILY, '', FontWeight.Normal, FontStyle.Normal);
  for (const page of doc.pages) for (const obj of page.objectStore.objects) c.visit(obj);
  return c.result();
}
