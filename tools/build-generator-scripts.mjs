// Builds src/generators/scripts.generated.json (spec 04 §7.2): the canonical JS text of every
// wireframe module, `{ "<module key>": "/*lekh-js:1:<key>*/function generate(p,t,h){…}" }`.
//
// Each file in src/generators/wireframe/ (but index.ts) default-exports one module. It is bundled
// with the pinned esbuild into a self-contained, minified function whose host calls go through its
// third argument; the marker is prepended. The text is a faithful copy of the code that runs, and
// lekhjs never evaluates it (AC-GEN-09). The output is committed; CI re-runs this with --check and
// fails on a difference (AC-GEN-08).
//
//   node tools/build-generator-scripts.mjs           write the file
//   node tools/build-generator-scripts.mjs --check   exit 1 when the committed file differs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'src/generators/wireframe');
const OUT = path.join(ROOT, 'src/generators/scripts.generated.json');
const ABI = 1;
const GLOBAL = '__lekhWireframe';

/** @param {string} contents @param {import('esbuild').BuildOptions} opts */
async function bundle(contents, opts) {
  const r = await esbuild.build({
    stdin: { contents, resolveDir: DIR, loader: 'ts', sourcefile: 'entry.ts' },
    bundle: true,
    write: false,
    platform: 'neutral',
    target: 'es2022',
    legalComments: 'none',
    charset: 'utf8',
    logLevel: 'silent',
    ...opts,
  });
  const file = r.outputFiles?.[0];
  if (file === undefined) throw new Error('esbuild produced no output');
  return file.text;
}

/** The module's key, read by running its own bundle (a tool, never src/). @param {string} file */
async function keyOf(file) {
  const code = await bundle(`import m from './${file}'; export const key = m.key;`, { format: 'esm' });
  const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  if (typeof mod.key !== 'string' || !/^wireframe\/[a-z0-9_-]+$/.test(mod.key)) {
    throw new Error(`${file}: the default export has no valid wireframe key`);
  }
  return mod.key;
}

/** @param {string} file @param {string} key */
async function textOf(file, key) {
  const iife = await bundle(
    `import m from './${file}'; export function generate(p, t, h) { return m.generate({ params: p, text: t }, h); }`,
    { format: 'iife', globalName: GLOBAL, minify: true },
  );
  return `/*lekh-js:${ABI}:${key}*/function generate(p,t,h){${iife.trim()}return ${GLOBAL}.generate(p,t,h)}`;
}

export async function buildScripts() {
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
    .sort();
  /** @type {Record<string, string>} */
  const out = {};
  for (const f of files) {
    const key = await keyOf(f);
    if (key in out) throw new Error(`${f}: duplicate key ${key}`);
    out[key] = await textOf(f, key);
  }
  const sorted = Object.fromEntries(
    Object.keys(out)
      .sort()
      .map((k) => [k, out[k]]),
  );
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

if (process.argv[1] === import.meta.filename) {
  const text = await buildScripts();
  if (process.argv.includes('--check')) {
    const committed = readFileSync(OUT, 'utf8');
    if (committed !== text) {
      console.error('src/generators/scripts.generated.json is stale: run node tools/build-generator-scripts.mjs');
      process.exit(1);
    }
  } else {
    writeFileSync(OUT, text);
  }
}
