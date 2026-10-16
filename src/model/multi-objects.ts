// A detached set of objects for the clipboard and custom-library items (port of C++
// `MultiObjects`, `L/object/MultiObjects.{h,cpp}`). It never enters a page store. Each shape is
// held at its centre's offset from the set's centre; connectors keep their ends. `addToCanvas`
// (clone, add with undo, select) is an `edit/` command and is not here.
import { Point, Rect } from '../geometry';
import type { DrawingPlatform } from '../render';
import { BoundsPlatform } from './bounds-platform';
import type { LayoutEnv, LayoutGeometry, LekhObject, PaintEnv } from './lekh-object';
import { ObjectKind } from './lekh-object';
import { TemplatedObject } from './templated-object';

/** C++ `MultiObjects::ObjectInfo`. */
export interface MultiObjectInfo {
  dx: number;
  dy: number;
  readonly object: LekhObject;
}

export class MultiObjects extends TemplatedObject {
  private objects_: MultiObjectInfo[] = [];

  override name(): string {
    return 'MultiObjects';
  }

  empty(): boolean {
    return this.objects_.length === 0;
  }

  objects(): readonly MultiObjectInfo[] {
    return this.objects_;
  }

  /** C++ `setObjects`: the shapes' union box becomes this box; nothing when there is no shape. */
  setObjects(objs: readonly LekhObject[]): void {
    let rect: Rect | null = null;
    for (const o of objs) {
      if (o instanceof TemplatedObject) rect = rect === null ? o.ds.rect() : rect.includeRect(o.ds.rect());
    }
    if (rect === null) return;
    this.ds.setRect(rect);
    const ct = rect.center();
    for (const o of objs) {
      if (o instanceof TemplatedObject) {
        const c = o.ds.rect().center();
        this.objects_.push({ dx: c.x - ct.x, dy: c.y - ct.y, object: o });
      } else {
        this.objects_.push({ dx: 0, dy: 0, object: o });
      }
    }
    this.invalidate();
  }

  /** The io codec's setter (C++ friend serializer): offsets as stored. */
  setObjectInfos(infos: readonly MultiObjectInfo[]): void {
    this.objects_ = infos.map((i) => ({ ...i }));
    this.invalidate();
  }

  /** C++ `generateData`: every shape re-centred at this box's centre plus its offset. */
  override generateData(): void {
    this.place();
    this.invalidate();
  }

  private place(): void {
    const center = this.ds.getCenter();
    for (const info of this.objects_) {
      const to = info.object;
      if (to instanceof TemplatedObject) {
        const r = to.ds.rect();
        to.setRect(Rect.fromCenter(new Point(center.x + info.dx, center.y + info.dy), r.width, r.height));
      }
    }
  }

  protected override computeLayout(env: LayoutEnv): LayoutGeometry {
    this.place();
    const bp = new BoundsPlatform();
    for (const info of this.objects_) if (info.object.kind !== ObjectKind.Connector) env.ensureLayout(info.object);
    for (const info of this.objects_) {
      if (info.object.kind === ObjectKind.Connector) env.ensureLayout(info.object);
      bp.addRect(info.object.extent());
    }
    const visualBounds = this.selectionRect();
    bp.addRect(visualBounds);
    return { visualBounds, extent: bp.bounds() ?? visualBounds };
  }

  /** C++ `draw`: the shapes, then the connectors. */
  override paint(dp: DrawingPlatform, env: PaintEnv): void {
    for (const info of this.objects_) if (info.object.kind !== ObjectKind.Connector) info.object.paint(dp, env);
    for (const info of this.objects_) if (info.object.kind === ObjectKind.Connector) info.object.paint(dp, env);
  }
}
