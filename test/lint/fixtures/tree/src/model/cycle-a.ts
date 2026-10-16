// AC-ARC-02 negative control: cycle-a <-> cycle-b.
import { b } from './cycle-b';

export const a = (): number => b() + 1;
