// Normaliser `geometry-precision` (DR-ENG-26). C++ computes geometry in float32 (`number_t` is
// `float`, `lekhcore/src/base/TypeDefinitions.h`) and writes six significant digits; lekhjs
// computes in plain doubles (spec 03: "Plain doubles (no Math.fround)"). Where load derives geometry (group member rects from
// the stored factors, polygon centres, rotated members' angles), the two differ by the float32
// rounding of the coordinates involved and by the six-digit rounding of the stored operands: an
// error relative to the magnitude of the absolute coordinates, not to the result, so a member near
// its group's centre or a centre near 0 falls outside the value-relative tolerance of
// verification 02 §A.5 step 8. At a top-level object path, for a numeric
// `params/{cx,cy,width,height,angle}` leaf at any group depth: true when |a − b| ≤ 2·10⁻⁵ · S,
// where S is the sum of max(|cx|, |cy|) over the object chain (top-level object to the leaf's
// object, as C++ wrote it) plus the leaf object's max(width, height), or 2π for `angle`, whose
// difference is taken modulo 2π (a member angle comes from `atan2` of a near-zero float32
// difference, so the two engines can land on either side of its branch cut: -0.785405 against
// 5.49778, the same rotation); null for any other leaf and for a larger difference (another rule
// may explain it).
import { num, obj } from './util.mjs';

export const name = 'geometry-precision';

const LEAVES = new Set(['cx', 'cy', 'width', 'height', 'angle']);
const REL = 2e-5;
const TAU = 2 * Math.PI;

/** The params of each object on the `objects/<id>/object` chain under a top-level object. */
/** @param {any} top @param {string[]} chain @returns {any[] | null} */
function paramsChain(top, chain) {
  const out = [];
  let o = obj(top);
  out.push(obj(o?.['params']));
  for (let i = 0; i < chain.length; i += 3) {
    if (chain[i] !== 'objects' || chain[i + 2] !== 'object') return null;
    o = obj(obj(obj(o?.['objects'])?.[chain[i + 1] ?? ''])?.['object']);
    if (o === null) return null;
    out.push(obj(o['params']));
  }
  return out;
}

/** @param {any} cpp @param {any} ts @param {any} _input @param {string[]} [rest] */
export function equal(cpp, ts, _input, rest = []) {
  const n = rest.length;
  const leaf = rest[n - 1] ?? '';
  if (n < 2 || rest[n - 2] !== 'params' || !LEAVES.has(leaf) || (n - 2) % 3 !== 0) return null;
  const cs = paramsChain(cpp, rest.slice(0, n - 2));
  const ts_ = paramsChain(ts, rest.slice(0, n - 2));
  if (cs === null || ts_ === null) return null;
  const own = cs[cs.length - 1];
  const a = num(own?.[leaf]);
  const b = num(ts_[ts_.length - 1]?.[leaf]);
  if (a === null || b === null) return null;
  let s = 0;
  if (leaf === 'angle') s = 2 * Math.PI;
  else {
    for (const p of cs) s += Math.max(Math.abs(num(p?.['cx']) ?? 0), Math.abs(num(p?.['cy']) ?? 0));
    s += Math.max(Math.abs(num(own?.['width']) ?? 0), Math.abs(num(own?.['height']) ?? 0));
  }
  // An angle is a rotation: a member angle that `atan2` returns on the other side of its branch
  // cut (a near-zero float32 difference changes sign) is the same rotation 2π away.
  const d = leaf === 'angle' ? Math.abs(a - b - TAU * Math.round((a - b) / TAU)) : Math.abs(a - b);
  return d <= REL * s ? true : null;
}
