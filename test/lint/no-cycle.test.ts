// AC-ARC-02: zero import-x/no-cycle findings over src/; the negative control
// (fixtures/tree/src/model/cycle-a.ts <-> cycle-b.ts) reports 2 with the same rules.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURES, structuralEslint } from './eslint-helpers';

const CYCLE = 'import-x/no-cycle';

describe('import cycles', () => {
  it('src/ has none', async () => {
    const results = await structuralEslint().lintFiles(['src/**/*.ts']);
    expect(results.length).toBeGreaterThan(17);
    expect(results.flatMap((r) => r.messages.filter((m) => m.ruleId === CYCLE))).toEqual([]);
  });

  it('the cycle-a <-> cycle-b fixture reports 2', async () => {
    const tree = path.join(FIXTURES, 'tree');
    const results = await structuralEslint(tree).lintFiles(['src/model/cycle-a.ts', 'src/model/cycle-b.ts']);
    expect(results.flatMap((r) => r.messages.filter((m) => m.ruleId === CYCLE))).toHaveLength(2);
  });
});
