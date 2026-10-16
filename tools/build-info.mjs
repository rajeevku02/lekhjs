// Writes dist/build-info.json: { commit, dirty, built_at, node, files_sha256 } (spec 01 §5.3,
// field names as spec 10 §10.1). kashi startup and lbs/deploy/build.sh compare it with the
// lekhjs HEAD and a fresh hash.
//
//   node tools/build-info.mjs          write dist/build-info.json
//   node tools/build-info.mjs --hash   print files_sha256 only
//
// files_sha256: SHA-256 over every file under src/, fonts/ and stencils/, in sorted
// package-relative POSIX path order, feeding for each file: path, NUL, content, NUL.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const HASHED_DIRS = Object.freeze(['src', 'fonts', 'stencils']);

/**
 * @param {string} dir absolute
 * @returns {string[]}
 */
function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return listFiles(p);
    return d.isFile() ? [p] : [];
  });
}

/** @param {string} [root] package root */
export function filesSha256(root = ROOT) {
  const rel = HASHED_DIRS.flatMap((d) => listFiles(path.join(root, d)))
    .map((f) => path.relative(root, f).split(path.sep).join('/'))
    .sort();
  const h = createHash('sha256');
  for (const p of rel) {
    h.update(p);
    h.update('\0');
    h.update(readFileSync(path.join(root, p)));
    h.update('\0');
  }
  return h.digest('hex');
}

/** @param {string[]} args */
function git(args) {
  try {
    return execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function buildInfo() {
  const commit = git(['rev-parse', 'HEAD']);
  const status = git(['status', '--porcelain']);
  return {
    commit,
    dirty: commit === null || status === null || status !== '',
    built_at: new Date().toISOString(),
    node: process.version,
    files_sha256: filesSha256(),
  };
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  if (process.argv.includes('--hash')) {
    console.log(filesSha256());
  } else {
    const info = buildInfo();
    mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
    writeFileSync(path.join(ROOT, 'dist/build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
    console.log(
      `build-info: commit ${info.commit ?? '(none)'}${info.dirty ? ' (dirty)' : ''}, files_sha256 ${info.files_sha256}`,
    );
  }
}
