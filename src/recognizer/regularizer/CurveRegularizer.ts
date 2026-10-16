// Port of C++ `regularizer::CurveRegularizer`, whose body is empty: kept as a no-op so the
// dispatch table of `Regularizer` matches the C++ (spec 07 §2.1).
import type { SimplePath } from '../../geometry';

export class CurveRegularizer {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the C++ body is empty
  regularize(_path: SimplePath): void {
    // C++: empty.
  }
}
