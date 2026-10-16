// lekhjs module `headless` (spec 01 §2.1, §4.3, rank 13). The only import target from outside the
// module: what kashi imports in place of the wasm `CoreDoc`. `createNodeRuntime`, the semantic
// functions and `paintPage` join these when `semantic/` and `export/raster` exist (task B1).
export { BoardSession, DeadlineBudget, createRuntime, type Runtime, type RuntimeOptions } from '../session';
export { TemplateCatalog } from '../template';
export { GeneratorRegistry, buildCatalog } from '../generators';
export { Canvas2DDrawingPlatform } from '../render';
