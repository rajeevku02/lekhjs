// User shape-library items (spec 04 §11; spec 02 `LibraryItemCodec`). The store is opaque JSON
// (`{library: [{objects}], templates}`), shared across a user's devices and other users.
//
// Reading converts in memory and never writes back because it read: a Lua generator is converted
// by the catalog's resolve hook (an old app on another device keeps seeing Lua), and a legacy
// object type is converted to its templated form (spec 03 §10.4) — the library panel and the
// board only ever see live kinds. The input JSON is never changed. An item saved by TS is written
// with JS generators and nothing else is added (no `info.version`, OQ-24).
import type { LekhDocument, LekhObject } from '../../model';
import {
  cloneJson,
  isJsonObject,
  type CatalogCategory,
  type CatalogOverlay,
  type JsonObject,
  type JsonValue,
  type LibraryFileJson,
} from '../../template';
import type { DocumentCodec, ReadObject } from '../document-codec';
import { LEGACY_TYPE_NAMES } from '../legacy/legacy-converter';

export class LibraryItemCodec {
  private readonly codec: DocumentCodec;

  constructor(codec: DocumentCodec) {
    this.codec = codec;
  }

  /** A copy of `blob` with every legacy-typed item replaced by its converted JSON. */
  normalize(blob: JsonValue): LibraryFileJson {
    if (!isJsonObject(blob)) return {};
    const out = cloneJson(blob) as Record<string, JsonValue>;
    const library = out['library'];
    if (!Array.isArray(library)) return out;
    out['library'] = (library as JsonValue[]).map((categ) => {
      if (!isJsonObject(categ) || !Array.isArray(categ['objects'])) return categ;
      const objects = (categ['objects'] as readonly JsonValue[]).map((item) => {
        if (!isJsonObject(item) || typeof item['type'] !== 'string' || !LEGACY_TYPE_NAMES.includes(item['type']))
          return item;
        return this.codec.writeObject(this.codec.readObject(item).object);
      });
      return { ...categ, objects };
    });
    return out;
  }

  /** Adds a user library to the session's catalog overlay; returns its categories. */
  ingest(blob: JsonValue, overlay: CatalogOverlay): CatalogCategory[] {
    return overlay.addLibraryFile(this.normalize(blob), 'user');
  }

  /** One item as a live object, for insertion (legacy types and Lua converted). */
  readItem(json: JsonValue, doc: LekhDocument | null = null): ReadObject {
    return this.codec.readObject(json, undefined, doc);
  }

  /** One item as saved by TS (JS generators). */
  writeItem(obj: LekhObject): JsonObject {
    return this.codec.writeObject(obj);
  }
}
