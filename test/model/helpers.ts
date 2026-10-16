// Fake object kinds for the model suites: a box shape (optionally titled, with a stroke and an
// overhang), a group and a straight connector between two ends. They implement the LekhObject
// contract with simple geometry and count their layout() and paint() calls.
import { EngineConfig, type Clock, type IdSource } from '../../src/base';
import { Point, Rect, pointLineSegmentDistance, rectDistanceFrom } from '../../src/geometry';
import {
  LekhObject,
  ObjectKind,
  ObjectStore,
  type LayoutEnv,
  type LayoutGeometry,
  type PaintEnv,
} from '../../src/model';
import type { DrawingPlatform } from '../../src/render';

export const fixedClock = (t = 1234): Clock => ({ now: () => t });

export function seqIds(): IdSource {
  let n = 0;
  return {
    next: () => {
      n++;
      return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
    },
  };
}

export const verifyConfig = new EngineConfig({ debug: { verifyIndex: true } });
export const plainConfig = new EngineConfig();

export function newStore(config = verifyConfig, clock: Clock = fixedClock()): ObjectStore {
  return new ObjectStore({ config, clock });
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return new Rect(x, y, Math.max(a.right(), b.right()) - x, Math.max(a.bottom(), b.bottom()) - y);
}

function grow(r: Rect, d: number): Rect {
  return new Rect(r.x - d, r.y - d, r.width + 2 * d, r.height + 2 * d);
}

/** A rectangle shape. `overhang` widens the extent beyond the stroke (arrowheads). */
export class BoxShape extends LekhObject {
  readonly kind: ObjectKind = ObjectKind.Templated;
  rect: Rect;
  stroke = 2;
  overhang = 0;
  title: Rect | null = null;
  images: string[] = [];
  connectable = true;
  /** A container: the inner area (rect shrunk by `inset`) passes hits through. */
  containerInset: number | null = null;
  layouts = 0;
  paints = 0;
  /** If set, the extent ignores the stroke and title (a non-conservative bug, for shadow mode). */
  brokenExtent = false;

  constructor(id: string, rect: Rect, order = 0) {
    super(id);
    this.rect = rect;
    this.order = order;
  }

  setRect(r: Rect): void {
    this.rect = r;
    this.invalidate();
  }

  override translate(dx: number, dy: number): void {
    this.setRect(new Rect(this.rect.x + dx, this.rect.y + dy, this.rect.width, this.rect.height));
  }

  protected computeLayout(): LayoutGeometry {
    this.layouts++;
    let ext = this.rect;
    if (this.title !== null) ext = union(ext, this.title);
    ext = this.brokenExtent ? this.rect.inflate(-80) : grow(ext, this.stroke / 2 + this.overhang);
    return { visualBounds: this.rect, extent: ext };
  }

  paint(): void {
    this.paints++;
  }

  selectionRect(): Rect {
    return this.rect;
  }

  isPointInside(p: Point): boolean {
    return this.rect.contains(p);
  }

  override isPointInsideTitle(p: Point): boolean {
    return this.title?.contains(p) ?? false;
  }

  distanceFrom(p: Point): number {
    return rectDistanceFrom(this.rect, p).dist;
  }

  override effectiveStrokeWidth(): number {
    return this.stroke;
  }

  override isConnectableKind(): boolean {
    return this.connectable;
  }

  override isInContainerArea(p: Point): boolean {
    if (this.containerInset === null) return false;
    return this.rect.inflate(-2 * this.containerInset).contains(p);
  }

  override imageUrls(): readonly string[] {
    return this.images;
  }
}

export class FakeGroup extends LekhObject {
  readonly kind: ObjectKind = ObjectKind.Group;
  items: LekhObject[];
  layouts = 0;
  paints = 0;

  constructor(id: string, items: LekhObject[], order = 0) {
    super(id);
    this.items = items;
    this.order = order;
  }

  override members(): readonly LekhObject[] {
    return this.items;
  }

  protected computeLayout(env: LayoutEnv): LayoutGeometry {
    this.layouts++;
    let vb: Rect | null = null;
    let ext: Rect | null = null;
    for (const m of this.items) {
      env.ensureLayout(m);
      vb = vb === null ? m.visualBounds() : union(vb, m.visualBounds());
      ext = ext === null ? m.extent() : union(ext, m.extent());
    }
    return { visualBounds: vb ?? new Rect(), extent: ext ?? new Rect() };
  }

  paint(dp: DrawingPlatform, env: PaintEnv): void {
    this.paints++;
    for (const m of this.items) m.paint(dp, env);
  }

  selectionRect(): Rect {
    return this.visualBounds();
  }

  isPointInside(p: Point): boolean {
    return this.items.some((m) => m.isPointInside(p));
  }

  distanceFrom(p: Point): number {
    return Math.min(...this.items.map((m) => m.distanceFrom(p)));
  }
}

/** A straight connector from the centre of one end to the centre of the other. */
export class FakeConnector extends LekhObject {
  readonly kind: ObjectKind = ObjectKind.Connector;
  first: string;
  second: string;
  stroke = 2;
  route: [Point, Point] = [new Point(), new Point()];
  layouts = 0;
  paints = 0;

  constructor(id: string, first: string, second: string, order = 0) {
    super(id);
    this.first = first;
    this.second = second;
    this.order = order;
  }

  setEnds(first: string, second: string): void {
    this.first = first;
    this.second = second;
    this.invalidate();
  }

  override endIds(): readonly string[] {
    return [this.first, this.second];
  }

  protected computeLayout(env: LayoutEnv): LayoutGeometry {
    this.layouts++;
    const a = env.objectById(this.first);
    const b = env.objectById(this.second);
    if (a !== undefined) env.ensureLayout(a);
    if (b !== undefined) env.ensureLayout(b);
    const pa = a?.visualBounds().center() ?? new Point();
    const pb = b?.visualBounds().center() ?? new Point();
    this.route = [pa, pb];
    const vb = new Rect(Math.min(pa.x, pb.x), Math.min(pa.y, pb.y), Math.abs(pa.x - pb.x), Math.abs(pa.y - pb.y));
    return { visualBounds: vb, extent: grow(vb, this.stroke / 2) };
  }

  paint(): void {
    this.paints++;
  }

  selectionRect(): Rect {
    return this.visualBounds();
  }

  isPointInside(): boolean {
    return false;
  }

  distanceFrom(p: Point): number {
    return pointLineSegmentDistance(this.route[0], this.route[1], p).dist;
  }

  override effectiveStrokeWidth(): number {
    return this.stroke;
  }
}

/** A deterministic pseudo-random generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A page of `n` random boxes (some titled) and `connectors` connectors between them. */
export function randomScene(
  store: ObjectStore,
  n: number,
  seed: number,
  span = 4000,
  connectors = Math.floor(n / 10),
): BoxShape[] {
  const r = rng(seed);
  const boxes: BoxShape[] = [];
  for (let i = 0; i < n; i++) {
    const w = 10 + r() * 140;
    const h = 10 + r() * 100;
    const b = new BoxShape(`b${String(i)}`, new Rect(r() * span, r() * span, w, h), (i + 1) * 100);
    b.stroke = r() * 6;
    if (r() < 0.2) b.title = new Rect(b.rect.x, b.rect.bottom() + 2, w, 14);
    if (r() < 0.1) b.connectable = false;
    if (r() < 0.05) b.containerInset = 8;
    boxes.push(b);
    store.add(b);
  }
  for (let i = 0; i < connectors; i++) {
    const a = boxes[Math.floor(r() * n)] as BoxShape;
    const b = boxes[Math.floor(r() * n)] as BoxShape;
    store.add(new FakeConnector(`c${String(i)}`, a.id, b.id, (n + i + 1) * 100));
  }
  return boxes;
}

export const noopDp = {} as DrawingPlatform;

export function paintEnv(config = verifyConfig, zoom = 1, forExport = false): PaintEnv {
  return { config, zoom, forExport, images: null };
}
