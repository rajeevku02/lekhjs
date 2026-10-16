// Normaliser `info-version` (verification 02 §A.5 step 3): `info.version` is replaced with `"<v>"`
// on both sides, and the TS stamp is checked on its own against spec 04's table:
//   pass `app`     → "5.0" always (AC-FMT-03);
//   pass `backend` → "5.0" iff the board held a Lua generator or gained a JS one, else the C++
//                    value ("4.2", or "4.3" with a title) (AC-FMT-04, AC-BE-13).
import { isObj } from '../lenient-parse.mjs';

export const name = 'info-version';
export const PLACEHOLDER = '<v>';

/**
 * Replaces `info.version` (in place) and returns what it was.
 * @param {import('../lenient-parse.mjs').LValue} tree
 * @returns {string | undefined}
 */
export function apply(tree) {
  if (!isObj(tree)) return undefined;
  const info = tree['info'];
  if (!isObj(info)) return undefined;
  const v = info['version'];
  info['version'] = PLACEHOLDER;
  return typeof v === 'string' ? v : v === undefined ? undefined : String(v);
}

/**
 * The stamp the TS output must carry.
 * @param {'app' | 'backend'} stamp
 * @param {{ cppVersion: string | undefined, generatorScripted: boolean }} c
 */
export function expectedTsVersion(stamp, c) {
  if (stamp === 'app') return '5.0';
  return c.generatorScripted ? '5.0' : c.cppVersion;
}
