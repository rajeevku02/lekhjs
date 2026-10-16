// `lekhjs/testing`: test-only entry, rank 14 (spec 01 §4.1). No module under src/ may import it,
// and tools/bundle-audit.mjs keeps it out of dist/node/index.js and dist/node/headless.js.
export { RecordedWidthMeasurer, type NativeWrapCase } from './recorded-width-measurer';
export { setTestConfig, type TestConfig, type TestConfigOverrides } from './test-config';
export { createTestTextStack, type TestTextStack, type TestTextStackOptions } from './text-stack';
export {
  createTestRuntime,
  recordingLogger,
  sequentialIds,
  type LogEntry,
  type TestRuntime,
  type TestRuntimeOptions,
} from './runtime';
export { FakeFontLoader, FakeImagePort, FakeScheduler, FakeTransport, fakeImage, type FakeImage } from './fakes';
export { createFixtureLoader, type FixtureLoader } from './fixtures';
