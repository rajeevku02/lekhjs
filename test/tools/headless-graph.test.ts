// AC-CLS-08: the kashi import graph (`lekhjs/headless` and below) holds no file of
// src/recognizer, src/interaction or src/export/pdf: the esbuild metafile of the headless entry.
import * as esbuild from 'esbuild';
import { describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../lint/eslint-helpers';

describe('headless import graph (AC-CLS-08)', () => {
  it('has no recognizer, interaction or export/pdf input', async () => {
    const r = await esbuild.build({
      absWorkingDir: PKG_ROOT,
      entryPoints: ['src/headless/index.ts'],
      bundle: true,
      write: false,
      metafile: true,
      format: 'esm',
      platform: 'node',
      logLevel: 'silent',
    });
    const inputs = Object.keys(r.metafile.inputs);
    expect(inputs.length).toBeGreaterThan(50);
    expect(inputs.filter((p) => /src\/(recognizer|interaction|export\/pdf)\//.test(p))).toEqual([]);
  });
});
