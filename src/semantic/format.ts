// The `lekh.semantic/1` vocabulary, in one place (port of C++ `semantic/SemanticFormat.{h,cpp}`).
//
// The shared half of `semantic/`: the key names, the value vocabularies and the two-way enum and
// colour conversions that both the projector (document → projection) and the delta compiler
// (projection → `changes{}` map) must agree on. Every translation this surface performs is exactly
// reversible (/backend/subsystems/mcp/semantic-format.md §2.2.1), so there is one table per
// translation and both directions read it.
//
// Every key is `snake_case`. Only the connector vocabulary (`ctype` → `edge_type`, `params` → a
// structured `route`) and the style vocabulary are renamed.
import type { TemplateDef } from '../template';
import { AutoType, CanvasSizeType, ConnectionType, Page, type PageSize } from '../model';
import {
  CapStyle,
  Color,
  FontStyle,
  FontWeight,
  JoinStyle,
  Length,
  PaintType,
  TextAlignHorizontal,
  TextAlignVertical,
  TextDecoration,
  Unit,
} from '../style';
import type { JsonOut } from './json';

/** The format tag every projection carries, and the version an agent matches on. */
export const FORMAT_NAME = 'lekh.semantic/1';

/**
 * How deep a group nesting this surface carries, counted from a top-level object at 0: the
 * projector emits a group's members while `depth < 5`. One constant for the projector, the
 * `group` operation and the whole-board generator.
 */
export const MAX_GROUP_DEPTH = 5;

// ---------------------------------------------------------------- keys

export const KEY = Object.freeze({
  // envelope
  docid: 'docid',
  name: 'name',
  version: 'version',
  format: 'format',
  grid: 'grid',
  present: 'present',
  scaling: 'scaling',
  scale: 'scale',
  pages: 'pages',
  truncated: 'truncated',
  notes: 'notes',

  // page
  id: 'id',
  order: 'order',
  canvas: 'canvas',
  type: 'type',
  unit: 'unit',
  margin: 'margin',
  leftRight: 'left_right',
  topBottom: 'top_bottom',
  background: 'background',
  color: 'color',
  image: 'image',
  bounds: 'bounds',
  minx: 'minx',
  miny: 'miny',
  maxx: 'maxx',
  maxy: 'maxy',
  strokes: 'freehand',
  depthOmitted: 'depth_omitted',
  nodes: 'nodes',
  edges: 'edges',

  // node
  kind: 'kind',
  shape: 'shape',
  shapeName: 'shape_name',
  cx: 'cx',
  cy: 'cy',
  width: 'width',
  height: 'height',
  angle: 'angle',
  zOrder: 'z_order',
  texts: 'texts',
  text: 'text',
  title: 'title',
  side: 'side',
  row: 'row',
  col: 'col',
  generated: 'generated',
  interpretText: 'interpret_text',
  templateParams: 'template_params',
  arrow: 'arrow',
  start: 'start',
  end: 'end',
  parent: 'parent',
  children: 'children',
  editable: 'editable',
  res: 'res',
  style: 'style',
  draw: 'draw',
  path: 'path',

  // edge
  from: 'from',
  to: 'to',
  edgeType: 'edge_type',
  autoType: 'auto_type',
  route: 'route',
  /** The fraction along the route, 0 to 1 (stored `param`). */
  position: 'position',
  /** A U-bend's run-out in points (the stored first `step` of a `u_bend_*` edge). */
  reach: 'reach',
  /** A self-loop's exit side (write only). */
  fromSide: 'from_side',
  /** A self-loop's entry side (write only). */
  toSide: 'to_side',
  /** An opposite-side self-loop's bend (write only). */
  bend: 'bend',

  // route
  segments: 'segments',
  points: 'points',
  length: 'length',
  dx: 'dx',
  dy: 'dy',
  controlDistance: 'control_distance',
  angleAuto: 'angle_auto',
  controlDistanceAuto: 'control_distance_auto',
  controlIn: 'control_in',
  controlOut: 'control_out',
  /** NOT renamed: carried under its stored name so the translation stays lossless. */
  angle2: 'angle2',
} as const);

// ---------------------------------------------------------------- values

export const KIND = Object.freeze({
  shape: 'shape',
  text: 'text',
  image: 'image',
  group: 'group',
  other: 'other',
  /** A stroke inside a group: id and box only. */
  freehand: 'freehand',
} as const);

/** The one semantic id of a shape whose drawing is its own (`avabodh.basic.polygon`, `.curve`, `.path`, an edited polygon). */
export const PATH_SHAPE_ID = 'lekh.semantic.path';

/** The commands a `draw` entry may hold — `M L C Z`, absolute only — and each one's argument count; −1 for any other letter. */
export function pathCommandArity(command: string): number {
  switch (command) {
    case 'M':
      return 2;
    case 'L':
      return 2;
    case 'C':
      return 6;
    case 'Z':
      return 0;
  }
  return -1;
}

export const CANVAS = Object.freeze({
  autoSize: 'auto',
  fixed: 'fixed',
  infinite: 'infinite',
  point: 'point',
  inch: 'inch',
  cm: 'cm',
} as const);

// ---------------------------------------------------------------- units

/** The refusal for a `fixed` canvas without a positive width and height. */
export const FIXED_CANVAS_NEEDS_SIZE = 'a "fixed" canvas needs a positive width and height';

/** The refusal for a size given to an `auto` or `infinite` canvas. */
export function noSizeMessage(type: CanvasSizeType): string {
  return `an ${Page.sizeTypeToStr(type)} canvas has no size; send canvas_type "fixed" with a width and height`;
}

/** A unit word (`point`, `inch`, `cm`, exactly), or null. `pixel` is legacy: read, never written. */
export function unitFromName(name: string): Unit | null {
  if (name === CANVAS.point) return Unit.Point;
  if (name === CANVAS.inch) return Unit.Inch;
  if (name === CANVAS.cm) return Unit.Centimeter;
  return null;
}

export function unitMessage(value: string): string {
  return `unit is "${CANVAS.point}", "${CANVAS.inch}" or "${CANVAS.cm}", not "${value}"`;
}

// ---------------------------------------------------------------- margin

/** `{left_right, top_bottom, unit}` from a stored margin (its `width` and `height` are per-side insets). */
export function marginToSemantic(size: PageSize): JsonOut {
  return { [KEY.leftRight]: size.width, [KEY.topBottom]: size.height, [KEY.unit]: Length.unitStr(size.unit) };
}

/** The stored `{height, width, unit}` margin node. */
export function marginToStored(leftRight: number, topBottom: number, unit: Unit): JsonOut {
  return { height: topBottom, width: leftRight, unit: Length.unitStr(unit) };
}

// ---------------------------------------------------------------- canvas type

/** Exactly the three canvas words (no case folding, no trimming), or null. */
export function canvasTypeFromName(name: string): CanvasSizeType | null {
  if (name === CANVAS.infinite) return CanvasSizeType.Infinite;
  if (name === CANVAS.fixed) return CanvasSizeType.Fixed;
  if (name === CANVAS.autoSize) return CanvasSizeType.Auto;
  return null;
}

export function canvasTypeMessage(value: string): string {
  return `canvas type is "${CANVAS.infinite}", "${CANVAS.fixed}" or "${CANVAS.autoSize}", not "${value}"`;
}

// ---------------------------------------------------------------- edge type

/**
 * The stored `ctype` ordinals and their words. `orthogonal` for the engine's `MultiLine`: its
 * route is strictly axis-aligned, and "multiline" means text with line breaks everywhere else.
 */
const EDGE_TYPES: readonly (readonly [ConnectionType, string])[] = Object.freeze([
  [ConnectionType.Curve, 'curve'],
  [ConnectionType.GenericLine, 'line'],
  [ConnectionType.MultiLine, 'orthogonal'],
  [ConnectionType.Path, 'path'],
] as const);

/**
 * Ten words for the ten stored `autotype`s. Each says which direction each end leaves, never a
 * segment count. `manual` never appears in a read: it is the word written beside a `route`.
 */
const AUTO_TYPES: readonly (readonly [AutoType, string])[] = Object.freeze([
  [AutoType.NoAuto, 'manual'],
  [AutoType.AutoLine, 'straight'],
  [AutoType.Auto2LineA, 'elbow_horizontal_first'],
  [AutoType.Auto2LineB, 'elbow_vertical_first'],
  [AutoType.Auto3LineA, 's_bend_horizontal'],
  [AutoType.Auto3LineB, 's_bend_vertical'],
  [AutoType.Auto3LineC, 'u_bend_right'],
  [AutoType.Auto3LineD, 'u_bend_down'],
  [AutoType.Auto3LineCLeft, 'u_bend_left'],
  [AutoType.Auto3LineDTop, 'u_bend_up'],
] as const);

export function edgeTypeName(type: ConnectionType): string {
  for (const [t, n] of EDGE_TYPES) if (t === type) return n;
  return '';
}

export function edgeTypeFromName(name: string): ConnectionType | null {
  for (const [t, n] of EDGE_TYPES) if (n === name) return t;
  return null;
}

/** Names the value and lists the current words, read off the table the lookup walks. */
export function edgeTypeMessage(value: string): string {
  return `unknown edge_type "${value}": one of ${EDGE_TYPES.map(([, n]) => n).join(', ')}`;
}

export function autoTypeName(type: AutoType): string {
  for (const [t, n] of AUTO_TYPES) if (t === type) return n;
  return '';
}

export function autoTypeFromName(name: string): AutoType | null {
  for (const [t, n] of AUTO_TYPES) if (n === name) return t;
  return null;
}

export function autoTypeMessage(value: string): string {
  return `unknown auto_type "${value}": one of ${AUTO_TYPES.map(([, n]) => n).join(', ')}`;
}

/** The `u_bend_*` auto types (stored 6-9): their first and last `step` are an input (`reach`). */
export function isUBend(type: AutoType): boolean {
  return (
    type === AutoType.Auto3LineC ||
    type === AutoType.Auto3LineD ||
    type === AutoType.Auto3LineCLeft ||
    type === AutoType.Auto3LineDTop
  );
}

/** The line-type auto types (stored 2-9), whose first and last `step` a switch between them carries over. */
export function isLineAutoType(type: AutoType): boolean {
  return type >= AutoType.Auto2LineA && type <= AutoType.Auto3LineDTop;
}

// ---------------------------------------------------------------- arrowheads

/** The arrowhead registry (C++ `TemplateStore::arrows()`): every arrowhead in id order. */
export interface ArrowRegistry {
  arrowhead(id: string): TemplateDef | undefined;
  arrowheads(): readonly TemplateDef[];
}

function arrowName(def: TemplateDef): string {
  const n = def.json['name'];
  return typeof n === 'string' ? n : '';
}

/**
 * An arrowhead's catalogue name: the `name` field of the 26 templates in
 * `stencils/core/connection_arrows.json`, read off the registry (no table here). '' when the
 * registry does not carry the id.
 */
export function arrowNameFor(arrows: ArrowRegistry, id: string): string {
  const def = arrows.arrowhead(id);
  return def === undefined ? '' : arrowName(def);
}

/** The id of the arrowhead with this catalogue name, first in id order; '' for '' or an unknown name. */
export function arrowIdFor(arrows: ArrowRegistry, name: string): string {
  if (name === '') return '';
  for (const def of arrows.arrowheads()) if (arrowName(def) === name) return def.id;
  return '';
}

// ---------------------------------------------------------------- style

/**
 * The stored style attribute names, as the serializer writes them, paired with the semantic key
 * each becomes. An attribute with no row is neither projected nor settable (`textstroke`,
 * `textpadding`: nothing reads them).
 */
export const STYLE_KEYS: readonly (readonly [stored: string, semantic: string])[] = Object.freeze([
  ['strokewidth', 'stroke_width'],
  ['strokepaint', 'stroke'],
  ['fillpaint', 'fill'],
  ['textfill', 'text_color'],
  ['joinstyle', 'join_style'],
  ['capstyle', 'cap_style'],
  ['dasharray', 'dash_array'],
  ['dashpatternphase', 'dash_pattern_phase'],
  ['textalignhorizontal', 'text_align_horizontal'],
  ['textalignvertical', 'text_align_vertical'],
  ['textdecoration', 'text_decoration'],
  ['fontweight', 'font_weight'],
  ['fontstyle', 'font_style'],
  ['fontsize', 'font_size'],
  ['fontfamily', 'font_family'],
  ['fontmodifier', 'font_face'],
  ['fontmultiplier', 'font_size_scale'],
  ['disabled', 'disabled'],
] as const);

/** The semantic key of a stored style attribute, or null when it is not projected. */
export function semanticStyleKey(storedKey: string): string | null {
  for (const [s, k] of STYLE_KEYS) if (s === storedKey) return k;
  return null;
}

/** The stored attribute of a semantic style key, or null. */
export function storedStyleKey(semanticKey: string): string | null {
  for (const [s, k] of STYLE_KEYS) if (k === semanticKey) return s;
  return null;
}

const TEXT_STYLE_KEYS: readonly string[] = Object.freeze([
  'textfill',
  'textalignhorizontal',
  'textalignvertical',
  'textdecoration',
  'fontweight',
  'fontstyle',
  'fontsize',
  'fontfamily',
  'fontmodifier',
  'fontmultiplier',
]);

/** The text subset of `STYLE_KEYS`, by stored name: the keys a title's own style may pin. */
export function isTextStyleKey(storedKey: string): boolean {
  return TEXT_STYLE_KEYS.includes(storedKey);
}

/** Their semantic names, comma-separated, in `STYLE_KEYS` order. */
export function textStyleKeyList(): string {
  return STYLE_KEYS.filter(([s]) => isTextStyleKey(s))
    .map(([, k]) => k)
    .join(', ');
}

/** Names the key and lists the current ones, read off the table the lookup walks. */
export function styleKeyMessage(key: string): string {
  return `"${key}" is not a style attribute this surface carries: one of ${STYLE_KEYS.map(([, k]) => k).join(', ')}`;
}

// ---------------------------------------------------------------- what a kind draws

/**
 * Stored and inert (spec/04 §8, B.17): which style keys an object of each kind never draws, so the
 * compiler refuses the write instead of storing a value nothing reads.
 */
export const StyleTarget = Object.freeze({ Edge: 0, Image: 1, FloatingLabel: 2, Slotless: 3, Other: 4 } as const);
export type StyleTarget = (typeof StyleTarget)[keyof typeof StyleTarget];

/** null when `semanticKey` draws on `target`; otherwise the reason fragment the refusal quotes. */
export function inertStyleReason(target: StyleTarget, semanticKey: string): string | null {
  const among = (keys: readonly string[]): boolean => keys.includes(semanticKey);
  switch (target) {
    case StyleTarget.Edge:
      if (semanticKey === 'fill') return 'an edge draws no fill: its solid arrowheads take the stroke';
      if (among(['text_align_horizontal', 'text_align_vertical']))
        return "an edge's label box is sized to its text, so alignment moves nothing";
      return null;
    case StyleTarget.Image:
      return 'an image draws the picture only; no style key is drawn';
    case StyleTarget.FloatingLabel:
      if (among(['stroke', 'stroke_width', 'fill', 'dash_array', 'dash_pattern_phase', 'cap_style', 'join_style']))
        return 'a floating label draws text only';
      return null;
    case StyleTarget.Slotless:
      if (
        among([
          'text_color',
          'text_align_horizontal',
          'text_align_vertical',
          'text_decoration',
          'font_weight',
          'font_style',
          'font_size',
          'font_family',
          'font_face',
          'font_size_scale',
        ])
      )
        return 'this shape has no text slot';
      return null;
    case StyleTarget.Other:
      return null;
  }
  return null;
}

// ---------------------------------------------------------------- style enums

/**
 * A stored `Style` enum, as a word. The ordinals are `Style`'s and are stored; `…Default` is absent
 * from every table (it is the absence of a deviation).
 */
export type EnumPair = readonly [value: number, name: string];
export type EnumTable = readonly EnumPair[];

export const JOIN_STYLES: EnumTable = Object.freeze([
  [JoinStyle.Miter, 'miter'],
  [JoinStyle.Round, 'round'],
  [JoinStyle.Bevel, 'bevel'],
] as const);

export const CAP_STYLES: EnumTable = Object.freeze([
  [CapStyle.Butt, 'butt'],
  [CapStyle.Round, 'round'],
  [CapStyle.Square, 'square'],
] as const);

export const TEXT_ALIGN_HORIZONTALS: EnumTable = Object.freeze([
  [TextAlignHorizontal.Center, 'center'],
  [TextAlignHorizontal.Left, 'left'],
  [TextAlignHorizontal.Right, 'right'],
] as const);

export const TEXT_ALIGN_VERTICALS: EnumTable = Object.freeze([
  [TextAlignVertical.Center, 'center'],
  [TextAlignVertical.Top, 'top'],
  [TextAlignVertical.Bottom, 'bottom'],
] as const);

export const FONT_WEIGHTS: EnumTable = Object.freeze([
  [FontWeight.Normal, 'normal'],
  [FontWeight.Bold, 'bold'],
] as const);

export const FONT_STYLES: EnumTable = Object.freeze([
  [FontStyle.Normal, 'normal'],
  [FontStyle.Italic, 'italic'],
  [FontStyle.Oblique, 'oblique'],
] as const);

/** `TextDecoration` is a bit field, so it becomes a list of words; `…Normal` is the empty list. */
export const TEXT_DECORATIONS: EnumTable = Object.freeze([
  [TextDecoration.UnderLine, 'underline'],
  [TextDecoration.OverLine, 'overline'],
  [TextDecoration.StrikeThrough, 'strikethrough'],
] as const);

/** Only the paints that are not a colour (a solid paint is `#rrggbb`, a default or absent one "none"). */
export const PAINT_TYPES: EnumTable = Object.freeze([
  [PaintType.LinearGradient, 'linear_gradient'],
  [PaintType.RadialGradient, 'radial_gradient'],
  [PaintType.Pattern, 'pattern'],
] as const);

/** The word for `value`, or `fallback` when the table does not carry it. */
export function enumName(table: EnumTable, value: number, fallback: string): string {
  for (const [v, n] of table) if (v === value) return n;
  return fallback;
}

/** The value of a word, or null. */
export function enumValue(table: EnumTable, name: string): number | null {
  for (const [v, n] of table) if (n === name) return v;
  return null;
}

// ---------------------------------------------------------------- colour

function hex2(n: number): string {
  return (n & 0xff).toString(16).padStart(2, '0');
}

/** "#rrggbb", or "#rrggbbaa" when the alpha is not opaque. */
export function colorToHex(color: Color): string {
  const rgb = `#${hex2(color.red)}${hex2(color.green)}${hex2(color.blue)}`;
  return color.alpha === 0xff ? rgb : rgb + hex2(color.alpha);
}

function hexDigit(c: string): number {
  if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48;
  if (c >= 'a' && c <= 'f') return c.charCodeAt(0) - 87;
  if (c >= 'A' && c <= 'F') return c.charCodeAt(0) - 55;
  return -1;
}

function hexByte(s: string, at: number): number {
  const hi = hexDigit(s.charAt(at));
  const lo = hexDigit(s.charAt(at + 1));
  return hi < 0 || lo < 0 ? -1 : (hi << 4) | lo;
}

/** `#rgb`, `#rrggbb` or `#rrggbbaa` (any case) as a colour, or null. */
export function hexToColor(hex: string): Color | null {
  if (hex === '' || hex.charAt(0) !== '#') return null;
  let body = hex.slice(1);
  if (body.length === 3) {
    let expanded = '';
    for (let i = 0; i < 3; i++) expanded += body.charAt(i) + body.charAt(i);
    body = expanded;
  }
  if (body.length !== 6 && body.length !== 8) return null;
  const r = hexByte(body, 0);
  const g = hexByte(body, 2);
  const b = hexByte(body, 4);
  if (r < 0 || g < 0 || b < 0) return null;
  let a = 0xff;
  if (body.length === 8) {
    a = hexByte(body, 6);
    if (a < 0) return null;
  }
  return new Color(r, g, b, a);
}
