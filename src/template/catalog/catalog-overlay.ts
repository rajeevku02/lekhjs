// A session's copy-on-write view of a `TemplateCatalog` (spec 04 §3; canonical name `CatalogOverlay`,
// spec 02 §1.2; spec 04 calls it `SessionTemplateStore`). Writes land in the overlay only: the
// downloaded stencil categories, user libraries, the document's templates and any template a
// request names. Reads look in the overlay first, then the base. Two sessions over one base never
// see each other's additions (AC-GEN-04). When the board closes the overlay is dropped.
import { classifyOnly, type GeneratorResolveFn } from '../generator/classify';
import type { JsonValue, LibraryFileJson } from '../json';
import type { ShapeTemplate } from '../model/shape-template';
import { ingestLibraryFile, type CatalogCategory } from './library-ingest';
import { CatalogMapsBuilder, type TemplateCatalog } from './template-catalog';
import { buildTemplateDef, type CatalogIssue, type TemplateDef } from './template-def';

/** The document's `templates` map, as definitions. */
export interface DocTemplates {
  get(id: string): TemplateDef | undefined;
}

/** Builds a fresh live template from a definition (`io/TemplateDataCodec`, injected). */
export type TemplateFactory = (def: TemplateDef) => ShapeTemplate;

export interface CatalogOverlayOptions {
  readonly resolve?: GeneratorResolveFn;
  readonly instantiate?: TemplateFactory;
}

export class CatalogOverlay {
  private readonly base_: TemplateCatalog;
  private readonly own_: CatalogMapsBuilder;
  private readonly resolve_: GeneratorResolveFn;
  private readonly instantiate_: TemplateFactory | undefined;
  private readonly issues_: CatalogIssue[] = [];

  constructor(base: TemplateCatalog, opts: CatalogOverlayOptions = {}) {
    this.base_ = base;
    this.own_ = new CatalogMapsBuilder(base.maps());
    this.resolve_ = opts.resolve ?? classifyOnly;
    this.instantiate_ = opts.instantiate;
  }

  base(): TemplateCatalog {
    return this.base_;
  }

  /** By id, C++ `getTemplate` order: templates (overlay, then base), then library objects. */
  get(id: string): TemplateDef | undefined {
    return this.own_.lookupTemplate(id);
  }

  /**
   * The definition an embed `id` resolves to, in the C++ `ShapeTemplate::load` order: a library
   * object, then a template (each overlay first, then base), then the document's templates.
   */
  getEmbed(id: string, doc?: DocTemplates): TemplateDef | undefined {
    return this.own_.lookupObjectOrTemplate(id) ?? doc?.get(id);
  }

  has(id: string): boolean {
    return this.get(id) !== undefined;
  }

  arrowhead(id: string): TemplateDef | undefined {
    return this.own_.arrows.get(id) ?? this.base_.arrowhead(id);
  }

  /** Every arrowhead, overlay over base, ordered by id (C++ `TemplateStore::arrows()`, a `std::map`). */
  arrowheads(): readonly TemplateDef[] {
    const byId = new Map<string, TemplateDef>();
    for (const d of this.base_.arrowheads()) byId.set(d.id, d);
    for (const [id, d] of this.own_.arrows) byId.set(id, d);
    return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  help(id: string): string | undefined {
    return this.own_.help.get(id) ?? this.base_.help(id);
  }

  /** The base categories, each replaced by its overlay version, then the overlay's new ones. */
  categories(): readonly CatalogCategory[] {
    const out = this.base_.categories().map((c) => this.own_.categories.get(c.id) ?? c);
    for (const c of this.own_.categories.values()) {
      if (this.base_.category(c.id) === undefined) out.push(c);
    }
    return out;
  }

  /** Adds a downloaded stencil file or a user library to the overlay; returns the categories it touched. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- both sources ingest alike; the caller states which
  addLibraryFile(file: LibraryFileJson, _source: 'stencil' | 'user'): CatalogCategory[] {
    return ingestLibraryFile(file, this.own_, this.resolve_, this.issues_);
  }

  /** Adds one template body (a document template, or one a request names) to the overlay. */
  addTemplate(json: JsonValue): TemplateDef | null {
    const def = buildTemplateDef(json, this.resolve_, this.issues_);
    if (def !== null) this.own_.addTemplate(def);
    return def;
  }

  /** A new live template from `def`; it never shares mutable state with `def`. */
  instantiate(def: TemplateDef): ShapeTemplate {
    if (this.instantiate_ === undefined) throw new Error('CatalogOverlay: no template factory was given');
    return this.instantiate_(def);
  }

  issues(): readonly CatalogIssue[] {
    return this.issues_;
  }
}
