// The device bench bundle of verification 03 §4.3 (T21): parity/out/bench-dist/ holds
//   cpp/      the C++ web build (the H-ROL-1 hooked wasm; a lekhboardwebapp checkout at the oracle
//             commit, never v2/dist) and
//   ts/       the TS web build under test (a lekhboardwebapp checkout whose v2 compiles ../../lekhjs),
// both built with VITE_LEKH_TEST_ANY_HOST=1 (the hooks install on any host; never deployed); plus
// bench.html / bench.js (page/) and the synthetic boards (boards/*.json and manifest.json, from
// synth.mjs; no customer data).
//
// Both web apps open a board only at the path "/" (lekhboardwebapp main.jsx), so the two builds
// cannot sit in sub-folders of one origin. The server below serves bench.html, bench.js and
// boards/ from the bundle root and everything else from the build the `lekhbench` cookie names
// (cpp | ts), with no caching; the page sets the cookie before it opens a build in its iframe, so
// both builds are same-origin with the page (the hooks are reachable) and each sees itself at "/".
//
//   node parity/bench/build-device-bench.mjs --cpp-webapp <lekhboardwebapp dir> --ts-webapp <dir>
//        [--out <dir>] [--cache <dir>]
//   node parity/bench/build-device-bench.mjs --serve [--out <dir>] [--port 4006]
//
// --serve serves the bundle on 0.0.0.0:<port> with COOP/COEP (5 µs performance.now()). Android:
// `adb reverse tcp:4006 tcp:4006`, then http://localhost:4006/bench.html?lekhtest=1 on the device.
// iPad: run the same --serve on the Mac (Node 24) on the LAN; a plain static server cannot switch
// builds by cookie.
import { execFileSync } from 'node:child_process';
import { copyFileSync, createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { synthBoard } from './synth.mjs';

const HERE = import.meta.dirname;
const PARITY = path.resolve(HERE, '..');
const { values: opt } = parseArgs({
  options: {
    'cpp-webapp': { type: 'string' },
    'ts-webapp': { type: 'string' },
    out: { type: 'string', default: path.join(PARITY, 'out', 'bench-dist') },
    cache: { type: 'string' },
    serve: { type: 'boolean', default: false },
    port: { type: 'string', default: '4006' },
  },
});
const OUT = path.resolve(opt.out);

/** The device set: a subset of the box bench (devices are slower; §2 S-syn sizes and mixes). */
const DEVICE_BOARDS = [
  ['basic', 300],
  ['basic', 685],
  ['basic', 1500],
  ['basic', 5000],
  ['diagram', 685],
  ['diagram', 1500],
  ['image', 300],
  ['image', 1500],
  ['ink', 685],
  ['ink', 1500],
];

if (opt.serve) {
  const MIME = /** @type {Record<string, string>} */ ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.woff2': 'font/woff2',
  });
  const ISOLATION = {
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'require-corp',
    'cross-origin-resource-policy': 'same-origin',
  };
  createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const p = decodeURIComponent(url.pathname);
    const own = p === '/bench.html' || p === '/bench.js' || p.startsWith('/boards/');
    const engine = /(?:^|;\s*)lekhbench=(cpp|ts)/.exec(req.headers.cookie ?? '')?.[1] ?? 'ts';
    const base = own ? OUT : path.join(OUT, engine);
    let file = path.join(base, p);
    if (!file.startsWith(base)) return void res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!existsSync(file)) return void res.writeHead(404, ISOLATION).end();
    res.writeHead(200, {
      ...ISOLATION,
      'cache-control': 'no-store',
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
    });
    createReadStream(file).pipe(res);
  }).listen(Number(opt.port), '0.0.0.0', () => {
    process.stdout.write(`serving ${OUT} on :${opt.port} (COOP/COEP); open /bench.html?lekhtest=1\n`);
  });
} else {
  if (!opt['cpp-webapp'] || !opt['ts-webapp']) {
    process.stderr.write('usage: build-device-bench.mjs --cpp-webapp <dir> --ts-webapp <dir> [--out <dir>]\n');
    process.exit(2);
  }
  mkdirSync(path.join(OUT, 'boards'), { recursive: true });
  for (const [engine, dir] of /** @type {const} */ ([
    ['cpp', opt['cpp-webapp']],
    ['ts', opt['ts-webapp']],
  ])) {
    const v2 = path.resolve(dir, 'v2');
    const cache = path.resolve(opt.cache ?? path.join(PARITY, 'out', 'vite-cache'), engine);
    // A config beside the output that only moves Vite's cache out of the checkout.
    const cfg = path.join(OUT, `.vite-${engine}.config.mjs`);
    writeFileSync(
      cfg,
      `import base from ${JSON.stringify(path.join(v2, 'vite.config.js'))};\n` +
        `export default { ...base, cacheDir: ${JSON.stringify(cache)} };\n`,
    );
    process.stdout.write(`building ${engine} from ${v2}\n`);
    execFileSync('npx', ['vite', 'build', '--config', cfg, '--outDir', path.join(OUT, engine), '--emptyOutDir'], {
      cwd: v2,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, VITE_LEKH_TEST_ANY_HOST: '1' },
    });
    const commit = execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    writeFileSync(
      path.join(OUT, `${engine}.build.json`),
      JSON.stringify({ webapp: commit, built_at: new Date().toISOString() }),
    );
  }
  const boards = DEVICE_BOARDS.map(([mix, n]) => {
    const m = /** @type {string} */ (mix);
    const objects = /** @type {number} */ (n);
    const file = `${m}-${objects}.json`;
    writeFileSync(
      path.join(OUT, 'boards', file),
      JSON.stringify(synthBoard(/** @type {any} */ (m), objects, { pages: 1, seed: objects * 7 + m.length })),
    );
    return { set: `S-syn/${m}/${objects}`, name: `${m}-${objects}`, objects, file, hit: objects >= 1500, side: 6000 };
  });
  writeFileSync(
    path.join(OUT, 'boards', 'manifest.json'),
    JSON.stringify({ schema: 'bench-boards/1', boards }, null, 1),
  );
  for (const f of ['bench.html', 'bench.js']) copyFileSync(path.join(HERE, 'page', f), path.join(OUT, f));
  process.stdout.write(`out: ${OUT}\n`);
}
