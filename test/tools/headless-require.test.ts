// AC-ARC-07, lekhjs side: the headless Node bundle loads through CommonJS `require()` (kashi is
// CommonJS and loads `lekhjs/headless` as `require(esm)`, Node 24), which works only when the
// bundle has no top-level `await`. The bundle is built here with the build's own esbuild options
// into a temporary directory, so the test needs no `npm run build`; kashi's own check
// (`lbs/kashi/test/startup/lekhjs-require.test.js`) runs against the built `dist/`.
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { afterAll, describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../lint/eslint-helpers';

const dir = mkdtempSync(path.join(tmpdir(), 'lekhjs-headless-'));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('lekhjs/headless under require() (AC-ARC-07)', () => {
  it('builds, has no top-level await, and loads from CommonJS with the mapped exports', async () => {
    await esbuild.build({
      absWorkingDir: PKG_ROOT,
      entryPoints: { headless: 'src/headless/index.ts' },
      outdir: dir,
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node24',
      splitting: false,
      supported: { 'top-level-await': false },
      logLevel: 'silent',
    });
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
    const file = path.join(dir, 'headless.js');
    const code = readFileSync(file, 'utf8');

    const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
    let topLevelAwait = 0;
    // A function body is not top level: the walk does not descend into one.
    const skip = (): void => undefined;
    walk.recursive(ast, null, {
      FunctionDeclaration: skip,
      FunctionExpression: skip,
      ArrowFunctionExpression: skip,
      AwaitExpression() {
        topLevelAwait++;
      },
      ForOfStatement(n, st, c) {
        if (n.await) topLevelAwait++;
        c(n.body, st);
      },
    });
    expect(topLevelAwait).toBe(0);

    const script = `const h = require(${JSON.stringify(file)}); process.stdout.write(JSON.stringify(Object.keys(h).sort()));`;
    const out = execFileSync(process.execPath, ['-e', script], { cwd: PKG_ROOT, encoding: 'utf8' });
    const names = JSON.parse(out) as string[];
    for (const n of [
      'createNodeRuntime',
      'BoardSession',
      'TemplateCatalog',
      'project',
      'compile',
      'generate',
      'lint',
      'paintPage',
      'Canvas2DDrawingPlatform',
    ])
      expect(names).toContain(n);
  });
});
