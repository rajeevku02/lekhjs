// Linted as src/model/x.ts. An inline type specifier keeps a runtime import under
// verbatimModuleSyntax, so it is an upward value edge: rejected.
import { type ImportsNothing } from '../session';

export type S = ImportsNothing;
