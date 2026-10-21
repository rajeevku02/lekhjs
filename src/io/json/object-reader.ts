// Object JSON → live objects (port of C++ `JsonObjectSerializer::parseObjects`, `parseObject`,
// `afterObjectParse`, the per-type `parse*` functions, `parseArrowInfo`, the connector parsers and
// `fixConnections`, `L/document/Serializer.cpp:831-1035, 1595-2385, 3044-3345`).
//
// This is the one object parser every path uses: a document's pages, a cloud `load`, a paste (a
// `multi` object) and a library item. Legacy types are converted on parse (spec 03 §10.4); no
// caller ever sees one.
//
// Rules (spec 03 §10.1):
//   - members are visited in UTF-8 byte order (C++ `std::map`); an entry with neither `type` nor
//     `template` is skipped (the "spurious objects" workaround); one failing object fails the
//     whole read, as today;
//   - an entry with a `template` but no `type` is read as a `templated` object, or skipped when it
//     does not parse as one (DR-FMT-03; C++ failed the whole load). It is what the store leaves when
//     a template change (`UserAction::raiseTemplateChange`: `.template` and `.params.*`) is `$set`
//     on an object whose entry is not there; it carries no `order`, so the page store gives it the
//     next one (on top), as it does any object added without one;
//   - the array form gets minted ids and `order = index + 1`;
//   - objects are then stably sorted by `order`, so equal orders keep the byte order of their ids
//     (DR-ENG-11; C++ `std::sort` left them in any order);
//   - an object's `id` member, when it is an integer, is the key connectors name it by (legacy
//     integer ids);
//   - a connector whose end is not found is dropped (`fixConnections(ignoreError)`).
import { BezierCurve, Point, Rect } from '../../geometry';
import {
  ArrowHeads,
  ConnectionObject,
  ConnectionType,
  GroupObject,
  MultiObjects,
  TemplatedObject,
  UnrecognizedObject,
  type ContainedObject,
  type LekhObject,
  type ParamMap,
  type Params,
} from '../../model';
import { isJsonObject, type JsonObject, type JsonValue } from '../../template';
import { LoadError, withLoadDetails } from '../errors';
import { convertLegacy, legacyBase, LEGACY_TYPES, type LegacyObject } from '../legacy/legacy-converter';
import type { LoadContext } from '../load-context';
import { parseStyleOrDrawingProfile } from '../codec/style-codec';
import {
  arrField,
  boolField,
  hasMember,
  intField,
  listOf,
  member,
  membersInByteOrder,
  numField,
  objField,
  strField,
} from './json-fields';

const TEMPLATED_TYPES = Object.freeze(['avabodh.basic.template', 'templated']);

/** C++ `parsePoint`: an object with numeric `x` and `y`. */
export function parsePoint(node: JsonValue | undefined): Point | null {
  if (!isJsonObject(node)) return null;
  const x = numField(node, 'x');
  const y = numField(node, 'y');
  if (x === undefined || y === undefined) return null;
  return new Point(x, y);
}

/** C++ `parsePoints`: an array of points; one bad point fails all. */
export function parsePoints(node: JsonValue | undefined): Point[] | null {
  if (!Array.isArray(node)) return null;
  const out: Point[] = [];
  for (const item of node as readonly JsonValue[]) {
    const p = parsePoint(item);
    if (p === null) return null;
    out.push(p);
  }
  return out;
}

/** C++ `parseBezier`: exactly four points. */
function parseBezier(node: JsonValue | undefined): BezierCurve | null {
  const pts = parsePoints(node);
  if (pts?.length !== 4) return null;
  return new BezierCurve(pts[0], pts[1], pts[2], pts[3], 4);
}

/** C++ `parseConnectionParams`: one map (the 2.8.1 beta form) or a list of maps; numbers only. */
export function parseConnectionParams(params: JsonValue): Params | null {
  const map = (o: JsonValue | undefined): ParamMap => {
    const cp: ParamMap = {};
    for (const [k, v] of membersInByteOrder(o)) if (typeof v === 'number') cp[k] = v;
    return cp;
  };
  if (isJsonObject(params)) return [map(params)];
  if (Array.isArray(params)) return (params as readonly JsonValue[]).map((item) => map(item));
  return null;
}

/** The ids a page's or a group's `objects` member gives its entries, with the entries. */
function objectEntries(
  objects: JsonValue | undefined,
  ctx: LoadContext,
  withOrder: boolean,
): [string, JsonValue][] | null {
  if (Array.isArray(objects)) {
    return (objects as readonly JsonValue[]).map((jobj, i) => {
      const entry = withOrder && isJsonObject(jobj) ? { ...jobj, order: i + 1 } : jobj;
      return [ctx.env.objects.newId(), entry];
    });
  }
  if (isJsonObject(objects)) return membersInByteOrder(objects);
  return null;
}

export class ObjectReader {
  private readonly ctx: LoadContext;

  constructor(ctx: LoadContext) {
    this.ctx = ctx;
  }

  /**
   * C++ `parseObjects(objs, root)`: `root.objects` (array or map) parsed and sorted by order.
   * Fails (`object_parse`) when there is no `objects` member or an object does not parse.
   */
  parseObjects(root: JsonValue | undefined): LekhObject[] {
    if (!hasMember(root, 'objects')) throw new LoadError('object_parse', { reason: 'no_objects' });
    const entries = objectEntries(member(root, 'objects'), this.ctx, true);
    if (entries === null) throw new LoadError('object_parse', { reason: 'objects_not_a_list' });
    const objs: LekhObject[] = [];
    let index = -1;
    for (const [id, jobj] of entries) {
      index++;
      if (!hasMember(jobj, 'type')) {
        const recovered = hasMember(jobj, 'template') ? this.recoverTypeless(id, jobj) : null;
        if (recovered === null) {
          this.ctx.note('object_skipped');
        } else {
          this.ctx.note('object_recovered');
          objs.push(recovered);
        }
        continue;
      }
      try {
        objs.push(this.parseObject(id, jobj));
      } catch (e) {
        // Where it stopped (the entry's position in byte order), for a load failure report.
        if (e instanceof LoadError) throw withLoadDetails(e, { object_index: index });
        throw e;
      }
    }
    // Stable (Array.prototype.sort is): equal orders keep the byte order of their ids (DR-ENG-11).
    objs.sort((a, b) => a.order - b.order);
    return objs;
  }

  /**
   * An entry with a `template` and no `type` (DR-FMT-03): the half-object the store builds when a
   * template change is applied to an object whose entry is missing (a concurrent delete, or an add
   * that was never stored). No writer produces one. It is read as a `templated` object so the shape
   * and the connectors that name it survive; `null` (skip it) when it does not parse as one. C++
   * `parseObject` refused it (`Serializer.cpp:897-900`), which failed the whole load.
   */
  private recoverTypeless(id: string, jobj: JsonValue | undefined): LekhObject | null {
    if (!isJsonObject(jobj) || !isJsonObject(member(jobj, 'template'))) return null;
    try {
      return this.tryParseObject(id, { ...jobj, type: 'templated' });
    } catch (e) {
      if (e instanceof LoadError) return null;
      throw e;
    }
  }

  /** C++ `parseObject(id, &obj, jobj)`: throws `object_parse` when it does not parse. */
  parseObject(id: string, jobj: JsonValue | undefined): LekhObject {
    const obj = this.tryParseObject(id, jobj);
    if (obj === null) throw new LoadError('object_parse');
    return obj;
  }

  private tryParseObject(id: string, jobj: JsonValue | undefined): LekhObject | null {
    if (!isJsonObject(jobj)) return null;
    const type = strField(jobj, 'type');
    if (type === undefined) return null;

    const legacy = this.parseLegacy(type, jobj);
    // C++ converted a free-hand stroke and a curve connector at parse and then ran
    // `afterObjectParse` on the result; the other six stayed live and got their text and style
    // first, which the converter now copies.
    const convertedFirst = legacy?.kind === 'freeform' || legacy?.kind === 'curveconnection';
    let obj: LekhObject | null;
    if (legacy !== undefined) {
      if (legacy === null) return null;
      if (!convertedFirst) {
        legacy.text = strField(jobj, 'text') ?? legacy.text;
        parseStyleOrDrawingProfile(jobj, legacy.style);
      }
      obj = convertLegacy(legacy, id, this.ctx);
    } else if (type === 'avabodh.basic.connection') {
      obj = this.parseConnection(id, jobj);
    } else if (type === 'avabodh.basic.group') {
      obj = this.parseGroup(id, jobj);
    } else if (type === 'avabodh.basic.unrecognized') {
      obj = this.parseUnrecognized(id, jobj);
    } else if (TEMPLATED_TYPES.includes(type)) {
      obj = this.parseTemplated(id, jobj);
    } else if (type === 'multi') {
      obj = this.parseMulti(id, jobj);
    } else {
      obj = null;
    }
    if (obj === null) return null;

    const order = intField(jobj, 'order');
    if (order !== undefined) obj.order = order;
    if (!this.afterObjectParse(obj, jobj, legacy !== undefined && !convertedFirst)) return null;
    if (obj instanceof TemplatedObject) obj.generateData();
    return obj;
  }

  /**
   * C++ `afterObjectParse`: registers the object under its integer `id` (or its key) and reads
   * `text` and the style into everything but a group. For a converted legacy object the text and
   * style were read before conversion.
   */
  private afterObjectParse(obj: LekhObject, jobj: JsonObject, wasLegacy: boolean): boolean {
    const intId = intField(jobj, 'id');
    const key = intId !== undefined ? String(intId) : obj.id;
    if (key === '') return false;
    if (!(obj instanceof GroupObject) && !wasLegacy) {
      obj.text = strField(jobj, 'text') ?? obj.text;
      parseStyleOrDrawingProfile(jobj, obj.getDrawingProfile());
    }
    if (!this.ctx.objMap.has(key)) this.ctx.objMap.set(key, obj);
    return true;
  }

  // ---- legacy types (parsed into records, converted at once) ----

  /** `undefined`: not a legacy type; `null`: a legacy type that does not parse. */
  private parseLegacy(type: string, node: JsonObject): LegacyObject | null | undefined {
    const oenv = this.ctx.env.objects;
    switch (type) {
      case LEGACY_TYPES.circle: {
        const radius = numField(node, 'radius');
        const center = parsePoint(member(node, 'center'));
        if (radius === undefined || center === null) return null;
        return { kind: 'circle', ...legacyBase(), center, radius };
      }
      case LEGACY_TYPES.ellipse: {
        const width = numField(node, 'width');
        const height = numField(node, 'height');
        const rotation = numField(node, 'rotation');
        const center = parsePoint(member(node, 'center'));
        if (width === undefined || height === undefined || rotation === undefined || center === null) return null;
        return { kind: 'ellipse', ...legacyBase(), center, width, height, rotation };
      }
      case LEGACY_TYPES.polygon: {
        const closed = boolField(node, 'closed');
        if (closed === undefined) return null;
        const vertices = parsePoints(member(node, 'vertices'));
        if (vertices === null) return null;
        const arrows = new ArrowHeads(oenv);
        if (!this.parseArrowInfo(arrows, node)) return null;
        return {
          kind: 'polygon',
          ...legacyBase(),
          vertices,
          closed,
          rounded: boolField(node, 'rounded') ?? false,
          arrows,
        };
      }
      case LEGACY_TYPES.freeform: {
        const points = parsePoints(member(node, 'points'));
        if (points === null) return null;
        return { kind: 'freeform', ...legacyBase(), points };
      }
      case LEGACY_TYPES.curve: {
        const list = arrField(node, 'curves');
        if (list === undefined) return null;
        const curves: BezierCurve[] = [];
        for (const item of list) {
          const bz = parseBezier(item);
          if (bz === null) return null;
          curves.push(bz);
        }
        const arrows = new ArrowHeads(oenv);
        if (!this.parseArrowInfo(arrows, node)) return null;
        return { kind: 'curve', ...legacyBase(), curves, arrows };
      }
      case LEGACY_TYPES.text: {
        const rotation = numField(node, 'rotation');
        const center = parsePoint(member(node, 'center'));
        if (rotation === undefined || center === null) return null;
        return { kind: 'text', ...legacyBase(), center, rotation };
      }
      case LEGACY_TYPES.image: {
        const width = numField(node, 'width');
        const height = numField(node, 'height');
        const rotation = numField(node, 'rotation');
        const format = strField(node, 'format');
        const center = parsePoint(member(node, 'center'));
        const data = strField(node, 'data');
        if (width === undefined || height === undefined || rotation === undefined) return null;
        if (format === undefined || center === null || data === undefined) return null;
        return { kind: 'image', ...legacyBase(), center, width, height, rotation, format, data };
      }
      case LEGACY_TYPES.curveconnection: {
        // C++ `parseCurveConnectionObject`: the connector fields, then the angles and factors.
        const scratch = new ConnectionObject(oenv, null, null, ConnectionType.Curve, '');
        if (!this.parseConnectionFields(scratch, node)) return null;
        const angles = this.numberPair(node, 'angles');
        const factors = this.numberPair(node, 'dfactors');
        if (angles === null || factors === null) return null;
        return {
          kind: 'curveconnection',
          ...legacyBase(),
          srcId: scratch.srcObjId,
          targetId: scratch.targetObjId,
          angle1: angles[0],
          angle2: angles[1],
          distFactor1: factors[0],
          distFactor2: factors[1],
          arrows: scratch.arrows,
        };
      }
    }
    return undefined;
  }

  /** `angles` / `dfactors`: element 0 is the first value, every later one overwrites the second. */
  private numberPair(node: JsonObject, key: string): [number, number] | null {
    const list = arrField(node, key);
    if (list === undefined) return null;
    const out: [number, number] = [0, 0];
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (typeof v !== 'number') return null;
      if (i === 0) out[0] = v;
      else out[1] = v;
    }
    return out;
  }

  // ---- connectors ----

  /** C++ `parseConnectionObject`'s field reads into `co` (type, params, labels, ends, arrows). */
  private parseConnectionFields(co: ConnectionObject, node: JsonObject): boolean {
    const ctype = intField(node, 'ctype');
    if (ctype === undefined) return false;
    co.setType(ctype as ConnectionType);
    const cdist = numField(node, 'cdist');
    if (cdist !== undefined) co.setOldLineParams(cdist, ctype);
    const params = member(node, 'params');
    if (params !== undefined) {
      const p = parseConnectionParams(params);
      if (p === null) return false;
      co.setParams(p);
    }
    const texts = member(node, 'texts');
    if (Array.isArray(texts)) {
      const labels: { text: string; param: number }[] = [];
      const legacy: string[] = [];
      (texts as readonly JsonValue[]).forEach((txt, i) => {
        if (typeof txt === 'string') {
          // The legacy form: one string per segment (at most three); only non-empty ones are kept.
          if (i < 3 && txt !== '') {
            while (legacy.length <= i) legacy.push('');
            legacy[i] = txt;
          }
        } else if (isJsonObject(txt)) {
          const param = numField(txt, 'param');
          const str = strField(txt, 'text');
          if (param !== undefined && str !== undefined) labels.push({ text: str, param });
        }
      });
      co.setTexts(labels);
      co.legacyTexts = legacy;
    }
    const src = this.endId(node, 'source');
    const target = this.endId(node, 'target');
    if (src === null || target === null) return false;
    co.srcObjId = src;
    co.targetObjId = target;
    return this.parseArrowInfo(co.arrows, node);
  }

  /** An end id: an integer (legacy, as its decimal string) or a string. */
  private endId(node: JsonObject, key: string): string | null {
    const i = intField(node, key);
    if (i !== undefined) return String(i);
    return strField(node, key) ?? null;
  }

  private parseConnection(id: string, node: JsonObject): ConnectionObject | null {
    const co = new ConnectionObject(this.ctx.env.objects, null, null, ConnectionType.GenericLine, id);
    return this.parseConnectionFields(co, node) ? co : null;
  }

  /**
   * C++ `parseArrowInfo`: the old boolean form (`arrow`), the templated form (`arrows`), or none.
   * As C++, "none" clears the start arrow twice and leaves the end as it was.
   */
  parseArrowInfo(arr: ArrowHeads, parent: JsonObject): boolean {
    const old = member(parent, 'arrow');
    if (old !== undefined) {
      arr.setStartKind(boolField(old, 'atstart') ?? false, boolField(old, 'solidatstart') ?? false);
      arr.setEndKind(boolField(old, 'atend') ?? false, boolField(old, 'solidatend') ?? false);
      return true;
    }
    const arrows = member(parent, 'arrows');
    if (arrows !== undefined) {
      const start = member(arrows, 'start');
      if (start !== undefined) {
        const t = this.ctx.codec.parse(start, this.ctx.stats);
        if (t === null) return false;
        arr.setStart(t);
      }
      const end = member(arrows, 'end');
      if (end !== undefined) {
        const t = this.ctx.codec.parse(end, this.ctx.stats);
        if (t === null) return false;
        arr.setEnd(t);
      }
      return true;
    }
    arr.setStartKind(false, false);
    return true;
  }

  // ---- templated objects ----

  /** C++ `parseTemplateObject`. */
  parseTemplated(id: string, node: JsonObject): TemplatedObject | null {
    const stl = this.ctx.codec.parse(member(node, 'template'), this.ctx.stats);
    if (stl === null) return null;
    const params = objField(node, 'params');
    if (params === undefined) return null;
    const cx = numField(params, 'cx') ?? 0;
    const cy = numField(params, 'cy') ?? 0;
    const width = numField(params, 'width') ?? 1;
    const height = numField(params, 'height') ?? 1;
    const angle = numField(params, 'angle') ?? 0;
    stl.load();
    const obj = new TemplatedObject(
      this.ctx.env.objects,
      stl,
      Rect.fromCenter(new Point(cx, cy), width, height),
      angle,
      null,
      id,
    );
    obj.nameInLibraryView = strField(node, 'name') ?? obj.nameInLibraryView;
    const texts = listOf(params, 'texts');
    texts.forEach((t, i) => {
      if (i < stl.texts().length) stl.setText(i, strField(t, 'text') ?? '');
    });
    listOf(params, 'images').forEach((im, i) => {
      const data = strField(im, 'data') ?? '';
      if (data !== '') stl.setImageData(i, data, strField(im, 'format') ?? '');
    });
    if (!this.parseArrowInfo(obj.arrows, node)) return null;
    return obj;
  }

  /** C++ `parseUnrecognizedObject`. */
  private parseUnrecognized(id: string, node: JsonObject): UnrecognizedObject | null {
    const pts = parsePoints(member(node, 'points'));
    if (pts === null) return null;
    const params = objField(node, 'params');
    if (params === undefined) return null;
    const rect = Rect.fromCenter(
      new Point(numField(params, 'cx') ?? 0, numField(params, 'cy') ?? 0),
      numField(params, 'width') ?? 0,
      numField(params, 'height') ?? 0,
    );
    return UnrecognizedObject.fromStored(this.ctx.env.objects, pts, rect, numField(params, 'angle') ?? 0, false, id);
  }

  /**
   * The box of a group or a multi object. C++ read the five members into one reused variable, so
   * a missing one repeats the previous member's value (the first defaults to 0 here).
   */
  private reusedBox(params: JsonObject): { rect: Rect; angle: number } {
    let n = 0;
    const next = (k: string) => {
      n = numField(params, k) ?? n;
      return n;
    };
    const cx = next('cx');
    const cy = next('cy');
    const angle = next('angle');
    const width = next('width');
    const height = next('height');
    return { rect: Rect.fromCenter(new Point(cx, cy), width, height), angle };
  }

  /** C++ `parseGroupObject`: members by key (or minted ids), sorted by `index`. */
  private parseGroup(id: string, node: JsonObject): GroupObject | null {
    const params = objField(node, 'params');
    if (params === undefined) return null;
    const { rect, angle } = this.reusedBox(params);
    const origWidth = numField(params, 'orig_width') ?? 0;
    const origHeight = numField(params, 'orig_height') ?? 0;
    const entries = objectEntries(member(node, 'objects'), this.ctx, false);
    if (entries === null || entries.length === 0) return null;
    const members: ContainedObject[] = [];
    for (const [key, item] of entries) {
      const width = numField(item, 'orig_width');
      const height = numField(item, 'orig_height');
      const cx = numField(item, 'orig_cx');
      const cy = numField(item, 'orig_cy');
      const origAngle = numField(item, 'orig_angle');
      const xf = numField(item, 'xfactor');
      const yf = numField(item, 'yfactor');
      const index = intField(item, 'index');
      if (width === undefined || height === undefined || cx === undefined || cy === undefined) return null;
      if (origAngle === undefined || xf === undefined || yf === undefined || index === undefined) return null;
      const inner = objField(item, 'object');
      if (inner === undefined) return null;
      const type = strField(inner, 'type');
      if (type === undefined) continue;
      let tobj: TemplatedObject | null;
      if (type === 'avabodh.basic.group') tobj = this.parseGroup(key, inner);
      else if (type === 'avabodh.basic.unrecognized') tobj = this.parseUnrecognized(key, inner);
      else tobj = this.parseTemplated(key, inner);
      if (tobj === null) return null;
      // A member's stacking order is on the inner object, as `serializeObject` writes it.
      const order = intField(inner, 'order');
      if (order !== undefined) tobj.order = order;
      if (!this.afterObjectParse(tobj, inner, false)) return null;
      members.push({
        xfactor: xf,
        yfactor: yf,
        origAngle,
        origRect: Rect.fromCenter(new Point(cx, cy), width, height),
        index,
        object: tobj,
      });
    }
    members.sort((a, b) => a.index - b.index);
    const g = GroupObject.fromStored(this.ctx.env.objects, members, rect, angle, origWidth, origHeight, id);
    g.nameInLibraryView = strField(node, 'name') ?? g.nameInLibraryView;
    return g;
  }

  /** C++ `parseMultiObject`: the objects, connectors fixed up against what was read so far. */
  private parseMulti(id: string, node: JsonObject): MultiObjects | null {
    const params = objField(node, 'params');
    if (params === undefined) return null;
    const { rect, angle } = this.reusedBox(params);
    const m = new MultiObjects(this.ctx.env.objects, null, new Rect(), 0, null, id);
    m.ds.setRect(rect);
    m.ds.setAngle(angle);
    m.nameInLibraryView = strField(node, 'name') ?? m.nameInLibraryView;
    const objs = this.parseObjects(node);
    const final: LekhObject[] = [];
    for (const o of objs) {
      if (o instanceof ConnectionObject) {
        if (this.fixConnector(o)) final.push(o);
      } else {
        final.push(o);
      }
    }
    m.setObjects(final);
    return m;
  }

  /** Resolves a connector's ends from the object map; false (and no change) when one is missing. */
  fixConnector(con: ConnectionObject): boolean {
    const first = this.ctx.objMap.get(con.srcObjId);
    const second = this.ctx.objMap.get(con.targetObjId);
    if (first === undefined || second === undefined) {
      this.ctx.note('connector_end_missing');
      return false;
    }
    con.setConnectedObjects(first, second);
    return true;
  }
}
