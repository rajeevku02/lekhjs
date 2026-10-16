// A recognized output shape: an ellipse or a path, with a snap flag (port of C++
// `geometry::Shape`, renamed to avoid the clash with the recognizer's shape).
import { Ellipse } from './ellipse';
import { SimplePath } from './simplePath';

export const GeoShapeType = Object.freeze({ Ellipse: 'ellipse', Path: 'path' } as const);
export type GeoShapeType = (typeof GeoShapeType)[keyof typeof GeoShapeType];

export class GeoShape {
  private type_: GeoShapeType = GeoShapeType.Path;
  private ellipse_ = new Ellipse();
  private path_ = new SimplePath();
  private snap_ = true;

  type(): GeoShapeType {
    return this.type_;
  }
  ellipse(): Ellipse {
    return this.ellipse_;
  }
  setEllipse(val: Ellipse): void {
    this.ellipse_ = val.clone();
    this.type_ = GeoShapeType.Ellipse;
  }
  path(): SimplePath {
    return this.path_;
  }
  setPath(path: SimplePath): void {
    this.path_ = path.clone();
    this.type_ = GeoShapeType.Path;
  }
  snap(): boolean {
    return this.snap_;
  }
  setSnap(val: boolean): void {
    this.snap_ = val;
  }
}
