// The customer-content scanner (verification 01 §9.5 rule 3, AC-ROL-23; verification 02 §A.8):
// rejects UUIDs, 22-character short ids, e-mail addresses and `docid=` strings in register entries
// and run summaries, and `.lekh` fixture text outside the synthetic vocabulary
// (`parity/fixtures/VOCABULARY.txt`).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const UUID = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;
// flickrBase58, 22 characters, with a digit, a lower- and an upper-case letter (a real short id
// almost always has all three; an English word or identifier of that length has no digit).
const SHORT_ID = /(?<![0-9A-Za-z])[1-9A-HJ-NP-Za-km-z]{22}(?![0-9A-Za-z])/g;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const DOCID = /docid\s*[=:]\s*\S/gi;

/**
 * @param {string} text
 * @returns {{ kind: string, at: number }[]}
 */
export function scanText(text) {
  /** @type {{ kind: string, at: number }[]} */
  const out = [];
  for (const m of text.matchAll(UUID)) out.push({ kind: 'uuid', at: m.index });
  for (const m of text.matchAll(SHORT_ID)) {
    const s = m[0];
    if (/\d/.test(s) && /[a-z]/.test(s) && /[A-Z]/.test(s)) out.push({ kind: 'short_id', at: m.index });
  }
  for (const m of text.matchAll(EMAIL)) out.push({ kind: 'email', at: m.index });
  for (const m of text.matchAll(DOCID)) out.push({ kind: 'docid', at: m.index });
  return out;
}

export const VOCABULARY_FILE = path.resolve(import.meta.dirname, '..', 'fixtures', 'VOCABULARY.txt');

/** The synthetic vocabulary: one word per line, `#` comments; compared case-insensitively. */
export function loadVocabulary(file = VOCABULARY_FILE) {
  if (!existsSync(file)) return new Set();
  return new Set(
    readFileSync(file, 'utf8')
      .split('\n')
      .map((l) => l.replace(/#.*/, '').trim().toLowerCase())
      .filter((l) => l !== ''),
  );
}

/** Members of a board that hold user text. */
const TEXT_KEYS = new Set(['text', 'title', 'name', 'description', 'author', 'label', 'help']);

/**
 * The words of a `.lekh` fixture's user text that are not in the vocabulary.
 * @param {unknown} board  parsed JSON
 * @param {Set<string>} vocab
 * @returns {string[]}
 */
export function wordsOutsideVocabulary(board, vocab) {
  /** @type {Set<string>} */
  const bad = new Set();
  /** @param {unknown} v @param {string} key */
  const walk = (v, key) => {
    if (typeof v === 'string') {
      if (!TEXT_KEYS.has(key)) return;
      for (const w of v.toLowerCase().match(/\p{L}+/gu) ?? []) if (!vocab.has(w)) bad.add(w);
      return;
    }
    if (Array.isArray(v)) for (const x of v) walk(x, key);
    else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(board, '');
  return [...bad].sort();
}
