// Shared vocabulary of the connector: types, auto types, the stored param names and the state a
// routing strategy writes (port of the declarations in C++ `ConnectionObject.h` and
// `Connection.h`). Routing classes see their connector through `RouteHost` only, so no routing
// file imports `ConnectionObject` as a value (no import cycle; spec 01 §3).
import type { Config } from '../../base';
import type { BezierCurve, Point, SimplePath } from '../../geometry';
import type { Style } from '../../style';
import type { TextMeasureMemo, LaidOutText } from '../../text';
import type { LekhObject } from '../lekh-object';

/** C++ `ConnectionObject::Type`; the numbers are the stored ones. */
export const ConnectionType = Object.freeze({ Curve: 0, GenericLine: 1, MultiLine: 2, Path: 3 } as const);
export type ConnectionType = (typeof ConnectionType)[keyof typeof ConnectionType];

/** C++ `ConnectionObject::AutoType`; the numbers are the stored `autotype` values. */
export const AutoType = Object.freeze({
  NoAuto: 0,
  AutoLine: 1,
  Auto2LineA: 2,
  Auto2LineB: 3,
  Auto3LineA: 4,
  Auto3LineB: 5,
  Auto3LineC: 6,
  Auto3LineD: 7,
  Auto3LineCLeft: 8,
  Auto3LineDTop: 9,
} as const);
export type AutoType = (typeof AutoType)[keyof typeof AutoType];

/** C++ `connection_param` (the stored keys). */
export const ConnectionParam = Object.freeze({
  param1: 'param1',
  param2: 'param2',
  angle1: 'angle1',
  angle2: 'angle2',
  angle3: 'angle3',
  angle4: 'angle4',
  autotype: 'autotype',
  cdist1: 'cdist1',
  cdist2: 'cdist2',
  angle1auto: 'angle1auto',
  angle2auto: 'angle2auto',
  cdist1auto: 'cdist1auto',
  cdist2auto: 'cdist2auto',
  angleauto: 'angleauto',
  cdistauto: 'cdistauto',
  step: 'step',
  dx: 'dx',
  dy: 'dy',
  dc1x: 'dc1x',
  dc1y: 'dc1y',
  dc2x: 'dc2x',
  dc2y: 'dc2y',
  angle: 'angle',
} as const);

/** C++ `ParamMap` (`std::map<std::string, number_t>`). */
export type ParamMap = Record<string, number>;
/** C++ `Params`: one map per segment (or per end). */
export type Params = ParamMap[];

/** Deep copy of params. */
export function cloneParams(p: readonly Readonly<ParamMap>[]): Params {
  return p.map((m) => ({ ...m }));
}

/** C++ `ConnectionObject::TextInfo`, plus the label's measurement memo and laid-out text. */
export class ConnectorTextInfo {
  center: Point;
  /** Position along the route, 0 to 1. */
  param: number;
  text: string;
  readonly memo: TextMeasureMemo | null;
  /** The laid-out label (layout output). */
  laid: LaidOutText | null = null;

  constructor(text: string, param: number, center: Point, memo: TextMeasureMemo | null = null) {
    this.text = text;
    this.param = param;
    this.center = center;
    this.memo = memo;
  }
}

/** What a routing strategy reads and writes of its connector (C++ `Connection`'s pointers). */
export interface RouteHost {
  readonly config: Config;
  /** The connector's own style (C++ `drawingProfile`). */
  readonly style: Style;
  readonly first: LekhObject | null;
  readonly second: LekhObject | null;
  /** C++ `pointsToDraw_`: the polyline of a line or orthogonal connector. */
  points: Point[];
  /** C++ `curvesToDraw_`: the Bézier of a curve connector. */
  curves: BezierCurve[];
  /** C++ `pathToDraw_`: the components of a path connector. */
  paths: SimplePath[];
  readonly texts: ConnectorTextInfo[];
}

/** The before/after params of a vertex edit (C++ `ConnectionVertexEditAction`'s arguments). */
export interface VertexEdit {
  readonly params: Params;
  readonly saved: Params;
}
