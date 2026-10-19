// Normaliser `draw-restyle` (DR-ENG-29). A C++ draw of a connector writes into the stored model:
// `ConnectionObject::draw` calls `drawingProfile.setNoFill()` (the connector's style gains
// `fillpaint: {type: 1}`), and `IArrowObject::drawArrows` restyles the stored arrowhead templates
// from the connector's effective style (stroke paint and width, no dash, a filled head filled with
// the stroke colour shown over white). So a board saved after a C++ draw carries these, and one
// saved without a draw (the Node oracle, P1) does not. lekhjs restyles a drawn copy and never
// changes serialized state on layout or paint (AC-BE-08; model/arrow-heads.ts, connection-object.ts).
// Only outputs of a drawing C++ build show it: the browser oracle (`loadDoc` draws once).
//
// At a connector object's path (top level or a group member's `object`), for differences under
// `style` or `arrows/<end>/style` only:
// - `style`: true when C++ has `fillpaint {type: 1}`, TS has no fill paint, the input had none, and
//   the rest of the style is equal;
// - `arrows/<end>/style`: true when TS kept the stored arrowhead style and the C++ one is the stored
//   style restyled from the C++ connector style as `drawArrows` does it.
// Null anywhere else (the next rule is tried); false when the shape matches but a value does not.
import { LNum } from '../lenient-parse.mjs';
import { num, obj, sameValue } from './util.mjs';

export const name = 'draw-restyle';

const CONNECTION = 'avabodh.basic.connection';
const BLACK = -16777216;

/** @param {import('./util.mjs').LObj | null} s @param {string} k */
function without(s, k) {
  /** @type {import('./util.mjs').LObj} */
  const out = {};
  for (const [key, v] of Object.entries(s ?? {})) if (key !== k) out[key] = v;
  return out;
}

/** The colour a stroke colour shows over white, opaque (C++ `drawArrows` setStyle). @param {number} argb */
export function overWhite(argb) {
  const a = (argb >>> 24) & 255;
  const alpha = a / 255;
  const ch = (/** @type {number} */ shift) => {
    const c = (argb >>> shift) & 255;
    return Math.trunc(255 + (c - 255) * alpha) & 255;
  };
  return (255 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0) | 0;
}

/**
 * Whether the C++ arrowhead style is the stored one restyled from the connector's style.
 * @param {import('./util.mjs').LObj | null} c   C++ arrowhead style
 * @param {import('./util.mjs').LObj | null} stored  the input's arrowhead style
 * @param {import('./util.mjs').LObj | null} conn    the C++ connector style
 */
function restyled(c, stored, conn) {
  const cs = c ?? {};
  const st = stored ?? {};
  const cn = conn ?? {};
  const keys = new Set([...Object.keys(cs), ...Object.keys(st)]);
  for (const k of keys) {
    if (k === 'strokepaint' || k === 'strokewidth') {
      // The connector's effective value; an undefined one (the default) is not written.
      if (cn[k] === undefined ? cs[k] !== undefined && !sameValue(cs[k], st[k]) : !sameValue(cs[k], cn[k]))
        return false;
    } else if (k === 'fillpaint') {
      if (st[k] === undefined) {
        if (cs[k] !== undefined) return false;
        continue;
      }
      const f = obj(cs[k]);
      const stroke = obj(cn['strokepaint']);
      const color = num(stroke?.['color']) ?? BLACK;
      if (f === null || num(f['type']) !== 2 || ((num(f['color']) ?? NaN) | 0) !== overWhite(color)) return false;
    } else if (k === 'dasharray' || k === 'dash') {
      if (cs[k] !== undefined) return false;
    } else if (!sameValue(cs[k], st[k])) return false;
  }
  return true;
}

/** @param {any} cpp @param {any} ts @param {any} input @param {string[]} [rest] */
export function equal(cpp, ts, input, rest = []) {
  const c = obj(cpp);
  const t = obj(ts);
  if (c === null || t === null || c['type'] !== CONNECTION || t['type'] !== CONNECTION) return null;
  const i = obj(input);
  if (rest[0] === 'style') {
    const cs = obj(c['style']);
    const ts_ = obj(t['style']);
    const is = obj(i?.['style']);
    const cf = obj(cs?.['fillpaint']);
    if (cf === null || !(cf['type'] instanceof LNum) || num(cf['type']) !== 1) return null;
    if (ts_?.['fillpaint'] !== undefined || is?.['fillpaint'] !== undefined) return null;
    return sameValue(without(cs, 'fillpaint'), without(ts_, 'fillpaint'));
  }
  if (rest[0] === 'arrows' && rest.length >= 3 && rest[2] === 'style') {
    const end = rest[1] ?? '';
    const key = end.replace(/^\[(\d+)\]$/, '$1');
    const pick = (/** @type {any} */ o) => {
      const a = o?.['arrows'];
      if (Array.isArray(a)) return obj(obj(a[Number(key)])?.['style']);
      return obj(obj(obj(a)?.[key])?.['style']);
    };
    const stored = pick(i);
    if (!sameValue(pick(t) ?? {}, stored ?? {})) return null;
    return restyled(pick(c), stored, obj(c['style']));
  }
  return null;
}
