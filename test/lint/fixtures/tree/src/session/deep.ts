// AC-ARC-03 deep-import case: session reaches past model's index.ts. Rejected.
import { internal } from '../model/internal';

export const d = internal;
