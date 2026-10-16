// Generates an orthogonal route between two directed end points (port of C++ `LineGenerator`,
// `L/connection/LineGenerator.cpp`): the six direction cases, each a fixed sequence of legs.
import type { Point } from '../../geometry';
import { ConnectionPoint, LineAlign, RouteLine } from './route-line';

/** C++ `LinesDir`. */
const LinesDir = Object.freeze({
  Parallel: 0,
  ParallelApproach: 1,
  ParallelAway: 2,
  PApproach: 3,
  PApproachOne: 4,
  PAway: 5,
} as const);
type LinesDir = (typeof LinesDir)[keyof typeof LinesDir];

function linesDir(c1: Point, d1: Point, c2: Point, d2: Point): LinesDir {
  const inX = (p: Point) => p.x === 1 || p.x === -1;
  const inY = (p: Point) => p.y === 1 || p.y === -1;
  if (inX(d1) && inX(d2)) {
    if (d1.x === d2.x) return LinesDir.Parallel;
    if ((d1.x === -1 && d2.x === 1 && c1.x < c2.x) || (d1.x === 1 && d2.x === -1 && c1.x > c2.x))
      return LinesDir.ParallelAway;
    return LinesDir.ParallelApproach;
  }
  if (inY(d1) && inY(d2)) {
    if (d1.y === d2.y) return LinesDir.Parallel;
    if ((d1.y === -1 && d2.y === 1 && c1.y < c2.y) || (d1.y === 1 && d2.y === -1 && c1.y > c2.y))
      return LinesDir.ParallelAway;
    return LinesDir.ParallelApproach;
  }
  const approachX = (): boolean => (c1.x < c2.x && (d1.x > 0 || d2.x < 0)) || (c1.x > c2.x && (d1.x < 0 || d2.x > 0));
  const approachY = (): boolean => (c1.y < c2.y && (d1.y > 0 || d2.y < 0)) || (c1.y > c2.y && (d1.y < 0 || d2.y > 0));
  if (approachX()) return approachY() ? LinesDir.PApproach : LinesDir.PApproachOne;
  if (approachY()) return approachX() ? LinesDir.PApproach : LinesDir.PApproachOne;
  return LinesDir.PAway;
}

export class LineGenerator {
  private readonly cp1_: ConnectionPoint;
  private readonly cp2_: ConnectionPoint;
  private readonly param1_: number;
  private readonly param2_: number;
  private readonly align1_: LineAlign;
  private readonly perpAlign1_: LineAlign;
  private readonly lines_: RouteLine[] = [];

  constructor(p1: Point, d1: Point, param1: number, p2: Point, d2: Point, param2: number) {
    this.cp1_ = new ConnectionPoint(p1.x, p1.y, d1.x, d1.y);
    this.cp2_ = new ConnectionPoint(p2.x, p2.y, d2.x, d2.y);
    this.param1_ = param1;
    this.param2_ = param2;
    this.align1_ = d1.x !== 0 ? LineAlign.AlongX : LineAlign.AlongY;
    this.perpAlign1_ = d1.x !== 0 ? LineAlign.AlongY : LineAlign.AlongX;
  }

  generate(): RouteLine[] {
    switch (linesDir(this.cp1_.point(), this.cp1_.dir(), this.cp2_.point(), this.cp2_.dir())) {
      case LinesDir.Parallel:
        this.parallel();
        break;
      case LinesDir.ParallelApproach:
        this.parallelApproach();
        break;
      case LinesDir.ParallelAway:
        this.parallelAway();
        break;
      case LinesDir.PApproach:
        this.pApproach();
        break;
      case LinesDir.PApproachOne:
        this.pApproachOne();
        break;
      case LinesDir.PAway:
        this.pAway();
        break;
    }
    return this.lines_;
  }

  private parallel(): void {
    const cp1 = this.cp1_;
    const cp2 = this.cp2_;
    let n1: ConnectionPoint;
    let n2: ConnectionPoint;
    if (cp1.isAhead(cp2)) {
      n1 = cp1.moveBy(this.param1_);
      n2 = n1.turn(cp2).moveTo(cp2);
    } else {
      n2 = cp2.moveBy(this.param2_);
      n1 = n2.turn(cp1).moveTo(cp1);
    }
    this.add(cp1.point(), n1.point(), this.align1_);
    this.add(n1.point(), n2.point(), this.perpAlign1_);
    this.add(n2.point(), cp2.point(), this.align1_);
  }

  private parallelApproach(): void {
    let rel = 0.5;
    const sum = this.param1_ + this.param2_;
    if (sum > 0.001) rel = this.param1_ / sum;
    const n1 = this.cp1_.moveTo(this.cp2_, rel);
    const n2 = n1.turn(this.cp2_).moveTo(this.cp2_);
    this.add(this.cp1_.point(), n1.point(), this.align1_);
    this.add(n1.point(), n2.point(), this.perpAlign1_);
    this.add(n2.point(), this.cp2_.point(), this.align1_);
  }

  private parallelAway(): void {
    const n1 = this.cp1_.moveBy(this.param1_);
    const n4 = this.cp2_.moveBy(this.param2_);
    const n2 = n1.turn(n4).moveTo(n4, 0.5);
    const n3 = n2.turn(n4).moveTo(n4);
    this.add(this.cp1_.point(), n1.point(), this.align1_);
    this.add(n1.point(), n2.point(), this.perpAlign1_);
    this.add(n2.point(), n3.point(), this.align1_);
    this.add(n3.point(), n4.point(), this.perpAlign1_);
    this.add(n4.point(), this.cp2_.point(), this.align1_);
  }

  private pApproach(): void {
    const mid = this.cp1_.moveTo(this.cp2_);
    this.add(this.cp1_.point(), mid.point(), this.align1_);
    this.add(mid.point(), this.cp2_.point(), this.perpAlign1_);
  }

  private pApproachOne(): void {
    let n1: ConnectionPoint;
    let n2: ConnectionPoint;
    let n3: ConnectionPoint;
    if (this.cp1_.isApproaching(this.cp2_)) {
      n3 = this.cp2_.moveBy(this.param2_);
      n1 = this.cp1_.moveTo(n3, 0.5);
      n2 = n1.turn(n3).moveTo(n3);
    } else {
      n1 = this.cp1_.moveBy(this.param1_);
      n3 = this.cp2_.moveTo(n1, 0.5);
      n2 = n3.turn(n1).moveTo(n1);
    }
    this.add(this.cp1_.point(), n1.point(), this.align1_);
    this.add(n1.point(), n2.point(), this.perpAlign1_);
    this.add(n2.point(), n3.point(), this.align1_);
    this.add(n3.point(), this.cp2_.point(), this.perpAlign1_);
  }

  private pAway(): void {
    const n1 = this.cp1_.moveBy(this.param1_);
    const n3 = this.cp2_.moveBy(this.param2_);
    const n2 = n1.turn(n3).moveTo(n3);
    this.add(this.cp1_.point(), n1.point(), this.align1_);
    this.add(n1.point(), n2.point(), this.perpAlign1_);
    this.add(n2.point(), n3.point(), this.align1_);
    this.add(n3.point(), this.cp2_.point(), this.perpAlign1_);
  }

  private add(p1: Point, p2: Point, align: LineAlign): void {
    const line = new RouteLine();
    line.start = p1;
    line.end = p2;
    line.computeParam(align);
    this.lines_.push(line);
  }
}
