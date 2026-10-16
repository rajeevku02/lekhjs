// The connector (port of C++ `connection::ConnectionObject`, `L/connection/ConnectionObject.cpp`,
// and its `IArrowObject` half): two ends, a type with its routing strategy, params, labels,
// arrowheads, self-loops and the pre-2.x migration.
//
// The layout/paint split (spec 03 §5.1) replaces C++ `draw`:
// - `layout()` resolves the ends by id (replaces `refreshConnectionsTargets`), lays them out first
//   (replaces `layOutEnds`), migrates legacy content once, routes, places the labels and computes
//   what `paint()` draws (the label-clipped segments, curves and paths);
// - queries read that layout. B9 fixed (DR-ENG-18): C++ `getSelectionRectangle`,
//   `getDistanceFrom` and `canEditTextAt` re-routed the connector and rewrote stored automatic
//   routes; here only `layout()` routes;
// - label centres are current after any layout (C++: only after a draw).
// Kept as is: an emptied label stays a dead slot for the session (KB known issue), the selection
// rect includes every label's padded box, BPMN conversation connectors draw doubled lines.
import { INT_MAX } from '../../base';
import {
  LineEquation,
  LineSegment,
  Point,
  Rect,
  Size,
  getDistance,
  getPointAtDistance,
  pointLineSegmentDistance,
  type BezierCurve,
  type PointAndSlope,
  type Range,
  type SimplePath,
} from '../../geometry';
import type { DrawingPlatform } from '../../render';
import type { Paint, Style } from '../../style';
import { layoutTextInBox, type ArrowInfo, type InterestingPoint } from '../../template';
import { TextMeasureMemo } from '../../text';
import { ArrowHeads } from '../arrow-heads';
import { BoundsPlatform } from '../bounds-platform';
import type { LayoutEnv, LayoutGeometry, LekhObject, MovableTextInfo, PaintEnv, TextEditResult } from '../lekh-object';
import { LekhObject as LekhObjectBase, ObjectKind } from '../lekh-object';
import { lowZoomTextFilter } from '../low-zoom';
import type { ObjectEnv } from '../object-env';
import { Connection } from './connection';
import { CurveConnection } from './curve-connection';
import { GenericLineConnection } from './generic-line-connection';
import { LineConnection } from './line-connection';
import { PathConnection } from './path-connection';
import { allowsSelfLoop, selfLoopDefaults, selfLoopParams, SelfLoopError } from './self-loop';
import {
  AutoType,
  ConnectionParam as P,
  ConnectorTextInfo,
  ConnectionType,
  cloneParams,
  type ParamMap,
  type Params,
  type RouteHost,
  type VertexEdit,
} from './types';

/** The template id whose connectors draw as BPMN conversation (double) lines. */
const BPMN_CONVERSATION = 'avabodh.bpmn.conversation';

/** Process-wide in C++ (`drawCounters`); per object here (no module state). */
export interface DrawCounters {
  migrations: number;
  endLayouts: number;
}

/** `ConnectionObject.settleSnapshot()`: the serialized state a layout may change. */
export interface ConnectorSettleState {
  readonly params: Params;
  readonly texts: readonly ConnectorTextInfo[];
  readonly legacyTexts: readonly string[];
  readonly needParamFix: boolean;
  readonly fill: Paint | null;
}

export class ConnectionObject extends LekhObjectBase implements RouteHost {
  readonly kind: ObjectKind = ObjectKind.Connector;
  readonly env: ObjectEnv;
  readonly arrows: ArrowHeads;
  readonly counters: DrawCounters = { migrations: 0, endLayouts: 0 };

  first: LekhObject | null;
  second: LekhObject | null;
  /** The stored end ids (C++ `srcObjId_` / `targetObjId_`): kept when an end is not resolvable. */
  srcObjId = '';
  targetObjId = '';
  private type_: ConnectionType;
  private connection_: Connection;
  private conParams_: Params = [];
  private needParamFix_ = false;
  private isBpmnCommunication_ = false;
  /** Legacy (pre-2.x) segment texts, by segment index; empty for every current connector. */
  legacyTexts: string[] = [];

  // RouteHost: the route, as the last layout left it.
  points: Point[] = [];
  curves: BezierCurve[] = [];
  paths: SimplePath[] = [];
  readonly texts: ConnectorTextInfo[] = [];

  private textEditCenter_ = new Point();
  private textEditIndex_ = 0;
  private textEditParamT_ = 0;

  // Layout output (what paint draws).
  private selRect_ = new Rect();
  private drawSegments_: LineSegment[] = [];
  private drawCurves_: BezierCurve[] = [];
  private drawPaths_: SimplePath[] = [];
  private drawArrows_ = true;

  /** C++ `ConnectionObject(first, second, type)`. */
  constructor(env: ObjectEnv, first: LekhObject | null, second: LekhObject | null, type: ConnectionType, id?: string) {
    super(id ?? env.newId());
    this.env = env;
    this.arrows = new ArrowHeads(env);
    this.first = first;
    this.second = second;
    this.srcObjId = first?.id ?? '';
    this.targetObjId = second?.id ?? '';
    this.type_ = type;
    this.connection_ = new Connection(this, ConnectionType.GenericLine);
    this.init();
  }

  get config(): ObjectEnv['config'] {
    return this.env.config;
  }

  /** RouteHost: the connector's own style. */
  get style(): Style {
    return this.drawingProfile;
  }

  override name(): string {
    return 'Connection';
  }

  override endIds(): readonly string[] {
    return [this.first?.id ?? this.srcObjId, this.second?.id ?? this.targetObjId];
  }

  override styleRevision(): number {
    return this.drawingProfile.revisionSum();
  }

  // ---- construction (C++ statics) ----

  /** C++ `getConnection(first, second, type, params)`. */
  static getConnection(
    env: ObjectEnv,
    first: LekhObject,
    second: LekhObject,
    type: ConnectionType,
    params: Params,
    id?: string,
  ): ConnectionObject {
    const con = new ConnectionObject(env, first, second, type, id);
    con.setParams(params);
    con.init();
    return con;
  }

  /** C++ `getAutoConnection(obj1, obj2, type, param)`: an automatic line or orthogonal connector. */
  static getAutoConnection(
    env: ObjectEnv,
    obj1: LekhObject,
    obj2: LekhObject,
    autoType: number,
    param?: number,
    id?: string,
  ): ConnectionObject {
    let type = autoType;
    let tp = autoType;
    let p = param ?? env.config.connectionDefaultParam;
    if (tp !== AutoType.Auto3LineC && tp !== AutoType.Auto3LineD) p = env.config.connectionDefaultParam;
    if (p < 0 && tp === AutoType.Auto3LineC) {
      tp = AutoType.Auto3LineCLeft;
      type = tp;
      p = Math.abs(p);
    }
    if (p < 0 && tp === AutoType.Auto3LineD) {
      tp = AutoType.Auto3LineDTop;
      type = tp;
      p = Math.abs(p);
    }
    const ctype = type > 1 ? ConnectionType.MultiLine : ConnectionType.GenericLine;
    const con = new ConnectionObject(env, obj1, obj2, ctype, id);
    const pm: ParamMap = { [P.angle]: 0, [P.step]: p, [P.autotype]: type, [P.dx]: 0, [P.dy]: 0 };
    con.setParams([{ ...pm }, { ...pm }]);
    return con;
  }

  /** C++ `getAutoCurveConnection`. */
  static getAutoCurveConnection(
    env: ObjectEnv,
    first: LekhObject,
    second: LekhObject,
    angle1: number,
    angle2: number,
    distFactor1: number,
    distFactor2: number,
  ): ConnectionObject {
    const con = new ConnectionObject(env, first, second, ConnectionType.Curve);
    con.setParamsForAutoCurve(angle1, angle2, distFactor1, distFactor2);
    con.init();
    return con;
  }

  private setParamsForAutoCurve(angle1: number, angle2: number, df1: number, df2: number): void {
    this.conParams_ = [
      { [P.angle1]: angle1, [P.angle2]: 0, [P.cdist1]: df1, [P.angleauto]: 1, [P.cdistauto]: 1 },
      { [P.angle1]: angle2, [P.angle2]: 0, [P.cdist1]: df2, [P.angleauto]: 1, [P.cdistauto]: 1 },
    ];
  }

  /** C++ `setOldLineParams`: the pre-2.x line connector (a step and an auto type). */
  setOldLineParams(dist: number, type: number): void {
    let d = dist;
    let t = type;
    if (t === AutoType.Auto3LineC || t === AutoType.Auto3LineD) this.needParamFix_ = true;
    if (d < 0 && t === AutoType.Auto3LineC) {
      t = AutoType.Auto3LineCLeft;
      d = Math.abs(d);
    }
    if (d < 0 && t === AutoType.Auto3LineD) {
      t = AutoType.Auto3LineDTop;
      d = Math.abs(d);
    }
    const pm: ParamMap = { [P.angle]: 0, [P.dx]: 0, [P.dy]: 0, [P.step]: d, [P.autotype]: t };
    this.setParams([{ ...pm }, { ...pm }]);
    this.type_ = t === 1 ? ConnectionType.GenericLine : ConnectionType.MultiLine;
  }

  /** The io codec's hook (C++ `onDeserialize`). */
  onDeserialize(): void {
    this.init();
  }

  /** Builds the routing strategy for the type (C++ `init`). */
  private init(): void {
    this.connection_ = new Connection(this, ConnectionType.GenericLine);
    if (this.first === null || this.second === null) return;
    const t = this.type_;
    if (t === ConnectionType.Curve) this.connection_ = new CurveConnection(this, t);
    else if (t === ConnectionType.GenericLine) this.connection_ = new GenericLineConnection(this, false);
    else if (t === ConnectionType.Path) this.connection_ = new PathConnection(this, t);
    else this.connection_ = new LineConnection(this, t, AutoType.NoAuto);
    this.connection_.setParams(this.conParams_);
    for (const obj of [this.first, this.second]) {
      const keys = obj.interactionKeys();
      if (keys.length > 1 && keys[0] === BPMN_CONVERSATION) {
        this.isBpmnCommunication_ = true;
        break;
      }
    }
    this.invalidate();
  }

  /** C++ `setConnectedObjects`. */
  setConnectedObjects(obj1: LekhObject | null, obj2: LekhObject | null): void {
    this.first = obj1;
    this.second = obj2;
    if (obj1 !== null) this.srcObjId = obj1.id;
    if (obj2 !== null) this.targetObjId = obj2.id;
    this.init();
  }

  setParams(params: Params): void {
    this.conParams_ = cloneParams(params);
    this.connection_.setParams(this.conParams_);
    this.invalidate();
  }

  /** C++ `getParams`: the strategy's current params. */
  getParams(): Params {
    this.conParams_ = this.connection_.getParams();
    return cloneParams(this.conParams_);
  }

  getType(): ConnectionType {
    return this.connection_.getType();
  }

  getAutoType(): AutoType {
    return this.connection_.getAutoType();
  }

  /** C++ `setType`. */
  setType(type: ConnectionType): void {
    this.points = [];
    this.curves = [];
    this.paths = [];
    this.type_ = type;
    this.init();
  }

  /** C++ `changeTypeTo` (the connector editor): resets to an automatic route of `type`. */
  changeTypeTo(type: ConnectionType): void {
    if (this.isSelfLoop()) {
      this.changeSelfLoopTypeTo(type);
      return;
    }
    this.conParams_ = [];
    this.points = [];
    this.curves = [];
    this.paths = [];
    const pm: ParamMap = { [P.angle]: 0, [P.step]: 0, [P.dx]: 0, [P.dy]: 0 };
    if (type === ConnectionType.Curve) {
      this.setParamsForAutoCurve(Math.PI / 2, -Math.PI / 2, 0.4, 0.4);
    } else if (type === ConnectionType.GenericLine) {
      pm[P.autotype] = AutoType.AutoLine;
      this.conParams_ = [{ ...pm }, { ...pm }];
    } else if (type === ConnectionType.MultiLine) {
      pm[P.autotype] = AutoType.Auto2LineA;
      this.conParams_ = [{ ...pm }, { ...pm }];
    }
    this.setType(type);
  }

  // ---- self-loops ----

  isSelfLoop(): boolean {
    return this.first !== null && this.first === this.second;
  }

  /** C++ `selfLoopEndAngles`: the pinned end angles; right → top when not pinned. */
  selfLoopEndAngles(): { from: number; to: number } {
    let from = 0;
    let to = (3 * Math.PI) / 2;
    const params = this.getParams();
    const p0 = params[0];
    const pl = params[params.length - 1];
    if (params.length < 2 || p0 === undefined || pl === undefined) return { from, to };
    const get = (pm: ParamMap, name: string, def: number) => pm[name] ?? def;
    if (this.getType() === ConnectionType.Curve) {
      if (get(p0, P.angleauto, 1) === 0 && get(pl, P.angleauto, 1) === 0) {
        from = get(p0, P.angle1, from);
        to = get(pl, P.angle1, to);
      }
    } else if (this.getType() !== ConnectionType.Path) {
      if (get(p0, P.autotype, 1) === AutoType.NoAuto) {
        from = get(p0, P.angle, from);
        to = get(pl, P.angle, to);
      }
    }
    return { from, to };
  }

  /** A loop is rebuilt as a loop of the new type; lines and paths are not loop types (no-op). */
  private changeSelfLoopTypeTo(type: ConnectionType): void {
    if (!allowsSelfLoop(type) || this.first === null) return;
    const { from, to } = this.selfLoopEndAngles();
    const r = selfLoopParams(type, this.first, from, to, selfLoopDefaults(this.config), this.config);
    if (r.error !== SelfLoopError.None) return;
    this.points = [];
    this.curves = [];
    this.paths = [];
    this.conParams_ = r.params;
    this.setType(type);
  }

  // ---- legacy content (pre-2.x) ----

  hasLegacyContent(): boolean {
    return this.needParamFix_ || this.legacyTexts.some((t) => t !== '');
  }

  needsParamFix(): boolean {
    return this.needParamFix_;
  }

  /**
   * What a layout may change of this connector's serialized form (the C++ projector's settle
   * snapshot): the strategy's params (an automatic route is re-derived), the labels and the legacy
   * content (migrated on the first layout), and the connector's own fill (cleared by layout).
   */
  settleSnapshot(): ConnectorSettleState {
    return {
      params: cloneParams(this.connection_.getParams()),
      texts: this.texts.slice(),
      legacyTexts: this.legacyTexts.slice(),
      needParamFix: this.needParamFix_,
      fill: this.drawingProfile.isFillPaintDefined() ? this.drawingProfile.effectiveFillPaint() : null,
    };
  }

  /**
   * Puts back what `settleSnapshot` recorded, WITHOUT invalidating the layout: the route and label
   * positions the layout computed stay (they are what a read reports and a render draws), while
   * `serialize` writes the board as it was loaded (AC-BE-08). A legacy label the layout migrated is
   * dropped again, as the C++ restore dropped it.
   */
  restoreSettle(state: ConnectorSettleState): void {
    this.conParams_ = cloneParams(state.params);
    this.connection_.setParams(this.conParams_);
    if (state.legacyTexts.length > 0 || state.needParamFix) {
      this.texts.length = 0;
      this.texts.push(...state.texts);
      this.legacyTexts = state.legacyTexts.slice();
      this.needParamFix_ = state.needParamFix;
    }
    if (state.fill !== null) this.drawingProfile.setFillPaint(state.fill);
  }

  /** C++ `migrateOldConnection`: once, then the legacy content is cleared on every path. */
  private migrateOldConnection(): void {
    this.counters.migrations++;
    this.migrateOldParams();
    this.migrateOldTexts();
    this.legacyTexts = [];
    this.needParamFix_ = false;
  }

  private migrateOldParams(): void {
    const params = this.getParams();
    const p0 = params[0];
    if (!this.needParamFix_ || p0 === undefined || this.first === null || this.second === null) return;
    const at = p0[P.autotype];
    const st = p0[P.step];
    if (at === undefined || st === undefined) return;
    let diff = 0;
    const autoType = Math.trunc(at);
    if (autoType === AutoType.Auto3LineC || autoType === AutoType.Auto3LineCLeft) {
      diff = Math.min(this.first.selectionRect().width / 2, this.second.selectionRect().width / 2);
    } else if (autoType === AutoType.Auto3LineD || autoType === AutoType.Auto3LineDTop) {
      diff = Math.min(this.first.selectionRect().height / 2, this.second.selectionRect().height / 2);
    }
    const step = Math.abs(st - diff);
    p0[P.step] = step;
    (params[params.length - 1] as ParamMap)[P.step] = step;
    this.setParams(params);
  }

  private migrateOldTexts(): void {
    if (this.legacyTexts.length === 0) return;
    this.connection_.update();
    const pts = this.points;
    if (pts.length < 2) return;
    let lenSum = 0;
    for (let i = 0; i < pts.length - 1; i++) lenSum += getDistance(pts[i] as Point, pts[i + 1] as Point);
    if (lenSum === 0) return;
    let prevSum = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const len = getDistance(pts[i] as Point, pts[i + 1] as Point);
      const t = this.legacyTexts[i];
      if (t !== undefined && t !== '') this.texts.push(this.newText(t, (prevSum + len / 2) / lenSum, new Point()));
      prevSum += len;
    }
  }

  // ---- labels ----

  private newText(text: string, param: number, center: Point): ConnectorTextInfo {
    return new ConnectorTextInfo(text, param, center, new TextMeasureMemo());
  }

  /** C++ `textInfos()`. */
  textInfos(): readonly ConnectorTextInfo[] {
    return this.texts;
  }

  /** C++ `setTexts`: replaces the labels. */
  setTexts(txts: readonly { text: string; param: number; center?: Point }[]): void {
    this.texts.length = 0;
    for (const t of txts) this.texts.push(this.newText(t.text, t.param, t.center ?? new Point()));
    this.invalidate();
  }

  /** C++ `getTextSize(text, style, Size())` of a label. */
  private textSize(text: string): Size {
    return this.env.text.measure(text, this.drawingProfile, new Size(0, 0));
  }

  /** C++ `TextInfo::getRect`: the label's measured box, padded by `textObjectBoundsAdjust` + stroke. */
  textRect(ti: ConnectorTextInfo): Rect {
    const sz = this.textSize(ti.text);
    const pad = this.config.textObjectBoundsAdjust + this.drawingProfile.effectiveStrokeWidth();
    return Rect.fromCenter(ti.center, sz.width + pad, sz.height + pad);
  }

  // ---- layout / paint ----

  /** C++ `updateConnection`, for tools that route a detached connector (tests, clipboard). */
  updateConnection(): void {
    this.connection_.update();
  }

  protected computeLayout(env: LayoutEnv): LayoutGeometry {
    // Ends by id: a replaced end object is picked up (C++ `refreshConnectionsTargets`).
    const f = (this.srcObjId !== '' ? env.objectById(this.srcObjId) : undefined) ?? this.first;
    const s = (this.targetObjId !== '' ? env.objectById(this.targetObjId) : undefined) ?? this.second;
    if (f !== this.first || s !== this.second) {
      this.first = f;
      this.second = s;
      this.init();
    }
    // The ends' outlines first (C++ `layOutEnds`).
    for (const end of this.first === this.second ? [this.first] : [this.first, this.second]) {
      if (end !== null && end.needsLayout()) {
        env.ensureLayout(end);
        this.counters.endLayouts++;
      }
    }
    if (this.hasLegacyContent()) this.migrateOldConnection();
    this.connection_.update();
    if (this.drawingProfile.fill()) this.drawingProfile.setNoFill();

    this.drawSegments_ = [];
    this.drawCurves_ = [];
    this.drawPaths_ = [];
    this.drawArrows_ = true;
    if (this.paths.length > 0) this.layoutPath();
    else if (this.curves.length > 0) this.layoutCurve();
    else {
      this.layoutLines();
      this.drawArrows_ = !this.isBpmnCommunication_;
    }
    const minEdit = this.env.config.minTextEditWidth;
    for (const ti of this.texts) {
      ti.laid =
        ti.text === ''
          ? null
          : layoutTextInBox(
              this.env.text,
              {
                text: ti.text,
                angle: 0,
                inRect: Rect.fromCenter(ti.center, 1, 1),
                wrapMode: 'float',
                textSizeAdjustment: 1,
              },
              this.drawingProfile,
              minEdit,
              ti.memo ?? undefined,
            );
    }
    if (this.drawArrows_) this.arrows.layout(this.getArrowPoints(), this.drawingProfile);
    this.selRect_ = this.computeSelectionRect();
    const bp = new BoundsPlatform();
    bp.addRect(this.selRect_);
    this.paintContent(bp, -1);
    return { visualBounds: this.selRect_, extent: bp.bounds() ?? this.selRect_ };
  }

  /** The non-empty labels' padded rects (the clip rects of C++ `drawPath`/`drawLines`). */
  private labelClipRects(): Rect[] {
    return this.texts.filter((t) => t.text !== '').map((t) => this.textRect(t));
  }

  private layoutPath(): void {
    this.connection_.updateTextCenters();
    const rects = this.labelClipRects();
    for (const path of this.paths)
      for (const item of path.clipAll(rects)) if (item.size > 0) this.drawPaths_.push(item);
  }

  private layoutCurve(): void {
    const acc = this.connection_;
    if (!(acc instanceof CurveConnection)) return;
    const c0 = this.curves[0] as BezierCurve;
    const clipped: Range[] = [];
    for (const ti of this.texts) {
      ti.center = acc.getPointForT(ti.param);
      if (ti.text !== '') clipped.push(...c0.clip(this.textRect(ti)));
    }
    clipped.sort((a, b) => a.start - b.start);
    const aggregated: { start: number; end: number }[] = [];
    for (const c of clipped) {
      const last = aggregated[aggregated.length - 1];
      if (last !== undefined && c.start <= last.start) last.end = c.end;
      else aggregated.push({ start: c.start, end: c.end });
    }
    let lastT = 0;
    let lastCurve = c0;
    for (const r of aggregated) {
      const tStart = (r.start - lastT) / (1 - lastT);
      const tEnd = (r.end - lastT) / (1 - lastT);
      if (tStart > 0) this.drawCurves_.push(lastCurve.split(tStart)[0]);
      lastCurve = lastCurve.split(tEnd)[1];
      lastT = r.end;
    }
    if (lastT < 1.0) this.drawCurves_.push(lastCurve);
  }

  /** C++ `drawLines`' computing half: label centres along the polyline and the clipped segments. */
  private layoutLines(): void {
    const pts = this.points;
    if (pts.length < 2) return;
    let len = 0;
    for (let i = 0; i < pts.length - 1; i++) len += getDistance(pts[i] as Point, pts[i + 1] as Point);
    if (len < 0.01) return; // total length very small: nothing to draw
    const segments: LineSegment[] = [];
    let lenSum = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const prevLen = lenSum;
      const prevT = prevLen / len;
      const firstPoint = pts[i] as Point;
      const secondPoint = pts[i + 1] as Point;
      lenSum += getDistance(firstPoint, secondPoint);
      const t = lenSum / len;
      const seg = new LineSegment(firstPoint, secondPoint);
      for (const ti of this.texts) {
        if (ti.param >= prevT && ti.param < t)
          ti.center = getPointAtDistance(firstPoint, secondPoint, len * ti.param - prevLen);
      }
      const clipped: LineSegment[] = [];
      for (const ti of this.texts) if (ti.text !== '') clipped.push(...seg.clip(this.textRect(ti)));
      clipped.sort((a, b) => getDistance(firstPoint, a.point1()) - getDistance(firstPoint, b.point1()));
      const aggregated: LineSegment[] = [];
      for (const c of clipped) {
        const last = aggregated[aggregated.length - 1];
        if (last !== undefined && getDistance(firstPoint, c.point1()) <= getDistance(firstPoint, last.point2())) {
          aggregated[aggregated.length - 1] = last.withPoint2(c.point2());
        } else {
          aggregated.push(c);
        }
      }
      let prevPoint = firstPoint;
      const a0 = aggregated[0];
      if (a0 !== undefined) {
        if (!firstPoint.equals(a0.point1())) segments.push(new LineSegment(firstPoint, a0.point1()));
        prevPoint = a0.point2();
        for (let k = 1; k < aggregated.length; k++) {
          const ak = aggregated[k] as LineSegment;
          segments.push(new LineSegment(prevPoint, ak.point1()));
          prevPoint = ak.point2();
        }
      }
      if (!secondPoint.equals(prevPoint)) segments.push(new LineSegment(prevPoint, secondPoint));
    }
    this.drawSegments_ = segments;
  }

  paint(dp: DrawingPlatform, env: PaintEnv): void {
    this.paintContent(lowZoomTextFilter(dp, env), this.editingText_ ? this.textEditIndex_ : -1);
  }

  private paintContent(dp: DrawingPlatform, editIndex: number): void {
    const style = this.drawingProfile;
    for (const item of this.drawPaths_) {
      dp.startDrawing(item.front().firstPoint(), style);
      dp.moveTo(item.front().firstPoint());
      for (const pc of item.components) {
        if (pc.isCurve) dp.addCurve(pc.curve);
        else dp.addLineTo(pc.segment.point2());
      }
      if (item.closed()) dp.closePath();
      dp.endDrawing();
    }
    for (const curve of this.drawCurves_) {
      dp.startDrawing(curve.point1, style);
      dp.addCurve(curve);
      dp.endDrawing();
    }
    this.paintSegments(dp, this.drawSegments_);
    this.texts.forEach((ti, i) => {
      if (ti.laid !== null && ti.text !== '' && i !== editIndex) dp.drawText(ti.laid, style);
    });
    if (this.drawArrows_) this.arrows.paint(dp, this.getArrowPoints());
  }

  /** C++ `drawSegments`. */
  private paintSegments(dp: DrawingPlatform, segments: readonly LineSegment[]): void {
    const s0 = segments[0];
    if (s0 === undefined) return;
    if (this.isBpmnCommunication_ && this.paintBpmnCommunication(dp, segments)) return;
    let prevPoint = s0.point1();
    dp.startDrawing(prevPoint, this.drawingProfile);
    dp.moveTo(prevPoint);
    for (const sg of segments) {
      if (prevPoint.equals(sg.point1())) {
        dp.addLineTo(sg.point2());
      } else {
        dp.moveTo(sg.point1());
        dp.addLineTo(sg.point2());
      }
      prevPoint = sg.point2();
    }
    dp.endDrawing();
  }

  /** C++ `drawBpmnCommunication`: two parallel lines 2 apart, mitred at the joins. */
  private paintBpmnCommunication(dp: DrawingPlatform, segments: readonly LineSegment[]): boolean {
    const s0 = segments[0];
    if (s0 === undefined || s0.length() < 0.1) return false;
    const lineWidth = 2;
    interface PLineSeg {
      p1: Point;
      p2: Point;
      p3: Point;
      p4: Point;
    }
    const segs: PLineSeg[] = [];
    const isNear = (a: LineSegment, b: LineSegment) => getDistance(a.point2(), b.point1()) < 1.0;
    const nextWithDelta = (seg: LineSegment, p1: Point) =>
      new Point(seg.point2().x + (p1.x - seg.point1().x), seg.point2().y + (p1.y - seg.point1().y));
    for (let i = 0; i < segments.length; i++) {
      const si = segments[i] as LineSegment;
      const connected = i > 0 && isNear(segments[i - 1] as LineSegment, si);
      const eq = LineEquation.through(si.point1(), si.point2());
      const pts = eq.getPerpendicularPassingThrough(si.point1()).getPointsAtDistanceFrom(lineWidth, si.point1());
      if (pts.length !== 2) return false;
      const pls: PLineSeg = { p1: pts[0] as Point, p2: pts[1] as Point, p3: new Point(), p4: new Point() };
      pls.p3 = nextWithDelta(si, pls.p1);
      pls.p4 = nextWithDelta(si, pls.p2);
      segs.push(pls);
      if (connected) {
        const last = segs[segs.length - 2] as PLineSeg;
        const lsLast1 = new LineSegment(last.p1, last.p3);
        const lsLast2 = new LineSegment(last.p2, last.p4);
        const ls1 = new LineSegment(pls.p1, pls.p3);
        const ls2 = new LineSegment(pls.p2, pls.p4);
        const lastEq1 = LineEquation.through(last.p1, last.p3);
        const lastEq2 = LineEquation.through(last.p2, last.p4);
        let x: Point | null;
        if ((x = lsLast1.getIntersection(ls1)) !== null) {
          last.p3 = x;
          pls.p1 = x;
          const y = lastEq2.solveWith(LineEquation.through(pls.p2, pls.p4));
          if (y !== null) {
            last.p4 = y;
            pls.p2 = y;
          }
        } else if ((x = lsLast1.getIntersection(ls2)) !== null) {
          last.p3 = x;
          pls.p2 = x;
          const y = lastEq2.solveWith(LineEquation.through(pls.p1, pls.p3));
          if (y !== null) {
            last.p4 = y;
            pls.p1 = y;
          }
        } else if ((x = lsLast2.getIntersection(ls1)) !== null) {
          last.p4 = x;
          pls.p1 = x;
          const y = lastEq1.solveWith(LineEquation.through(pls.p2, pls.p4));
          if (y !== null) {
            last.p3 = y;
            pls.p2 = y;
          }
        } else if ((x = lsLast2.getIntersection(ls2)) !== null) {
          last.p4 = x;
          pls.p2 = x;
          const y = lastEq1.solveWith(LineEquation.through(pls.p1, pls.p3));
          if (y !== null) {
            last.p3 = y;
            pls.p1 = y;
          }
        }
      }
    }
    for (const seg of segs) {
      dp.startDrawing(seg.p1, this.drawingProfile);
      dp.moveTo(seg.p1);
      dp.addLineTo(seg.p3);
      dp.endDrawing();
      dp.startDrawing(seg.p2, this.drawingProfile);
      dp.moveTo(seg.p2);
      dp.addLineTo(seg.p4);
      dp.endDrawing();
    }
    return true;
  }

  // ---- geometry (from the layout; B9) ----

  /** C++ `getSelectionRectangle`, computed at layout. */
  selectionRect(): Rect {
    return this.selRect_;
  }

  private computeSelectionRect(): Rect {
    let rect = new Rect();
    let hasCurve = false;
    if (this.curves.length > 0 || this.paths.length > 0) {
      rect = this.connection_.getSelectionRectangle() ?? new Rect();
      hasCurve = true;
    }
    const p0 = this.points[0];
    if (!hasCurve && p0 !== undefined) rect = new Rect(p0.x, p0.y, 0, 0);
    for (const p of this.points) rect = rect.include(p);
    for (const ti of this.texts) rect = rect.includeRect(this.textRect(ti));
    return rect;
  }

  distanceFrom(p: Point): number {
    if (this.paths.length > 0 || this.curves.length > 0) return this.connection_.getDistanceFrom(p);
    let dist = INT_MAX;
    const pts = this.points;
    for (let i = 0; i + 1 < pts.length; i++) {
      const d = pointLineSegmentDistance(pts[i] as Point, pts[i + 1] as Point, p).dist;
      if (d < dist) dist = d;
    }
    return dist;
  }

  /** A connector is never "inside" (C++ `LekhObject::isPointInside` default). */
  isPointInside(): boolean {
    return false;
  }

  override getIntersection(): PointAndSlope[] {
    return [];
  }

  override getInterestingPoints(): InterestingPoint[] {
    return this.connection_.getInterestingPoints();
  }

  /** The route accessors (C++ `routePoints` / `routeCurves` / `routePaths`): current after a layout. */
  routePoints(): readonly Point[] {
    return this.points;
  }
  routeCurves(): readonly BezierCurve[] {
    return this.curves;
  }
  routePaths(): readonly SimplePath[] {
    return this.paths;
  }

  /** C++ `getArrowPoints`: the route's first and last non-trivial segments. */
  getArrowPoints(): ArrowInfo[] {
    const ret: ArrowInfo[] = [];
    const pf = this.paths[0];
    const pb = this.paths[this.paths.length - 1];
    if (pf !== undefined && pb !== undefined && pf.size > 0 && pb.size > 0) {
      let pc = pf.front();
      ret.push(pc.isCurve ? [pc.curve.point1, pc.curve.point2] : [pc.segment.point1(), pc.segment.point2()]);
      pc = pb.back();
      ret.push(pc.isCurve ? [pc.curve.point4, pc.curve.point3] : [pc.segment.point2(), pc.segment.point1()]);
      return ret;
    }
    const bz = this.curves[0];
    if (bz !== undefined)
      return [
        [bz.point1, bz.point2],
        [bz.point4, bz.point3],
      ];
    const pts = this.points;
    if (pts.length < 2) return ret;
    for (let i = 0; i < pts.length - 1; i++) {
      if (getDistance(pts[i] as Point, pts[i + 1] as Point) > 1.0) {
        ret.push([pts[i] as Point, pts[i + 1] as Point]);
        break;
      }
    }
    for (let i = pts.length - 1; i > 0; i--) {
      if (getDistance(pts[i] as Point, pts[i - 1] as Point) > 1.0) {
        ret.push([pts[i] as Point, pts[i - 1] as Point]);
        break;
      }
    }
    return ret;
  }

  // ---- vertex editing and transforms ----

  override moveVertexTo(vid: number, pt: Point): Point {
    const r = this.connection_.moveVertexTo(vid, pt);
    this.invalidate();
    return r;
  }

  /** C++ `getVertexEditAction`'s params (after consolidation), or null. */
  vertexEdit(): VertexEdit | null {
    const r = this.connection_.vertexEdit();
    this.invalidate();
    return r;
  }

  newVertexIndex(vid: number): number {
    return this.connection_.newVertexIndex(vid);
  }

  override startModification(): void {
    this.connection_.startModification();
  }

  override scale(fx: number, fy: number): void {
    this.connection_.scale(fx, fy);
    this.invalidate();
  }

  override finishScaling(): { x: number; y: number } {
    return this.connection_.finishScaling();
  }

  // ---- text editing ----

  override canEditText(): boolean {
    return true;
  }

  override canEditTextAt(pt: Point): boolean {
    return this.editTextAt(pt, false) !== null;
  }

  /**
   * C++ `canEditTextAt(pt, &index, onlyExisting)`: an existing non-empty label whose box (at least
   * 2.5 × 2 taps) holds `pt`, else (unless `onlyExisting`) a new label near the route. Records the
   * edit centre and parameter.
   */
  private editTextAt(pt: Point, onlyExisting: boolean): number | null {
    const tap = this.config.tapToSelectDistance;
    for (let i = 0; i < this.texts.length; i++) {
      const ti = this.texts[i] as ConnectorTextInfo;
      if (ti.text === '') continue;
      const sz = this.textSize(ti.text);
      const rect = Rect.fromCenter(ti.center, Math.max(sz.width, tap * 2.5), Math.max(sz.height, tap * 2.0));
      if (rect.contains(pt)) {
        this.textEditParamT_ = ti.param;
        this.textEditCenter_ = ti.center;
        return i;
      }
    }
    if (onlyExisting) return null;
    const near = this.addTextNear(pt);
    if (near !== null) {
      this.textEditParamT_ = near.param;
      this.textEditCenter_ = near.center;
      return this.texts.length;
    }
    return null;
  }

  /** C++ `canAddTextNear`: the route parameter and point nearest `pt`, within a tap. */
  private addTextNear(pt: Point): { param: number; center: Point } | null {
    const tap = this.config.tapToSelectDistance;
    if (this.curves.length > 0 || this.paths.length > 0) {
      const r = this.connection_.getTFor(pt);
      if (r !== null && r.dist <= tap) return { param: r.t, center: r.at };
    }
    const pts = this.points;
    if (pts.length < 2) return null;
    let dist = INT_MAX;
    let totalLen = 0;
    let lenAtEditPoint = 0;
    let center = new Point();
    for (let i = 0; i < pts.length - 1; i++) {
      const r = pointLineSegmentDistance(pts[i] as Point, pts[i + 1] as Point, pt);
      if (r.dist < dist) {
        lenAtEditPoint = totalLen + getDistance(pts[i] as Point, r.near);
        dist = r.dist;
        center = r.near;
      }
      totalLen += getDistance(pts[i] as Point, pts[i + 1] as Point);
    }
    if (totalLen === 0 || dist > tap) return null;
    return { param: lenAtEditPoint / totalLen, center };
  }

  override getMovableTextNear(pt: Point): MovableTextInfo | null {
    const rect = this.selRect_.inflate(this.config.textMoverTolerace + this.drawingProfile.effectiveFontSize());
    if (!rect.contains(pt)) return null;
    const index = this.editTextAt(pt, true);
    const ti = index !== null ? this.texts[index] : undefined;
    if (index === null || ti === undefined) return null;
    return { obj: this, index, param: ti.param, center: ti.center };
  }

  override moveTextNear(index: number, pt: Point): number | null {
    const ti = this.texts[index];
    if (ti === undefined) return null;
    const near = this.addTextNear(pt);
    if (near === null) return null;
    ti.param = near.param;
    this.invalidate();
    return near.param;
  }

  override moveText(index: number, param: number): void {
    const ti = this.texts[index];
    if (ti === undefined) return;
    ti.param = param;
    this.invalidate();
  }

  override startTextEditing(pt: Point): void {
    this.editingText_ = true;
    this.textEditIndex_ = this.editTextAt(pt, false) ?? this.textEditIndex_;
    let newEntry = false;
    if (this.textEditIndex_ >= this.texts.length) {
      this.textEditIndex_ = this.texts.length;
      this.texts.push(this.newText('', this.textEditParamT_, this.textEditCenter_));
      newEntry = true;
    }
    this.origText_ = (this.texts[this.textEditIndex_] as ConnectorTextInfo).text;
    if (newEntry && this.config.addDefaultTextOnConnector)
      (this.texts[this.texts.length - 1] as ConnectorTextInfo).text = 'Text';
    this.invalidate();
  }

  override getTextEditCenter(): Point {
    return this.textEditCenter_;
  }

  override updateText(str: string, index: number): void {
    let i = index;
    if (i < 0 || i >= this.texts.length) i = this.textEditIndex_;
    const ti = this.texts[i];
    if (ti === undefined) return;
    ti.text = str;
    this.invalidate();
  }

  override finishTextEditing(): TextEditResult {
    this.editingText_ = false;
    this.invalidate();
    return { text: this.origText_, index: this.textEditIndex_ };
  }

  override getTextForEditing(): string {
    return this.texts[this.textEditIndex_]?.text ?? '';
  }

  // ---- copy ----

  /** C++ `getCopy(first, second)`: the same type, params, labels, arrows and style between new ends. */
  getCopy(first: LekhObject, second: LekhObject): ConnectionObject {
    const con = new ConnectionObject(this.env, first, second, this.type_);
    con.legacyTexts = this.legacyTexts.slice();
    this.conParams_ = this.connection_.getParams();
    con.conParams_ = cloneParams(this.conParams_);
    for (const t of this.texts) con.texts.push(con.newText(t.text, t.param, t.center));
    con.arrows.copyFrom(this.arrows);
    con.drawingProfile.copyFrom(this.drawingProfile);
    con.init();
    return con;
  }
}
