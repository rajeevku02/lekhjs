// The §6.3 table for a device run of the in-page bench (verification 03 §4.3 step 5): reads the
// perf-device/1 JSON the owner downloads from bench.html and applies the same statistics and
// verdict as the box bench (web-bench.mjs): per run the p95 of each metric's samples, the metric
// value the median of the per-run p95s, the A/A margin from the C++ runs split into two
// interleaved halves, and pass / needs DR-PERF / fail per §3.3.
//
//   node parity/bench/verdict.mjs <perf-device.json> [--md <file>]
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: opt, positionals } = parseArgs({ allowPositionals: true, options: { md: { type: 'string' } } });
const file = positionals[0];
if (file === undefined) {
  process.stderr.write('usage: verdict.mjs <perf-device.json> [--md <file>]\n');
  process.exit(2);
}
const d = JSON.parse(readFileSync(file, 'utf8'));

/** @param {number[]} xs @param {number} p */
const pct = (xs, p) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] ?? NaN;
};
const metrics = /** @type {[string, string, (r: any) => number[] | null][]} */ ([
  ['P-01', 'ms', (r) => [r.load]],
  ['P-02', 'ms', (r) => r.frames ?? null],
  ['P-03 near', 'ms/call', (r) => r.hit?.near ?? null],
  ['P-03 connection', 'ms/call', (r) => r.hit?.connection ?? null],
]);
const rows = [];
for (const b of d.boards) {
  for (const [metric, unit, f] of metrics) {
    /** @param {any[]} rs */
    const per = (rs) =>
      rs.map((run) => {
        const r = run[b.name];
        return r && !r.error ? pct(f(r) ?? [], 95) : NaN;
      });
    const c = per(d.runs.cpp).filter(Number.isFinite);
    const t = per(d.runs.ts).filter(Number.isFinite);
    if (c.length === 0 && t.length === 0) continue;
    const cv = pct(c, 50);
    const tv = pct(t, 50);
    const h1 = pct(
      c.filter((_, i) => i % 2 === 0),
      50,
    );
    const h2 = pct(
      c.filter((_, i) => i % 2 === 1),
      50,
    );
    const a = h2 > 0 ? Math.abs(h1 / h2 - 1) : 0;
    const margin = Math.max(0.02, Number.isFinite(a) ? a : 0);
    const ratio = cv > 0 ? tv / cv : tv === 0 ? 1 : Infinity;
    const verdict =
      c.length === 0
        ? metric === 'P-01'
          ? tv <= 10000
            ? 'cpp_fail; TS ≤ 10 s'
            : 'cpp_fail; TS > 10 s'
          : 'cpp_fail'
        : ratio <= 1 + margin
          ? 'pass'
          : ratio <= 1.1
            ? 'needs DR-PERF'
            : 'fail';
    rows.push({ metric, set: b.set, unit, cpp: cv, ts: tv, ratio, margin, verdict, a_a_over_10pct: a > 0.1 });
  }
}
const f = (/** @type {number} */ x) =>
  Number.isFinite(x) ? (Math.abs(x) >= 100 ? x.toFixed(0) : x.toPrecision(3)) : String(x);
const dev = d.device || d.user_agent;
const md = [
  `device: ${dev}; runs per build ${d.runs_per_build}; ${d.started} … ${d.finished}`,
  '',
  '| Metric | Set | Device | C++ p95 | TS p95 | Ratio | Margin | Verdict |',
  '|---|---|---|---|---|---|---|---|',
  ...rows.map(
    (r) =>
      `| ${r.metric} | ${r.set} | ${d.device || 'device'} | ${f(r.cpp)} ${r.unit} | ${f(r.ts)} ${r.unit} | ${f(r.ratio)} | ${f(r.margin)} | ${r.verdict}${r.a_a_over_10pct ? ' (C++ halves differ > 10 %: repeat, §9.4)' : ''} |`,
  ),
].join('\n');
if (opt.md) writeFileSync(opt.md, md + '\n');
process.stdout.write(md + '\n');
