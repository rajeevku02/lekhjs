// Refuses a run summary that holds anything but counts, generalised paths and register ids
// (verification 02 §A.6 step 9, §A.8): no UUIDs, short ids, e-mail addresses or docids anywhere,
// no per-board list, and every diff path generalised. Run before anything leaves the box.
//
//   node parity/json/scrub-check.mjs <run dir>      exit 0 clean, 1 refused
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { scanText } from '../register/scan.mjs';

const ALLOWED_TOP = new Set([
  'run',
  'boards',
  'status',
  'pass',
  'failures',
  'stamp_ok',
  'stamp_wrong',
  'generator_parts_ok',
  'generator_parts_bad',
  'root_style_wrong',
  'json_unescaped_key',
  'ts_fail_codes',
  'register',
  'top_paths',
  'tolerance_max_rel',
]);
const PATH_KEY = /^(?:[a-z_]+ )?\/[A-Za-z0-9_*~./-]*$/;

/**
 * @param {string} dir
 * @returns {string[]} the reasons it is refused (empty: clean)
 */
export function scrubCheck(dir) {
  /** @type {string[]} */
  const bad = [];
  for (const f of ['summary.json', 'summary.md']) {
    const text = readFileSync(path.join(dir, f), 'utf8');
    for (const h of scanText(text)) bad.push(`${f}: ${h.kind} at offset ${h.at}`);
  }
  const s = JSON.parse(readFileSync(path.join(dir, 'summary.json'), 'utf8'));
  for (const k of Object.keys(s)) if (!ALLOWED_TOP.has(k)) bad.push(`summary.json: member ${k} is not an aggregate`);
  for (const k of [...Object.keys(s.top_paths ?? {}), ...Object.keys(s.tolerance_max_rel ?? {})])
    if (!PATH_KEY.test(k)) bad.push(`summary.json: path ${JSON.stringify(k.slice(0, 40))} is not a generalised path`);
  for (const k of Object.keys(s.register ?? {}))
    if (!/^DR-[A-Z]+-\d+$/.test(k)) bad.push(`summary.json: ${k} is not a register id`);
  return bad;
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) {
  const dir = process.argv[2];
  if (dir === undefined) {
    process.stderr.write('usage: scrub-check.mjs <run dir>\n');
    process.exit(2);
  }
  const bad = scrubCheck(path.resolve(dir));
  if (bad.length > 0) {
    process.stderr.write(`refused:\n  ${bad.join('\n  ')}\n`);
    process.exit(1);
  }
  process.stdout.write('clean\n');
}
