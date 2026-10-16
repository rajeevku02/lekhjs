// Grid snapping (port of C++ `LekhUtil::snapNumber` and `LekhUtil::snapToGrid`,
// `L/LekhUtil.cpp:383-423`). The C++ read `Config::instance().snapToGrid` and the active document's
// snap step; here both are arguments.
import { toInt } from '../base';
import { Point, Rect } from '../geometry';
import type { Length } from '../style';

/**
 * The multiple of `step` (points, or a `Length`) nearest `num`, ties to the one toward zero;
 * `num` itself when snapping is off.
 */
export function snapNumber(num: number, step: number | Length, snapToGrid: boolean): number {
  if (!snapToGrid) return num;
  const s = typeof step === 'number' ? step : step.points();
  const newNum = toInt(num / s) * s;
  const newNum2 = newNum < 0 ? newNum - s : newNum + s;
  return Math.abs(newNum - num) <= Math.abs(newNum2 - num) ? newNum : newNum2;
}

/** C++ `snapToGrid(rect)`: size to twice the snap step, centre to the snap step. */
export function snapRectToGrid(rect: Rect, snapStep: Length, snapToGrid: boolean): Rect {
  if (!snapToGrid) return rect;
  const step = snapStep.points() * 2;
  const center = rect.center();
  const width = snapNumber(rect.width, step, true);
  const height = snapNumber(rect.height, step, true);
  const c = new Point(snapNumber(center.x, step / 2, true), snapNumber(center.y, step / 2, true));
  return new Rect(c.x - width / 2, c.y - height / 2, width, height);
}
