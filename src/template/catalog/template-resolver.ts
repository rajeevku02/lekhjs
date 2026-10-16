// How a template finds the templates it embeds or references (spec 01 C4: templates get a
// `TemplateResolver`, not the global `LoadContext`). C++ `ShapeTemplate::load` asked
// `TemplateStore::getObjectFromTemplate` and then the document (the load context's, else the
// current one); by-reference bodies `{id}` asked `TemplateStore::getTemplate`.
import { Point, Rect } from '../../geometry';
import type { EmbeddedShapeSource, ShapeTemplate } from '../model/shape-template';
import type { CatalogOverlay, DocTemplates } from './catalog-overlay';
import type { TemplateDef } from './template-def';

export interface TemplateResolver {
  /** A fresh, loaded template for embed `id`, with its source frame; `null` when unknown. */
  getEmbed(id: string): EmbeddedShapeSource | null;
  /** A fresh, loaded template for the by-reference body `{ id }`; `null` when unknown. */
  getTemplate(id: string): ShapeTemplate | null;
}

/** Resolves nothing (a template with no catalog, e.g. in a unit test). */
export const NO_TEMPLATES: TemplateResolver = Object.freeze({
  getEmbed: () => null,
  getTemplate: () => null,
});

/**
 * Builds the live embed for a definition: for a library object, its template and its stored box
 * (C++ `TemplatedObject::clone`); for a bare template, a loaded clone at its default size at the
 * origin (C++ `getObjectFromTemplate`). Supplied by the layer that has the codec.
 */
export type EmbedFactory = (def: TemplateDef) => EmbeddedShapeSource | null;

/** The default frame of a bare template: `defaultAttr` size, centred at the origin. */
export function defaultEmbedFrame(t: ShapeTemplate): { rect: Rect; angle: number } {
  return {
    rect: Rect.fromCenter(new Point(0, 0), t.defaultAttr.width, t.defaultAttr.height),
    angle: t.defaultAttr.angle,
  };
}

/**
 * `TemplateResolver` over a session's overlay and its document templates. An embed that is
 * already being resolved further up resolves to nothing: C++ recursed until the stack overflowed.
 */
export class CatalogTemplateResolver implements TemplateResolver {
  private readonly store_: CatalogOverlay;
  private readonly embed_: EmbedFactory;
  private readonly doc_: DocTemplates | undefined;
  private readonly active_ = new Set<string>();
  private readonly onCycle_: ((id: string) => void) | undefined;

  constructor(store: CatalogOverlay, embed: EmbedFactory, doc?: DocTemplates, onCycle?: (id: string) => void) {
    this.store_ = store;
    this.embed_ = embed;
    this.doc_ = doc;
    this.onCycle_ = onCycle;
  }

  getEmbed(id: string): EmbeddedShapeSource | null {
    const def = this.store_.getEmbed(id, this.doc_);
    if (def === undefined) return null;
    if (this.active_.has(id)) {
      this.onCycle_?.(id);
      return null;
    }
    this.active_.add(id);
    try {
      return this.embed_(def);
    } finally {
      this.active_.delete(id);
    }
  }

  getTemplate(id: string): ShapeTemplate | null {
    const def = this.store_.get(id);
    if (def === undefined) return null;
    const t = this.store_.instantiate(def);
    t.load();
    return t;
  }
}
