// `StyleSnapshot` of one `Style` (spec 05 §6.3): what `ViewState.style` carries for the current
// drawing style. The interaction layer merges several into a "mixed" selection snapshot.
import {
  FontStyle,
  FontWeight,
  PaintType,
  TextAlignHorizontal,
  TextAlignVertical,
  TextDecoration,
  type Paint,
  type Style,
} from '../style';
import type { OrNone, StyleSnapshot } from './ui';

function paintCss(p: Paint): OrNone<string> {
  return p.type === PaintType.NoPaint ? 'none' : p.solidColor.toCss();
}

function dashOf(style: Style): 'solid' | 'dash' | 'dot' {
  const d = style.effectiveDashArray();
  if (d.length === 0) return 'solid';
  const first = d[0] ?? 0;
  return first <= style.effectiveStrokeWidth() ? 'dot' : 'dash';
}

function alignOf(a: TextAlignHorizontal): 'left' | 'center' | 'right' {
  if (a === TextAlignHorizontal.Left) return 'left';
  if (a === TextAlignHorizontal.Right) return 'right';
  return 'center';
}

function valignOf(a: TextAlignVertical): 'top' | 'center' | 'bottom' {
  if (a === TextAlignVertical.Top) return 'top';
  if (a === TextAlignVertical.Bottom) return 'bottom';
  return 'center';
}

export function styleSnapshotOf(style: Style): StyleSnapshot {
  const deco = style.effectiveTextDecoration();
  const stroke = paintCss(style.effectiveStrokePaint());
  return Object.freeze({
    stroke: Object.freeze({
      color: stroke === 'none' ? 'transparent' : stroke,
      width: style.effectiveStrokeWidth(),
      dash: dashOf(style),
      dashArray: Object.freeze(style.effectiveDashArray().slice()),
    }),
    fill: Object.freeze({ color: paintCss(style.effectiveFillPaint()) }),
    text: Object.freeze({
      family: style.effectiveFontFamily(),
      size: style.effectiveFontSize(),
      bold: style.effectiveFontWeight() === FontWeight.Bold,
      italic: style.effectiveFontStyle() === FontStyle.Italic || style.effectiveFontStyle() === FontStyle.Oblique,
      underline: (deco & TextDecoration.UnderLine) !== 0,
      strike: (deco & TextDecoration.StrikeThrough) !== 0,
      // The colour text is drawn with (`Canvas2DDrawingPlatform`: the text fill; C++ `setFontColor`).
      color: style.effectiveTextFill().solidColor.toCss(),
      align: alignOf(style.effectiveTextAlignHorizontal()),
      verticalAlign: valignOf(style.effectiveTextAlignVertical()),
    }),
  });
}
