// What io/ needs from its session, and the per-load state (port of C++ `document::LoadContext`,
// `L/document/LoadContext.{h,cpp}`, and the serializer's `objMap_`).
//
// C++ installed the load context in `LekhGlobal` so that `ShapeTemplate::load` could find the
// document being loaded. Here a `LoadContext` is a local of one read call (spec 03 §10.1): it is
// the `TemplateResolver` of every template that load creates (catalog first, then the document's
// own `templates`, as C++ `ShapeTemplate::load` asked), and it holds the object map connectors
// are fixed up against. Two loads never share one.
import type { Logger } from '../base';
import type { DocumentContext, LekhDocument, LekhObject, ObjectEnv } from '../model';
import {
  defaultEmbedFrame,
  type DocTemplates,
  type EmbeddedShapeSource,
  type ShapeTemplate,
  type TemplateEnv,
  type TemplateResolver,
} from '../template';
import type { GeneratorHooks } from './codec/generator-hooks';
import { TemplateDataCodec, type TemplateParseStats } from './codec/template-data-codec';

/** The services io/ reads and writes through (a session builds one). */
export interface IoEnv {
  /** For the objects the reader creates (ids from `newId`, arrowheads, text measuring). */
  readonly objects: ObjectEnv;
  /** For the templates the reader creates; its resolver is the catalog (C++ `TemplateStore`). */
  readonly templates: TemplateEnv;
  /** For the documents and pages the reader creates. */
  readonly document: DocumentContext;
  /** Lua → JS conversion and generator construction (generators/). */
  readonly generators?: GeneratorHooks;
  /** A template's help text (C++ `TemplateStore::getHelp`): the catalog's and the boards'. */
  readonly help?: (templateId: string) => string | undefined;
  /**
   * A help text a document carries (C++ `TemplateStore::setHelpIfRequired`: kept only when the
   * session has none for that id yet). Called once per entry while reading.
   */
  readonly onHelp?: (templateId: string, text: string) => void;
  readonly logger?: Logger;
}

/** A content-free note a load made. */
export interface LoadWarning {
  readonly code:
    | 'nonfinite_read'
    | 'connector_end_missing'
    | 'object_skipped'
    | 'template_skipped'
    | 'embed_cycle'
    | 'legacy_converted';
  readonly count: number;
}

/** `TemplateEnv` with another resolver; every other service is `base`'s. */
export function withResolver(base: TemplateEnv, resolver: TemplateResolver): TemplateEnv {
  return {
    config: base.config,
    text: base.text,
    resolver,
    image: (key) => base.image(key),
    generatorContext: (t) => base.generatorContext(t),
    warn: (code, details) => {
      base.warn(code, details);
    },
  };
}

export class LoadContext implements TemplateResolver {
  readonly env: IoEnv;
  /** The document templates embeds fall back to (the document being loaded, if any). */
  readonly docTemplates: DocTemplates | null;
  /** The document being loaded (`null` for an object read: paste, library item). */
  readonly doc: LekhDocument | null;
  /** C++ `objMap_`: every parsed object by its id (integer ids as their decimal string). */
  readonly objMap = new Map<string, LekhObject>();
  readonly templateEnv: TemplateEnv;
  readonly codec: TemplateDataCodec;
  readonly stats: TemplateParseStats = { converted: 0 };
  private readonly counts_ = new Map<LoadWarning['code'], number>();
  private readonly activeEmbeds_ = new Set<string>();

  constructor(env: IoEnv, doc: LekhDocument | null, docTemplates: DocTemplates | null = doc) {
    this.env = env;
    this.doc = doc;
    this.docTemplates = docTemplates;
    this.templateEnv = withResolver(env.templates, this);
    this.codec = new TemplateDataCodec(this.templateEnv, env.generators);
  }

  /** C++ `ShapeTemplate::load`'s lookup: the catalog, then the document's templates. */
  getEmbed(id: string): EmbeddedShapeSource | null {
    const fromCatalog = this.env.templates.resolver.getEmbed(id);
    if (fromCatalog !== null) return fromCatalog;
    const def = this.docTemplates?.get(id);
    if (def === undefined) return null;
    if (this.activeEmbeds_.has(id)) {
      this.note('embed_cycle');
      return null;
    }
    this.activeEmbeds_.add(id);
    try {
      const template: ShapeTemplate = this.codec.instantiate(def);
      return { template, ...defaultEmbedFrame(template) };
    } finally {
      this.activeEmbeds_.delete(id);
    }
  }

  /** C++ `TemplateStore::getTemplate` (a reference body `{id}`): the catalog only. */
  getTemplate(id: string): ShapeTemplate | null {
    return this.env.templates.resolver.getTemplate(id);
  }

  note(code: LoadWarning['code'], n = 1): void {
    this.counts_.set(code, (this.counts_.get(code) ?? 0) + n);
  }

  warnings(): LoadWarning[] {
    return [...this.counts_].map(([code, count]) => ({ code, count }));
  }

  count(code: LoadWarning['code']): number {
    return this.counts_.get(code) ?? 0;
  }
}
