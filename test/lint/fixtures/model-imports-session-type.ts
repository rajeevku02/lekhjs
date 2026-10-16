// Control: linted as src/model/x.ts. A type-only upward reference is allowed (rule 2).
import type * as session from '../session';

export type S = typeof session;
