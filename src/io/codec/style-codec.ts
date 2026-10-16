// Style JSON ⇄ `Style` (port of C++ `JsonObjectSerializer::parseStyle`, `parsePaint`,
// `parseDrawingProfile`, `parseStyleOrDrawingProfile`, `serializeStyle` and `serializePaint`,
// `L/document/Serializer.cpp:598-610, 1037-1533`). Ported as is, including:
//   - a radial gradient is written with the *linear* gradient's spread (`Serializer.cpp:1082`);
//   - a pattern paint (type 5) or an unknown type reads as the default paint;
//   - a solid paint without a colour stops the paint read but the paint is still set;
//   - dash entries and the dash phase are truncated to integers;
//   - a `dasharray` or `nonoverridables` member that is not an array of the right items fails the
//     style read (`false`), which fails a document load only for the root style.
import {
  Color,
  Gradient,
  Paint,
  PaintType,
  type CapStyle,
  type FillRule,
  type FontStyle,
  type FontWeight,
  type GradientStop,
  type JoinStyle,
  type Style,
  type TextAlignHorizontal,
  type TextAlignVertical,
} from '../../style';
import { isJsonObject, type JsonObject, type JsonValue } from '../../template';
import {
  arrField,
  boolField,
  colorField,
  compareUtf8,
  intField,
  member,
  numField,
  objField,
  strField,
} from '../json/json-fields';

type Out = Record<string, JsonValue>;

/** C++ `parsePaint` into a fresh `Paint()` (no paint). */
export function parsePaint(node: JsonValue | undefined): Paint {
  const type = intField(node, 'type');
  if (type === undefined) return new Paint();
  if (type === PaintType.Default || type === PaintType.NoPaint) return new Paint({ type: type as PaintType });
  let paint = new Paint({ type: type as PaintType });
  const color = colorField(node, 'color');
  if (color !== undefined) paint = paint.with({ solidColor: Color.fromInt(color) });
  if (type === PaintType.Solid) {
    if (color === undefined) return paint;
  } else if (type === PaintType.LinearGradient) {
    const g = objField(node, 'lineargradient');
    if (g !== undefined)
      paint = paint.with({ linearGradient: Gradient.linear(readGradient(g, ['x1', 'y1', 'x2', 'y2'])) });
  } else if (type === PaintType.RadialGradient) {
    const g = objField(node, 'radialgradient');
    if (g !== undefined) {
      paint = paint.with({ radialGradient: Gradient.radial(readGradient(g, ['cx', 'cy', 'r', 'fx', 'fy', 'fr'])) });
    }
  } else {
    paint = paint.with({ type: PaintType.Default });
  }
  const rule = intField(node, 'fillrule');
  return paint.with({ fillRule: (rule ?? 0) as FillRule });
}

function readGradient(g: JsonObject, coords: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of coords) {
    const v = numField(g, k);
    if (v !== undefined) out[k] = v;
  }
  const stops = arrField(g, 'stops');
  if (stops !== undefined) {
    const list: GradientStop[] = [];
    for (const s of stops) {
      list.push({ offset: numField(s, 'offset') ?? 0, color: Color.fromInt(colorField(s, 'color') ?? -16777216) });
    }
    out['stops'] = list;
  }
  const spread = intField(g, 'spread');
  if (spread !== undefined) out['spread'] = spread;
  return out;
}

/**
 * C++ `parseStyle(style, node, resetToDefault)`: each attribute set from `node`, or (when
 * `reset`) removed. False when `dasharray` or `nonoverridables` is malformed.
 */
export function parseStyle(style: Style, node: JsonValue | undefined, reset = true): boolean {
  const num = (k: string, set: (v: number) => void, remove: () => void) => {
    const v = numField(node, k);
    if (v !== undefined) set(v);
    else if (reset) remove();
  };
  const int = (k: string, set: (v: number) => void, remove: () => void) => {
    const v = intField(node, k);
    if (v !== undefined) set(v);
    else if (reset) remove();
  };
  const paint = (k: string, set: (p: Paint) => void, remove: () => void) => {
    const v = member(node, k);
    if (v !== undefined) set(parsePaint(v));
    else if (reset) remove();
  };
  const str = (k: string, set: (v: string) => void, remove: () => void) => {
    const v = strField(node, k);
    if (v !== undefined) set(v);
    else if (reset) remove();
  };
  num(
    'strokewidth',
    (v) => {
      style.setStrokeWidth(v);
    },
    () => {
      style.removeStrokeWidth();
    },
  );
  int(
    'joinstyle',
    (v) => {
      style.setJoinStyle(v as JoinStyle);
    },
    () => {
      style.removeJoinStyle();
    },
  );
  int(
    'capstyle',
    (v) => {
      style.setCapStyle(v as CapStyle);
    },
    () => {
      style.removeCapStyle();
    },
  );
  paint(
    'strokepaint',
    (p) => {
      style.setStrokePaint(p);
    },
    () => {
      style.removeStrokePaint();
    },
  );
  paint(
    'fillpaint',
    (p) => {
      style.setFillPaint(p);
    },
    () => {
      style.removeFillPaint();
    },
  );
  paint(
    'textstroke',
    (p) => {
      style.setTextStroke(p);
    },
    () => {
      style.removeTextStroke();
    },
  );
  paint(
    'textfill',
    (p) => {
      style.setTextFill(p);
    },
    () => {
      style.removeTextFill();
    },
  );
  int(
    'textalignhorizontal',
    (v) => {
      style.setTextAlignHorizontal(v as TextAlignHorizontal);
    },
    () => {
      style.removeTextAlignHorizontal();
    },
  );
  int(
    'textalignvertical',
    (v) => {
      style.setTextAlignVertical(v as TextAlignVertical);
    },
    () => {
      style.removeTextAlignVertical();
    },
  );
  int(
    'textdecoration',
    (v) => {
      style.setTextDecoration(v);
    },
    () => {
      style.removeTextDecoration();
    },
  );
  int(
    'fontweight',
    (v) => {
      style.setFontWeight(v as FontWeight);
    },
    () => {
      style.removeFontWeight();
    },
  );
  int(
    'fontstyle',
    (v) => {
      style.setFontStyle(v as FontStyle);
    },
    () => {
      style.removeFontStyle();
    },
  );
  num(
    'fontsize',
    (v) => {
      style.setFontSize(v);
    },
    () => {
      style.removeFontSize();
    },
  );
  str(
    'fontfamily',
    (v) => {
      style.setFontFamily(v);
    },
    () => {
      style.removeFontFamily();
    },
  );
  str(
    'fontmodifier',
    (v) => {
      style.setFontModifier(v);
    },
    () => {
      style.removeFontModifier();
    },
  );
  const disabled = boolField(node, 'disabled');
  if (disabled !== undefined) style.setDisabled(disabled ? 1 : 0);
  else if (reset) style.removeDisabled();
  num(
    'fontmultiplier',
    (v) => {
      style.setFontMultiplier(v);
    },
    () => {
      style.removeFontMultiplier();
    },
  );
  num(
    'textpadding',
    (v) => {
      style.setTextPadding(v);
    },
    () => {
      style.removeTextPadding();
    },
  );

  const darr = member(node, 'dasharray');
  if (darr !== undefined) {
    if (!Array.isArray(darr)) return false;
    const dash: number[] = [];
    for (const item of (darr as readonly JsonValue[]).slice(0, 4)) {
      if (typeof item !== 'number') return false;
      dash.push(Math.trunc(item));
    }
    style.setDashArray(dash);
    const phase = numField(node, 'dashpatternphase');
    if (phase !== undefined) style.setDashPatternPhase(Math.trunc(phase));
  }
  const arr = member(node, 'nonoverridables');
  if (arr !== undefined) {
    if (!Array.isArray(arr)) return false;
    for (const item of arr as readonly JsonValue[]) {
      if (typeof item !== 'string') return false;
      style.addNonOverridables(item);
    }
  }
  return true;
}

/** C++ `parseDrawingProfile(dp, fld, parent)`: the pre-`style` form. */
export function parseDrawingProfile(dp: Style, fld: string, parent: JsonValue | undefined): boolean {
  const node = member(parent, fld);
  if (node === undefined) return true;
  const width = numField(node, 'width');
  if (width !== undefined) dp.setStrokeWidth(width);
  else dp.removeStrokeWidth();

  const color = colorField(node, 'color');
  if (color !== undefined) {
    dp.setStrokePaint(dp.effectiveStrokePaint().with({ solidColor: Color.fromInt(color), type: PaintType.Solid }));
  } else {
    dp.removeStrokePaint();
  }

  const fill = colorField(node, 'fillcolor');
  const fp = dp.effectiveFillPaint();
  dp.setFillPaint(
    fill !== undefined
      ? fp.with({ type: PaintType.Solid, solidColor: Color.fromInt(fill) })
      : fp.with({ type: PaintType.NoPaint }),
  );

  const font = objField(node, 'font');
  if (font !== undefined) {
    const size = numField(font, 'size');
    if (size !== undefined) dp.setFontSize(size);
    const fc = colorField(font, 'color');
    if (fc !== undefined) dp.setFontColor(Color.fromInt(fc));
    const family = strField(font, 'family');
    if (family !== undefined) dp.setFontFamily(family);
    const mods = strField(font, 'modifiers');
    if (mods !== undefined) dp.setFontModifier(mods);
  }

  const dash = member(node, 'dash');
  if (dash !== undefined) {
    const phase = intField(dash, 'phase');
    if (phase !== undefined) dp.setDashPatternPhase(phase);
    const da = dp.effectiveDashArray().slice();
    const pattern = member(dash, 'pattern');
    if (!Array.isArray(pattern)) return false;
    for (const item of (pattern as readonly JsonValue[]).slice(0, 4)) {
      if (typeof item !== 'number') return false;
      da.push(item);
    }
    dp.setDashArray(da);
  }
  return true;
}

/** C++ `parseStyleOrDrawingProfile`: `curdrawingprofile`, else `drawingprofile`, else `style`. */
export function parseStyleOrDrawingProfile(parent: JsonValue | undefined, style: Style): boolean {
  if (member(parent, 'curdrawingprofile') !== undefined) return parseDrawingProfile(style, 'curdrawingprofile', parent);
  if (member(parent, 'drawingprofile') !== undefined) return parseDrawingProfile(style, 'drawingprofile', parent);
  const node = member(parent, 'style');
  if (node !== undefined) return parseStyle(style, node);
  return true;
}

/** C++ `serializePaint`. */
export function serializePaint(paint: Paint): JsonObject {
  const node: Out = { type: paint.type };
  if (paint.type === PaintType.Default || paint.type === PaintType.NoPaint) return node;
  node['color'] = paint.solidColor.toInt();
  const stops = (list: readonly GradientStop[]) => list.map((s) => ({ offset: s.offset, color: s.color.toInt() }));
  if (paint.type === PaintType.LinearGradient) {
    const g = paint.linearGradient;
    node['lineargradient'] = { x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, stops: stops(g.stops), spread: g.spread };
  } else if (paint.type === PaintType.RadialGradient) {
    const g = paint.radialGradient;
    node['radialgradient'] = {
      cx: g.cx,
      cy: g.cy,
      r: g.r,
      fx: g.fx,
      fy: g.fy,
      fr: g.fr,
      stops: stops(g.stops),
      // As C++: the linear gradient's spread.
      spread: paint.linearGradient.spread,
    };
  }
  if (paint.fillRule !== 0) node['fillrule'] = paint.fillRule;
  return node;
}

/** C++ `serializeStyle(style, includeDefault)`: the defined attributes, as effective values. */
export function serializeStyle(style: Style, includeDefault = false): JsonObject {
  const d = includeDefault;
  const node: Out = {};
  if (style.isStrokeWidthDefined() || d) node['strokewidth'] = style.effectiveStrokeWidth();
  if (style.isJoinStyleDefined() || d) node['joinstyle'] = style.effectiveJoinStyle();
  if (style.isCapStyleDefined() || d) node['capstyle'] = style.effectiveCapStyle();
  if (style.isStrokePaintDefined() || d) node['strokepaint'] = serializePaint(style.effectiveStrokePaint());
  if (style.isFillPaintDefined() || d) node['fillpaint'] = serializePaint(style.effectiveFillPaint());
  if (style.isTextStrokeDefined() || d) node['textstroke'] = serializePaint(style.effectiveTextStroke());
  if (style.isTextFillDefined() || d) node['textfill'] = serializePaint(style.effectiveTextFill());
  if (style.isTextAlignHorizontalDefined() || d) node['textalignhorizontal'] = style.effectiveTextAlignHorizontal();
  if (style.isTextAlignVerticalDefined() || d) node['textalignvertical'] = style.effectiveTextAlignVertical();
  if (style.isTextDecorationDefined() || d) node['textdecoration'] = style.effectiveTextDecoration();
  if (style.isFontWeightDefined() || d) node['fontweight'] = style.effectiveFontWeight();
  if (style.isFontStyleDefined() || d) node['fontstyle'] = style.effectiveFontStyle();
  if (style.isFontSizeDefined() || d) node['fontsize'] = style.effectiveFontSize();
  if (style.isFontFamilyDefined() || d) node['fontfamily'] = style.effectiveFontFamily();
  if (style.isFontModifierDefined() || d) node['fontmodifier'] = style.effectiveFontModifier();
  if (style.isDisabledDefined() || d) node['disabled'] = style.effectiveDisabled();
  if (style.isFontMultiplierDefined() || d) node['fontmultiplier'] = style.effectiveFontMultiplier();
  if (style.isTextPaddingDefined() || d) node['textpadding'] = style.effectiveTextPadding();
  if (style.isDashArrayDefined() || d) {
    node['dasharray'] = style.effectiveDashArray().slice();
    if (style.isDashPatternPhaseDefined() || d) node['dashpatternphase'] = style.effectiveDashPatternPhase();
  }
  if (style.nonOverridables().size > 0 || d) {
    // A C++ std::set: sorted.
    node['nonoverridables'] = [...style.nonOverridables()].sort(compareUtf8);
  }
  return node;
}

/** C++ `serializeStyleIfNeeded`: `parent.style` unless the style defines nothing. */
export function serializeStyleIfNeeded(parent: Out, style: Style): void {
  const node = serializeStyle(style);
  if (Object.keys(node).length > 0) parent['style'] = node;
}

/** A style member's node, or `{}` for a non-object (C++ read every field of it as absent). */
export function styleNode(v: JsonValue | undefined): JsonObject {
  return isJsonObject(v) ? v : {};
}
