// The stroke's lines and the neighbour search the poly aggregator extends with (port of C++
// `recognizer::LineColl`). Speed-ups adopted (spec 07 §4.1): line-id sets are bitmasks (R1), and
// each line's chord segment is computed once when the line is added (R6). `dumpPoints` is dropped.
import type { Point } from '../../geometry';
import { getDistance, LineEquation, LineSegment, Rect } from '../../geometry';
import type { RecognizerConfig } from '../core/RecognizerConfig';
import { RecInternalError } from './RecognizerUtil';
import { LinePoint, type ExtensionPoint, type StrokeLine } from './StrokeLine';

/** The most lines a stroke may have, so that a line-id bitmask fits a 32-bit int (R1). */
export const MAX_LINES = 30;

/** The mask bit of line `id` (ids are 1-based). */
export function lineBit(id: number): number {
  return 1 << (id - 1);
}

export class LineColl {
  private readonly config: RecognizerConfig;
  private items: StrokeLine[] = [];
  private segs: LineSegment[] = [];
  private idSeq = 1;
  private inOrder = false;

  constructor(config: RecognizerConfig) {
    this.config = config;
  }

  reset(): void {
    this.items = [];
    this.segs = [];
    this.idSeq = 1;
  }

  /** Appends the lines, numbering them 1, 2, … (C++ `setId`). At most `MAX_LINES` in all. */
  addLines(lines: readonly StrokeLine[]): void {
    if (this.items.length + lines.length > MAX_LINES) {
      throw new RecInternalError(`LineColl holds at most ${String(MAX_LINES)} lines`);
    }
    for (const line of lines) {
      line.id = this.idSeq;
      this.idSeq++;
      this.items.push(line);
      this.segs.push(new LineSegment(line.points().first(), line.points().last()));
    }
  }

  lines(): readonly StrokeLine[] {
    return this.items;
  }

  /** In-order search (each line joins only its drawing-order neighbours) or all-nearby. */
  setLineSearchInOrder(val: boolean): void {
    this.inOrder = val;
  }

  lineSearchInOrder(): boolean {
    return this.inOrder;
  }

  /**
   * C++ `getLinesNear`: the lines not in `excludeMask` that an extension at `ep` may continue
   * with, each with the point where it is joined. In order mode (and with a direction), only the
   * previous or next line in drawing order, joined at its near end; otherwise every line whose
   * chord passes within `lineCollConnectDist`, joined at the nearest chord point.
   */
  getLinesNear(ep: ExtensionPoint, excludeMask: number): LinePoint[] {
    const result: LinePoint[] = [];
    if (this.inOrder && ep.towards !== 0) {
      this.getLinesNearInOrder(ep, excludeMask, result);
      return result;
    }
    const connectDist = this.config.lineCollConnectDist;
    for (let i = 0; i < this.items.length; i++) {
      const line = this.items[i] as StrokeLine;
      if ((excludeMask & lineBit(line.id)) !== 0) continue;
      const { dist, near } = (this.segs[i] as LineSegment).getDistanceFrom(ep.linePoint.point);
      if (dist < connectDist) result.push(new LinePoint(line, near));
    }
    return result;
  }

  private getLinesNearInOrder(ep: ExtensionPoint, excludeMask: number, result: LinePoint[]): void {
    const wanted = ep.towards < 0 ? ep.linePoint.line.id - 1 : ep.linePoint.line.id + 1;
    // Ids are 1..N in array order, so line `wanted` is at index wanted - 1.
    const line = this.items[wanted - 1];
    if (line === undefined || line.id !== wanted || (excludeMask & lineBit(wanted)) !== 0) return;
    const end = ep.towards < 0 ? line.lastPoint() : line.firstPoint();
    if (getDistance(ep.linePoint.point, end) < this.config.lineCollConnectDist) {
      result.push(new LinePoint(line, end));
    }
  }

  /** C++ `bound()`: the box of the line ends (an empty rect without lines). */
  bound(): Rect {
    const first = this.items[0];
    if (first === undefined) return new Rect();
    let rect = new Rect(first.firstPoint().x, first.firstPoint().y, 0, 0);
    for (const lp of this.items) {
      rect = rect.include(lp.firstPoint());
      rect = rect.include(lp.lastPoint());
    }
    return rect;
  }

  /** C++ `getAmplitudePoint()`: the line end farthest from the first-to-last chord. */
  getAmplitudePoint(): Point {
    const first = this.items[0];
    const last = this.items[this.items.length - 1];
    if (first === undefined || last === undefined) throw new RecInternalError('getAmplitudePoint on no lines');
    let pt = first.firstPoint();
    const eq = LineEquation.through(first.firstPoint(), last.lastPoint());
    let dist = 0;
    for (const line of this.items) {
      let tmp = eq.getDistanceFrom(line.firstPoint());
      if (tmp > dist) {
        dist = tmp;
        pt = line.firstPoint();
      }
      tmp = eq.getDistanceFrom(line.lastPoint());
      if (tmp > dist) {
        dist = tmp;
        pt = line.lastPoint();
      }
    }
    return pt;
  }

  /** C++ `areNear`: closer than `lineCollConnectDist`. */
  areNear(p1: Point, p2: Point): boolean {
    return getDistance(p1, p2) < this.config.lineCollConnectDist;
  }

  /** C++ `lenSum()`: the sum of the lines' chord lengths. */
  lenSum(): number {
    let len = 0;
    for (const line of this.items) len += getDistance(line.firstPoint(), line.lastPoint());
    return len;
  }
}
