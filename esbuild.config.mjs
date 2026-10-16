// The Node bundle (spec 01 §5.2): src/{index,headless/index,testing/index}.ts -> dist/node/*.js.
// ESM, platform node, target node24, every runtime library inlined (lekhjs has no
// `dependencies`, §5.4), sourcemaps. Front ends never use it: they compile src/ via Vite.
//
//   node esbuild.config.mjs            build once
//   node esbuild.config.mjs --watch    rebuild on change
import * as esbuild from 'esbuild';
import path from 'node:path';

const root = import.meta.dirname;

/** @type {import('esbuild').BuildOptions} */
export const options = {
  absWorkingDir: root,
  entryPoints: {
    index: 'src/index.ts',
    headless: 'src/headless/index.ts',
    testing: 'src/testing/index.ts',
  },
  outdir: path.join(root, 'dist/node'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  // The three bundles are self-contained: no shared chunks to load at require time.
  splitting: false,
  // No top-level await anywhere (kashi loads dist/node/headless.js through require(esm)).
  supported: { 'top-level-await': false },
  logLevel: 'info',
  legalComments: 'eof',
};

if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
