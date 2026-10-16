// lekhjs module `semantic` (spec 01 §2.1, rank 10). The only import target from outside the module.
// Port of the C++ `semantic/` directory: the `lekh.semantic/1` projector, the delta compiler,
// the whole-board generator, the layout lint and auto-placement, used by the MCP backend (spec 10
// §3). Every function is synchronous and takes the board session first; options, batches and
// content go in as parsed JSON (or its text) and answers come out as plain JSON objects.
export { project } from './projector';
export {
  compile,
  compileToNode,
  operationMembers,
  refuseUnknownMembers,
  slotClearedTextKeys,
  type MemberVocabulary,
} from './delta';
export { generate } from './generator';
export { lint } from './lint';
export {
  withDocument,
  type JsonInput,
  type SemanticContext,
  type SemanticHost,
  type SemanticLoadResult,
} from './context';
export { g6 } from './json';
export {
  PLACEMENT_GAP,
  PLACEMENT_MARGIN,
  placementBoxAt,
  placementHalfExtents,
  placementPushClear,
  type PlacementBox,
} from './placement';
