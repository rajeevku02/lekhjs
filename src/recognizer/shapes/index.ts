// recognizer/shapes: candidate shapes for closed-shape detection, and the basic-shape classifier.
export {
  BasicShapeRecognizer,
  RecognitionContext,
  recognitionConfigForConnection,
  recognitionConfigForPath,
  recognitionConfigRegular,
  type RecognitionConfig,
} from './BasicShapeRecognizer';
export { chooseFinalShape } from './chooseFinalShape';
export { PolyMatcher } from './PolyMatcher';
export { RecShape, ShapeAttrs, ShapeNames } from './RecShape';
export { ShapeAggregator } from './ShapeAggregator';
export { ShapeColl } from './ShapeColl';
export { ShapeExtender, type IdSeq, type ShapeExtension } from './ShapeExtender';
