// Typed reads of parsed JSON, with the C++ `JsonNode::getField` contracts (`L/document/JsonNode.cpp`),
// and the key order every C++ map iteration had.
//
// What is kept from C++ and what is not (spec 03 §10.1):
//   - a field of the wrong JSON type reads as absent, as `getField` returned false;
//   - an integer field accepts any integer-valued number: `2.0` reads as 2 (C++: absent,
//     DR-ENG-03) and integers are not truncated to 32 bits (C++ `atoi`, B13, DR-ENG-04);
//   - colours alone keep signed 32-bit semantics (`value | 0`);
//   - object keys are visited in UTF-8 byte order, as `std::map<std::string, …>` iterated them.
//     `JSON.parse` keeps insertion order except that it puts integer-like keys first, so every
//     member walk that C++ did over a map goes through `byteOrderKeys`.
import { isJsonObject, type JsonObject, type JsonValue } from '../../template';

/** `a` before `b` in UTF-8 byte order (= code point order), as `std::string::compare`. */
export function compareUtf8(a: string, b: string): number {
  if (a === b) return 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(i);
    if (ca === cb) continue;
    // A surrogate (an astral code point) sorts after every BMP code point, as its UTF-8 form does.
    const sa = ca >= 0xd800 && ca <= 0xdfff;
    const sb = cb >= 0xd800 && cb <= 0xdfff;
    if (sa !== sb) return sa ? 1 : -1;
    return ca < cb ? -1 : 1;
  }
  return a.length - b.length;
}

/** The keys of `o` in UTF-8 byte order (C++ `std::map` iteration). */
export function byteOrderKeys(o: JsonObject): string[] {
  return Object.keys(o).sort(compareUtf8);
}

/** The value of member `key`, or `undefined` when there is no such member. */
export function member(o: JsonValue | undefined, key: string): JsonValue | undefined {
  if (!isJsonObject(o)) return undefined;
  return Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined;
}

export function hasMember(o: JsonValue | undefined, key: string): boolean {
  return isJsonObject(o) && Object.prototype.hasOwnProperty.call(o, key);
}

/** C++ `getField(name, float*)`: an int or a float. */
export function numField(o: JsonValue | undefined, key: string): number | undefined {
  const v = member(o, key);
  return typeof v === 'number' ? v : undefined;
}

/** C++ `getField(name, int*)` / `(long*)`: an integer-valued number (DR-ENG-03, -04). */
export function intField(o: JsonValue | undefined, key: string): number | undefined {
  const v = member(o, key);
  return typeof v === 'number' && Number.isInteger(v) ? v : undefined;
}

/** A colour member: an integer read with signed 32-bit semantics (spec 03 §10.1). */
export function colorField(o: JsonValue | undefined, key: string): number | undefined {
  const v = intField(o, key);
  return v === undefined ? undefined : v | 0;
}

export function strField(o: JsonValue | undefined, key: string): string | undefined {
  const v = member(o, key);
  return typeof v === 'string' ? v : undefined;
}

export function boolField(o: JsonValue | undefined, key: string): boolean | undefined {
  const v = member(o, key);
  return typeof v === 'boolean' ? v : undefined;
}

export function objField(o: JsonValue | undefined, key: string): JsonObject | undefined {
  const v = member(o, key);
  return isJsonObject(v) ? v : undefined;
}

export function arrField(o: JsonValue | undefined, key: string): readonly JsonValue[] | undefined {
  const v = member(o, key);
  return Array.isArray(v) ? (v as readonly JsonValue[]) : undefined;
}

/**
 * C++ `getMember(key)->listVal()`: the elements of an array member; any other member (or none)
 * has no elements.
 */
export function listOf(o: JsonValue | undefined, key: string): readonly JsonValue[] {
  return arrField(o, key) ?? [];
}

/** C++ `JsonNode::stringVal()` of a list element: '' unless it is a string. */
export function stringVal(v: JsonValue | undefined): string {
  return typeof v === 'string' ? v : '';
}

/** The members of an object value as `[key, value]` in UTF-8 byte order; none for a non-object. */
export function membersInByteOrder(o: JsonValue | undefined): [string, JsonValue][] {
  if (!isJsonObject(o)) return [];
  return byteOrderKeys(o).map((k) => [k, o[k] ?? null]);
}
