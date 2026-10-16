// geometry/fit: everything ported from C++ `fitter/` (spec 01 §2.1, spec 07 §2.3). Re-exported by
// the geometry barrel; the model, the selection menu and the recognizer import it from there.
export { areComparableLength } from './comparable';
export { CurveFitter } from './curveFitter';
export { EllipseFitter } from './ellipseFitter';
export { FitLine } from './fitLine';
export { Quadrilateral, type QuadrilateralConfig } from './quadrilateral';
export { Triangle } from './triangle';
