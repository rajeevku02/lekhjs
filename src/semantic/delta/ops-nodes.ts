// The node and structure operations of the delta compiler (the C++ `SemanticDelta.cpp`, lines
// 3195-4937: add_node, the path write side, auto-placement, embedded templates, self-loops,
// add_edge, delete, clear_page, group / ungroup, move / resize / rotate, reorder) and the route
// helpers add_edge shares with set_edge_route (lines 6473-6895 minus doSetEdgeRoute). Conventions:
// compilation-base.ts.
//
// Every object an op builds is built detached from the page (C++ property 1: the compiler never
// mutates the document); an object is constructed with its minted id, so no id is drawn from the
// session's id source for it (the C++ constructors mint none either).
import { collectEmbedTemplates } from '../../edit';
import { Point, Rect } from '../../geometry';
import {
  AutoType,
  Bend,
  ConnectionObject,
  ConnectionParam as P,
  ConnectionType,
  GroupObject,
  SelfLoopError,
  Side,
  SideRelation,
  TemplatedObject,
  allowsSelfLoop,
  relationOf,
  selfLoopDefaults,
  selfLoopParams as buildSelfLoopParams,
  sideAngle,
  stampNewContentFont,
  worldSideOf,
  type LekhObject,
  type ObjectEnv,
  type ParamMap,
  type Params,
  type SelfLoopOptions,
} from '../../model';
import { TextTemplate, type ShapeTemplate } from '../../template';
import { consts } from '../../sync';
import {
  KEY,
  MAX_GROUP_DEPTH,
  PATH_SHAPE_ID,
  StyleTarget,
  autoTypeFromName,
  autoTypeMessage,
  edgeTypeFromName,
  edgeTypeMessage,
  edgeTypeName,
  isUBend,
} from '../format';
import { isJsonObject, sortedKeys, type JsonObject, type JsonOut, type JsonValue } from '../json';
import {
  PLACEMENT_GAP,
  PLACEMENT_MARGIN,
  placementBoxAt,
  placementHalfExtents,
  placementPushClear,
} from '../placement';
import { CompilationBase, byteOrder, type AddSize, type LoopParams, type Working } from './compilation-base';
import {
  DRAW_ONLY_ON_PATH,
  FrameKind,
  INVALID_OPERATION,
  K_EDGE,
  K_NODE,
  K_OP,
  K_PAGE,
  K_REF,
  K_TO,
  LOOP_REACH_MESSAGE,
  LoopSides,
  OBJECT_NOT_FOUND,
  OP,
  PAGE_NOT_FOUND,
  PATH_NEEDS_SIZE,
  REACH_MESSAGE,
  STORED,
  UNKNOWN_STENCIL,
  Z_ORDER_ZERO,
  addNamed,
  arrowheadRefusal,
  drawsArrowheads,
  endpointKindRefusal,
  groupHeight,
  hasLabel,
  isOpenLineNode,
  jsonText,
  labelMemberMessage,
  labelPosition,
  latentEdgeKey,
  loopEdgeTypeMessage,
  loopRuleRefusal,
  loopSideIsHorizontal,
  namesAnArrowhead,
  numberOf,
  owningGroup,
  planPathDraw,
  readLoopSides,
  refuseUnknownMembers as refuseUnknownMembersIn,
  settledCopy,
  spelledOf,
  styleTargetFor,
  templateKey,
  unknownLabelMember,
  whatItIs,
  wholeNumberText,
  setEndSteps,
  type MemberVocabulary,
  type PathPlan,
} from './helpers';

// ---------------------------------------------------------------- small readers

/** C++ `getMember`: the member, `null` for a JSON null, undefined when absent. */
function memberOf(node: JsonObject, name: string): JsonValue | undefined {
  return Object.prototype.hasOwnProperty.call(node, name) ? node[name] : undefined;
}

/** C++ `getField(name, std::string*)`: the member when it is a string, else ''. */
function stringOf(node: JsonObject, name: string): string {
  const v = memberOf(node, name);
  return typeof v === 'string' ? v : '';
}

// ---------------------------------------------------------------- route helpers (6473-6895)

function joinList(items: readonly string[]): string {
  return items.join(', ');
}

/** An edge type's name with its indefinite article: "a curve", "an orthogonal". */
function withArticle(typeName: string): string {
  const vowel = typeName !== '' && 'aeiou'.includes(typeName.charAt(0));
  return (vowel ? 'an ' : 'a ') + typeName;
}

function routeVocabulary(typeName: string, level: string, allowed: readonly string[]): MemberVocabulary {
  const list = joinList(allowed);
  const aType = withArticle(typeName);
  return {
    allowed,
    refusal: (member: string, location: string) =>
      `route has no member "${member}" at ${location}; ${aType} ${level} takes ${list}`,
  };
}

/** A present, non-null member. */
function present(node: JsonValue | undefined, name: string): boolean {
  if (!isJsonObject(node)) return false;
  const member = memberOf(node, name);
  return member !== undefined && member !== null;
}

function isBoolean(node: JsonValue | undefined, name: string): boolean {
  if (!isJsonObject(node)) return false;
  return typeof memberOf(node, name) === 'boolean';
}

function isNumber(node: JsonValue | undefined, name: string): boolean {
  return isJsonObject(node) && numberOf(memberOf(node, name)) !== null;
}

/** A leg's direction: exactly −1, 0 or 1 (`1.0` is 1). */
function unitDirection(node: JsonValue | undefined): number | null {
  const value = numberOf(node);
  if (value === null) return null;
  return value === -1 || value === 0 || value === 1 ? value : null;
}

/** A ParamMap with C++ `std::map` key order. */
function sortedParamMap(pm: ParamMap): JsonOut {
  const out: JsonOut = {};
  for (const k of Object.keys(pm).sort(byteOrder)) out[k] = pm[k] ?? 0;
  return out;
}

// ---------------------------------------------------------------- the class

export abstract class NodeOps extends CompilationBase {
  /** The object environment the codec builds objects with (C++: the global platform). */
  get objectEnv(): ObjectEnv {
    return this.codec.env.objects;
  }

  // ---------------------------------------------------------------- add_node

  doAddNode(opNode: JsonObject, at: number): boolean {
    const shapeId = stringOf(opNode, KEY.shape);
    if (shapeId === '') return this.failAt(INVALID_OPERATION, 'add_node needs a `shape` template id', at);

    // A path: the drawing is validated before anything is resolved; `draw` on any other shape is refused.
    const isPath = shapeId === PATH_SHAPE_ID;
    if (!isPath && memberOf(opNode, KEY.draw) !== undefined)
      return this.failAt(INVALID_OPERATION, DRAW_ONLY_ON_PATH, at);
    if (isPath && !this.checkPathOp(opNode, at)) return false;

    const size = this.resolveAddSize(opNode);
    if (size === null) {
      return this.failAt(
        UNKNOWN_STENCIL,
        `no stencil "${shapeId}": search for it with stencil_search rather than guessing an id`,
        at,
      );
    }
    const { stl, width, height, angle } = size;
    if (isPath) {
      if (!this.applyEntryStyles(opNode, stl, at)) return false;
      const arrow = memberOf(opNode, KEY.arrow);
      if (arrow !== undefined && arrow !== null && !this.checkArrowShape(arrow, at)) return false;
      if (namesAnArrowhead(arrow) && !drawsArrowheads(stl)) {
        return this.failAt(INVALID_OPERATION, arrowheadRefusal(stl, addNamed(opNode)), at);
      }
    }
    let cx = numberOf(memberOf(opNode, KEY.cx));
    let cy = numberOf(memberOf(opNode, KEY.cy));
    const hasCx = cx !== null;
    const hasCy = cy !== null;

    // The image reference: refused before anything is built.
    if (!this.applyImage(opNode, stl, at)) return false;

    // #14: a width or height of 0 or less.
    for (const dimension of [KEY.width, KEY.height]) {
      const sent = numberOf(memberOf(opNode, dimension));
      if (sent !== null && sent <= 0) {
        return this.failAt(
          INVALID_OPERATION,
          `add_node: ${dimension} must be greater than 0; leave it out for the stencil's own size`,
          at,
        );
      }
    }

    // Placement, for a node sent without `cx` and/or `cy`; a coordinate the agent gave is never altered.
    if (!hasCx || !hasCy) {
      const placed = this.placeAddNode(hasCx, hasCy, width, height, angle, cx ?? 0, cy ?? 0);
      cx = placed.cx;
      cy = placed.cy;
    }
    const x = cx ?? 0;
    const y = cy ?? 0;
    const { halfH } = placementHalfExtents(width, height, angle);
    this.hasPrev = true;
    this.prevCx = x;
    this.prevCy = y;
    this.prevHalfH = halfH;

    // The uuid for THIS op is the one the pre-pass minted for it, in op order.
    const addIndex = this.addCursor++;
    const objId = this.addedIds[addIndex];
    if (objId === undefined) {
      return this.failAt(INVALID_OPERATION, 'internal: ref pre-pass disagreed with the operation list', at);
    }
    stl.load();
    // The constructor runs the generator, so a generated shape's geometry comes from running it.
    const obj = new TemplatedObject(
      this.objectEnv,
      stl,
      Rect.fromCenter(new Point(x, y), width, height),
      angle,
      null,
      objId,
    );
    const tmpl = obj.shapeTemplate() as ShapeTemplate;

    if (!this.applyTexts(opNode, tmpl, obj, at)) return false;
    if (!this.applyTitle(opNode, tmpl, at)) return false;

    const templateParams = memberOf(opNode, KEY.templateParams);
    if (templateParams !== undefined) {
      if (!this.applyTemplateParams(templateParams, tmpl, at)) return false;
    }

    // B7: the style is a generator input too, so it goes on before the template is loaded.
    const style = memberOf(opNode, KEY.style);
    if (style !== undefined) {
      if (!this.applyStyle(style, obj.getDrawingProfile(), at, styleTargetFor(obj, tmpl), addNamed(opNode))) {
        return false;
      }
    }
    // A new node is new content (spec 06 §9): without a `font_family` it gets the bundled default
    // (not in kashi's backend-first mode, `newContentFont: false`, as the C++ MCP).
    if (this.ctx.newContentFont) stampNewContentFont(obj);

    // Text and parameters are generator inputs: the geometry is recomputed after them.
    tmpl.load();
    obj.generateData();

    const arrow = memberOf(opNode, KEY.arrow);
    if (arrow !== undefined) {
      if (!this.checkArrowShape(arrow, at)) return false;
      if (!isPath && namesAnArrowhead(arrow) && !drawsArrowheads(tmpl)) {
        return this.failAt(INVALID_OPERATION, arrowheadRefusal(tmpl, addNamed(opNode)), at);
      }
      if (!this.applyArrow(arrow, obj.arrows, at)) return false;
    }

    const zOrder = numberOf(memberOf(opNode, KEY.zOrder));
    if (zOrder !== null) {
      if (Math.trunc(zOrder) === 0) return this.failAt(INVALID_OPERATION, Z_ORDER_ZERO, at);
      obj.order = Math.trunc(zOrder);
    } else {
      obj.order = this.nextOrder(addIndex);
    }

    if (!hasCx || !hasCy) {
      // Reported as the object STORES them, so the entry and the frame's `params` agree.
      this.autoPlaced.push({ id: objId, ref: stringOf(opNode, K_REF), cx: obj.ds.cx(), cy: obj.ds.cy() });
    }

    this.newObjects.set(objId, obj);
    this.change(FrameKind.AddObjects, this.objPath(objId), this.codec.writeObject(obj));
    this.emitEmbeddedTemplates(obj);
    // An add conditions on nothing.
    return true;
  }

  /**
   * An `add_node`'s template, size and angle, for `doAddNode` and the placement scan alike. Null
   * when the op names no shape or the shape does not resolve (no refusal is recorded: the caller
   * decides).
   */
  resolveAddSize(opNode: JsonObject): AddSize | null {
    const shapeId = stringOf(opNode, KEY.shape);
    if (shapeId === '') return null;

    if (shapeId === PATH_SHAPE_ID) {
      const pw = numberOf(memberOf(opNode, KEY.width));
      const ph = numberOf(memberOf(opNode, KEY.height));
      if (pw === null || ph === null || pw <= 0 || ph <= 0) return null;
      const plan = planPathDraw(memberOf(opNode, KEY.draw));
      if (!plan.ok) return null;
      const built = this.buildPathTemplate(plan.value);
      if (built === null) return null;
      const pa = numberOf(memberOf(opNode, KEY.angle)) ?? 0;
      return { stl: built, width: pw, height: ph, angle: pa };
    }

    const resolved = this.resolveTemplate(shapeId);
    if (resolved === null) return null;
    const stl = resolved.stl;
    // The catalogue entry's `params` wins over the template's own `default` block.
    let w = resolved.defaultWidth ?? 0;
    let h = resolved.defaultHeight ?? 0;
    if (w <= 0 && stl.defaultAttr.width > 0) w = stl.defaultAttr.width;
    if (h <= 0 && stl.defaultAttr.height > 0) h = stl.defaultAttr.height;
    if (w <= 0) w = 1;
    if (h <= 0) h = 1;
    let a = stl.defaultAttr.angle;
    w = numberOf(memberOf(opNode, KEY.width)) ?? w;
    h = numberOf(memberOf(opNode, KEY.height)) ?? h;
    a = numberOf(memberOf(opNode, KEY.angle)) ?? a;
    return { stl, width: w, height: h, angle: a };
  }

  // ---------------------------------------------------------------- add_node: a path

  /** V1–V10 of /spec/write-path.md §2: V1 first, then the drawing. */
  checkPathOp(opNode: JsonObject, at: number): boolean {
    const w = numberOf(memberOf(opNode, KEY.width));
    const h = numberOf(memberOf(opNode, KEY.height));
    if (w === null || h === null || w <= 0 || h <= 0) return this.failAt(INVALID_OPERATION, PATH_NEEDS_SIZE, at);
    const plan = planPathDraw(memberOf(opNode, KEY.draw));
    if (!plan.ok) return this.failAt(INVALID_OPERATION, plan.message, at);
    return true;
  }

  /** The native template for a plan, parsed by the real codec (which picks the class by id). Unloaded. */
  buildPathTemplate(plan: PathPlan): ShapeTemplate | null {
    const body: JsonOut = {
      [consts.id]: plan.nativeId,
      [STORED.data]: [...plan.data],
      [STORED.draw]: plan.draws.map((cmds) => ({ [STORED.path]: cmds })),
      [STORED.flags]: plan.flags,
    };
    return this.codec.templates.parse(body);
  }

  /** V11: each entry's `style`, on that path's own stored style. */
  applyEntryStyles(opNode: JsonObject, stl: ShapeTemplate, at: number): boolean {
    const draw = memberOf(opNode, KEY.draw);
    const entries = Array.isArray(draw) ? (draw as readonly JsonValue[]) : [];
    const paths = stl.pathData;
    for (let i = 0; i < entries.length && i < paths.length; i++) {
      const entry = entries[i];
      const style = isJsonObject(entry) ? memberOf(entry, KEY.style) : undefined;
      if (style === undefined) continue;
      if (!this.applyStyle(style, (paths[i] as (typeof paths)[number]).style, at)) {
        const prefix = `draw[${String(i)}]`;
        this.errorMessage = this.errorMessage.startsWith('style.')
          ? `${prefix}.${this.errorMessage}`
          : `${prefix}.style: ${this.errorMessage}`;
        return false;
      }
    }
    return true;
  }

  // ---------------------------------------------------------------- placement

  /** Placement for an `add_node` without `cx` and/or `cy` (semantic-format.md §7). */
  placeAddNode(
    hasCx: boolean,
    hasCy: boolean,
    width: number,
    height: number,
    angle: number,
    cx: number,
    cy: number,
  ): { cx: number; cy: number } {
    this.buildTaken();
    const { halfW, halfH } = placementHalfExtents(width, height, angle);
    let x = cx;
    let y = cy;
    const first = this.taken[0];
    if (this.hasPrev) {
      if (!hasCx) x = this.prevCx;
      if (!hasCy) y = this.prevCy + this.prevHalfH + PLACEMENT_GAP + halfH;
    } else if (first !== undefined) {
      const bounds = { ...first };
      for (const box of this.taken) {
        bounds.minx = Math.min(bounds.minx, box.minx);
        bounds.miny = Math.min(bounds.miny, box.miny);
        bounds.maxx = Math.max(bounds.maxx, box.maxx);
        bounds.maxy = Math.max(bounds.maxy, box.maxy);
      }
      if (!hasCx) x = bounds.minx + halfW;
      if (!hasCy) y = bounds.maxy + PLACEMENT_GAP + halfH;
    } else {
      if (!hasCx) x = PLACEMENT_MARGIN + halfW;
      if (!hasCy) y = PLACEMENT_MARGIN + halfH;
    }
    const pushed = placementPushClear({ cx: x, cy: y }, halfW, halfH, !hasCy, this.taken);
    this.taken.push(placementBoxAt(pushed.cx, pushed.cy, halfW, halfH));
    return pushed;
  }

  /**
   * The taken set: what is on the page once the batch lands (existing survivors at their final
   * geometry, inflated for their stroke; the batch's fully placed adds). Connectors are not
   * obstacles. Built once, deterministically.
   */
  buildTaken(): void {
    if (this.takenBuilt) return;
    this.takenBuilt = true;
    const ops = this.ops();

    const changed = new Map<string, Map<string, number>>();
    for (const op of ops) {
      if (!isJsonObject(op)) continue;
      const name = stringOf(op, K_OP);
      let fields: readonly string[];
      if (name === OP.moveNode) fields = [KEY.cx, KEY.cy];
      else if (name === OP.resizeNode) fields = [KEY.width, KEY.height];
      else if (name === OP.rotateNode) fields = [KEY.angle];
      else continue;
      let named = stringOf(op, K_NODE);
      if (named === '') {
        named = stringOf(op, K_EDGE);
        if (named === '') continue;
      }
      const id = this.refs.get(named) ?? named;
      for (const field of fields) {
        const value = numberOf(memberOf(op, field));
        if (value === null) continue;
        let m = changed.get(id);
        if (m === undefined) {
          m = new Map();
          changed.set(id, m);
        }
        m.set(field, value);
      }
    }
    const finalOf = (id: string, field: string, current: number): number => changed.get(id)?.get(field) ?? current;

    for (const obj of this.pageObjects()) {
      if (!this.endOfBatchIds.has(obj.id) && !this.consumedByGroup.has(obj.id)) continue;
      if (obj instanceof ConnectionObject) continue;
      const stroke = obj.getDrawingProfile().effectiveStrokeWidth();
      let rect = obj instanceof TemplatedObject ? obj.getVisualBounds() : obj.visualBounds();
      if (changed.has(obj.id) && obj instanceof TemplatedObject) {
        const id = obj.id;
        const ds = obj.ds;
        const cx = finalOf(id, KEY.cx, ds.cx());
        const cy = finalOf(id, KEY.cy, ds.cy());
        const { halfW, halfH } = placementHalfExtents(
          finalOf(id, KEY.width, ds.width()),
          finalOf(id, KEY.height, ds.height()),
          finalOf(id, KEY.angle, ds.angle()),
        );
        // The title's reach beyond the box, carried to where the box ends up.
        const selection = obj.selectionRect();
        const left = selection.x - rect.x;
        const top = selection.y - rect.y;
        const right = rect.right() - selection.right();
        const bottom = rect.bottom() - selection.bottom();
        rect = new Rect(cx - halfW - left, cy - halfH - top, 2 * halfW + left + right, 2 * halfH + top + bottom);
      }
      rect = rect.inflate(stroke / 2);
      this.taken.push({ minx: rect.x, miny: rect.y, maxx: rect.right(), maxy: rect.bottom() });
    }

    // One uuid per `add_node` AND `add_edge`, in op order: counting both finds each add's id.
    let addIndex = 0;
    for (const op of ops) {
      if (!isJsonObject(op)) continue;
      const name = stringOf(op, K_OP);
      const isAddNode = name === OP.addNode;
      if (!isAddNode && name !== OP.addEdge) continue;
      const index = addIndex++;
      const id = this.addedIds[index];
      if (!isAddNode || id === undefined) continue;
      if (!this.endOfBatchIds.has(id)) continue;
      const cx = numberOf(memberOf(op, KEY.cx));
      const cy = numberOf(memberOf(op, KEY.cy));
      if (cx === null || cy === null) continue;
      const size = this.resolveAddSize(op);
      if (size === null) continue;
      const { halfW, halfH } = placementHalfExtents(
        finalOf(id, KEY.width, size.width),
        finalOf(id, KEY.height, size.height),
        finalOf(id, KEY.angle, size.angle),
      );
      this.taken.push(placementBoxAt(finalOf(id, KEY.cx, cx), finalOf(id, KEY.cy, cy), halfW, halfH));
    }
  }

  /**
   * The document-level `templates` entries for the templates a shape REFERENCES (its embeds and
   * its generator's embed references) and the document does not already hold.
   */
  emitEmbeddedTemplates(obj: TemplatedObject): void {
    const embeds = new Map<string, ShapeTemplate>();
    const embedRefs = new Set<string>();
    collectEmbedTemplates(obj, embeds, embedRefs);

    const wanted = new Map<string, ShapeTemplate>();
    for (const [id, stl] of embeds) {
      if (!this.doc.hasTemplate(id) && !this.emittedTemplateIds.has(id)) wanted.set(id, stl);
    }
    const prefix = `${consts.doc}.${consts.templates}.`;
    for (const ref of [...embedRefs].sort(byteOrder)) {
      if (this.doc.hasTemplate(ref) || this.emittedTemplateIds.has(ref) || wanted.has(ref)) continue;
      const stl = this.storeTemplate(ref) ?? this.docTemplate(ref);
      if (stl !== null) {
        this.change(FrameKind.AddObjects, prefix + templateKey(ref), this.codec.templates.serialize(stl));
        this.emittedTemplateIds.add(ref);
      }
    }
    for (const id of [...wanted.keys()].sort(byteOrder)) {
      this.change(
        FrameKind.AddObjects,
        prefix + templateKey(id),
        this.codec.templates.serialize(wanted.get(id) as ShapeTemplate),
      );
      this.emittedTemplateIds.add(id);
    }
  }

  // ---------------------------------------------------------------- self-loops

  /** spec/mcp-self-loop.md §§2.2-2.3: every rule of the table, then the loop's type and params. */
  selfLoopParams(
    opNode: JsonObject,
    at: number,
    node: LekhObject,
    named: string,
    sides: LoopSides,
    defaultType: ConnectionType,
    routeNeedsType: boolean,
  ): LoopParams | null {
    const routeValue = memberOf(opNode, KEY.route);
    const route = isJsonObject(routeValue) ? routeValue : null;
    const hasRoute = route !== null;

    const ruleMessage = loopRuleRefusal(opNode, sides, named, hasRoute);
    if (ruleMessage !== '') return this.failNull(INVALID_OPERATION, ruleMessage, at);
    if (isOpenLineNode(node)) {
      return this.failNull(INVALID_OPERATION, `"${named}" is an open line and cannot hold a self-loop`, at);
    }

    let type = defaultType;
    const edgeName = stringOf(opNode, KEY.edgeType);
    if (edgeName !== '') {
      const t = edgeTypeFromName(edgeName);
      if (t === null) return this.failNull(INVALID_OPERATION, edgeTypeMessage(edgeName), at);
      type = t;
    } else if (hasRoute && routeNeedsType) {
      return this.failNull(INVALID_OPERATION, 'a `route` needs the `edge_type` it belongs to', at);
    }
    if (!allowsSelfLoop(type)) {
      return this.failNull(INVALID_OPERATION, loopEdgeTypeMessage(named, edgeTypeName(type)), at);
    }

    const reach = this.readReach(opNode, at);
    if (reach === null) return null;
    if (reach.has && (hasRoute || type !== ConnectionType.MultiLine)) {
      return this.failNull(INVALID_OPERATION, LOOP_REACH_MESSAGE, at);
    }

    const config = this.config;
    const minEndDist = config.selfLoopMinEndDistance;
    const shape = settledCopy(node, config);
    let opts: SelfLoopOptions = selfLoopDefaults(config);

    if (route !== null) {
      const out = this.routeToParams(route, type, AutoType.NoAuto, at);
      if (out === null) return null;
      if (type === ConnectionType.Curve) {
        for (const pm of out) {
          if ((pm[P.angleauto] ?? 0) !== 0 || (pm[P.cdistauto] ?? 0) !== 0) {
            return this.failNull(
              INVALID_OPERATION,
              'a self-loop curve needs `angle_auto` and `control_distance_auto` false',
              at,
            );
          }
        }
      }
      const angleFrom = this.endpointAngle(route, KEY.from) ?? 0;
      const angleTo = this.endpointAngle(route, KEY.to) ?? 0;
      opts = { ...opts, minEndDist };
      const probe = buildSelfLoopParams(ConnectionType.Curve, shape, angleFrom, angleTo, opts, config);
      if (probe.error === SelfLoopError.EndsTooClose) {
        return this.failNull(
          INVALID_OPERATION,
          `a self-loop's ends must be at least ${wholeNumberText(minEndDist)} apart on "${named}"`,
          at,
        );
      }
      return { type, params: out };
    }

    const sameSide = sides.from === sides.to;
    const angleFrom = sideAngle(shape, sides.from, sameSide ? 0.25 : 0.5);
    const angleTo = sideAngle(shape, sides.to, sameSide ? 0.75 : 0.5);
    if (sameSide) opts = { ...opts, minEndDist };
    if (reach.has) opts = { ...opts, runOut: reach.value };
    if (relationOf(sides.from, sides.to) === SideRelation.Opposite) {
      // The bend names a side of the shape; an orthogonal loop rounds the world side nearest it.
      let bend: Side = sides.hasBend ? sides.bend : loopSideIsHorizontal(sides.from) ? Side.Top : Side.Right;
      if (type === ConnectionType.MultiLine) bend = worldSideOf(shape, bend);
      opts = { ...opts, bend: bendOf(bend) };
    }
    const r = buildSelfLoopParams(type, shape, angleFrom, angleTo, opts, config);
    if (r.error === SelfLoopError.EndsTooClose) {
      return this.failNull(
        INVALID_OPERATION,
        `"${named}" is too small for a self-loop on one side; use two different sides`,
        at,
      );
    }
    if (r.error !== SelfLoopError.None) {
      return this.failNull(INVALID_OPERATION, loopEdgeTypeMessage(named, edgeTypeName(type)), at);
    }
    return { type, params: r.params };
  }

  /** C++ `return failAt(…)` in a function whose TS answer is `T | null`. */
  private failNull(code: string, message: string, at: number): null {
    this.failAt(code, message, at);
    return null;
  }

  // ---------------------------------------------------------------- add_edge

  doAddEdge(opNode: JsonObject, at: number): boolean {
    const fromNamed = stringOf(opNode, KEY.from);
    const toNamed = stringOf(opNode, KEY.to);
    const fromId = this.refs.get(fromNamed) ?? fromNamed;
    const toId = this.refs.get(toNamed) ?? toNamed;

    // A backstop: the pre-pass settled every endpoint.
    const first = this.existingAnywhere(fromId);
    const second = this.existingAnywhere(toId);
    if (first === null || second === null) {
      return this.failAt(
        OBJECT_NOT_FOUND,
        `add_edge endpoint not found on page ${this.pageId} although the pre-pass accepted it: this is a compiler defect, not a fault in the batch`,
        at,
      );
    }
    if (first instanceof ConnectionObject || second instanceof ConnectionObject) {
      return this.failAt(INVALID_OPERATION, 'an edge joins two nodes; one of its endpoints is an edge', at);
    }
    for (const [end, named] of [
      [first, fromNamed],
      [second, toNamed],
    ] as const) {
      const kind = endpointKindRefusal(end, named);
      if (kind !== '') return this.failAt(INVALID_OPERATION, kind, at);
    }

    const addIndex = this.addCursor;
    const objId = this.addedIds[addIndex];
    const env = this.objectEnv;

    let con: ConnectionObject | null = null;
    if (fromId === toId) {
      const sides = new LoopSides();
      const sideMessage = readLoopSides(opNode, sides);
      if (sideMessage !== '') return this.failAt(INVALID_OPERATION, sideMessage, at);
      const loop = this.selfLoopParams(opNode, at, first, fromNamed, sides, ConnectionType.Curve, true);
      if (loop === null) return false;
      con = ConnectionObject.getConnection(env, first, first, loop.type, loop.params, objId);
    }

    let autoType: AutoType = AutoType.AutoLine;
    const autoName = stringOf(opNode, KEY.autoType);
    const hasAuto = autoName !== '';
    if (hasAuto) {
      const a = autoTypeFromName(autoName);
      if (a === null) return this.failAt(INVALID_OPERATION, autoTypeMessage(autoName), at);
      autoType = a;
    }

    const routeValue = memberOf(opNode, KEY.route);
    const route = isJsonObject(routeValue) ? routeValue : null;

    // A U-bend's reach needs a `u_bend_*` named beside it.
    const reach = this.readReach(opNode, at);
    if (reach === null) return false;
    if (con === null && reach.has && (route !== null || !hasAuto || !isUBend(autoType))) {
      return this.failAt(INVALID_OPERATION, REACH_MESSAGE, at);
    }

    if (con !== null) {
      // the self-loop, built above
    } else if (route !== null) {
      if (hasAuto && autoType !== AutoType.NoAuto) {
        return this.failAt(
          INVALID_OPERATION,
          'an automatic route is recomputed from the endpoints: name an `auto_type` or give a `route`, not both',
          at,
        );
      }
      const edgeName = stringOf(opNode, KEY.edgeType);
      const type = edgeName === '' ? null : edgeTypeFromName(edgeName);
      if (type === null) return this.failAt(INVALID_OPERATION, 'a `route` needs the `edge_type` it belongs to', at);
      const params = this.routeToParams(route, type, AutoType.NoAuto, at);
      if (params === null) return false;
      con = ConnectionObject.getConnection(env, first, second, type, params, objId);
    } else {
      if (hasAuto && autoType === AutoType.NoAuto) {
        return this.failAt(INVALID_OPERATION, 'auto_type `manual` needs a `route`: a fixed route IS its numbers', at);
      }
      con = ConnectionObject.getAutoConnection(env, first, second, autoType, undefined, objId);
      // The reach overwrites the probe's steps; it is never `getAutoConnection`'s `param`.
      if (reach.has) {
        const params = con.getParams();
        setEndSteps(params, reach.value, reach.value);
        con.setParams(params);
      }
    }

    this.addCursor++;
    if (objId === undefined) {
      return this.failAt(INVALID_OPERATION, 'internal: ref pre-pass disagreed with the operation list', at);
    }

    // A label is an object; `null` is no labels.
    const texts = memberOf(opNode, KEY.texts);
    if (texts !== undefined && texts !== null && !Array.isArray(texts)) {
      return this.failAt(INVALID_OPERATION, "add_edge's `texts` is an array of {text, position}", at);
    }
    if (Array.isArray(texts)) {
      const infos: { text: string; param: number }[] = [];
      for (const entry of texts as readonly JsonValue[]) {
        if (!isJsonObject(entry))
          return this.failAt(INVALID_OPERATION, 'each edge label is an object with a `text`', at);
        const unknown = unknownLabelMember(entry);
        if (unknown !== null) return this.failAt(INVALID_OPERATION, labelMemberMessage(unknown), at);
        const position = labelPosition(entry);
        if (!position.ok) return this.failAt(INVALID_OPERATION, position.message, at);
        infos.push({ text: stringOf(entry, KEY.text), param: position.value });
      }
      con.setTexts(infos);
    }

    const arrow = memberOf(opNode, KEY.arrow);
    if (arrow !== undefined) {
      if (!this.applyArrow(arrow, con.arrows, at)) return false;
    }

    const style = memberOf(opNode, KEY.style);
    if (style !== undefined) {
      let named = stringOf(opNode, K_REF);
      if (!this.applyStyle(style, con.getDrawingProfile(), at, StyleTarget.Edge, named === '' ? OP.addEdge : named)) {
        return false;
      }
      if (named === '') named = objId;
      // B.17's latent case: text keys on an edge with no label are kept, with a note.
      if (!hasLabel(con.textInfos()) && isJsonObject(style)) {
        this.noteLatentKeys(objId, named, sortedKeys(style).filter(latentEdgeKey));
      }
    }
    // A new edge is new content (spec 06 §9): its labels get the bundled default font (not with
    // `newContentFont: false`).
    if (this.ctx.newContentFont) stampNewContentFont(con);

    const zOrder = numberOf(memberOf(opNode, KEY.zOrder));
    if (zOrder !== null) {
      if (Math.trunc(zOrder) === 0) return this.failAt(INVALID_OPERATION, Z_ORDER_ZERO, at);
      con.order = Math.trunc(zOrder);
    } else {
      con.order = this.nextOrder(addIndex);
    }

    this.newObjects.set(objId, con);
    // A node and the edge reaching it go in the same frame.
    this.change(FrameKind.AddObjects, this.objPath(objId), this.codec.writeObject(con));
    return true;
  }

  // ---------------------------------------------------------------- delete

  doDeleteObject(opNode: JsonObject, at: number, isNode: boolean): boolean {
    const id = this.resolveId(opNode, at, isNode);
    if (id === null) return false;
    const deleteOp = isNode ? OP.deleteNode : OP.deleteEdge;
    const obj = this.existing(id, at, deleteOp);
    if (obj === null) return this.failAt(OBJECT_NOT_FOUND, `no object "${id}" on page ${this.pageId}`, at);
    if (isNode && obj instanceof ConnectionObject) {
      return this.failAt(INVALID_OPERATION, `"${id}" is an edge; use delete_edge`, at);
    }
    if (!isNode && !(obj instanceof ConnectionObject)) {
      return this.failAt(INVALID_OPERATION, `"${id}" is a node; use delete_node`, at);
    }

    this.change(FrameKind.DelObjects, this.objPath(id), null);
    // A delete conditions on the object existing, nothing finer.
    this.conditionExists(FrameKind.DelObjects, this.objPath(id));

    if (isNode) {
      for (const con of this.page.objectStore.connectionsOf(obj)) {
        this.change(FrameKind.DelObjects, this.objPath(con.id), null);
        this.conditionExists(FrameKind.DelObjects, this.objPath(con.id));
        this.reportedDeletedEdges.add(con.id);
      }
    }
    return true;
  }

  doClearPage(opNode: JsonObject, at: number): boolean {
    // The op's own `page`: absent, the batch's page; present, the page it names.
    let pageId = this.pageId;
    const named = memberOf(opNode, K_PAGE);
    if (named !== undefined) {
      if (typeof named !== 'string' || named === '') {
        return this.failAt(INVALID_OPERATION, "clear_page's `page` is a page id, as board_outline lists it", at);
      }
      pageId = named;
      this.buildPageOrder();
      // A page this batch has already deleted is not there any more, and one it adds cannot be named.
      if (this.doc.getPage(pageId) === null || !this.pageOrder.includes(pageId)) {
        return this.failAt(PAGE_NOT_FOUND, `no page "${pageId}" on this board`, at);
      }
    }
    const page = pageId === this.pageId ? this.page : this.doc.getPage(pageId);
    if (page === null) return this.failAt(PAGE_NOT_FOUND, `no page "${pageId}" on this board`, at);
    // One null change per object on the page at compile time, never the whole map; no condition.
    const objectsPath = `${this.pagePath(pageId)}.${consts.objects}.`;
    for (const obj of page.objectStore.objects) this.change(FrameKind.DelObjects, objectsPath + obj.id, null);
    return true;
  }

  // ---------------------------------------------------------------- group / ungroup

  /** One `convertobjects` frame carries every group and ungroup: refuse a consumption of another's output. */
  checkConvertConsumes(opName: string, ids: readonly string[], at: number): boolean {
    for (const id of ids) {
      const produced = this.convertProduced.get(id);
      if (produced !== undefined) {
        return this.failAt(
          INVALID_OPERATION,
          `${opName} at operation ${String(at)} consumes "${id}", which operation ${String(produced)} produces. One \`convertobjects\` frame carries every group and ungroup of a batch, so it cannot both write and remove the same object — split the batch`,
          at,
        );
      }
      const consumed = this.convertConsumed.get(id);
      if (consumed !== undefined) {
        return this.failAt(
          INVALID_OPERATION,
          `${opName} at operation ${String(at)} names "${id}", which operation ${String(consumed)} already consumed — it is no longer on the page at that point — split the batch`,
          at,
        );
      }
    }
    return true;
  }

  recordConvert(consumes: readonly string[], produces: readonly string[], at: number): void {
    for (const id of consumes) this.convertConsumed.set(id, at);
    for (const id of produces) this.convertProduced.set(id, at);
  }

  /** group — `{ "op": "group", "nodes": [ … ], "ref": "g1" }`, built over detached copies. */
  doGroup(opNode: JsonObject, at: number): boolean {
    const named = memberOf(opNode, KEY.nodes);
    if (!Array.isArray(named)) {
      return this.failAt(INVALID_OPERATION, 'group needs `nodes`, the ids of the objects to group', at);
    }
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const item of named as readonly JsonValue[]) {
      if (typeof item !== 'string' || item === '') {
        return this.failAt(INVALID_OPERATION, 'every entry of group `nodes` is an object id or a `ref`', at);
      }
      const id = this.refs.get(item) ?? item;
      if (seen.has(id)) {
        return this.failAt(
          INVALID_OPERATION,
          `group names "${item}" twice; each member is named once, and a repeated id would corrupt the member list`,
          at,
        );
      }
      seen.add(id);
      ids.push(id);
    }
    if (ids.length < 2) {
      return this.failAt(
        INVALID_OPERATION,
        `a group needs at least two objects; this one names ${String(ids.length)}`,
        at,
      );
    }
    if (!this.checkConvertConsumes(OP.group, ids, at)) return false;

    const members: TemplatedObject[] = [];
    let deepest = 0;
    for (const id of ids) {
      // Top level only: a member that resolved into a group would be quietly reparented.
      const obj = this.newObjects.get(id) ?? this.page.objectStore.getObject(id);
      if (obj === null) {
        const owner = owningGroup(this.pageObjects(), id);
        if (owner !== null) {
          return this.failAt(
            INVALID_OPERATION,
            `"${id}" is already inside group "${owner.id}". An object cannot be moved from one group into another; ungroup "${owner.id}" first`,
            at,
          );
        }
        return this.failAt(OBJECT_NOT_FOUND, `no object "${id}" on page ${this.pageId}`, at);
      }
      if (obj instanceof ConnectionObject) {
        return this.failAt(
          INVALID_OPERATION,
          `"${id}" is an edge, and a connector cannot be a group member; group the nodes it joins and it follows them`,
          at,
        );
      }
      if (!(obj instanceof TemplatedObject)) {
        return this.failAt(
          INVALID_OPERATION,
          `"${id}" is ${whatItIs(obj)} and cannot be a group member: \`GroupObject\` holds templated shapes`,
          at,
        );
      }
      members.push(obj);
      const height = obj instanceof GroupObject ? groupHeight(obj) : 0;
      if (height > deepest) deepest = height;
    }

    // The cap is a property of the surface.
    const resulting = deepest + 1;
    if (resulting > MAX_GROUP_DEPTH) {
      return this.failAt(
        INVALID_OPERATION,
        `this group would nest its contents ${String(resulting)} groups deep; this surface carries ${String(MAX_GROUP_DEPTH)}`,
        at,
      );
    }

    // The uuid and the `ref` are the pre-pass's.
    const groupId = this.addedGroupIds[this.groupCursor];
    if (groupId === undefined) {
      return this.failAt(
        INVALID_OPERATION,
        `group at operation ${String(at)} was not seen by the pre-pass: this is a compiler defect, not a fault in the batch`,
        at,
      );
    }
    this.groupCursor++;

    // Built over COPIES: building a group writes to its members.
    const copies: TemplatedObject[] = [];
    for (const member of members) {
      const copy = this.detachedCopy(member);
      if (copy === null) {
        return this.failAt(
          INVALID_OPERATION,
          `"${member.id}" could not be copied to build the group: this is a compiler defect, not a fault in the batch`,
          at,
        );
      }
      copies.push(copy);
    }
    const gobj = new GroupObject(this.objectEnv, copies, groupId);

    // The group takes its first member's order; 0 means "no order" to the loader.
    const firstMember = gobj.objects()[0];
    let base = firstMember === undefined ? 0 : firstMember.object.order;
    if (base === 0) base = this.nextOrder(0);
    gobj.order = base;

    this.change(FrameKind.ConvertObjects, this.objPath(groupId), this.codec.writeObject(gobj));
    for (const id of ids) {
      this.change(FrameKind.ConvertObjects, this.objPath(id), null);
      // group conditions on each member existing.
      this.conditionExists(FrameKind.ConvertObjects, this.objPath(id));
    }
    this.recordConvert(ids, [groupId], at);
    // A later operation of this batch can address the new group.
    this.newObjects.set(groupId, gobj);
    return true;
  }

  /** ungroup — `{ "op": "ungroup", "node": "<groupId>" }`: dissolves exactly one level. */
  doUngroup(opNode: JsonObject, at: number): boolean {
    const id = this.resolveId(opNode, at, true);
    if (id === null) return false;
    if (!this.checkConvertConsumes(OP.ungroup, [id], at)) return false;

    const obj = this.page.objectStore.getObject(id);
    if (obj === null) {
      const owner = owningGroup(this.pageObjects(), id);
      if (owner !== null) {
        return this.failAt(
          INVALID_OPERATION,
          `"${id}" is inside group "${owner.id}". ungroup dissolves one level, so ungroup "${owner.id}" first and "${id}" lands on the page as a group`,
          at,
        );
      }
      return this.failAt(OBJECT_NOT_FOUND, `no object "${id}" on page ${this.pageId}`, at);
    }
    if (!(obj instanceof GroupObject)) {
      return this.failAt(INVALID_OPERATION, `ungroup addresses a group; "${id}" is ${whatItIs(obj)}`, at);
    }

    // The store keeps its objects arranged by order: the index IS the stacking position.
    const objects = this.pageObjects();
    const index = objects.indexOf(obj);
    if (index < 0) return this.failAt(OBJECT_NOT_FOUND, `"${id}" is not in the page's stacking order`, at);

    const skipZero = (order: number): number => (order === 0 ? 1 : order);
    const contained = obj.objects();
    const memberOrders: number[] = [];
    let previous = 0;
    for (let i = 0; i < contained.length; i++) {
      previous = i === 0 ? skipZero(obj.order) : skipZero(previous + 1);
      memberOrders.push(previous);
    }

    // Everything above the group is pushed one further, until the first object already clear.
    const shifts: [LekhObject, number][] = [];
    if (memberOrders.length > 0) {
      for (let k = index + 1; k < objects.length; k++) {
        const above = objects[k] as LekhObject;
        if (above.order > previous) break;
        previous = skipZero(previous + 1);
        shifts.push([above, previous]);
      }
    }

    for (let i = 0; i < contained.length; i++) {
      const member = (contained[i] as (typeof contained)[number]).object;
      // The stored order of an old member is 0: the computed one replaces it.
      const node: JsonOut = { ...this.codec.writeObject(member), [consts.order]: memberOrders[i] ?? 0 };
      this.change(FrameKind.ConvertObjects, this.objPath(member.id), node);
    }

    this.change(FrameKind.ConvertObjects, this.objPath(id), null);
    // ungroup conditions on the group existing.
    this.conditionExists(FrameKind.ConvertObjects, this.objPath(id));

    for (const [neighbour] of shifts) {
      if (!this.refuseShiftOfRemoved(OP.ungroup, spelledOf(opNode), neighbour.id, at)) return false;
    }
    for (const [neighbour, order] of shifts) {
      const path = `${this.objPath(neighbour.id)}.${consts.order}`;
      this.change(FrameKind.ChangeAttr, path, order);
      this.condition(FrameKind.ChangeAttr, path, neighbour.order);
    }

    this.recordConvert(
      [id],
      contained.map((m) => m.object.id),
      at,
    );
    return true;
  }

  // ---------------------------------------------------------------- geometry

  doMoveResizeRotate(opNode: JsonObject, at: number, opName: string): boolean {
    const id = this.resolveId(opNode, at, true);
    if (id === null) return false;
    // A group is an ordinary target here.
    const tobj = this.existingTemplated(id, at, opName, true);
    if (tobj === null) return false;

    const ds = tobj.ds;
    const w = this.workingFor(id, tobj);
    interface Field {
      readonly key: string;
      readonly stored: string;
      readonly current: number;
      readonly set: (v: number) => void;
    }
    let fields: Field[];
    if (opName === OP.moveNode) {
      fields = [
        { key: KEY.cx, stored: consts.cx, current: ds.cx(), set: (v) => (w.cx = v) },
        { key: KEY.cy, stored: consts.cy, current: ds.cy(), set: (v) => (w.cy = v) },
      ];
    } else if (opName === OP.resizeNode) {
      fields = [
        { key: KEY.width, stored: consts.width, current: ds.width(), set: (v) => (w.width = v) },
        { key: KEY.height, stored: consts.height, current: ds.height(), set: (v) => (w.height = v) },
      ];
    } else {
      fields = [{ key: KEY.angle, stored: consts.angle, current: ds.angle(), set: (v) => (w.angle = v) }];
    }

    // #14: a size of 0 or less is refused before anything is emitted.
    const isResize = opName === OP.resizeNode;
    if (isResize) {
      for (const field of fields) {
        const value = numberOf(memberOf(opNode, field.key));
        if (value !== null && value <= 0) {
          return this.failAt(INVALID_OPERATION, `${opName}: ${field.key} must be greater than 0`, at);
        }
      }
    }

    let any = false;
    for (const field of fields) {
      const value = numberOf(memberOf(opNode, field.key));
      if (value === null) continue;
      any = true;
      const path = `${this.objPath(id)}.${consts.params}.${field.stored}`;
      this.change(FrameKind.ChangeAttr, path, value);
      // Conditions on the value the compiler read, never a working value.
      this.condition(FrameKind.ChangeAttr, path, field.current);
      field.set(value);
    }
    if (!any) return this.failAt(INVALID_OPERATION, `${opName} needs at least one of the values it changes`, at);

    // B5: a resize the kind re-derives is refused (a group is not probed).
    if (isResize && !(tobj instanceof GroupObject)) {
      const width = numberOf(memberOf(opNode, KEY.width));
      const height = numberOf(memberOf(opNode, KEY.height));
      if (!this.refuseRederivedResize(id, tobj, w, width !== null, width ?? 0, height !== null, height ?? 0, at)) {
        return false;
      }
    }
    return true;
  }

  /** B5 — a resize nothing would draw: probe the working template at the requested size. */
  refuseRederivedResize(
    id: string,
    tobj: TemplatedObject,
    w: Working,
    namedWidth: boolean,
    width: number,
    namedHeight: boolean,
    height: number,
    at: number,
  ): boolean {
    if (w.tnode === null || this.currentTemplate(w, tobj) === null) return true;
    const parsed = this.codec.templates.parse(w.tnode);
    if (parsed === null) return true;
    parsed.load();
    const textSized = parsed instanceof TextTemplate;
    const probe = new TemplatedObject(
      this.objectEnv,
      parsed,
      Rect.fromCenter(new Point(w.cx, w.cy), w.width, w.height),
      w.angle,
      null,
      id,
    );
    const differs = (probed: number, requested: number): boolean => {
      const expected = Math.max(requested, 1);
      const tolerance = 1e-3 * Math.max(1, Math.abs(requested));
      return Math.abs(probed - expected) > tolerance;
    };
    let dimension: string | null = null;
    if (namedWidth && differs(probe.ds.width(), width)) dimension = KEY.width;
    else if (namedHeight && differs(probe.ds.height(), height)) dimension = KEY.height;
    if (dimension === null) return true;
    const what = textSized ? 'its text and font_size' : 'its content: its texts, style and template_params';
    return this.failAt(
      INVALID_OPERATION,
      `resize_node: the ${dimension} of "${id}" follows ${what}, so a resize would store a size nothing draws; change ${what} instead`,
      at,
    );
  }

  /** A neighbour the batch takes off the page: its order write would build a half object. */
  refuseShiftOfRemoved(opName: string, spelled: string, neighbour: string, at: number): boolean {
    let removal: string;
    let by: number;
    const consumed = this.consumedByGroup.get(neighbour);
    const dissolved = this.ungroupedAt.get(neighbour);
    if (consumed !== undefined) {
      removal = 'group';
      by = consumed;
    } else if (dissolved !== undefined) {
      removal = 'ungroup';
      by = dissolved;
    } else {
      return true;
    }
    return this.failAt(
      INVALID_OPERATION,
      `${opName} of "${spelled}" also moves "${neighbour}" to keep the stacking order, but operation ${String(by)} ${removal}s it in this batch, and a batch writes its groups and ungroups before its other changes, so that move would miss it. Send the ${opName} and the ${removal} in separate batches`,
      at,
    );
  }

  doReorder(opNode: JsonObject, at: number): boolean {
    const id = this.resolveId(opNode, at, true, true);
    if (id === null) return false;
    // B.4: an object this batch creates has no stacking position yet.
    const minted = this.mintedAt.get(id);
    if (minted !== undefined) {
      const isGroup = this.addedGroupIds.includes(id);
      return this.failAt(
        INVALID_OPERATION,
        `"${spelledOf(opNode)}" is created by this batch (operation ${String(minted)}) and has no stacking order until the batch is stored; ` +
          (isGroup ? 'reorder it in the next batch' : 'give its add_node or add_edge a z_order instead'),
        at,
      );
    }
    const obj = this.existing(id, at, OP.reorder);
    if (obj === null) return this.failAt(OBJECT_NOT_FOUND, `no object "${id}" on page ${this.pageId}`, at);
    const to = stringOf(opNode, K_TO);
    if (to === '') return this.failAt(INVALID_OPERATION, 'reorder needs `to`: front, back, forward or backward', at);

    const objects = this.pageObjects();
    const index = objects.indexOf(obj);
    if (index < 0) {
      return this.failAt(
        OBJECT_NOT_FOUND,
        `"${id}" is not in the page's stacking order; a node created by this batch cannot be reordered in it`,
        at,
      );
    }

    const count = objects.length;
    const orderAt = (i: number): number => (objects[i] as LekhObject).order;
    const writes: [LekhObject, number][] = [];
    // A computed 0 steps once more in the direction of travel.
    const skipZero = (order: number, step: number): number => (order === 0 ? step : order);

    const moveBetween = (nearIndex: number, step: number): void => {
      const nearOrder = orderAt(nearIndex);
      const farIndex = nearIndex + step;
      const farOrder = orderAt(farIndex);
      let previous =
        (farOrder - nearOrder) * step >= 2 ? nearOrder + Math.trunc((farOrder - nearOrder) / 2) : nearOrder + step;
      previous = skipZero(previous, step);
      writes.push([obj, previous]);
      for (let k = farIndex; k >= 0 && k < count; k += step) {
        const current = orderAt(k);
        if ((current - previous) * step > 0) break;
        previous = skipZero(previous + step, step);
        writes.push([objects[k] as LekhObject, previous]);
      }
    };

    const strictlyTop = index === count - 1 && (count === 1 || orderAt(count - 2) < orderAt(count - 1));
    const strictlyBottom = index === 0 && (count === 1 || orderAt(1) > orderAt(0));
    const tiedTop = index === count - 1 && !strictlyTop;
    const tiedBottom = index === 0 && !strictlyBottom;

    if (to === 'front') {
      if (strictlyTop) return true;
      writes.push([obj, skipZero(orderAt(count - 1) + 100, 1)]);
    } else if (to === 'back') {
      if (strictlyBottom) return true;
      writes.push([obj, skipZero(orderAt(0) - 100, -1)]);
    } else if (to === 'forward') {
      if (strictlyTop) return true;
      if (tiedTop) writes.push([obj, skipZero(obj.order + 1, 1)]);
      else if (index + 2 < count) moveBetween(index + 1, 1);
      else writes.push([obj, skipZero(orderAt(count - 1) + 100, 1)]);
    } else if (to === 'backward') {
      if (strictlyBottom) return true;
      if (tiedBottom) writes.push([obj, skipZero(obj.order - 1, -1)]);
      else if (index - 1 > 0) moveBetween(index - 1, -1);
      else writes.push([obj, skipZero(orderAt(0) - 100, -1)]);
    } else {
      return this.failAt(INVALID_OPERATION, `reorder \`to\` must be front, back, forward or backward, not "${to}"`, at);
    }

    for (const [target] of writes) {
      if (target === obj) continue;
      if (!this.refuseShiftOfRemoved(OP.reorder, spelledOf(opNode), target.id, at)) return false;
    }
    // `z_order` is the STORED `order`.
    for (const [target, order] of writes) {
      const path = `${this.objPath(target.id)}.${consts.order}`;
      this.change(FrameKind.ChangeAttr, path, order);
      this.condition(FrameKind.ChangeAttr, path, target.order);
    }
    return true;
  }

  // ---------------------------------------------------------------- route helpers

  /** An endpoint's `angle`, or null. */
  endpointAngle(route: JsonObject, which: string): number | null {
    const endpoint = memberOf(route, which);
    if (!isJsonObject(endpoint)) return null;
    return numberOf(memberOf(endpoint, KEY.angle));
  }

  /** `route` back to `params`: the exact inverse of the projector's route. */
  routeToParams(route: JsonObject, type: ConnectionType, autoType: AutoType, at: number): Params | null {
    const out: Params = [];
    const hasSegments = memberOf(route, KEY.segments) !== undefined;
    const hasPoints = memberOf(route, KEY.points) !== undefined;
    const typeName = edgeTypeName(type);
    const aType = withArticle(typeName);
    const wrongShape = (why: string): null => this.failNull(INVALID_OPERATION, `${aType} route ${why}`, at);
    const needs = (name: string, location: string): null =>
      this.failNull(INVALID_OPERATION, `route for ${aType} edge needs "${name}" on ${location}`, at);
    const endpointsClosed = (vocabulary: MemberVocabulary): boolean => {
      for (const which of [KEY.from, KEY.to]) {
        const endpoint = memberOf(route, which);
        if (!isJsonObject(endpoint)) continue;
        if (!this.refuseUnknownMembers(endpoint, vocabulary, which, at)) return false;
      }
      return true;
    };
    const needsAngles = (): boolean => {
      for (const which of [KEY.from, KEY.to]) {
        if (!isNumber(memberOf(route, which), KEY.angle)) {
          needs(KEY.angle, which);
          return false;
        }
      }
      return true;
    };

    if (type === ConnectionType.Curve) {
      if (hasSegments || hasPoints)
        return wrongShape('carries `from` and `to` only, with no `segments` and no `points`');
      const names = [KEY.from, KEY.to];
      for (const name of names) {
        if (!isJsonObject(memberOf(route, name))) return wrongShape('needs both a `from` and a `to` endpoint');
      }
      if (!this.refuseUnknownMembers(route, routeVocabulary(typeName, 'route', [KEY.from, KEY.to]), 'route', at)) {
        return null;
      }
      if (
        !endpointsClosed(
          routeVocabulary(typeName, 'endpoint', [
            KEY.angle,
            KEY.angle2,
            KEY.angleAuto,
            KEY.controlDistance,
            KEY.controlDistanceAuto,
          ]),
        )
      ) {
        return null;
      }
      for (const name of names) {
        const endpoint = memberOf(route, name) as JsonObject;
        for (const n of [KEY.angle, KEY.angle2]) if (!isNumber(endpoint, n)) return needs(n, name);
        if (!isBoolean(endpoint, KEY.angleAuto)) return needs(KEY.angleAuto, name);
        if (!isNumber(endpoint, KEY.controlDistance)) return needs(KEY.controlDistance, name);
        if (!isBoolean(endpoint, KEY.controlDistanceAuto)) return needs(KEY.controlDistanceAuto, name);
      }
      for (const name of names) {
        const endpoint = memberOf(route, name) as JsonObject;
        const pm: ParamMap = {};
        pm[P.angle1] = numberOf(memberOf(endpoint, KEY.angle)) ?? 0;
        // `angle2` keeps its stored name, so the translation stays lossless.
        pm[P.angle2] = numberOf(memberOf(endpoint, KEY.angle2)) ?? 0;
        pm[P.cdist1] = numberOf(memberOf(endpoint, KEY.controlDistance)) ?? 0;
        pm[P.angleauto] = memberOf(endpoint, KEY.angleAuto) === true ? 1 : 0;
        pm[P.cdistauto] = memberOf(endpoint, KEY.controlDistanceAuto) === true ? 1 : 0;
        out.push(pm);
      }
      return out;
    }

    if (type === ConnectionType.GenericLine) {
      if (hasSegments || hasPoints)
        return wrongShape('carries `from` and `to` only, with no `segments` and no `points`');
      if (!this.refuseUnknownMembers(route, routeVocabulary(typeName, 'route', [KEY.from, KEY.to]), 'route', at)) {
        return null;
      }
      if (!endpointsClosed(routeVocabulary(typeName, 'endpoint', [KEY.angle]))) return null;
      if (!needsAngles()) return null;
      // `autotype` is regenerated in every case, `manual` included, as 0.
      out.push({ [P.angle]: this.endpointAngle(route, KEY.from) ?? 0, [P.autotype]: autoType });
      out.push({ [P.angle]: this.endpointAngle(route, KEY.to) ?? 0 });
      return out;
    }

    if (type === ConnectionType.MultiLine) {
      if (hasPoints) return wrongShape('carries `segments`, not `points`');
      const segmentsValue = memberOf(route, KEY.segments);
      if (!Array.isArray(segmentsValue) || segmentsValue.length < 2) {
        return wrongShape('needs a `segments` array of at least two entries');
      }
      const segments = segmentsValue as readonly JsonValue[];
      for (const segment of segments) {
        if (!isJsonObject(segment)) return wrongShape('has a `segments` entry that is not an object');
      }
      if (
        !this.refuseUnknownMembers(
          route,
          routeVocabulary(typeName, 'route', [KEY.from, KEY.to, KEY.segments]),
          'route',
          at,
        )
      ) {
        return null;
      }
      if (!endpointsClosed(routeVocabulary(typeName, 'endpoint', [KEY.angle]))) return null;
      const segmentVocabulary = routeVocabulary(typeName, 'segment', [KEY.length, KEY.dx, KEY.dy]);
      for (let i = 0; i < segments.length; i++) {
        if (!this.refuseUnknownMembers(segments[i], segmentVocabulary, `segments[${String(i)}]`, at)) return null;
      }
      if (!needsAngles()) return null;
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i] as JsonObject;
        const location = `segments[${String(i)}]`;
        for (const name of [KEY.length, KEY.dx, KEY.dy]) if (!present(segment, name)) return needs(name, location);
        // H3: `dx` and `dy` are the leg's unit direction, `length` its distance.
        const dx = unitDirection(memberOf(segment, KEY.dx));
        const dy = unitDirection(memberOf(segment, KEY.dy));
        const length = numberOf(memberOf(segment, KEY.length));
        if (dx === null || dy === null || (dx !== 0 && dy !== 0) || length === null || length < 0) {
          this.failAt(
            INVALID_OPERATION,
            `orthogonal segment ${String(i)}: dx and dy are a direction (-1, 0 or 1, not both non-zero), and length is the distance; got dx=${jsonText(memberOf(segment, KEY.dx))}, dy=${jsonText(memberOf(segment, KEY.dy))}`,
            at,
          );
          return null;
        }
        out.push({ [P.step]: length, [P.dx]: dx, [P.dy]: dy });
      }
      const front = out[0] as ParamMap;
      const back = out[out.length - 1] as ParamMap;
      front[P.autotype] = autoType;
      front[P.angle] = this.endpointAngle(route, KEY.from) ?? 0;
      back[P.angle] = this.endpointAngle(route, KEY.to) ?? 0;
      return out;
    }

    // Path.
    if (hasSegments) return wrongShape('carries `points`, not `segments`');
    const pointsValue = memberOf(route, KEY.points);
    if (!Array.isArray(pointsValue) || pointsValue.length < 2) {
      return wrongShape('needs a `points` array of at least two entries');
    }
    const points = pointsValue as readonly JsonValue[];
    if (
      !this.refuseUnknownMembers(route, routeVocabulary(typeName, 'route', [KEY.from, KEY.to, KEY.points]), 'route', at)
    ) {
      return null;
    }
    if (!endpointsClosed(routeVocabulary(typeName, 'endpoint', [KEY.angle]))) return null;
    const pointVocabulary = routeVocabulary(typeName, 'point', [
      KEY.dx,
      KEY.dy,
      KEY.angle,
      KEY.controlIn,
      KEY.controlOut,
    ]);
    const last = points.length - 1;
    for (let i = 0; i <= last; i++) {
      const point = points[i];
      if (!isJsonObject(point)) return wrongShape('has a `points` entry that is not an object');
      const location = `points[${String(i)}]`;
      if (!this.refuseUnknownMembers(point, pointVocabulary, location, at)) return null;
      for (const control of [KEY.controlIn, KEY.controlOut]) {
        if (
          !this.refuseUnknownMembers(
            memberOf(point, control),
            routeVocabulary(typeName, control, [KEY.dx, KEY.dy]),
            `${location}.${control}`,
            at,
          )
        ) {
          return null;
        }
      }
      const pm: ParamMap = {};
      const dx = numberOf(memberOf(point, KEY.dx));
      if (dx === null) return wrongShape('needs `dx` on every point');
      pm[P.dx] = dx;
      const dy = numberOf(memberOf(point, KEY.dy));
      if (dy === null) return wrongShape('needs `dy` on every point');
      pm[P.dy] = dy;

      const controlIn = memberOf(point, KEY.controlIn);
      const controlOut = memberOf(point, KEY.controlOut);
      if ((controlIn !== undefined) !== (controlOut !== undefined)) {
        return wrongShape('needs `control_in` and `control_out` together, or neither');
      }
      if (controlIn !== undefined) {
        const inX = isJsonObject(controlIn) ? numberOf(memberOf(controlIn, KEY.dx)) : null;
        const inY = isJsonObject(controlIn) ? numberOf(memberOf(controlIn, KEY.dy)) : null;
        if (inX === null || inY === null) return wrongShape('has a `control_in` without `dx` and `dy`');
        pm[P.dc1x] = inX;
        pm[P.dc1y] = inY;
        const outX = isJsonObject(controlOut) ? numberOf(memberOf(controlOut, KEY.dx)) : null;
        const outY = isJsonObject(controlOut) ? numberOf(memberOf(controlOut, KEY.dy)) : null;
        if (outX === null || outY === null) return wrongShape('has a `control_out` without `dx` and `dy`');
        pm[P.dc2x] = outX;
        pm[P.dc2y] = outY;
      }

      if (i === 0) {
        const a = this.endpointAngle(route, KEY.from);
        if (a === null) return wrongShape('needs an angle on its `from` endpoint');
        pm[P.angle] = a;
      } else if (i === last) {
        const a = this.endpointAngle(route, KEY.to);
        if (a === null) return wrongShape('needs an angle on its `to` endpoint');
        pm[P.angle] = a;
      } else {
        // A middle point's own angle, carried under its own name.
        const a = numberOf(memberOf(point, KEY.angle));
        if (a !== null) pm[P.angle] = a;
      }
      out.push(pm);
    }
    return out;
  }

  /** `reach`: `{ has, value }`, or null after a failAt. */
  readReach(opNode: JsonObject, at: number): { has: boolean; value: number } | null {
    const node = memberOf(opNode, KEY.reach);
    if (node === undefined) return { has: false, value: 0 };
    const value = numberOf(node);
    if (value === null || !(value > 0)) return this.failNull(INVALID_OPERATION, REACH_MESSAGE, at);
    return { has: true, value };
  }

  /** The frame of a `set_edge_route`: new params and type, on the condition of the type it was found with. */
  emitEdgeRoute(id: string, params: Params, type: ConnectionType, currentType: ConnectionType): void {
    this.change(FrameKind.ChangeConnectionParams, `${this.objPath(id)}.${consts.params}`, params.map(sortedParamMap));
    if (type !== ConnectionType.Path) {
      this.change(FrameKind.ChangeConnectionParams, `${this.objPath(id)}.${consts.ctype}`, type);
    }
    this.condition(FrameKind.ChangeConnectionParams, `${this.objPath(id)}.${consts.ctype}`, currentType);
  }

  refuseUnknownMembers(
    node: JsonValue | undefined,
    vocabulary: MemberVocabulary,
    location: string,
    at: number,
  ): boolean {
    const message = refuseUnknownMembersIn(node, vocabulary, location);
    if (message === '') return true;
    return this.failAt(INVALID_OPERATION, message, at);
  }
}

/** A loop side as the bend the builder takes. */
function bendOf(side: Side): Bend {
  switch (side) {
    case Side.Top:
      return Bend.Top;
    case Side.Right:
      return Bend.Right;
    case Side.Bottom:
      return Bend.Bottom;
    case Side.Left:
      return Bend.Left;
  }
  return Bend.Auto;
}
