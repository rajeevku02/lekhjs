// results.jsonl → summary.json + summary.md (verification 02 §A.3, §A.6 step 9): counts per
// status, the pass bar, the top generalised diff paths, counts per register id, load-failure codes,
// stamp_ok / stamp_wrong, generator_parts_ok, the largest within-tolerance deviation per path.
// For a fixture run the summary also names the boards that are not equal (fixture paths are
// synthetic); for a customer run it carries counts, generalised paths and register ids only, and
// is refused by scrub-check if anything else slipped in.
//
//   node parity/json/report.mjs <run dir>
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { scrubCheck } from './scrub-check.mjs';

export const STATUSES = Object.freeze([
  'equal',
  'equal_tol',
  'equal_rules',
  'gap',
  'differ',
  'ts_fail',
  'cpp_fail',
  'both_fail',
  'cpp_oom',
  'timeout',
]);

/** @param {Record<string, number>} m @param {number} n */
const top = (m, n) =>
  Object.fromEntries(
    Object.entries(m)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, n),
  );

/** @param {Record<string, number>} m @param {string} k @param {number} [by] */
const bump = (m, k, by = 1) => {
  m[k] = (m[k] ?? 0) + by;
};

/**
 * @param {string} dir
 * @returns {{ pass: boolean, line: string, summary: Record<string, any> }}
 */
export function report(dir) {
  const run = existsSync(path.join(dir, 'run.json'))
    ? JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8'))
    : {};
  const recs = readFileSync(path.join(dir, 'results.jsonl'), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));
  /** @type {Record<string, number>} */
  const status = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const st = (/** @type {string} */ k) => status[k] ?? 0;
  /** @type {Record<string, number>} */
  const paths = {};
  /** @type {Record<string, number>} */
  const register = {};
  /** @type {Record<string, number>} */
  const tsCodes = {};
  /** @type {Record<string, number>} */
  const gapOwners = {};
  /** @type {Record<string, number>} */
  const tolerance = {};
  let stampOk = 0;
  let stampWrong = 0;
  let partsOk = 0;
  let partsBad = 0;
  let rootStyleWrong = 0;
  let unescapedKey = 0;
  let cppFailUntied = 0;
  /** @type {string[]} */
  const notEqual = [];
  for (const r of recs) {
    bump(status, r.status);
    for (const [k, v] of Object.entries(r.paths ?? {})) bump(paths, k, Number(v));
    for (const [k, v] of Object.entries(r.register ?? {})) bump(register, k, Number(v));
    for (const k of Object.keys(r.gap ?? {})) bump(gapOwners, k);
    for (const [k, v] of Object.entries(r.tolerance ?? {})) tolerance[k] = Math.max(tolerance[k] ?? 0, Number(v));
    if (r.ts_code !== undefined) bump(tsCodes, r.ts_code);
    if (r.ts_code === 'json_unescaped_key' || r.unescaped_key === true) unescapedKey++;
    if (r.stamp !== undefined) {
      if (r.stamp.ok) stampOk++;
      else stampWrong++;
    }
    if (r.generator_parts !== undefined) {
      partsOk += r.generator_parts.ok;
      partsBad += r.generator_parts.bad;
    }
    if (r.root_style_ok === false) rootStyleWrong++;
    if (r.status === 'cpp_fail' && r.register === undefined) cppFailUntied++;
    if (!run.customer && !['equal', 'equal_tol', 'equal_rules'].includes(r.status))
      notEqual.push(`${r.status} ${r.idx}${r.gap !== undefined ? ` (${Object.keys(r.gap).join(', ')})` : ''}`);
  }
  const tsFailGate = st('ts_fail') - recs.filter((r) => r.ts_code === 'json_unescaped_key').length;
  /** @type {string[]} */
  const failures = [];
  if (st('differ') > 0) failures.push(`differ ${st('differ')}`);
  if (tsFailGate > 0) failures.push(`ts_fail ${tsFailGate}`);
  if (st('timeout') > 0) failures.push(`timeout ${st('timeout')}`);
  if (cppFailUntied > 0) failures.push(`cpp_fail without a register entry ${cppFailUntied}`);
  if (stampWrong > 0) failures.push(`stamp_wrong ${stampWrong}`);
  if (rootStyleWrong > 0) failures.push(`root style wrong ${rootStyleWrong}`);
  const pass = failures.length === 0;
  const ids = Object.keys(register).sort();
  const line =
    `${run.label ?? 'json'} ${run.pipeline ?? ''}×${run.stamp ?? ''}: ${recs.length} boards — ` +
    `equal ${st('equal')}, equal_tol ${st('equal_tol')}, equal_rules ${st('equal_rules')}` +
    (ids.length > 0 ? ` [${ids.join(', ')}]` : '') +
    (st('gap') > 0
      ? `, gap ${st('gap')} [${Object.keys(gapOwners)
          .sort()
          .map((k) => `${k}: ${gapOwners[k]}`)
          .join(', ')}]`
      : '') +
    `, differ ${st('differ')}, ts_fail ${st('ts_fail')}, cpp_fail ${st('cpp_fail')}, both_fail ${st('both_fail')}, cpp_oom ${st('cpp_oom')}, timeout ${st('timeout')}` +
    ` — ${pass ? 'PASS' : 'FAIL'}`;
  const summary = {
    run: {
      pipeline: run.pipeline,
      stamp: run.stamp,
      customer: run.customer === true,
      started: run.started,
      finished: run.finished,
      oracle: run.oracle
        ? { commit: run.oracle.commit, wasm_sha256: run.oracle.wasm_sha256, instances: run.oracle.instances }
        : null,
      lekhjs: run.lekhjs
        ? { commit: run.lekhjs.commit, dirty: run.lekhjs.dirty, files_sha256: run.lekhjs.files_sha256 }
        : null,
    },
    boards: recs.length,
    status,
    pass,
    failures,
    stamp_ok: stampOk,
    stamp_wrong: stampWrong,
    generator_parts_ok: partsOk,
    generator_parts_bad: partsBad,
    root_style_wrong: rootStyleWrong,
    json_unescaped_key: unescapedKey,
    ts_fail_codes: tsCodes,
    register,
    gap_owners: gapOwners,
    top_paths: top(paths, 50),
    tolerance_max_rel: top(tolerance, 50),
    ...(run.customer ? {} : { not_equal: notEqual }),
  };
  const md = [
    `# JSON comparison — ${run.label ?? path.basename(dir)}`,
    '',
    `\`${line}\``,
    '',
    `lekhjs ${String(summary.run.lekhjs?.commit ?? '?').slice(0, 7)}${summary.run.lekhjs?.dirty ? ' (dirty)' : ''} (files_sha256 ${String(summary.run.lekhjs?.files_sha256 ?? '').slice(0, 8)}) · oracle node ${String(summary.run.oracle?.commit ?? '?').slice(0, 7)}/${String(summary.run.oracle?.wasm_sha256 ?? '').slice(0, 8)}`,
    '',
    '| status | boards |',
    '|---|---|',
    ...STATUSES.map((s) => `| ${s} | ${st(s)} |`),
    '',
    `stamp_ok ${stampOk}, stamp_wrong ${stampWrong}; generator_parts_ok ${partsOk}, bad ${partsBad}; root style wrong ${rootStyleWrong}; json_unescaped_key ${unescapedKey}`,
    '',
    failures.length > 0
      ? `**FAIL:** ${failures.join('; ')}`
      : '**PASS** (G1 bar: 0 differ, 0 ts_fail, 0 timeout, every cpp_fail tied, 0 stamp_wrong, 0 root style wrong; an owned gap (`parity/gaps.json`) is listed with its task and counts as differ in a phase-exit run)',
    '',
    '## Register ids applied',
    '',
    ...(ids.length > 0 ? ids.map((k) => `- ${k}: ${register[k]}`) : ['- none']),
    '',
    '## Load-failure codes (TS)',
    '',
    ...(Object.keys(tsCodes).length > 0 ? Object.entries(tsCodes).map(([k, v]) => `- ${k}: ${v}`) : ['- none']),
    '',
    '## Top unexplained diff paths (kind, generalised path: count)',
    '',
    ...(Object.keys(summary.top_paths).length > 0
      ? Object.entries(summary.top_paths).map(([k, v]) => `- \`${k}\`: ${v}`)
      : ['- none']),
    '',
    '## Largest relative deviation within tolerance',
    '',
    ...(Object.keys(summary.tolerance_max_rel).length > 0
      ? Object.entries(summary.tolerance_max_rel).map(([k, v]) => `- \`${k}\`: ${Number(v).toExponential(2)}`)
      : ['- none']),
    ...(run.customer
      ? []
      : ['', '## Boards not equal', '', ...(notEqual.length > 0 ? notEqual.map((x) => `- ${x}`) : ['- none'])]),
    '',
  ].join('\n');
  writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  writeFileSync(path.join(dir, 'summary.md'), md);
  if (run.customer) {
    const bad = scrubCheck(dir);
    if (bad.length > 0) throw new Error(`report: summary refused by scrub-check:\n  ${bad.join('\n  ')}`);
  }
  return { pass, line, summary };
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) {
  const dir = process.argv[2];
  if (dir === undefined) {
    process.stderr.write('usage: report.mjs <run dir>\n');
    process.exit(2);
  }
  const r = report(path.resolve(dir));
  process.stdout.write(r.line + '\n');
  process.exit(r.pass ? 0 : 1);
}
