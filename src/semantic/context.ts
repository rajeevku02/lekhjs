// What the semantic layer reads from the board session it runs on (spec 10 §3). The C++ reached
// globals for all of it: `TemplateStore::instance()` for templates and arrowheads,
// `Platform::currentPlatform` for text measurement and ids, `DocManager::instance` for loading.
// Here a `BoardSession` hands over one `SemanticContext` (`semanticContext()`), and every function
// of this module takes the session as its first argument.
//
// `semantic/` sits below `session/` (spec 01 §2.1, rank 10 < 11), so the session is seen through
// the structural `SemanticHost` interface; `BoardSession` satisfies it.
import type { Config, Logger } from '../base';
import type { DocumentCodec } from '../io';
import { settleLayout, type ImageLookup, type LekhDocument } from '../model';
import type { CatalogOverlay, JsonValue, TemplateText } from '../template';
import type { ArrowRegistry } from './format';

export interface SemanticContext {
  /** The session's current document (the C++ `LekhDocument::Ptr` of the handle). */
  readonly doc: LekhDocument;
  /** Reads and writes documents, objects, templates and styles (C++ `JsonObjectSerializer`, `DocManager`). */
  readonly codec: DocumentCodec;
  /** Templates by id and embeds (C++ `TemplateStore::instance()`, the per-session overlay). */
  readonly catalog: CatalogOverlay;
  /** The arrowhead registry (C++ `TemplateStore::arrows()`). */
  readonly arrows: ArrowRegistry;
  /** C++ `Platform::getTextSize` and text layout. */
  readonly text: TemplateText;
  readonly config: Config;
  readonly logger: Logger;
  /** Decoded images by key (the per-operation preload map on the server). */
  readonly images: ImageLookup;
  /**
   * Whether new nodes and edges get the bundled default font (spec 06 §9, `stampNewContentFont`).
   * False in kashi's backend-first mode (`SessionOptions.newContentFont`), as the C++ MCP set none.
   */
  readonly newContentFont: boolean;
  /** C++ `Platform::newId`: a fresh short id. */
  newId(): string;
  /** The cooperative deadline (spec 03 §12.4): throws `LekhError('budget_exceeded')` once it has passed. */
  budgetCheck(): void;
  /** Lays out every dirty object of one page or of all (the C++ projector's settle draw). */
  layoutAll(pageId?: string): void;
}

/** C++ `DocManager::load`'s answer, as `BoardSession.load` gives it. */
export type SemanticLoadResult =
  { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string };

/** The session as the semantic layer sees it. */
export interface SemanticHost {
  readonly isLoaded: boolean;
  semanticContext(): SemanticContext;
  /** Replaces the session's document (C++ `DocManager::load` into the handle). */
  load(raw: string | object): SemanticLoadResult;
  serialize(opts: { stamp: 'offline' | 'cloud' }): string;
}

/** The same context over another document (the generator compiles against intermediate documents). */
export function withDocument(ctx: SemanticContext, doc: LekhDocument): SemanticContext {
  return Object.freeze({
    ...ctx,
    doc,
    layoutAll: (pageId?: string) => {
      layoutDocument(doc, ctx, pageId);
    },
  });
}

function layoutDocument(doc: LekhDocument, ctx: SemanticContext, pageId?: string): void {
  for (const p of doc.pages) {
    if (pageId !== undefined && p.id !== pageId) continue;
    ctx.budgetCheck();
    settleLayout(p.objectStore);
  }
}

/** A value an option, batch or content argument may be given as: parsed JSON, or its text. */
export type JsonInput = JsonValue | string;
