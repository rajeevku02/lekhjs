// The `Config` subset the recognizer reads (spec 07 §6.3). Every field read under the C++
// `recognizer/ fitter/ regularizer/ geometry/` (all `Config::instance().*` uses and the two
// `const Config& cfg` sites), minus `enableMultiStroke` (multi-stroke is not ported).
// `recognizeShape` and `logRawPoints` are read on the main thread only, so they are not here.
//
// The recognizer never reads a `Config` singleton: a `RecognizerConfig` arrives with each job
// (inside `RecognizerContext`), as plain numbers and booleans that cross `postMessage` unchanged.
// AC-REC-05: a test fails if a recognizer source reads a config field not declared here.
// AC-REC-35: the defaults equal C++ `base/Config.cpp`.
import { CONFIG_DEFAULTS, type Config } from '../../base';

/** The recognizer's tunables. Names and meanings are the C++ `Config` fields'. */
export interface RecognizerConfig {
  readonly recognizeConnection: boolean;
  readonly recognizeSelfLoop: boolean;
  /** Above this many lines, `detectClosedShape` returns false without searching (16). */
  readonly closedShapeMaxLines: number;
  /** The most polys the all-nearby `CxPolyAggregator` search may produce (3000). */
  readonly cxPolyMaxPolys: number;
  /** Line ends nearer than this connect in `LineColl` (12 view px). */
  readonly lineCollConnectDist: number;
  /** Join-cost threshold of the line aggregator (7); `+ 2` is the sub-line cost cut in `CxPoly`. */
  readonly lineAggregatorMaxJoinCost: number;
  /** Two parts of one line are equal when both ends are within this distance (4). */
  readonly linePartEqualityDelta: number;
  readonly angleReductionAreaThreshold: number;
  readonly closePointDistance: number;
  readonly closePointDistanceShort: number;
  readonly maxDistForPolygonClosing: number;
  readonly polygonSmallClosingDist: number;
  readonly parallelogramRegularizeAngle: number;
  readonly curveSideStretchRatio: number;
  readonly multiStrokePathJoinDist: number;
  readonly multiStrokeTrimFactor: number;
  readonly multiStrokeTrimFactorSingle: number;
  readonly endPointDistForArrow: number;
  readonly arrowDrawBoundLimit: number;
  readonly minLenOfArrow: number;
  readonly maxAngleForArrow: number;
  readonly maxAngleForArrowOnCurve: number;
  readonly maxAngleFor2LinArrowRecognition: number;
  readonly minLineDistFor2LineArrow: number;
  readonly connectionLinesAngleRangeStart: number;
  readonly connectionLinesAngleRangeEnd: number;
  readonly connectObjectDistThreshold: number;
  readonly selfLoopMinOutsideFraction: number;
  readonly selfLoopMinExcursion: number;
  readonly selfLoopMinExcursionRatio: number;
  readonly selfLoopMaxExcursionRatio: number;
  readonly selfLoopMinStrokeLength: number;
  readonly selfLoopMinEndDistance: number;
  readonly selfLoopMaxCorners: number;
  readonly selfLoopMinCornerAngle: number;
  readonly selfLoopAxisTolerance: number;
}

/** The field names of `RecognizerConfig`, in declaration order. */
export const RECOGNIZER_CONFIG_KEYS = Object.freeze([
  'recognizeConnection',
  'recognizeSelfLoop',
  'closedShapeMaxLines',
  'cxPolyMaxPolys',
  'lineCollConnectDist',
  'lineAggregatorMaxJoinCost',
  'linePartEqualityDelta',
  'angleReductionAreaThreshold',
  'closePointDistance',
  'closePointDistanceShort',
  'maxDistForPolygonClosing',
  'polygonSmallClosingDist',
  'parallelogramRegularizeAngle',
  'curveSideStretchRatio',
  'multiStrokePathJoinDist',
  'multiStrokeTrimFactor',
  'multiStrokeTrimFactorSingle',
  'endPointDistForArrow',
  'arrowDrawBoundLimit',
  'minLenOfArrow',
  'maxAngleForArrow',
  'maxAngleForArrowOnCurve',
  'maxAngleFor2LinArrowRecognition',
  'minLineDistFor2LineArrow',
  'connectionLinesAngleRangeStart',
  'connectionLinesAngleRangeEnd',
  'connectObjectDistThreshold',
  'selfLoopMinOutsideFraction',
  'selfLoopMinExcursion',
  'selfLoopMinExcursionRatio',
  'selfLoopMaxExcursionRatio',
  'selfLoopMinStrokeLength',
  'selfLoopMinEndDistance',
  'selfLoopMaxCorners',
  'selfLoopMinCornerAngle',
  'selfLoopAxisTolerance',
] as const satisfies readonly (keyof RecognizerConfig)[]);

/** The fields of `src` that the recognizer reads, as a frozen plain object. */
function pick(src: RecognizerConfig): RecognizerConfig {
  const out: Record<string, number | boolean> = {};
  for (const k of RECOGNIZER_CONFIG_KEYS) out[k] = src[k];
  return Object.freeze(out) as unknown as RecognizerConfig;
}

/** The C++ defaults (`Config::init`), taken from the engine defaults. */
export const RECOGNIZER_CONFIG_DEFAULTS: RecognizerConfig = pick(CONFIG_DEFAULTS);

/** The recognizer's view of an engine `Config` (C++ `Config::instance()` at job time). */
export function recognizerConfigFrom(config: Config): RecognizerConfig {
  return pick(config);
}

/** The defaults with `overrides` applied (tests, the parity harness). */
export function recognizerConfigWith(overrides: Partial<RecognizerConfig>): RecognizerConfig {
  for (const k of Object.keys(overrides)) {
    if (!(RECOGNIZER_CONFIG_KEYS as readonly string[]).includes(k)) {
      throw new TypeError(`Unknown recognizer config key '${k}'`);
    }
  }
  return pick({ ...RECOGNIZER_CONFIG_DEFAULTS, ...overrides });
}
