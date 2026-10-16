// The per-job context (spec 07 §3.1): everything a recognition job reads that C++ took from
// singletons or globals. There is no module-level state in the recognizer; each job builds one
// context and passes it down. (The scene delegate joins it with the delegate port, task R3.)
import type { LineAggregatorModule } from '../lines/LineAggregatorModule';
import type { RecognizerConfig } from './RecognizerConfig';

/**
 * Test-only switches that put back two C++ bugs the port fixes, so the rest of the port can be
 * proved against the shipped wasm (spec 07 §4.2). Both default to false. Not reachable from
 * product code or from `Config`: only tests and the parity harness's strict run set them.
 */
export interface RecognizerQuirks {
  /**
   * DR-REC-01 off: `ShapeColl.takeOut` behaves as C++ (`ShapeColl.cpp:79-95`): the first final
   * shape is taken without recording its perimeter, so any later final shape with a perimeter
   * attribute replaces it.
   */
  readonly legacyTakeOut?: boolean;
  /**
   * DR-REC-02 off: `CxPoly.computeBasicFeatures` sets `maxx = p.y` as C++ does
   * (`CxPoly.cpp:455-456`), so `features.width` is wrong.
   */
  readonly legacyWidthBug?: boolean;
}

/** Per-job counters, for tests and timings (AC-REC-09). */
export interface RecognizerCounters {
  /** Closed-shape detections that ran the shape stage (built candidate shapes). */
  shapeStageRuns: number;
  /** Closed-shape detections stopped by the 80 %-of-length early exit (R7). */
  earlyExits: number;
  /** Closed-shape searches stopped by the poly budget. */
  budgetExceeded: number;
}

export interface RecognizerContext {
  readonly config: RecognizerConfig;
  /** The injected line aggregator (AC-REC-06); `lines/index.ts` has the default binding. */
  readonly lineAggregator: LineAggregatorModule;
  readonly quirks: RecognizerQuirks;
  /** Log sink (C++ `base::Logger::log`); the worker returns the lines with the job result. */
  log(message: string): void;
  readonly counters: RecognizerCounters;
}

export interface RecognizerContextInit {
  readonly config: RecognizerConfig;
  readonly lineAggregator: LineAggregatorModule;
  readonly quirks?: RecognizerQuirks;
  /** Where log lines go; by default they are kept in `logs`. */
  readonly log?: (message: string) => void;
}

/** A context plus the log lines it collected (when no sink was given). */
export interface CollectingRecognizerContext extends RecognizerContext {
  readonly logs: readonly string[];
}

/** A fresh context for one job. */
export function createRecognizerContext(init: RecognizerContextInit): CollectingRecognizerContext {
  const logs: string[] = [];
  const sink = init.log;
  return {
    config: init.config,
    lineAggregator: init.lineAggregator,
    quirks: Object.freeze({ ...init.quirks }),
    counters: { shapeStageRuns: 0, earlyExits: 0, budgetExceeded: 0 },
    logs,
    log(message: string): void {
      if (sink !== undefined) sink(message);
      else logs.push(message);
    },
  };
}
