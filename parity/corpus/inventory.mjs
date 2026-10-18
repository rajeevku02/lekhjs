// Step 6 of the corpus procedure (verification 02 §A.6): `corpus/inventory.json`, one entry per
// board idx with its size, object and page counts and feature flags, the input of the image
// sample (§B.4) and of the perf board sets (verification 03 §2). Reads the boards as kashi stores
// them (`corpus/out/kashi-form/boards/`, D2) and the manifest's group / provider / owner hash /
// updated_at. Everything stays under `corpus/`; stdout carries aggregate counts only.
//
//   node parity/corpus/inventory.mjs [<corpus dir>]       (default: <workspace_root>/corpus)
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const corpus = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, '..', '..', '..', 'corpus'));
const boardsDir = path.join(corpus, 'out', 'kashi-form', 'boards');

/** Feature flags of verification 02 §B.4 item 1 (plus the counts verification 03 §2 S-feat needs). */
export const FLAGS = Object.freeze([
  'images',
  'res_images',
  'inline_images',
  'multipage',
  'lua',
  'bpmn',
  'table',
  'native',
  'groups',
  'connector:0',
  'connector:1',
  'connector:2',
  'connector:3',
  'legacy',
  'title',
  'text',
  'multiline',
  'nonlatin',
  'cjk',
  'gradient',
  'dash',
  'rotated',
  'ink',
]);

/** Code-point ranges (inclusive). */
const CJK_RANGES = [
  [0x3040, 0x30ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xac00, 0xd7af],
  [0xf900, 0xfaff],
];
const LATIN_RANGES = [
  [0x0000, 0x024f],
  [0x1e00, 0x1eff],
  [0x2000, 0x206f],
  [0x20a0, 0x20cf],
  [0x2100, 0x214f],
  [0x2190, 0x23ff],
  [0x2500, 0x27bf],
];
/** @param {number} cp @param {number[][]} rs */
const inRanges = (cp, rs) => rs.some(([a, b]) => cp >= (a ?? 0) && cp <= (b ?? 0));
/** @param {string} s @param {(cp: number) => boolean} f */
const someChar = (s, f) => {
  for (const ch of s) if (f(ch.codePointAt(0) ?? 0)) return true;
  return false;
};

/** @param {any} v */
const values = (v) => (Array.isArray(v) ? v : v !== null && typeof v === 'object' ? Object.values(v) : []);

/**
 * @param {any} doc
 * @param {number} bytes
 */
export function inventoryOf(doc, bytes) {
  /** @type {Set<string>} */
  const flags = new Set();
  const c = { objects: 0, pages: 0, texts: 0, connectors: 0, ink_points: 0, lua: 0, res: 0 };
  /** @type {Set<string>} */
  const resids = new Set();
  if (Array.isArray(doc.pages)) flags.add('legacy');
  const pages = values(doc.pages);
  c.pages = pages.length;
  if (pages.length > 1) flags.add('multipage');
  if (typeof doc.info?.title === 'string' && doc.info.title !== '') flags.add('title');

  /** @param {any} s */
  const text = (s) => {
    if (typeof s !== 'string' || s === '') return;
    c.texts++;
    flags.add('text');
    if (s.includes('\n')) flags.add('multiline');
    if (someChar(s, (cp) => !inRanges(cp, LATIN_RANGES))) flags.add('nonlatin');
    if (someChar(s, (cp) => inRanges(cp, CJK_RANGES))) flags.add('cjk');
  };
  /** @param {any} st */
  const style = (st) => {
    if (st === null || typeof st !== 'object') return;
    for (const p of [st.fillpaint, st.strokepaint]) {
      if (p !== null && typeof p === 'object' && (p.stops !== undefined || p.type === 3 || p.type === 4))
        flags.add('gradient');
    }
    if (Array.isArray(st.dasharray) ? st.dasharray.length > 0 : st.dasharray !== undefined && st.dasharray !== '')
      flags.add('dash');
  };
  /** @param {any} o */
  const walk = (o) => {
    if (o === null || typeof o !== 'object') return;
    c.objects++;
    const type = String(o.type ?? '');
    if (type !== 'templated' && !type.startsWith('avabodh.basic.')) flags.add('legacy');
    if (type === 'avabodh.basic.unrecognized') {
      flags.add('ink');
      c.ink_points += values(o.points).length;
    }
    if (type === 'avabodh.basic.group') flags.add('groups');
    if (type === 'avabodh.basic.connection') {
      c.connectors++;
      flags.add(`connector:${Number(o.ctype ?? 0)}`);
    }
    const a = Number(o.params?.angle ?? 0);
    if (Number.isFinite(a) && Math.abs(a) > 1e-6) flags.add('rotated');
    style(o.style);
    text(o.text);
    if (typeof o.texts === 'string') {
      flags.add('legacy');
      text(o.texts);
    }
    for (const t of values(o.texts)) text(t?.text);
    const t = o.template;
    if (t !== null && typeof t === 'object') {
      style(t.style);
      for (const x of values(t.texts)) text(x?.text);
      for (const im of values(t.images)) {
        const src = String(im?.src ?? '');
        flags.add('images');
        if (src.startsWith('res://')) {
          flags.add('res_images');
          resids.add(src.slice(6));
        } else flags.add('inline_images');
      }
      const g = t.generator;
      if (g !== null && typeof g === 'object') {
        text(g.text);
        if (g.type === 'native') {
          flags.add('native');
          const shape = String(g.shape ?? '');
          if (shape.startsWith('bpmn')) flags.add('bpmn');
          if (shape === 'table-v1') flags.add('table');
        } else if (typeof g.script === 'string' || typeof g.scriptfile === 'string') {
          flags.add('lua');
          c.lua++;
        }
      }
    }
    for (const child of values(o.objects)) walk(child);
  };
  for (const p of pages) {
    if (Array.isArray(p?.objects)) flags.add('legacy');
    for (const o of values(p?.objects)) walk(o);
  }
  c.res = resids.size;
  return { bytes, ...c, flags: FLAGS.filter((f) => flags.has(f)), resids: [...resids] };
}

function main() {
  const manifest = readFileSync(path.join(corpus, 'manifest.jsonl'), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));
  /** @type {Record<string, any>} */
  const inv = {};
  const counts = { boards: 0, parse_fail: 0, missing: 0 };
  /** @type {Record<string, number>} */
  const flagCounts = {};
  for (const row of manifest) {
    const file = path.join(boardsDir, `${row.idx}.lekh`);
    if (!existsSync(file)) {
      counts.missing++;
      continue;
    }
    const bytes = statSync(file).size;
    let doc;
    try {
      doc = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      counts.parse_fail++;
      inv[row.idx] = { bytes, parse_fail: true, group: row.group, provider: row.provider };
      continue;
    }
    const e = inventoryOf(doc, bytes);
    inv[row.idx] = {
      group: row.group,
      provider: row.provider,
      owner_hash: row.owner_hash,
      updated_at: row.updated_at ?? null,
      ...e,
    };
    counts.boards++;
    for (const f of e.flags) flagCounts[f] = (flagCounts[f] ?? 0) + 1;
  }
  writeFileSync(path.join(corpus, 'inventory.json'), JSON.stringify(inv));
  const res = new Set(Object.values(inv).flatMap((e) => e.resids ?? []));
  process.stdout.write(JSON.stringify({ ...counts, distinct_res: res.size, flags: flagCounts }, null, 1) + '\n');
}

if (process.argv[1] === import.meta.filename) main();
