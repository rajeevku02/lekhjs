// The routing strategy of a connector (port of C++ `connection::Connection`,
// `L/connection/Connection.h`; spec 03 names the family `ConnectionRouting`). It reads its
// connector through `RouteHost` and writes the route there. `update()` runs only from the
// connector's `layout()` (B9): no query re-routes.
import type { Point, Rect } from '../../geometry';
import { INT_MAX } from '../../base';
import type { InterestingPoint } from '../../template';
import type { LekhObject } from '../lekh-object';
import type { AutoType, ConnectionType, Params, RouteHost, VertexEdit } from './types';
import { AutoType as Auto } from './types';

/* eslint-disable @typescript-eslint/no-unused-vars -- default hooks take the parameters their overrides use */
export class Connection {
  protected readonly host_: RouteHost;
  protected readonly type_: ConnectionType;
  protected readonly first_: LekhObject | null;
  protected readonly second_: LekhObject | null;

  constructor(host: RouteHost, type: ConnectionType) {
    this.host_ = host;
    this.type_ = type;
    this.first_ = host.first;
    this.second_ = host.second;
  }

  /** Computes the route into the host. */
  update(): void {
    /* none */
  }
  getDistanceFrom(_p: Point): number {
    return INT_MAX;
  }
  getSelectionRectangle(): Rect | null {
    return null;
  }
  getInterestingPoints(): InterestingPoint[] {
    return [];
  }
  moveVertexTo(_vid: number, pt: Point): Point {
    return pt;
  }
  startModification(): void {
    /* none */
  }
  scale(_fx: number, _fy: number): void {
    /* none */
  }
  finishScaling(): { x: number; y: number } {
    return { x: 1, y: 1 };
  }
  /** C++ `getVertexEditAction`'s params, or null. */
  vertexEdit(): VertexEdit | null {
    return null;
  }
  getType(): ConnectionType {
    return this.type_;
  }
  getAutoType(): AutoType {
    return Auto.NoAuto;
  }
  /** C++ `getTFor`: the route parameter nearest `p`, its distance and the point there. */
  getTFor(_p: Point): { t: number; dist: number; at: Point } | null {
    return null;
  }
  updateTextCenters(): void {
    /* none */
  }
  setParams(_params: Params): void {
    /* none */
  }
  getParams(): Params {
    return [];
  }
  newVertexIndex(vid: number): number {
    return vid;
  }
}
/* eslint-enable @typescript-eslint/no-unused-vars */
