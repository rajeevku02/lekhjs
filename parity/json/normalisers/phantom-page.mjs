// Normaliser `phantom-page` (DR-FMT-01). A stored page that holds only `objects` (the old
// silent-empty-board bug) loads in C++ as a page with no name at order 0; lekhjs names it
// "Recovered", "Recovered 2", … and orders it after the real pages (spec 04 §9.1). At a page path,
// for the `name` and `order` members only: true when the input page held only `objects`, C++ wrote
// the empty name and order 0, and TS wrote a "Recovered" name and an integer order; null for any
// other page or member (the next rule is tried).
import { num, obj } from './util.mjs';

export const name = 'phantom-page';

const RECOVERED = /^Recovered(?: \d+)?$/;

/** @param {any} cpp @param {any} ts @param {any} input @param {string[]} [rest] */
export function equal(cpp, ts, input, rest = []) {
  if (rest.length !== 1 || (rest[0] !== 'name' && rest[0] !== 'order')) return null;
  const i = obj(input);
  if (i === null || Object.keys(i).join() !== 'objects') return null;
  const c = obj(cpp);
  const t = obj(ts);
  if (c === null || t === null) return false;
  if (rest[0] === 'name') return c['name'] === '' && typeof t['name'] === 'string' && RECOVERED.test(t['name']);
  const co = num(c['order']);
  const to = num(t['order']);
  return co === 0 && to !== null && Number.isInteger(to) && to >= 0;
}
