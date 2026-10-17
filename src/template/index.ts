// lekhjs module `template` (spec 01 §2.1, rank 5). The only import target from outside the module.
// Shape templates and their expression language, elements and draw commands; the shared immutable
// catalog and the per-session copy-on-write overlay; the generator contract (spec 04 §1-§3, §5.1).
// `template/` never imports `generators/`: the registry and the Lua → JS converter are injected.
export {
  cloneJson,
  deepFreeze,
  isJsonObject,
  stringField,
  type JsonObject,
  type JsonValue,
  type LibraryCategoryJson,
  type LibraryFileJson,
  type TemplateJson,
} from './json';
export {
  TemplateTextService,
  type MeasureTap,
  type TemplateConfig,
  type TemplateEnv,
  type TemplateText,
  type TemplateWarningCode,
} from './env';

export { DataStore, type ArrowInfo } from './expr/data-store';
export {
  BinaryExpression,
  BinaryOperator,
  Expression,
  FunctionCallExpression,
  PrimitiveExpression,
  VariableAccessExpression,
  type ExpressionScope,
} from './expr/expression';
export { DataExpressionParser, type IntOrName } from './expr/data-expression-parser';
export { validateSemanticExpression, type SemanticExpressionCheck } from './expr/semantic-expression';
export { ParamEditorType, TemplateParam, TemplateParamEditor, jsonEquals } from './expr/template-param';

export {
  ArcShape,
  BezierCurveShape,
  CloseCommand,
  EllipseShape,
  HorizontalLineShape,
  LineShape,
  MoveToCommand,
  PrimitiveShape,
  QuadBezierCurveShape,
  RoundedRectShape,
  VerticalLineShape,
} from './model/primitive-shape';
export { SvgPathParser, type ParsedPath } from './model/svg-path-parser';
export {
  ElementType,
  ShapeBoxElement,
  ShapeElement,
  ShapeImageElement,
  ShapePathElement,
  ShapeTextElement,
  TextSide,
  TextType,
  inlineImageKey,
  textSideFromName,
  textSideName,
} from './model/shape-element';
export { layoutTextInBox, textBoxWrapWidth, textEditRect, type TextBoxParam } from './model/text-box';
export {
  Condition,
  DEFAULT_ROW_COL,
  EmbedInfo,
  ImageInfo,
  PathInfo,
  TemplateData,
  TemplateFlags,
  TextInfo,
} from './model/template-data';
export {
  DefaultAttr,
  EmbeddedShape,
  LibraryViewAttr,
  ShapeTemplate,
  type AttrParamInfo,
  type CompiledData,
  type EmbeddedShapeSource,
  type InterestingPoint,
  type PointAttribute,
} from './model/shape-template';
export { POLYGON_TEMPLATE_ID, PolygonTemplate } from './model/polygon-template';
export { TEXT_TEMPLATE_ID, TextTemplate } from './model/text-template';
export { BezierCurveTemplate, CURVE_TEMPLATE_ID } from './model/bezier-curve-template';
export { PATH_TEMPLATE_ID, PathTemplate } from './model/path-template';

export {
  buildTemplateDef,
  compiledDataOf,
  isReferenceOnly,
  templateClassOf,
  type CatalogIssue,
  type TemplateClass,
  type TemplateDef,
} from './catalog/template-def';
export { ingestLibraryFile, type CatalogCategory, type CatalogItem, type CatalogSink } from './catalog/library-ingest';
export { CatalogMapsBuilder, TemplateCatalog, type CatalogMaps } from './catalog/template-catalog';
export {
  CatalogOverlay,
  type CatalogOverlayOptions,
  type DocTemplates,
  type TemplateFactory,
} from './catalog/catalog-overlay';
export {
  CatalogTemplateResolver,
  NO_TEMPLATES,
  defaultEmbedFrame,
  type EmbedFactory,
  type TemplateResolver,
} from './catalog/template-resolver';

export {
  ShapeGenerator,
  type GeneratorBehavior,
  type GeneratorJson,
  type PreservedTemplate,
} from './generator/shape-generator';
export type { GeneratorContext, SizeSpec, SizeSpecItem, SplitItem, SplitOptions } from './generator/generator-context';
export type {
  DrawEntry,
  EmbedEntry,
  ImageEntry,
  TextEntry,
  WireframeInput,
  WireframeKey,
  WireframeModule,
  WireframeOutput,
} from './generator/wireframe';
export {
  JS_GENERATOR_MARKER,
  classifyGenerator,
  classifyOnly,
  type GeneratorKind,
  type GeneratorRef,
  type GeneratorResolution,
  type GeneratorResolveFn,
  type UnknownGeneratorReason,
} from './generator/classify';
