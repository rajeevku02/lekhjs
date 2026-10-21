// Normaliser `duplicate-key` (DR-ENG-02). Of a key the input board holds twice in one object,
// C++ JsonParser kept the FIRST value and lekhjs keeps the last (JSON.parse semantics). At any path
// below a top-level member (rule path `/*`): true when some object on the way down in the input
// held the next key twice, C++ wrote the first value there and TS the last; null otherwise (the
// next rule is tried), so no other difference is ever explained by it.
import { at } from '../diff.mjs';
import { FIRST_VALUES } from '../lenient-parse.mjs';
import { obj, sameValue } from './util.mjs';

export const name = 'duplicate-key';

/** @param {any} cpp @param {any} ts @param {any} input @param {string[]} [rest] */
export function equal(cpp, ts, input, rest = []) {
  if (input === undefined) return null;
  for (let j = 0; j < rest.length; j++) {
    const parent = obj(at(input, rest.slice(0, j)));
    const key = rest[j] ?? '';
    const first = parent === null ? undefined : /** @type {any} */ (parent)[FIRST_VALUES];
    if (!(first instanceof Map) || !first.has(key)) continue;
    const here = rest.slice(0, j + 1);
    return sameValue(at(cpp, here), first.get(key)) && sameValue(at(ts, here), parent?.[key]) ? true : null;
  }
  return null;
}
