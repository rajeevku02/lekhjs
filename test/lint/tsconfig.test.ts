// AC-ARC-04: the build compiles src/ with lib ES2022 only: no DOM, WebWorker or Node types.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURES, PKG_ROOT } from './eslint-helpers';
import { diagnosticCodes, parsedBuildConfig } from './ts-helpers';

describe('tsconfig.build.json', () => {
  it('uses lib ES2022 and no ambient types', () => {
    const raw = JSON.parse(readFileSync(path.join(PKG_ROOT, 'tsconfig.build.json'), 'utf8')) as {
      compilerOptions: { lib: string[]; types: string[]; erasableSyntaxOnly: boolean; verbatimModuleSyntax: boolean };
    };
    expect(raw.compilerOptions.lib).toEqual(['ES2022']);
    expect(raw.compilerOptions.types).toEqual([]);
    expect(raw.compilerOptions.erasableSyntaxOnly).toBe(true);
    expect(raw.compilerOptions.verbatimModuleSyntax).toBe(true);
  });

  it('compiles src/', () => {
    expect(diagnosticCodes(parsedBuildConfig().fileNames)).toEqual([]);
  });

  it('rejects a DOM reference', () => {
    const codes = diagnosticCodes([path.join(FIXTURES, 'dom-use.ts')]);
    expect(codes.some((c) => c === 2584 || c === 2304)).toBe(true);
  });
});
