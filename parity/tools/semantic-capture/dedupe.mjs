// Turns the raw capture of `capture-setup.cjs` (one record per wasm call, the board text repeated
// in every record) into `cases.jsonl`: one line per distinct (op, source, argument), the board
// texts stored once each under `texts/<sha1>.txt`. Run after a capture:
//
//   node parity/tools/semantic-capture/dedupe.mjs [<capture dir>]   (default parity/out/semantic-capture)
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const DIR = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, '..', '..', 'out', 'semantic-capture'));
const TEXTS = path.join(DIR, 'texts');
mkdirSync(TEXTS, { recursive: true });
/** @param {string} s */
const sha = (s) => createHash('sha1').update(s).digest('hex');
/** @param {unknown} text */
const ref = (text) => {
  if (typeof text !== 'string') return null;
  const h = sha(text);
  const f = path.join(TEXTS, h + '.txt');
  if (!existsSync(f)) writeFileSync(f, text);
  return h;
};

/** @type {Map<string, Record<string, unknown>>} */
const seen = new Map();
/** @type {Record<string, number>} */
const counts = {};
for (const f of readdirSync(DIR)
  .filter((n) => n.endsWith('.jsonl') && n !== 'cases.jsonl')
  .sort()) {
  const rl = readline.createInterface({ input: createReadStream(path.join(DIR, f)) });
  for await (const line of rl) {
    if (line.trim() === '') continue;
    const r = JSON.parse(line);
    /** @type {Record<string, unknown>} */
    const c = { op: r.op };
    if (typeof r.raw === 'string') c.raw = ref(r.raw);
    if (typeof r.payload === 'string') c.payload = ref(r.payload);
    for (const k of ['options', 'batch', 'args']) if (r[k] !== undefined) c[k] = r[k];
    const key = JSON.stringify(c);
    if (seen.has(key)) continue;
    c.id = sha(key).slice(0, 12);
    c.out = r.out;
    if (typeof r.generated === 'string') c.generated = r.generated;
    if (typeof r.serialized === 'string') c.serialized = ref(r.serialized);
    c.seeded = [...(r.seeded ?? [])].sort();
    seen.set(key, c);
    counts[r.op] = (counts[r.op] ?? 0) + 1;
  }
}
writeFileSync(path.join(DIR, 'cases.jsonl'), [...seen.values()].map((c) => JSON.stringify(c)).join('\n') + '\n');
console.log(JSON.stringify({ cases: seen.size, byOp: counts }));
