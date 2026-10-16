// register:check (verification 01 §9.5; merge gate): the difference register's own checks.
//
//   cd lekhjs/parity && npm run register:check [-- --strict] [-- --oracles]
//
//   1. each DR-*.yaml parses and validates against schema.json; id = file name; ids unique; the
//      area matches the id; its structured json rules compile;
//   2. `fixture` exists, under parity/fixtures/ or test/fixtures/; with --oracles each board
//      fixture loads in both the Node oracle and lekhjs (T6 loads them too; --oracles takes the
//      heavy-job lock);
//   3. no customer content: no UUID, short id, e-mail or docid in an entry; a `.lekh` fixture's
//      text uses only the words of parity/fixtures/VOCABULARY.txt;
//   4. every DR id cited in lekhjs (src/, test/, tools/, parity/) is filed, or is one the specs
//      propose (register/spec-ids.json) and is reported pending;
//   5. --strict (phase exit, AC-ROL-15): no entry is `proposed`, every cited id is filed and every
//      fixture is a board fixture.
//   It also prints the age of every proposed entry and checks that README.md is current
//   (`npm run register:index`).
//
// The entries filed before this tool existed name a vitest file (or a golden) as their fixture;
// that is reported as a warning, and is an error only under --strict.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import Ajv from 'ajv';
import { compileRules } from '../json/rules.mjs';
import { ENTRY_FILE, REGISTER_DIR, loadRegister } from './load.mjs';
import { loadVocabulary, scanText, wordsOutsideVocabulary } from './scan.mjs';
import { formattedIndex } from '../tools/register-index.mjs';

const PKG = path.resolve(REGISTER_DIR, '..', '..');
const CITE = /\bDR-[A-Z]+-\d{2,}\b/g;
const SCAN_ROOTS = ['src', 'test', 'tools', 'parity'];
const SKIP_DIRS = new Set(['node_modules', 'out', 'dist', 'coverage']);
const SCAN_EXT = /\.(?:ts|mts|cts|js|mjs|cjs|json|md|yaml|yml|txt)$/;
const DATA_FIXTURE = /\.(?:lekh|json|xml)$/;

/** @param {string} dir @returns {string[]} */
function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else if (SCAN_EXT.test(name)) out.push(p);
  }
  return out;
}

/** Days since the file was first committed (0 when it is not committed yet). */
function ageDays(/** @type {string} */ file) {
  try {
    const out = execFileSync('git', ['-C', PKG, 'log', '--follow', '--format=%ct', '--', file], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const first = out.split('\n').filter(Boolean).pop();
    return first === undefined ? 0 : Math.floor((Date.now() / 1000 - Number(first)) / 86400);
  } catch {
    return 0;
  }
}

/**
 * @param {{ strict?: boolean, oracles?: boolean, dir?: string }} [opts]
 * @returns {Promise<{ errors: string[], warnings: string[], info: string[] }>}
 */
export async function checkRegister(opts = {}) {
  const dir = opts.dir ?? REGISTER_DIR;
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  /** @type {string[]} */
  const info = [];
  const strict = opts.strict === true;

  const schema = JSON.parse(readFileSync(path.join(REGISTER_DIR, 'schema.json'), 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const entries = loadRegister(dir);
  for (const f of readdirSync(dir))
    if (f.endsWith('.yaml') && !ENTRY_FILE.test(f)) errors.push(`${f}: not a DR-<AREA>-<NN>.yaml file name`);

  // 1. format
  /** @type {Map<string, string>} */
  const seen = new Map();
  for (const e of entries) {
    for (const p of e.parseErrors) errors.push(`${e.file}: YAML: ${p}`);
    if (!validate(e.data))
      for (const v of validate.errors ?? []) errors.push(`${e.file}: ${v.instancePath || '/'} ${v.message ?? ''}`);
    const id = String(e.data['id'] ?? '');
    if (`${id}.yaml` !== e.file) errors.push(`${e.file}: id ${id} does not match the file name`);
    if (seen.has(id)) errors.push(`${e.file}: id ${id} is also in ${seen.get(id)}`);
    seen.set(id, e.file);
    const area = /^DR-([A-Z]+)-/.exec(id)?.[1];
    if (area !== undefined && e.data['area'] !== area)
      errors.push(`${e.file}: area ${e.data['area']} does not match ${id}`);
  }
  const compiled = compileRules(entries);
  for (const x of compiled.errors) errors.push(`rule: ${x}`);
  const descriptive = entries.reduce(
    (n, e) =>
      n +
      (Array.isArray(e.data['rule']?.json)
        ? e.data['rule'].json.filter((/** @type {unknown} */ r) => typeof r === 'string').length
        : 0),
    0,
  );
  info.push(
    `${entries.length} entries; ${compiled.json.length} applied json rules, ${descriptive} descriptive json items, ${compiled.cppFail.length} cpp_fail ties`,
  );

  // 2 + 3. fixtures and content
  const vocab = loadVocabulary();
  /** @type {{ id: string, file: string }[]} */
  const boards = [];
  for (const e of entries) {
    const id = String(e.data['id'] ?? e.file);
    const text = readFileSync(path.join(dir, e.file), 'utf8');
    for (const h of scanText(text)) errors.push(`${e.file}: customer-content scanner: ${h.kind} at offset ${h.at}`);
    const fx = e.data['fixture'];
    if (typeof fx !== 'string') continue;
    const abs = path.resolve(PKG, fx);
    if (!existsSync(abs)) {
      errors.push(`${e.file}: fixture ${fx} does not exist`);
      continue;
    }
    const rel = path.relative(PKG, abs);
    const underFixtures =
      rel.startsWith(`parity${path.sep}fixtures${path.sep}`) || rel.startsWith(`test${path.sep}fixtures${path.sep}`);
    if (underFixtures && DATA_FIXTURE.test(rel)) {
      if (rel.endsWith('.lekh')) {
        boards.push({ id, file: abs });
        let parsed = null;
        try {
          parsed = JSON.parse(readFileSync(abs, 'utf8'));
        } catch {
          // a fixture of a reader quirk may be deliberately broken JSON; the oracles decide
        }
        if (parsed !== null) {
          const words = wordsOutsideVocabulary(parsed, vocab);
          if (words.length > 0)
            errors.push(
              `${e.file}: fixture text outside parity/fixtures/VOCABULARY.txt: ${words.slice(0, 10).join(', ')}`,
            );
        }
      }
    } else if (rel.startsWith(`test${path.sep}`)) {
      const msg = `${e.file}: fixture ${fx} is a test file, not a board fixture under parity/fixtures/ or test/fixtures/`;
      (strict ? errors : warnings).push(msg);
      if (!readFileSync(abs, 'utf8').includes(id)) warnings.push(`${e.file}: ${fx} does not mention ${id}`);
    } else errors.push(`${e.file}: fixture ${fx} is outside parity/fixtures/ and test/fixtures/`);
  }
  if (opts.oracles === true && boards.length > 0) {
    const require = createRequire(import.meta.url);
    const { NodeOracle } = require('../oracle/node-oracle.cjs');
    const { TsRunner } = await import('../oracle/ts-runner.mjs');
    const o = new NodeOracle();
    const t = new TsRunner();
    try {
      for (const b of boards) {
        const text = readFileSync(b.file, 'utf8');
        const c = await o.load(text, { stamp: 'app' });
        const s = await t.load(text, { stamp: 'app' });
        // A reader-quirk entry's fixture may be one only one engine reads; both must answer.
        if (c.timeout || s.timeout)
          errors.push(`${b.id}: fixture timed out in ${c.timeout ? 'the Node oracle' : 'lekhjs'}`);
        else if (!c.ok && !s.ok) errors.push(`${b.id}: fixture loads in neither engine`);
        else if (!c.ok || !s.ok) info.push(`${b.id}: fixture loads only in ${c.ok ? 'C++' : 'lekhjs'}`);
      }
    } finally {
      await o.close();
      await t.close();
    }
  } else if (boards.length > 0) info.push(`${boards.length} board fixtures not loaded (run with --oracles, or T6)`);

  // 4. citations
  const filed = new Set(entries.map((e) => String(e.data['id'])));
  const specIds = JSON.parse(readFileSync(path.join(REGISTER_DIR, 'spec-ids.json'), 'utf8')).ids;
  /** @type {Map<string, { withdrawn: boolean }>} */
  const proposedBySpecs = new Map(specIds.map((/** @type {any} */ s) => [s.id, { withdrawn: s.withdrawn === true }]));
  /** @type {Map<string, Set<string>>} */
  const cited = new Map();
  for (const root of SCAN_ROOTS)
    for (const f of filesUnder(path.join(PKG, root))) {
      const rel = path.relative(PKG, f);
      if (
        rel === path.join('parity', 'register', 'spec-ids.json') ||
        rel === path.join('parity', 'register', 'README.md')
      )
        continue;
      for (const m of readFileSync(f, 'utf8').matchAll(CITE)) {
        const set = cited.get(m[0]) ?? new Set();
        set.add(rel);
        cited.set(m[0], set);
      }
    }
  /** @type {string[]} */
  const pending = [];
  for (const [id, where] of [...cited].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (filed.has(id)) continue;
    const spec = proposedBySpecs.get(id);
    const files = [...where].slice(0, 3).join(', ');
    if (spec === undefined) errors.push(`${id} is cited (${files}) but neither filed nor proposed by a spec`);
    else if (spec.withdrawn) errors.push(`${id} is withdrawn and may not be cited (${files})`);
    else if (strict) errors.push(`${id} is cited (${files}) but not filed`);
    else pending.push(id);
  }
  if (pending.length > 0) warnings.push(`cited, proposed by the specs, not filed yet (pending): ${pending.join(', ')}`);
  for (const id of filed)
    if (!proposedBySpecs.has(id))
      info.push(`${id} is filed but not in spec-ids.json (a new entry: fine, the next free number)`);
  const unfiled = [...proposedBySpecs].filter(([id, s]) => !s.withdrawn && !filed.has(id)).map(([id]) => id);
  info.push(`${unfiled.length} spec-proposed ids not filed yet`);

  // 5. status
  const proposed = entries.filter((e) => e.data['status'] === 'proposed');
  if (strict)
    for (const e of proposed) errors.push(`${e.file}: status proposed (phase exit needs accepted or rejected)`);
  if (proposed.length > 0)
    info.push(
      `proposed: ${proposed
        .map((e) => `${e.data['id']} ${ageDays(path.join('parity', 'register', e.file))}d`)
        .join(', ')}`,
    );

  // the generated index
  const readme = path.join(dir, 'README.md');
  const want = await formattedIndex(entries);
  if (!existsSync(readme) || readFileSync(readme, 'utf8') !== want)
    errors.push('README.md is not current: run npm run register:index');

  return { errors, warnings, info };
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) {
  const args = process.argv.slice(2);
  const oracles = args.includes('--oracles');
  if (oracles) {
    const { holdHeavyLock } = await import('../tools/lock.mjs');
    holdHeavyLock();
  }
  const r = await checkRegister({ strict: args.includes('--strict'), oracles });
  for (const l of r.info) process.stdout.write(`info: ${l}\n`);
  for (const l of r.warnings) process.stdout.write(`warning: ${l}\n`);
  for (const l of r.errors) process.stdout.write(`error: ${l}\n`);
  process.stdout.write(
    `register:check${args.includes('--strict') ? ' --strict' : ''}: ${r.errors.length === 0 ? 'PASS' : 'FAIL'} (${r.errors.length} errors, ${r.warnings.length} warnings)\n`,
  );
  process.exit(r.errors.length === 0 ? 0 : 1);
}
