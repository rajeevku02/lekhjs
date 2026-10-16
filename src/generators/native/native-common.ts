// What the seven native generators share (port of C++ `CppShapeGenerator`'s members and the
// helpers at the top of `L/shapegen/CppShapeGenerator.cpp`). The C++ base class itself is merged
// into the registry's native factory (spec 02 §7.2); each TS generator implements `ShapeGenerator`
// directly and keeps these fields.
//
// Expression strings are built exactly as C++ built them, spaces included: `S(int...)` writes a
// space before every index (`" M 0 1"`), and a `number_t` goes through `std::stringstream`'s
// default `%g` with six significant digits (`formatG6`; `-0` stays `-0`). Arithmetic is in doubles
// where C++ used `float` (spec 04 §5.5); the parity tool compares numbers inside data strings with
// tolerance.
import { formatG6 } from '../../base';
import type { JsonObject, JsonValue, ShapeTemplate, TemplateParam } from '../../template';
import { EmbedInfo } from '../../template';
import { Style } from '../../style';
import { embedRefsOf } from '../wireframe-generator';

/** The members of C++ `CppShapeGenerator` a generator block carries. */
export type NativeFields = {
  readonly shape: string;
  text: string;
  readonly interpretText: boolean;
  /** Sorted and unique (a C++ `std::set`). */
  readonly embedRefs: readonly string[];
};

/** C++ `ShapeGenerator::getGenerator` for `type: "native"`: `text`, `interprettext`, `embedrefs`. */
export function nativeFieldsOf(shape: string, gen: JsonObject): NativeFields {
  const text = gen['text'];
  return {
    shape,
    text: typeof text === 'string' ? text : '',
    interpretText: gen['interprettext'] === true,
    embedRefs: embedRefsOf(gen),
  };
}

/** C++ `serializeGenerator` for a native generator: `{type, shape, text, interprettext[, embedrefs]}`. */
export function nativeJson(f: NativeFields): JsonObject {
  const out: Record<string, JsonValue> = {
    type: 'native',
    shape: f.shape,
    text: f.text,
    interprettext: f.interpretText,
  };
  if (f.embedRefs.length > 0) out['embedrefs'] = f.embedRefs.slice();
  return out;
}

/** A frozen sorted unique list (C++ `std::set<std::string>`), empty strings dropped. */
export function refSet(...lists: readonly (readonly string[])[]): readonly string[] {
  const s = new Set<string>();
  for (const l of lists) for (const r of l) if (r !== '') s.add(r);
  return Object.freeze([...s].sort());
}

/** C++ `S(int)`. */
export function si(v: number): string {
  return String(v);
}

/** C++ `S(number_t)`: `std::stringstream` default formatting. */
export function sf(v: number): string {
  return formatG6(v);
}

/** C++ `S(std::vector<int>)`: each index after a space. */
export function sv(v: readonly number[]): string {
  let s = '';
  for (const i of v) s += ` ${String(i)}`;
  return s;
}

/** C++ `S(const std::string&, std::vector<int>)`: `" <cmd> a b ..."`. */
export function sc(cmd: string, v: readonly number[]): string {
  return ` ${cmd}${sv(v)}`;
}

/** The five location indices from `len` (`S({len, len+1, len+2, len+3, len+4})`). */
export function loc5(len: number): string {
  return sv([len, len + 1, len + 2, len + 3, len + 4]);
}

/** `std::map<std::string, TemplateParam*>` over the template's parameters: the last of a name wins. */
export function paramMap(t: ShapeTemplate): Map<string, TemplateParam> {
  const m = new Map<string, TemplateParam>();
  for (const p of t.params) m.set(p.name, p);
  return m;
}

/** C++ `JsonNode::boolVal()`: false for anything but a boolean `true`. */
export function boolVal(p: TemplateParam | undefined): boolean {
  return p?.value === true;
}

/** C++ `JsonNode::stringVal()`: empty for a non-string. */
export function stringVal(p: TemplateParam | undefined): string {
  return p?.stringValue() ?? '';
}

/**
 * C++ `JsonNode::intVal()`: the value of an INT node (a literal without `.` or exponent), 0 for
 * anything else. JSON numbers are doubles here, so an integral number reads as itself and any
 * other number as 0 (C++'s FLOAT node; a stored `3.0` is the one case read differently).
 */
export function intVal(p: TemplateParam | undefined): number {
  const v = p?.value;
  return typeof v === 'number' && Number.isInteger(v) ? v | 0 : 0;
}

/** C++ `EmbedInfo(name, "", location, "aspect", false, new Style(), Condition())`. */
export function aspectEmbed(name: string, location: string): EmbedInfo {
  return new EmbedInfo(name, '', location, 'aspect', false, new Style());
}

/** C++ `cornerRad`. */
export const CORNER_RADIUS = 10;

/**
 * C++ `makeRect(data, delta)`: appends a rounded rectangle's 33 data strings (inset by `delta`)
 * and returns its draw commands.
 */
export function makeRect(data: string[], delta: number): string {
  const rad = CORNER_RADIUS;
  let hw = 'w/2';
  let hh = 'h/2';
  let mhw = '-w/2';
  let mhh = '-h/2';
  if (delta !== 0) {
    hw = `(w/2-${sf(delta)})`;
    hh = `(h/2-${sf(delta)})`;
    mhw = `(-w/2+${sf(delta)})`;
    mhh = `(-h/2+${sf(delta)})`;
  }
  data.push(`min(${sf(rad)}, min(w/2, h/2))`);
  const len = data.length;
  const rs = `d(${si(len - 1)})`;
  data.push(
    `${mhw}+${rs}`,
    mhh,
    `${hw}-${rs}`,
    mhh,
    `${hw}-0.3*${rs}`,
    mhh,
    hw,
    `${mhh} + 0.3*${rs}`,
    hw,
    `${mhh} + ${rs}`,
    hw,
    `${hh}-${rs}`,
    hw,
    `${hh} - 0.3*${rs}`,
    `${hw} - 0.3*${rs}`,
    hh,
    `${hw}-${rs}`,
    hh,
    `${mhw} + ${rs}`,
    hh,
    `${mhw} + 0.3*${rs}`,
    hh,
    mhw,
    `${hh}-0.3*${rs}`,
    mhw,
    `${hh}-${rs}`,
    mhw,
    `${mhh} + ${rs}`,
    mhw,
    `${mhh}+0.3*${rs}`,
    `${mhw}+0.3*${rs}`,
    mhh,
  );
  const r = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => len + a + i);
  return (
    sc('M', [len, len + 1]) +
    sc('L', r(2, 3)) +
    sc('C', r(4, 9)) +
    sc('L', r(10, 11)) +
    sc('C', r(12, 17)) +
    sc('L', r(18, 19)) +
    sc('C', r(20, 25)) +
    sc('L', r(26, 27)) +
    sc('C', [len + 28, len + 29, len + 30, len + 31, len, len + 1]) +
    ' Z'
  );
}
