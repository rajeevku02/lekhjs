// AC-ARC-18: no enum, namespace, parameter properties or decorators in src/.
// tsc's erasableSyntaxOnly rejects the first three (TS1294); the decorator is rejected by lint.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURES, lintAs, ruleIds } from './eslint-helpers';
import { diagnosticCodes } from './ts-helpers';

describe('erasable syntax only', () => {
  it.each(['enum.ts', 'namespace.ts', 'parameter-property.ts'])('%s fails tsc with TS1294', (fixture) => {
    expect(diagnosticCodes([path.join(FIXTURES, 'erasable', fixture)])).toContain(1294);
  });

  it.each(['enum.ts', 'namespace.ts', 'parameter-property.ts', 'decorator.ts'])('%s fails lint', async (fixture) => {
    expect(ruleIds(await lintAs(`erasable/${fixture}`, 'src/base/x.ts'))).toContain('no-restricted-syntax');
  });
});
