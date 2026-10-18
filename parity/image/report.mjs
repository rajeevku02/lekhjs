// Aggregates an image run (run.mjs results.jsonl) into the counts of verification 02 §B.3: per-page
// statuses, register ids applied (pages per id), board-level harness statuses, flags under
// unexplained oversized blobs, the differing-fraction distribution of non-passing pages, and the
// selfdiff tally. Counts only: no board idx, id or content (safe for a Work comment).
//
//   node parity/image/report.mjs <run dir> [--md]
import { readFileSync } from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) {
  process.stderr.write('usage: report.mjs <run dir> [--md]\n');
  process.exit(2);
}
const rows = readFileSync(path.join(dir, 'results.jsonl'), 'utf8')
  .split('\n')
  .filter((l) => l.trim() !== '')
  .map((l) => JSON.parse(l));
// The last row of a board wins (a board re-run after a harness fix appends a new row).
const byIdx = new Map(rows.map((r) => [r.idx, r]));
/** @type {Record<string, number>} */
const pageStatus = {};
/** @type {Record<string, number>} */
const boardStatus = {};
/** @type {Record<string, number>} */
const rules = {};
/** @type {Record<string, number>} */
const flagsUnder = {};
const failFractions = [];
let pages = 0;
/** Every compared page's differing fraction (the switches-off review counts, §B.5 item 3). */
const allFractions = [];
let maskedPages = 0;
const selfdiff = { boards: 0, cpp_nondet: 0, ts_nondet: 0 };
const ms = [];
const inc = (/** @type {Record<string, number>} */ o, /** @type {string} */ k, n = 1) => (o[k] = (o[k] ?? 0) + n);
for (const r of byIdx.values()) {
  if (r.status) inc(boardStatus, r.status);
  else inc(boardStatus, 'compared');
  if (r.wall_ms) ms.push(r.wall_ms);
  if (r.selfdiff) {
    selfdiff.boards++;
    if (!r.selfdiff.cpp) selfdiff.cpp_nondet++;
    if (!r.selfdiff.ts) selfdiff.ts_nondet++;
  }
  if (r.status && r.status.startsWith('harness')) continue;
  for (const p of r.pages ?? []) {
    pages++;
    if (typeof p.fraction === 'number') allFractions.push(p.fraction);
    inc(pageStatus, p.status);
    for (const id of new Set(p.rules ?? [])) inc(rules, id);
    if (p.masked_fraction !== undefined) maskedPages++;
    if (!['pass', 'pass_rules'].includes(p.status)) {
      if (typeof p.fraction === 'number') failFractions.push(p.unexplained_fraction ?? p.fraction);
      for (const [f, n] of Object.entries(p.flags_under ?? {})) inc(flagsUnder, f, /** @type {number} */ (n));
    }
  }
}
failFractions.sort((a, b) => a - b);
const q = (/** @type {number[]} */ xs, /** @type {number} */ p) =>
  xs.length ? xs[Math.min(xs.length - 1, Math.floor(p * xs.length))] : null;
ms.sort((a, b) => a - b);
allFractions.sort((a, b) => a - b);
const summary = {
  boards: byIdx.size,
  board_status: boardStatus,
  pages,
  page_status: pageStatus,
  register_ids_applied_pages: rules,
  masked_pages: maskedPages,
  differing_pages: allFractions.filter((x) => x > 0).length,
  median_differing_fraction: q(allFractions, 0.5),
  median_differing_fraction_of_differing: q(
    allFractions.filter((x) => x > 0),
    0.5,
  ),
  non_passing_unexplained_fraction: {
    n: failFractions.length,
    p50: q(failFractions, 0.5),
    p90: q(failFractions, 0.9),
    max: failFractions.at(-1) ?? null,
    under_0_1pct: failFractions.filter((x) => x < 0.001).length,
  },
  flags_under_unexplained_blobs: flagsUnder,
  selfdiff,
  wall_s_per_board: { p50: (q(ms, 0.5) ?? 0) / 1000, p95: (q(ms, 0.95) ?? 0) / 1000 },
};
if (process.argv.includes('--md')) {
  const kv = (/** @type {Record<string, number>} */ o) =>
    Object.entries(o)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
  process.stdout.write(
    [
      `boards: ${summary.boards} (${kv(boardStatus)})`,
      `pages: ${pages} (${kv(pageStatus)})`,
      `register ids applied (pages): ${kv(rules) || 'none'}`,
      `pages with any differing pixel: ${summary.differing_pages}; median differing fraction ${summary.median_differing_fraction} (of those: ${summary.median_differing_fraction_of_differing})`,
      `non-passing pages, unexplained differing fraction: p50 ${summary.non_passing_unexplained_fraction.p50}, p90 ${summary.non_passing_unexplained_fraction.p90}, max ${summary.non_passing_unexplained_fraction.max}; ${summary.non_passing_unexplained_fraction.under_0_1pct} under 0.1 % (blob-only failures)`,
      `object flags under unexplained blobs > 16 px²: ${kv(flagsUnder) || 'none'}`,
      `self-diff: ${selfdiff.boards} boards, C++ non-deterministic ${selfdiff.cpp_nondet}, TS ${selfdiff.ts_nondet}`,
    ].join('\n') + '\n',
  );
} else process.stdout.write(JSON.stringify(summary, null, 1) + '\n');
