// The delta compiler (port of C++ `semantic/SemanticDelta.{h,cpp}`): a semantic batch as the
// realtime protocol's frames. The inverse of the projector; it never mutates the document. The
// compilation itself is `Compilation` (compilation-base.ts → ops-nodes.ts → ops-edits.ts).
import type { JsonInput, SemanticContext, SemanticHost } from '../context';
import type { JsonObject, JsonOut } from '../json';
import { Compilation } from './compilation';
import { opVocabulary } from './helpers';

export { refuseUnknownMembers, slotClearedTextKeys, type MemberVocabulary } from './helpers';

/** The batch compiled against the session's loaded document, or null when nothing is loaded (C++ ""). */
export function compile(s: SemanticHost, batch: JsonInput): JsonObject | null {
  if (!s.isLoaded) return null;
  return compileToNode(s.semanticContext(), batch);
}

/** C++ `SemanticDelta::compileToNode`: the answer object (`ok`, `frames`, … or `ok: false`, `error`, …). */
export function compileToNode(ctx: SemanticContext, batch: JsonInput): JsonOut {
  return new Compilation(ctx, batch).run();
}

/** C++ `operationMembers`: every operation name with the members it takes. */
export function operationMembers(): readonly (readonly [string, readonly string[]])[] {
  return opVocabulary().map((row) => [row.name, row.members] as const);
}
