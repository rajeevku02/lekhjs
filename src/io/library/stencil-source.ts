// Where stencils come from (spec 04 §4; port of the C++ `ShapeManager::libVer`, `libBaseUrl`,
// `stencilUrl`, `getLocalPath` and `getLocalPathForCustomLib`, `L/app/ShapeManager.cpp`).
//
// TS apps read the `v5` folder: the base URL and the local cache directory are both derived from
// `STENCIL_LIB_VERSION`, as C++ derived them from `libVer` ("v4"). The core stencils are bundled
// (`lekhjs/stencils/core`); `v3`/`v4` stay frozen for the C++ apps.
export const STENCIL_LIB_VERSION = 'v5';

export const StencilSource = Object.freeze({
  version: STENCIL_LIB_VERSION,
  /** C++ `libBaseUrl`. */
  baseUrl: `https://rajeevku02.github.io/lekhboard/stencils/${STENCIL_LIB_VERSION}/`,
  /** The local cache directory, under the documents root (native only; the web never caches). */
  cacheDir: `stencils/${STENCIL_LIB_VERSION}`,

  /** C++ `stencilUrl(baseUrl, name)`: joined with exactly one `/`. */
  stencilUrl(baseUrl: string, name: string): string {
    return baseUrl.endsWith('/') ? baseUrl + name : `${baseUrl}/${name}`;
  },

  /**
   * C++ `getLocalPath(category)`: the cache file of a category's content URL — its last path
   * segment, or, for a user (custom) library, its last two joined by `_`.
   */
  localPath(contentUrl: string, isCustomLib: boolean): string {
    const parts = contentUrl.split('/');
    const base = `stencils/${STENCIL_LIB_VERSION}/`;
    if (isCustomLib) return `${base}${parts[parts.length - 2] ?? ''}_${parts[parts.length - 1] ?? ''}`;
    return base + (parts[parts.length - 1] ?? '');
  },

  /** C++ `getLocalPathForCustomLib(libId)`. */
  customLibLocalPath(libId: string): string {
    return `stencils/${STENCIL_LIB_VERSION}/${libId}_content`;
  },

  /** True for the stencil host, which is fetched without credentials (no `x-auth-token`). */
  isUnauthenticatedHost(url: string): boolean {
    return url.startsWith('https://rajeevku02.github.io/');
  },
});
