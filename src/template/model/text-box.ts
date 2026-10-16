// Placing a text block in a box (port of C++ `LekhUtil::getTextEditRect` and `LekhUtil::drawText`,
// `L/LekhUtil.cpp:304-381`, with `TextDrawParamInternal`). The measuring half becomes
// `layoutTextInBox`: the C++ measured, computed the text rect, and handed the rect to the host,
// which wrapped again at the rect's width; here the layout is done once at the measuring width
// (same lines by construction) and placed in the computed rect.
import { Point, Rect, Size } from '../../geometry';
import { TextAlignHorizontal, TextAlignVertical, type Style } from '../../style';
import type { LaidOutText, TextMeasureMemo, WrapMode } from '../../text';
import type { TemplateText } from '../env';

/** C++ `TextDrawParamInternal`. */
export interface TextBoxParam {
  readonly text: string;
  readonly angle: number;
  /** The box the text is centred in (C++ `inRect`). */
  readonly inRect: Rect;
  readonly pad?: number;
  readonly textSizeAdjustment?: number;
  /** `wrap` (C++ Wrap), `float` (Float) or `clip` (Clip). */
  readonly wrapMode?: WrapMode;
  readonly forEditing?: boolean;
}

/** C++ `getTextEditRect` given the measured `textSize` (before the size adjustment). */
export function textEditRect(param: TextBoxParam, style: Style, measured: Size, minTextEditWidth: number): Rect {
  const center = param.inRect.center();
  if (param.text === '') return Rect.fromCenter(center, 1, 1);
  const pad = param.pad ?? 0;
  const adj = param.textSizeAdjustment ?? 0;
  const mode = param.wrapMode ?? 'wrap';
  const availableWidth = param.inRect.width - pad * 2;
  const availableHeight = param.inRect.height - pad * 2;
  let tw = measured.width + adj;
  const th = measured.height + adj;
  const ah = style.effectiveTextAlignHorizontal();

  if (mode === 'float') {
    const width2 = param.forEditing === true && tw < minTextEditWidth ? minTextEditWidth : tw;
    let cx = center.x;
    if (ah === TextAlignHorizontal.Left) cx = center.x - tw / 2 + width2 / 2;
    else if (ah === TextAlignHorizontal.Right) cx = center.x + tw / 2 - width2 / 2;
    return Rect.fromCenter(new Point(cx, center.y), width2, th);
  }
  if (mode === 'clip' && tw > availableWidth) tw = availableWidth;

  let left = center.x - availableWidth / 2;
  let right = center.x + availableWidth / 2;
  let top = center.y - availableHeight / 2;
  let bottom = center.y + availableHeight / 2;
  if (param.forEditing !== true) {
    if (ah === TextAlignHorizontal.Left) {
      right = left + tw;
    } else if (ah === TextAlignHorizontal.Center) {
      left = center.x - tw / 2;
      right = center.x + tw / 2;
    } else {
      left = right - tw;
    }
  }
  const av = style.effectiveTextAlignVertical();
  if (av === TextAlignVertical.Top) {
    bottom = top + th;
  } else if (av === TextAlignVertical.Center) {
    top = center.y - th / 2;
    bottom = center.y + th / 2;
  } else {
    top = bottom - th;
  }
  return new Rect(left, top, right - left, bottom - top);
}

/** The width the text is measured and wrapped at: the available width for `wrap`, else none. */
export function textBoxWrapWidth(param: TextBoxParam): number {
  const mode = param.wrapMode ?? 'wrap';
  return mode === 'wrap' ? param.inRect.width - (param.pad ?? 0) * 2 : -1;
}

/**
 * The laid-out text of C++ `LekhUtil::drawText`, or `null` for empty text (C++ drew nothing).
 * Measures once (through `memo`), then places the lines in the `textEditRect`.
 */
export function layoutTextInBox(
  text: TemplateText,
  param: TextBoxParam,
  style: Style,
  minTextEditWidth: number,
  memo?: TextMeasureMemo,
): LaidOutText | null {
  if (param.text === '') return null;
  const mode = param.wrapMode ?? 'wrap';
  const ww = textBoxWrapWidth(param);
  const probe = text.layout(param.text, style, param.inRect, ww, param.angle, mode, memo);
  const rect = textEditRect(param, style, new Size(probe.width, probe.height), minTextEditWidth);
  return text.layout(param.text, style, rect, ww, param.angle, mode, memo);
}
