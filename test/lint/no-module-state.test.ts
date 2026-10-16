// AC-ARC-06: lekhjs/no-module-state reports nothing over src/ and one finding per bad fixture.
import { describe, expect, it } from 'vitest';
import { lintAs, structuralEslint } from './eslint-helpers';

const RULE = 'lekhjs/no-module-state';

describe('no-module-state', () => {
  it('src/ has zero findings', async () => {
    const results = await structuralEslint().lintFiles(['src/**/*.ts']);
    expect(results.flatMap((r) => r.messages.filter((m) => m.ruleId === RULE))).toEqual([]);
  });

  it.each(['top-level-let.ts', 'top-level-map.ts', 'top-level-instance.ts'])('%s fails', async (fixture) => {
    const messages = await lintAs(fixture, 'src/base/x.ts');
    expect(messages.filter((m) => m.ruleId === RULE)).toHaveLength(1);
  });

  it('frozen-table.ts (constants, as-const and frozen tables, functions) passes', async () => {
    expect(await lintAs('frozen-table.ts', 'src/base/x.ts')).toEqual([]);
  });
});
