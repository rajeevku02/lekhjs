// The heavy-job lock (verification 01 §4 rule 1): every heavy command on the 2-core box runs under
// `flock -n <workspace_root>/logs/.heavy.lock`, so a second heavy job fails fast instead of
// queueing silently. The parity CLIs take it themselves through `holdHeavyLock()`.
//
// The lock is box-wide. From a worktree the workspace root is the shared checkout the worktree
// belongs to (`git rev-parse --git-common-dir` of the workspace-root repository), never the
// worktree itself, so a worktree run and a shared-checkout run exclude each other.
// `LEKH_HEAVY_LOCK=<file>` overrides the path.
//
//   node parity/tools/lock.mjs <cmd> [args…]     run one command under the lock
//   node parity/tools/lock.mjs --path            print the lock file
//
// In a script: `holdHeavyLock()` as the first statement. If this process does not hold the lock it
// re-runs itself under `flock -n` (with LEKH_HEAVY_LOCK_HELD=1) and exits with that run's status;
// when the lock is taken it prints who to wait for and exits 75 (EX_TEMPFAIL).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
/** lekhjs/ */
const PKG = path.resolve(HERE, '../..');
export const LOCK_BUSY = 75;

/** The workspace root that owns this lekhjs checkout: the nearest ancestor with ecosystem.config.js. */
function workspaceRoot() {
  for (let d = path.dirname(PKG); d !== path.dirname(d); d = path.dirname(d)) {
    if (existsSync(path.join(d, 'ecosystem.config.js'))) return d;
  }
  return null;
}

/** The box-wide lock file. */
export function lockPath() {
  const env = process.env['LEKH_HEAVY_LOCK'];
  if (env !== undefined && env !== '') return path.resolve(env);
  const ws = workspaceRoot();
  if (ws === null) throw new Error('lock: no workspace root (ecosystem.config.js) above ' + PKG);
  let root = ws;
  try {
    const common = execFileSync('git', ['-C', ws, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (path.basename(common) === '.git') root = path.dirname(common);
  } catch {
    // Not a git checkout: the workspace root itself.
  }
  return path.join(root, 'logs', '.heavy.lock');
}

/** What the lock file says about its holder (the holder writes nothing; flock(1) owns it). */
/** @param {string} file */
function holderHint(file) {
  try {
    const out = execFileSync('fuser', [file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (out === '') return '';
    const pids = out.split(/\s+/).filter((p) => /^\d+$/.test(p));
    const cmds = pids.map((p) => {
      try {
        return `${p}: ${readFileSync(`/proc/${p}/cmdline`, 'utf8').split('\0').join(' ').trim().slice(0, 160)}`;
      } catch {
        return p;
      }
    });
    return cmds.join('\n  ');
  } catch {
    return '';
  }
}

/**
 * Runs `argv` under the lock; returns its exit status (LOCK_BUSY when another heavy job holds it).
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number}
 */
export function runLocked(argv, env = process.env) {
  const file = lockPath();
  mkdirSync(path.dirname(file), { recursive: true });
  const r = spawnSync('flock', ['-n', '-E', String(LOCK_BUSY), file, ...argv], {
    stdio: 'inherit',
    env: { ...env, LEKH_HEAVY_LOCK_HELD: '1' },
  });
  if (r.error) throw r.error;
  if (r.status === LOCK_BUSY) {
    const who = holderHint(file);
    process.stderr.write(
      `heavy-job lock ${file} is held by another job; run this when it is free.` + (who !== '' ? `\n  ${who}\n` : '\n'),
    );
  }
  return r.status ?? 1;
}

/**
 * Whether an ancestor process is `flock … <file> …` (the runbook form,
 * `flock -n …/.heavy.lock npm run fixtures`): then this process already runs under the lock, and
 * a second `flock` on the same file would refuse.
 */
/** @param {string} file */
function ancestorHolds(file) {
  let pid = process.ppid;
  for (let depth = 0; depth < 16 && pid > 1; depth++) {
    try {
      const argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
      if (path.basename(argv[0] ?? '') === 'flock' && argv.some((a) => a !== '' && path.resolve(a) === file))
        return true;
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      pid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
    } catch {
      return false;
    }
  }
  return false;
}

/** Whether this process already runs under the lock (its own flock run, or an ancestor's). */
export function lockHeld() {
  return process.env['LEKH_HEAVY_LOCK_HELD'] === '1' || ancestorHolds(lockPath());
}

/** Makes the calling script hold the lock (see the header). Returns only inside the locked run. */
export function holdHeavyLock() {
  if (lockHeld()) return;
  const status = runLocked([process.execPath, ...process.execArgv, ...process.argv.slice(1)]);
  process.exit(status);
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) {
  const args = process.argv.slice(2);
  if (args[0] === '--path') {
    process.stdout.write(lockPath() + '\n');
  } else if (args.length === 0) {
    process.stderr.write('usage: node parity/tools/lock.mjs <cmd> [args…] | --path\n');
    process.exit(2);
  } else if (lockHeld()) {
    const r = spawnSync(args[0] ?? '', args.slice(1), { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  } else {
    process.exit(runLocked(args));
  }
}
