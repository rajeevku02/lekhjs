// Builds a job's `SceneSnapshot` on the main thread (spec 07 §6.4), when the job is DISPATCHED (so
// stroke N+1 sees stroke N's result), with the stroke's captured view transform:
//
//  1. the stroke's bbox in view px, inflated by R = max(max(w, h), 64) (covers the double-line
//     arrow search, `placePath`'s 55 px, `getPathsNear`'s 36, `connectObjectDistThreshold` 32 and
//     `endPointDistForArrow` 30);
//  2. mapped to canvas coords and queried in the spatial index (top-level objects, store order);
//  3. the connectors among the hits and those incident to a hit become `connections`, and every
//     arrow-capable hit (connectors included) its `arrowEnds`;
//  4. each non-connector hit is serialised with the io writer, its title box precomputed (the
//     worker never measures text), and every template it references that the worker's base catalog
//     lacks (document templates, closed over embeds, and stencil sets the session added later) is
//     copied into `docTemplates`;
//  5. the serialised objects are read back here, as the worker will read them, with the session's
//     text measurements tapped: the sizes go into `textSizes` (the worker answers `measure` from
//     them).
//
// It also returns the `rev` of every object it named, which `MutationApplier` validates against.
import type { DocumentCodec } from '../../io';
import type { Config } from '../../base';
import {
  ConnectionObject,
  ObjectKind,
  ObjectStore,
  TemplatedObject,
  isFreehand,
  type LekhDocument,
  type LekhObject,
  type Page,
} from '../../model';
import { Point, Rect } from '../../geometry';
import {
  BezierCurveTemplate,
  type CatalogOverlay,
  type JsonValue,
  type ShapeTemplate,
  type TemplateTextService,
} from '../../template';
import { measureKey } from '../worker/textSizes';
import type { RecViewTransform } from '../delegate/SceneStore';
import { toCanvas } from '../delegate/SnapshotCanvasDelegate';
import type { SceneSnapshot, SnapshotArrow, SnapshotConnection, SnapshotObject } from '../worker/protocol';

/** What the builder reads from the session. */
export interface SnapshotSource {
  /** The document (`BoardSession.editor.doc`). */
  readonly doc: LekhDocument;
  readonly codec: DocumentCodec;
  readonly overlay: CatalogOverlay;
  /** The session's text service (`BoardSession.text`): its measurements are tapped. */
  readonly text: Pick<TemplateTextService, 'tapMeasures'>;
  readonly config: Config;
}

export interface BuiltSnapshot {
  readonly snapshot: SceneSnapshot;
  /** `rev` of every object the snapshot names (objects, connectors, arrow objects). */
  readonly revs: ReadonlyMap<string, number>;
  /** The page the snapshot was taken on. */
  readonly pageId: string;
}

/** The smallest inflation R (view px). */
export const SNAPSHOT_MIN_INFLATE = 64;

/** The stroke's bbox in view px (`x0,y0,x1,y1,…`). */
export function strokeBounds(points: Float64Array): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = points[i] ?? 0;
    const y = points[i + 1] ?? 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (minX > maxX) return new Rect();
  return new Rect(minX, minY, maxX - minX, maxY - minY);
}

/** Steps 1-2: the canvas-space query region of a stroke. */
export function snapshotRegion(points: Float64Array, view: RecViewTransform): Rect {
  const b = strokeBounds(points);
  const r = Math.max(Math.max(b.width, b.height), SNAPSHOT_MIN_INFLATE);
  const v = b.inflate(r);
  const p1 = toCanvas(view, new Point(v.x, v.y));
  const p2 = toCanvas(view, new Point(v.x + v.width, v.y + v.height));
  return new Rect(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y));
}

function arrowEndsOf(obj: LekhObject): SnapshotArrow | null {
  if (!(obj instanceof TemplatedObject) && !(obj instanceof ConnectionObject)) return null;
  if (obj.kind === ObjectKind.Group || isFreehand(obj)) return null;
  const pts = obj.getArrowPoints();
  if (pts.length === 0) return null;
  const isSingleCurve = obj instanceof TemplatedObject && obj.shapeTemplate() instanceof BezierCurveTemplate;
  return {
    id: obj.id,
    strokeWidth: obj.effectiveStrokeWidth(),
    isSingleCurve,
    ends: pts.map(([end, from]) => ({
      p1: { x: end.x, y: end.y },
      p2: { x: from.x, y: from.y },
      hasArrow: obj.arrows.hasArrowAt(pts, end),
    })),
  };
}

function connectionOf(con: ConnectionObject): SnapshotConnection {
  const [first, second] = con.endIds();
  return {
    id: con.id,
    firstId: first ?? '',
    secondId: second ?? '',
    type: con.getType(),
    autoType: con.getAutoType(),
  };
}

/** The title's box (C++ `ShapeTextElement::getRectAndAngle`), when the title has text. */
function titleOf(obj: LekhObject): Pick<SnapshotObject, 'titleRect' | 'titleAngle'> {
  if (!(obj instanceof TemplatedObject) || obj.kind === ObjectKind.Group) return {};
  const title = obj.shapeTemplate()?.titleElement() ?? null;
  if (title === null || title.text() === '') return {};
  const { rect, angle } = title.getRectAndAngle(obj.ds);
  return {
    titleRect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
    ...(angle !== 0 ? { titleAngle: angle } : {}),
  };
}

/** The ids a live template references: its own, its embeds' (closed), its generator's embed refs. */
function templateRefs(t: ShapeTemplate, out: Set<string>, seen: Set<ShapeTemplate>): void {
  if (seen.has(t)) return;
  seen.add(t);
  out.add(t.id());
  for (const e of t.embeds()) templateRefs(e.template, out, seen);
  if (t.generator !== null) for (const r of t.generator.embedReferences()) out.add(r);
}

function objectRefs(obj: LekhObject, out: Set<string>, seen: Set<ShapeTemplate>): void {
  if (obj instanceof TemplatedObject) {
    const t = obj.shapeTemplate();
    if (t !== null) templateRefs(t, out, seen);
  }
  for (const m of obj.members()) objectRefs(m, out, seen);
}

const ZERO_CLOCK = Object.freeze({ now: () => 0 });

export class SceneSnapshotBuilder {
  private readonly src_: SnapshotSource;

  constructor(src: SnapshotSource) {
    this.src_ = src;
  }

  /** Step 5: the text sizes reading `objects` back (and laying them out) measures. */
  private textSizes(objects: readonly SnapshotObject[]): Record<string, readonly [number, number]> {
    const out: Record<string, readonly [number, number]> = {};
    if (objects.length === 0) return out;
    const codec = this.src_.codec;
    this.src_.text.tapMeasures(
      (text, style, constraint, size) => {
        out[measureKey(text, style, constraint)] = [size.width, size.height];
      },
      () => {
        const objs: LekhObject[] = [];
        for (const so of objects) {
          try {
            objs.push(codec.readObject(so.json as JsonValue, so.id).object);
          } catch {
            // the worker reports it (`rec_snapshot`)
          }
        }
        const scratch = new ObjectStore({ config: this.src_.config, clock: ZERO_CLOCK });
        scratch.load(objs);
        scratch.flushLayout();
      },
    );
    return out;
  }

  build(points: Float64Array, view: RecViewTransform): BuiltSnapshot {
    const doc = this.src_.doc;
    const page: Page = doc.activePage();
    const store = page.objectStore;
    const region = snapshotRegion(points, view);
    store.flushLayout();
    const hits = store.candidates(region);

    const revs = new Map<string, number>();
    const objects: SnapshotObject[] = [];
    const arrowEnds: SnapshotArrow[] = [];
    const connections: SnapshotConnection[] = [];
    const seenCon = new Set<string>();
    const arrowIds = new Set<string>();
    const refs = new Set<string>();
    const seenT = new Set<ShapeTemplate>();

    const addArrow = (o: LekhObject): void => {
      if (arrowIds.has(o.id)) return;
      const a = arrowEndsOf(o);
      if (a === null) return;
      arrowIds.add(o.id);
      revs.set(o.id, o.rev);
      arrowEnds.push(a);
    };
    const addCon = (con: ConnectionObject): void => {
      if (seenCon.has(con.id)) return;
      seenCon.add(con.id);
      revs.set(con.id, con.rev);
      connections.push(connectionOf(con));
      addArrow(con);
    };

    for (const o of hits) {
      if (o instanceof ConnectionObject) {
        addCon(o);
        continue;
      }
      revs.set(o.id, o.rev);
      objects.push({
        id: o.id,
        rev: o.rev,
        json: this.src_.codec.writeObject(o),
        ...titleOf(o),
        isConnector: false,
        isHelper: false,
        isUnrecognized: isFreehand(o),
      });
      addArrow(o);
      objectRefs(o, refs, seenT);
      for (const c of store.connectionsOf(o)) if (c instanceof ConnectionObject) addCon(c);
    }

    const textSizes = this.textSizes(objects);

    const docTemplates: Record<string, unknown> = {};
    const base = this.src_.overlay.base();
    for (const id of refs) {
      if (base.get(id) !== undefined || base.getEmbed(id) !== undefined) continue;
      const def = doc.get(id) ?? this.src_.overlay.getEmbed(id, doc);
      if (def !== undefined) docTemplates[id] = def.json;
    }

    return {
      snapshot: {
        region: { x: region.x, y: region.y, w: region.width, h: region.height },
        objects,
        arrowEnds,
        connections,
        docTemplates,
        textSizes,
      },
      revs,
      pageId: page.id,
    };
  }
}
