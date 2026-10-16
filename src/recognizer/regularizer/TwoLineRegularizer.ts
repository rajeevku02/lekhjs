// Two lines: the bounds' corners minus one, i.e. the four right-angle "L"s (port of C++
// `regularizer::TwoLineRegularizer`). Accepts a cost up to 1.7e-3.
import type { Point } from '../../geometry';
import { at } from '../lines/RecognizerUtil';
import { PolyRegularizer, type Feature } from './PolyRegularizer';

export class TwoLineRegularizer extends PolyRegularizer {
  protected override getFeatures(result: Feature[]): void {
    const points = this.rect.getPoints();
    const p = (i: number): Point => at(points, i);
    result.push([p(1), p(2), p(3)]);
    result.push([p(2), p(3), p(0)]);
    result.push([p(3), p(0), p(1)]);
    result.push([p(0), p(1), p(2)]);
  }

  protected override canAccept(_fid: number, cost: number): boolean {
    if (cost * 1000 > 1.7) return false;
    return true;
  }
}
