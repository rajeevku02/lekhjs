// `createTestRuntime(opts?)` (spec 01 §4.1): a `Runtime` for tests over a `RecordedWidthMeasurer`
// (a fixed advance per character by default, so layouts are exact) or over a canvas factory
// (`@napi-rs/canvas` in the lekhjs suites, passed in by the test: src/ never imports it). Ids are
// sequential uuids, the log is recorded, fonts come from a `FakeFontLoader`, and the test-only
// text switches (`setTestConfig`, with `linePitch`) are applied to the runtime's text stack.
import type { Clock, ConfigOverrides, IdSource, Logger } from '../base';
import type { GeneratorHooks } from '../io';
import { createRuntime, type Runtime } from '../session';
import { TemplateCatalog } from '../template';
import { CanvasTextMeasurer, type CanvasFactory, type FontHost, type TextMeasurer } from '../text';
import { FakeFontLoader } from './fakes';
import { RecordedWidthMeasurer } from './recorded-width-measurer';
import { setTestConfig, type TestConfig, type TestConfigOverrides } from './test-config';

export interface LogEntry {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly m: string;
  readonly f?: object;
}

export interface TestRuntimeOptions {
  /** The measurer; default a `RecordedWidthMeasurer` with `advance` per character. */
  readonly measurer?: TextMeasurer;
  /** Measure with a real canvas (`@napi-rs/canvas`) instead. */
  readonly canvas?: CanvasFactory;
  /** Per-character advance of the default measurer. Default 10. */
  readonly advance?: number;
  /** Default: an empty catalog. */
  readonly catalog?: TemplateCatalog;
  readonly generators?: GeneratorHooks;
  /** The test-only switches (`lineSpacingCompat`, `fontFallbackCompat`, `linePitch`). */
  readonly testing?: TestConfigOverrides;
  readonly clock?: Clock;
  readonly ids?: IdSource;
  readonly logger?: Logger;
  readonly config?: ConfigOverrides;
  readonly host?: FontHost;
}

export interface TestRuntime extends Runtime {
  readonly fontLoader: FakeFontLoader;
  /** What the runtime's logger recorded (when the test passed no logger). */
  readonly logs: LogEntry[];
  readonly testing: TestConfig;
}

/** Sequential uuid-v4 strings: `00000000-0000-4000-8000-000000000001`, … */
export function sequentialIds(start = 0): IdSource {
  let n = start;
  return {
    next: () => {
      n++;
      return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
    },
  };
}

/** A logger that appends to `logs`. */
export function recordingLogger(logs: LogEntry[]): Logger {
  const rec =
    (level: LogEntry['level']) =>
    (m: string, f?: object): void => {
      logs.push(f === undefined ? { level, m } : { level, m, f });
    };
  return { debug: rec('debug'), info: rec('info'), warn: rec('warn'), error: rec('error') };
}

export function createTestRuntime(opts: TestRuntimeOptions = {}): TestRuntime {
  const testing = setTestConfig(opts.testing);
  const logs: LogEntry[] = [];
  const logger = opts.logger ?? recordingLogger(logs);
  const measurer =
    opts.measurer ??
    (opts.canvas !== undefined
      ? CanvasTextMeasurer.fromFactory(opts.canvas, logger)
      : new RecordedWidthMeasurer(new Map(), opts.advance ?? 10));
  const fontLoader = new FakeFontLoader();
  const runtime = createRuntime({
    measurer,
    fonts: fontLoader,
    catalog: opts.catalog ?? TemplateCatalog.empty(),
    ...(opts.generators !== undefined ? { generators: opts.generators } : {}),
    clock: opts.clock ?? { now: () => 1234 },
    ids: opts.ids ?? sequentialIds(),
    logger,
    config: opts.config ?? { debug: { verifyIndex: true } },
    host: opts.host ?? 'backend',
    testing,
  });
  return Object.freeze({ ...runtime, fontLoader, logs, testing });
}
