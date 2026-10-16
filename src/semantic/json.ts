// The JSON the semantic layer reads and writes (port of the `JsonNode` accessors the C++
// `semantic/` files use). Options, batches and content arrive as plain JSON values and answers
// leave as plain JSON values (spec 01 §4.3: "object in, object out").
//
// C++ `JsonNode` tells INT from FLOAT; a parsed JS value cannot. Where the C++ insists on an INT
// (`getField(long*)`, `type() == INT`), lekhjs accepts an integral number: `5.0` in the JSON text
// therefore reads as 5 here where the C++ refused it (decision of task B1, recorded in its summary).
import { formatG6 } from '../base';
import { isJsonObject, type JsonObject, type JsonValue } from '../template';

export { isJsonObject, type JsonObject, type JsonValue };

/** A JSON object under construction (the C++ `new JsonNode(JsonNode::OBJECT)` + `addField`). */
export type JsonOut = { [key: string]: JsonValue };

/** C++ `JsonNode::Type`, by the name the refusals use. */
export type JsonKind = 'int' | 'float' | 'string' | 'object' | 'boolean' | 'array' | 'none';

/** The C++ type a value would have had (an integral number is `int`). */
export function jsonKind(v: JsonValue | undefined): JsonKind {
  if (v === undefined || v === null) return 'none';
  if (Array.isArray(v)) return 'array';
  switch (typeof v) {
    case 'number':
      return Number.isInteger(v) ? 'int' : 'float';
    case 'string':
      return 'string';
    case 'boolean':
      return 'boolean';
  }
  return 'object';
}

/** C++ `hasMember`. */
export function hasMember(node: JsonValue | undefined, name: string): boolean {
  return isJsonObject(node) && Object.prototype.hasOwnProperty.call(node, name);
}

/**
 * C++ `getMember`: `undefined` when the member is absent (C++ nullptr), `null` for a JSON `null`
 * (C++ a NONE node).
 */
export function member(node: JsonValue | undefined, name: string): JsonValue | undefined {
  if (!isJsonObject(node) || !Object.prototype.hasOwnProperty.call(node, name)) return undefined;
  return node[name];
}

/** C++ `getField(name, std::string*)`: the member when it is a string. */
export function stringOf(node: JsonValue | undefined, name: string): string | undefined {
  const v = member(node, name);
  return typeof v === 'string' ? v : undefined;
}

/** C++ `getField(name, float*)` / `floatOrIntVal`: the member when it is a number. */
export function numberOf(node: JsonValue | undefined, name: string): number | undefined {
  const v = member(node, name);
  return typeof v === 'number' ? v : undefined;
}

/** C++ `getField(name, long*)`: the member when it is an integral number. */
export function intOf(node: JsonValue | undefined, name: string): number | undefined {
  const v = member(node, name);
  return typeof v === 'number' && Number.isInteger(v) ? v : undefined;
}

/** C++ `getField(name, bool*)`: the member when it is a boolean. */
export function boolOf(node: JsonValue | undefined, name: string): boolean | undefined {
  const v = member(node, name);
  return typeof v === 'boolean' ? v : undefined;
}

/** C++ `floatOrIntVal` on a node: the value when it is a number. */
export function numberValue(v: JsonValue | undefined): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

/** The members of an object in C++ `std::map` order (byte order of the UTF-16 code units for ASCII keys). */
export function sortedKeys(node: JsonObject): string[] {
  return Object.keys(node).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * A number as the C++ answer carried it: a `float` written by `ostream <<` with six significant
 * digits (OQ-67: the semantic layer rounds the coordinates it reports, so agents see the numbers
 * today's float output gave them). `-0` reads back as 0.
 */
export function g6(value: number): number {
  if (!Number.isFinite(value)) return value;
  const n = Number(formatG6(Math.fround(value)));
  return n === 0 ? 0 : n;
}

/** A deep copy of a JSON value (C++ `JsonNode::clone`). */
export function cloneValue<T extends JsonValue>(v: T): T {
  return (v === null || typeof v !== 'object' ? v : structuredCloneJson(v)) as T;
}

function structuredCloneJson(v: JsonValue): JsonValue {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return (v as readonly JsonValue[]).map(structuredCloneJson);
  const out: JsonOut = {};
  for (const k of Object.keys(v)) out[k] = structuredCloneJson((v as JsonObject)[k] as JsonValue);
  return out;
}

/**
 * C++ `JsonNode::equals`: same type and value, objects member for member, arrays in order.
 * INT and FLOAT are different types in C++; here two equal numbers are equal.
 */
export function jsonEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as readonly JsonValue[];
    if (a.length !== bb.length) return false;
    for (let i = 0; i < a.length; i++) if (!jsonEqual(a[i] as JsonValue, bb[i])) return false;
    return true;
  }
  const ao = a as JsonObject;
  const bo = b as JsonObject;
  const ak = Object.keys(ao);
  if (ak.length !== Object.keys(bo).length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
    if (!jsonEqual(ao[k], bo[k])) return false;
  }
  return true;
}
