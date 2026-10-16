// Engine tunables (port of the C++ `Config` singleton). Here it is an immutable value: one
// `EngineConfig` per session (or runtime), built from the defaults plus user settings and test
// overrides with `withOverrides` (spec 01 §2.1, spec 02 §2). Field names are the C++ names, typos
// included, so each value can be traced to its C++ use.

/** C++ `Config::PENCIL_*` (`pencilBehavior`). */
export const PencilBehavior = Object.freeze({ SameAsTouch: 0, DrawInSelectionMode: 1, IgnoreTouch: 2 } as const);
export type PencilBehavior = (typeof PencilBehavior)[keyof typeof PencilBehavior];

/** C++ `Config::SCREEN_MODE_*` (`screenMode`). */
export const ScreenMode = Object.freeze({ AsSystem: 0, AlwaysLight: 1, AlwaysDark: 2 } as const);
export type ScreenMode = (typeof ScreenMode)[keyof typeof ScreenMode];

/** Debug switches (spec 03 §3.3). */
export interface DebugConfig {
  /** Shadow mode: every spatial-index query also runs the linear scan and throws on a difference. */
  verifyIndex: boolean;
}

/** Rendering switches (spec 03 §13). */
export interface RenderConfig {
  /** Skip the fill of text whose screen-space glyph height is below `minGlyphPx`. */
  lowZoomSimplify: boolean;
  minGlyphPx: number;
}

/** Every engine tunable, with the C++ defaults. */
export interface ConfigValues {
  recognizeShape: boolean;
  regulaizeShape: boolean;
  defaultArrowType: number;
  recognizeConnection: boolean;
  snapToGrid: boolean;
  snapToGridNewObject: boolean;
  snapAngleStep: number;
  enableVertexEditing: boolean;
  showPositionWhileMoving: boolean;
  showSizeWhileResizing: boolean;
  smoothUnrecognizedShape: boolean;
  makePolylineForUnrecognized: boolean;
  logRawPoints: boolean;
  logUpdates: boolean;
  /** 0 => like touch, 1 => draw in select mode, 2 => ignore touch */
  pencilBehavior: number;
  onlyDrawWithPencil: boolean;
  resizeShapeByZoomGesture: boolean;
  /** 0=> same as system, 1 = Always light 2 = Always Dark */
  screenMode: number;
  /** 0: no demo, 1: gesture demo, 2: shape demo */
  demoMode: number;
  shouldShowInfoButton: boolean;
  enableAirGesture: boolean;
  preventScreenToTurnOff: boolean;
  closePointDistance: number;
  closePointDistanceShort: number;
  closeDistForUnrecognized: number;
  lineAggregatorMaxJoinCost: number;
  minBoundForCircle: number;
  maxDistForPolygonClosing: number;
  parallelogramRegularizeAngle: number;
  minSmoothingForSingleCurve: number;
  curveSideStretchRatio: number;
  endPointDistForArrow: number;
  arrowDrawBoundLimit: number;
  maxAngleForArrow: number;
  maxAngleForArrowOnCurve: number;
  minLineDistFor2LineArrow: number;
  maxAngleFor2LinArrowRecognition: number;
  connectionLinesAngleRangeStart: number;
  connectionLinesAngleRangeEnd: number;
  multiStrokeWaitMS: number;
  multiStrokePathJoinDist: number;
  multiStrokeTrimFactorSingle: number;
  multiStrokeTrimFactor: number;
  connectObjectDistThreshold: number;
  enableMultiStroke: boolean;
  minLenOfArrow: number;
  minLenOfSolidArrow: number;
  multiplierForArrowLen: number;
  minDistBetweenDrawnPoints: number;
  vertexHandleRadius: number;
  vertexHandleSelectionRectAdjustment: number;
  ellipseHeightWidthMinDiff: number;
  textObjectBoundsAdjust: number;
  connectionLineSeparationFromObject: number;
  insertedImageMaxWidth: number;
  resizeInsertedImage: boolean;
  miniIconRadius: number;
  cloneDisplacement: number;
  selectRectAdjustment: number;
  minSelectRectDimention: number;
  showSelectionMenu: boolean;
  showExtendedSelectionMenu: boolean;
  resizeIndicatorSize: number;
  resizeIndicatorColor: number;
  rotationIndicatorGap: number;
  keepRIAtCorner: boolean;
  tapToSelectDistance: number;
  tapToEraseDistance: number;
  vertexDrawingRadius: number;
  vertexDrawingRadiusBig: number;
  selectionRectMenuTapToleranceDistance: number;
  vertexEditSnapDistance: number;
  svgTextLineHeightInEM: number;
  svgExportMargin: number;
  removeLeftAndTopUnusedSpaceInExport: boolean;
  imageExportMargin: number;
  pdfExportHorizontalMargin: number;
  pdfExportVerticalMargin: number;
  insertImageSize: number;
  defaultFontSize: number;
  defaultStrokeWidth: number;
  regularizeAngleThresholdInDegree: number;
  minCanvasZoom: number;
  maxCanvasZoom: number;
  alignmentPad: number;
  textMoverTolerace: number;
  connectionDefaultParam: number;
  connectionParamSnapDelta: number;
  connectionParamReduceDelta: number;
  extraConnectionLineLength: number;
  intersectionSnapDist: number;
  addDefaultTextOnConnector: boolean;
  scrollAnimationInterval: number;
  rejectFingerTouches: boolean;
  enableImplicitContainer: boolean;
  implicitContainerSize: number;
  implicitContainerSmallSize: number;
  implicitContainerContainsCheckAdjust: number;
  minCanvasWidth: number;
  minCanvasHeight: number;
  rightBottomMargin: number;
  minFixedCanvasWidth: number;
  minFixedCanvasHeight: number;
  maxCanvasSize: number;
  minTextEditWidth: number;
  lineCollConnectDist: number;
  /** default 3000: total polys produced (done + pending) before giving up */
  cxPolyMaxPolys: number;
  /** default 16: above this, detectClosedShape is skipped */
  closedShapeMaxLines: number;
  polygonSmallClosingDist: number;
  linePartEqualityDelta: number;
  angleReductionAreaThreshold: number;
  /** ConnectionObject::Type of a dragged connector: 0 = Curve, 1 = GenericLine, 2 = MultiLine */
  defaultConnectionType: number;
  showConnectionHandles: boolean;
  /** view px in the app; MCP uses the number as canvas units */
  selfLoopMinEndDistance: number;
  /** orthogonal loop: first and last leg, canvas units */
  selfLoopRunOut: number;
  /** orthogonal loop: distance beyond the edge an opposite-side loop rounds */
  selfLoopClearance: number;
  /** curve loop: extra sideways shift of an opposite-side loop */
  selfLoopCurveClearance: number;
  recognizeSelfLoop: boolean;
  /** ratio of the stroke length */
  selfLoopMinOutsideFraction: number;
  /** view px */
  selfLoopMinExcursion: number;
  /** x min(w, h) */
  selfLoopMinExcursionRatio: number;
  /** x max(w, h) */
  selfLoopMaxExcursionRatio: number;
  /** view px */
  selfLoopMinStrokeLength: number;
  selfLoopMaxCorners: number;
  /** degrees */
  selfLoopMinCornerAngle: number;
  /** degrees */
  selfLoopAxisTolerance: number;
  /** view px */
  connectDragStraightenMinSegment: number;
  /** degrees */
  connectDragStraightenAngle: number;
  shapePickerSearchThreshold: number;
  debug: DebugConfig;
  render: RenderConfig;
}

/** Overrides: any top-level field, and any part of a group. */
export type ConfigOverrides = {
  [K in keyof ConfigValues]?: ConfigValues[K] extends object ? Partial<ConfigValues[K]> : ConfigValues[K];
};

/** The C++ defaults (`Config::init`), with `PI` = `Math.PI` (OQ-46). */
export const CONFIG_DEFAULTS: Readonly<ConfigValues> = Object.freeze({
  recognizeShape: true,
  regulaizeShape: true,
  defaultArrowType: 2,
  recognizeConnection: true,
  snapToGrid: true,
  snapToGridNewObject: true,
  snapAngleStep: Math.PI / 36,
  enableVertexEditing: true,
  showPositionWhileMoving: true,
  showSizeWhileResizing: true,
  smoothUnrecognizedShape: false,
  makePolylineForUnrecognized: false,
  logRawPoints: false,
  logUpdates: false,
  pencilBehavior: 0,
  onlyDrawWithPencil: false,
  resizeShapeByZoomGesture: false,
  screenMode: ScreenMode.AsSystem,
  demoMode: 0,
  shouldShowInfoButton: true,
  enableAirGesture: false,
  preventScreenToTurnOff: false,
  closePointDistance: 28,
  closePointDistanceShort: 15,
  closeDistForUnrecognized: 5,
  lineAggregatorMaxJoinCost: 7,
  minBoundForCircle: 7,
  maxDistForPolygonClosing: 150,
  parallelogramRegularizeAngle: 12,
  minSmoothingForSingleCurve: 0.2,
  curveSideStretchRatio: 0.38,
  endPointDistForArrow: 30,
  arrowDrawBoundLimit: 100,
  maxAngleForArrow: 60,
  maxAngleForArrowOnCurve: 85,
  minLineDistFor2LineArrow: 8,
  maxAngleFor2LinArrowRecognition: 45,
  connectionLinesAngleRangeStart: 60,
  connectionLinesAngleRangeEnd: 120,
  multiStrokeWaitMS: 1000,
  multiStrokePathJoinDist: 18,
  multiStrokeTrimFactorSingle: 0.25,
  multiStrokeTrimFactor: 0.14,
  connectObjectDistThreshold: 32,
  enableMultiStroke: false,
  minLenOfArrow: 6,
  minLenOfSolidArrow: 6,
  multiplierForArrowLen: 1,
  minDistBetweenDrawnPoints: 2,
  vertexHandleRadius: 16,
  vertexHandleSelectionRectAdjustment: 12,
  ellipseHeightWidthMinDiff: 5,
  textObjectBoundsAdjust: 8,
  connectionLineSeparationFromObject: 2,
  insertedImageMaxWidth: 500,
  resizeInsertedImage: true,
  miniIconRadius: 15,
  cloneDisplacement: 24,
  selectRectAdjustment: 15,
  minSelectRectDimention: 50 + 2 * 15,
  showSelectionMenu: true,
  showExtendedSelectionMenu: false,
  resizeIndicatorSize: 8,
  resizeIndicatorColor: 0xfff0f0f0 | 0,
  rotationIndicatorGap: 20,
  keepRIAtCorner: true,
  tapToSelectDistance: 16,
  tapToEraseDistance: 12,
  vertexDrawingRadius: 3,
  vertexDrawingRadiusBig: 4,
  selectionRectMenuTapToleranceDistance: 4,
  vertexEditSnapDistance: 7,
  svgTextLineHeightInEM: 1.2,
  svgExportMargin: 12,
  removeLeftAndTopUnusedSpaceInExport: true,
  imageExportMargin: 30,
  pdfExportHorizontalMargin: 54,
  pdfExportVerticalMargin: 72,
  insertImageSize: 300,
  defaultFontSize: 15,
  defaultStrokeWidth: 1.5,
  regularizeAngleThresholdInDegree: 7,
  minCanvasZoom: 2,
  maxCanvasZoom: 800,
  alignmentPad: 2,
  textMoverTolerace: 50,
  connectionDefaultParam: 40,
  connectionParamSnapDelta: 12,
  connectionParamReduceDelta: 4,
  extraConnectionLineLength: 60,
  intersectionSnapDist: 2,
  addDefaultTextOnConnector: true,
  scrollAnimationInterval: 5,
  rejectFingerTouches: false,
  enableImplicitContainer: true,
  implicitContainerSize: 310,
  implicitContainerSmallSize: 80,
  implicitContainerContainsCheckAdjust: 10,
  minCanvasWidth: 612,
  minCanvasHeight: 792,
  rightBottomMargin: 64,
  minFixedCanvasWidth: 20,
  minFixedCanvasHeight: 20,
  maxCanvasSize: 50000,
  minTextEditWidth: 120,
  lineCollConnectDist: 12,
  cxPolyMaxPolys: 3000,
  closedShapeMaxLines: 16,
  polygonSmallClosingDist: 6,
  linePartEqualityDelta: 4,
  angleReductionAreaThreshold: 0.65,
  defaultConnectionType: 2,
  showConnectionHandles: true,
  selfLoopMinEndDistance: 40,
  selfLoopRunOut: 40,
  selfLoopClearance: 20,
  selfLoopCurveClearance: 20,
  recognizeSelfLoop: true,
  selfLoopMinOutsideFraction: 0.7,
  selfLoopMinExcursion: 20,
  selfLoopMinExcursionRatio: 0.1,
  selfLoopMaxExcursionRatio: 1.5,
  selfLoopMinStrokeLength: 60,
  selfLoopMaxCorners: 4,
  selfLoopMinCornerAngle: 60,
  selfLoopAxisTolerance: 15,
  connectDragStraightenMinSegment: 16,
  connectDragStraightenAngle: 15,
  shapePickerSearchThreshold: 20,
  debug: Object.freeze({ verifyIndex: false }),
  render: Object.freeze({ lowZoomSimplify: false, minGlyphPx: 2 }),
});

const GROUPS = Object.freeze(['debug', 'render'] as const);

/** The keys of `ConfigValues`, in declaration order. */
export const CONFIG_KEYS: readonly (keyof ConfigValues)[] = Object.freeze(
  Object.keys(CONFIG_DEFAULTS) as (keyof ConfigValues)[],
);

/** A read-only view of the values, as every engine module receives it. */
export type Config = EngineConfig;

// The class carries the fields of ConfigValues as frozen own properties (assigned in the
// constructor); this interface gives them their types.
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface EngineConfig extends Readonly<Omit<ConfigValues, 'debug' | 'render'>> {
  readonly debug: Readonly<DebugConfig>;
  readonly render: Readonly<RenderConfig>;
}

/** Immutable snapshot of the engine tunables. */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class EngineConfig {
  /** The defaults plus `overrides`. */
  constructor(overrides: ConfigOverrides = {}) {
    const merged = merge(CONFIG_DEFAULTS, overrides);
    Object.assign(this, merged);
    Object.freeze(this);
  }

  /** A new config: this one with `overrides` applied (groups are merged field by field). */
  withOverrides(overrides: ConfigOverrides): EngineConfig {
    return new EngineConfig({ ...this.toValues(), ...mergeGroups(this.toValues(), overrides) });
  }

  /** A plain copy of every value. */
  toValues(): ConfigValues {
    const out: Record<string, unknown> = {};
    for (const k of CONFIG_KEYS) {
      const v = this[k];
      out[k] = typeof v === 'object' ? { ...v } : v;
    }
    return out as unknown as ConfigValues;
  }
}

function mergeGroups(base: Readonly<ConfigValues>, overrides: ConfigOverrides): ConfigOverrides {
  const out: Record<string, unknown> = { ...overrides };
  for (const g of GROUPS) {
    const o = overrides[g];
    if (o !== undefined) out[g] = { ...base[g], ...o };
  }
  return out;
}

function merge(base: Readonly<ConfigValues>, overrides: ConfigOverrides): ConfigValues {
  for (const k of Object.keys(overrides)) {
    if (!(k in base)) throw new TypeError(`Unknown config key '${k}'`);
  }
  const out = { ...base, ...mergeGroups(base, overrides) } as ConfigValues;
  out.debug = Object.freeze({ ...out.debug });
  out.render = Object.freeze({ ...out.render });
  return out;
}
