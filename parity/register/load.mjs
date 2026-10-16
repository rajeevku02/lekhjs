// Reads the difference register (verification 01 §9): one `DR-<AREA>-<NN>.yaml` per entry, in id
// order. Shared by register:check and the comparison tools, which apply the entries' rules.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const REGISTER_DIR = import.meta.dirname;
export const ENTRY_FILE = /^DR-[A-Z]+-\d+\.yaml$/;

/**
 * @typedef {object} RegisterEntry
 * @property {string} file
 * @property {Record<string, any>} data
 * @property {string[]} parseErrors
 */

/**
 * Every entry file of `dir`, sorted by name (= by id).
 * @param {string} [dir]
 * @returns {RegisterEntry[]}
 */
export function loadRegister(dir = REGISTER_DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((f) => {
      const text = readFileSync(path.join(dir, f), 'utf8');
      const doc = YAML.parseDocument(text, { uniqueKeys: true, prettyErrors: true });
      const parseErrors = [...doc.errors, ...doc.warnings].map((e) => e.message.split('\n')[0] ?? e.message);
      const data = /** @type {Record<string, any>} */ (doc.toJS() ?? {});
      return { file: f, data, parseErrors };
    });
}

/**
 * The entries whose rules the comparison applies (`accepted` and `proposed`, verification 02
 * §A.5 step 11; at a phase exit only `accepted`).
 * @param {RegisterEntry[]} entries
 * @param {{ acceptedOnly?: boolean }} [opts]
 */
export function activeEntries(entries, opts = {}) {
  return entries.filter((e) =>
    opts.acceptedOnly === true ? e.data['status'] === 'accepted' : ['accepted', 'proposed'].includes(e.data['status']),
  );
}
