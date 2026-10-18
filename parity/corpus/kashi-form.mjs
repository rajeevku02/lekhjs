// The corpus as kashi stores it (D2): `corpus/out/kashi-form/{manifest.jsonl,boards/}`, the input of
// the corpus JSON comparison. S3 boards are what kashi wrote (`logDocClose`: `JSON.stringify` of
// the DocumentDB document) and are linked unchanged. DocumentDB boards were saved by
// `fetch_docdb.py` through bson `json_util.dumps`, which escapes every non-ASCII character as
// `\uXXXX` (ensure_ascii) and writes doubles as `26.0`; neither is what kashi stores or serves, and
// the C++ reader refuses `\u` escapes (DR-ENG-01), so those boards are re-written here exactly as
// kashi would (`JSON.stringify(JSON.parse(text))`). Everything stays under `corpus/`; the script
// prints counts only.
//
//   node parity/corpus/kashi-form.mjs [<corpus dir>]       (default: <workspace_root>/corpus)
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const corpus = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, '..', '..', '..', 'corpus'));
const out = path.join(corpus, 'out', 'kashi-form');
mkdirSync(path.join(out, 'boards'), { recursive: true });
const rows = readFileSync(path.join(corpus, 'manifest.jsonl'), 'utf8')
  .split('\n')
  .filter((l) => l.trim() !== '');
const manifest = [];
const counts = { rewritten: 0, linked: 0, present: 0, missing: 0 };
for (const line of rows) {
  const idx = String(JSON.parse(line).idx);
  manifest.push(JSON.stringify({ idx }));
  const src = path.join(corpus, 'boards', `${idx}.lekh`);
  const dst = path.join(out, 'boards', `${idx}.lekh`);
  if (existsSync(dst)) {
    counts.present++;
    continue;
  }
  if (!existsSync(src)) {
    counts.missing++;
    continue;
  }
  const meta = JSON.parse(readFileSync(path.join(corpus, 'meta', `${idx}.json`), 'utf8'));
  if (meta.source === 'docdb') {
    writeFileSync(dst, JSON.stringify(JSON.parse(readFileSync(src, 'utf8'))));
    counts.rewritten++;
  } else {
    symlinkSync(src, dst);
    counts.linked++;
  }
}
writeFileSync(path.join(out, 'manifest.jsonl'), manifest.join('\n') + '\n');
process.stdout.write(JSON.stringify({ boards: manifest.length, ...counts }) + '\n');
