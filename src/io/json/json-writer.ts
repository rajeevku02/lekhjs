// The JSON text of a document or an object (spec 03 §10.2). `JSON.stringify` semantics with two
// deterministic choices:
//   - keys in UTF-8 byte order within each object (OQ-15: alphabetical, as the C++ `std::map`
//     wrote them, so diffs against C++ output stay small). `JSON.stringify` alone would put
//     integer-like keys (legacy integer ids) first;
//   - non-finite numbers (`NaN`, `±Infinity`) are written as 0 and counted (DR-ENG-06; C++ wrote
//     `nan`/`inf`, which is not JSON).
// Every key and string is escaped by `JSON.stringify` (DR-ENG-07: C++ wrote keys unescaped).
import type { JsonValue } from '../../template';
import { byteOrderKeys } from './json-fields';

export interface JsonTextStats {
  /** Non-finite numbers written as 0. */
  nonFinite: number;
}

function write(v: JsonValue | undefined, out: string[], stats: JsonTextStats): void {
  if (v === null || v === undefined) {
    out.push('null');
    return;
  }
  switch (typeof v) {
    case 'number':
      if (Number.isFinite(v)) out.push(JSON.stringify(v));
      else {
        stats.nonFinite++;
        out.push('0');
      }
      return;
    case 'string':
      out.push(JSON.stringify(v));
      return;
    case 'boolean':
      out.push(v ? 'true' : 'false');
      return;
  }
  if (Array.isArray(v)) {
    out.push('[');
    const a = v as readonly JsonValue[];
    for (let i = 0; i < a.length; i++) {
      if (i > 0) out.push(',');
      write(a[i], out, stats);
    }
    out.push(']');
    return;
  }
  out.push('{');
  let first = true;
  const o = v as Readonly<Record<string, JsonValue>>;
  for (const k of byteOrderKeys(o)) {
    const item = o[k];
    if (item === undefined) continue;
    if (!first) out.push(',');
    first = false;
    out.push(JSON.stringify(k), ':');
    write(item, out, stats);
  }
  out.push('}');
}

/** `value` as JSON text, keys sorted, non-finite numbers as 0 (counted in `stats`). */
export function writeJsonText(value: JsonValue, stats: JsonTextStats = { nonFinite: 0 }): string {
  const out: string[] = [];
  write(value, out, stats);
  return out.join('');
}
