// The image sample of verification 02 §B.4, drawn from `corpus/inventory.json` with a recorded
// seed: (1) every feature stratum up to 300 boards (topped up after (2) and (3), so boards already
// drawn count toward their features), (2) 1,200 boards stratified by provider × group
// × object-count decile (proportional, at least 10 per non-empty cell), (3) the 4 most recently
// edited boards of each paid user; de-duplicated. Also the 200-board switches-off subsample of
// §B.5 item 3 (seeded). Writes `corpus/sample/image-sample.json` (idx lists and the seed; no board
// ids); prints aggregate counts only.
//
//   node parity/corpus/sample.mjs [--seed N] [<corpus dir>]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values: opt, positionals } = parseArgs({
  options: { seed: { type: 'string', default: '20261018' } },
  allowPositionals: true,
});
const corpus = path.resolve(positionals[0] ?? path.join(import.meta.dirname, '..', '..', '..', 'corpus'));
const SEED = Number(opt.seed);

export const STRATA = Object.freeze([
  'images',
  'multipage',
  'lua',
  'bpmn',
  'table',
  'groups',
  'connector:0',
  'connector:1',
  'connector:2',
  'connector:3',
  'legacy',
  'title',
  'multiline',
  'nonlatin',
  'cjk',
  'gradient',
  'dash',
  'rotated',
  'ink',
]);
const CAP = 300;
const RANDOM = 1200;
const PER_USER = 4;
const OFF_SUBSAMPLE = 200;

/** mulberry32 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** @template T @param {T[]} arr @param {() => number} r @returns {T[]} */
function shuffled(arr, r) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const inv = JSON.parse(readFileSync(path.join(corpus, 'inventory.json'), 'utf8'));
const idxs = Object.keys(inv)
  .filter((k) => !inv[k].parse_fail)
  .sort();
const r = rng(SEED);
/** @type {Map<string, string[]>} idx → reasons */
const chosen = new Map();
const add = (/** @type {string} */ idx, /** @type {string} */ why) => {
  const l = chosen.get(idx) ?? [];
  l.push(why);
  chosen.set(idx, l);
};

// (2) stratified random: provider × group × object-count decile
const sortedByObjects = [...idxs].sort((a, b) => inv[a].objects - inv[b].objects || (a < b ? -1 : 1));
/** @type {Record<string, number>} */
const decile = {};
sortedByObjects.forEach((k, i) => (decile[k] = Math.min(9, Math.floor((10 * i) / sortedByObjects.length))));
/** @type {Map<string, string[]>} */
const cells = new Map();
for (const k of idxs) {
  const key = `${inv[k].provider}/${inv[k].group}/d${decile[k]}`;
  const l = cells.get(key) ?? [];
  l.push(k);
  cells.set(key, l);
}
let randomPicked = 0;
for (const [key, members] of [...cells].sort()) {
  const n = Math.min(members.length, Math.max(10, Math.round((RANDOM * members.length) / idxs.length)));
  for (const k of shuffled(members, r).slice(0, n)) {
    add(k, `random:${key}`);
    randomPicked++;
  }
}

// (3) the 4 most recently edited boards per paid user
/** @type {Map<string, string[]>} */
const byUser = new Map();
for (const k of idxs) {
  if (inv[k].group !== 'paid') continue;
  const l = byUser.get(inv[k].owner_hash) ?? [];
  l.push(k);
  byUser.set(inv[k].owner_hash, l);
}
let recentPicked = 0;
for (const [, l] of byUser) {
  l.sort((a, b) => (inv[b].updated_at ?? 0) - (inv[a].updated_at ?? 0) || (a < b ? -1 : 1));
  for (const k of l.slice(0, PER_USER)) {
    add(k, 'recent');
    recentPicked++;
  }
}

// (1) feature strata, topped up last: a stratum counts the sample's boards that already carry the
// feature (from (2) and (3)) and adds seeded random boards with it until it holds 300 (or all).
/** @type {Record<string, number>} */
const strata = {};
for (const f of STRATA) {
  const with_ = idxs.filter((k) => inv[k].flags.includes(f));
  const have = with_.filter((k) => chosen.has(k));
  const need = Math.max(0, Math.min(CAP, with_.length) - have.length);
  const pick = shuffled(
    with_.filter((k) => !chosen.has(k)),
    r,
  ).slice(0, need);
  for (const k of pick) add(k, `feature:${f}`);
  strata[f] = Math.min(CAP, with_.length);
}

const sample = [...chosen.keys()].sort();
const off = shuffled(sample, rng(SEED + 1))
  .slice(0, OFF_SUBSAMPLE)
  .sort();
const outDir = path.join(corpus, 'sample');
mkdirSync(outDir, { recursive: true });
writeFileSync(
  path.join(outDir, 'image-sample.json'),
  JSON.stringify(
    {
      seed: SEED,
      made: new Date().toISOString(),
      boards: sample,
      reasons: Object.fromEntries(chosen),
      off_subsample: off,
    },
    null,
    0,
  ),
);
const pages = sample.reduce((s, k) => s + Math.min(4, Math.max(1, inv[k].pages)), 0);
const res = new Set(sample.flatMap((k) => inv[k].resids));
process.stdout.write(
  JSON.stringify(
    {
      seed: SEED,
      boards: sample.length,
      pages_to_compare: pages,
      strata,
      random_picked: randomPicked,
      random_cells: cells.size,
      recent_users: byUser.size,
      recent_picked: recentPicked,
      off_subsample: off.length,
      distinct_res_in_sample: res.size,
    },
    null,
    1,
  ) + '\n',
);
