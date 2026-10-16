// lekhjs module `headless` (spec 01 §2.1, §4.3, rank 13). The only import target from outside the
// module: what kashi imports in place of the C++ `CoreDoc` binding (spec 10 §3 maps every `CoreDoc` method
// to these). No exported function or method is `async` or returns a promise (AC-ARC-08).
export { createNodeRuntime, type NodeCanvasFactory, type NodeRuntimeOptions } from './node-runtime';
export { BoardSession, DeadlineBudget, createRuntime, type Runtime, type RuntimeOptions } from '../session';
export { TemplateCatalog } from '../template';
export { GeneratorRegistry, buildCatalog } from '../generators';
export { project, compile, generate, lint } from '../semantic';
export { paintPage, type PaintPageAnswer, type PaintPageOptions } from '../export/raster';
export { Canvas2DDrawingPlatform } from '../render';
