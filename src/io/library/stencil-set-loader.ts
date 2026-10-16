// Parsing a stencil set into the session's catalog (spec 04 §4; port of the parse half of C++
// `ShapeManager::loadShapes` and `LibraryObjectStore::fetchContent`'s source choice; spec 02
// `StencilSetLoader`).
//
// io/ is synchronous (AC-ENG-25): the host reads or fetches the text (local file first on native,
// never revalidated; download otherwise, without credentials for the stencil host) and hands it
// here. `plan` says where to look; `load` parses and adds to a `CatalogOverlay`, whose resolve hook
// converts any Lua generator (`v3`/`v4` sets in the library-shape test; `v5` has none).
import type { CatalogCategory, CatalogOverlay, JsonValue, LibraryFileJson } from '../../template';
import { isJsonObject } from '../../template';
import { LoadError } from '../errors';
import { parseJsonText } from '../json/lenient-json';
import { StencilSource } from './stencil-source';

/** Where a category's content comes from. */
export interface StencilFetchPlan {
  /** The cache file to read first, then write after a download; `null` without local files (web). */
  readonly localPath: string | null;
  readonly url: string;
  /** User libraries go to the backend with the auth token; the stencil host gets none. */
  readonly authenticated: boolean;
}

/** A category's content location (C++ `ObjectCategory::contentUrl`, `isCustomLib`). */
export interface StencilCategoryRef {
  readonly contentUrl: string;
  readonly isCustomLib: boolean;
}

export const StencilSetLoader = Object.freeze({
  /** C++ `fetchContent`'s choice: the local copy first where the host has files, then the URL. */
  plan(category: StencilCategoryRef, hasLocalFiles: boolean): StencilFetchPlan {
    return {
      localPath: hasLocalFiles ? StencilSource.localPath(category.contentUrl, category.isCustomLib) : null,
      url: category.contentUrl,
      authenticated: category.isCustomLib && !StencilSource.isUnauthenticatedHost(category.contentUrl),
    };
  },

  /** A stencil file's text as a library file; throws `LoadError` when it is not one. */
  parse(text: string): LibraryFileJson {
    const { value } = parseJsonText(text);
    if (!isJsonObject(value)) throw new LoadError('json_parse', { reason: 'stencil_not_an_object' });
    return value;
  },

  /** Parses `text` and adds it to `overlay`; returns the categories it created or extended. */
  load(text: string, overlay: CatalogOverlay): CatalogCategory[] {
    return overlay.addLibraryFile(StencilSetLoader.parse(text), 'stencil');
  },

  /** `load` for an already-parsed file. */
  loadValue(file: JsonValue, overlay: CatalogOverlay): CatalogCategory[] {
    if (!isJsonObject(file)) throw new LoadError('json_parse', { reason: 'stencil_not_an_object' });
    return overlay.addLibraryFile(file, 'stencil');
  },
});
