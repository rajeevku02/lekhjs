// `setTestConfig(overrides)` (spec 01 §4.1): the only way to turn on the test-only switches of
// `EngineConfig.testing` — `lineSpacingCompat`, `fontFallbackCompat` (spec 06 §3.6) and the pitch
// override of AC-ENG-11. It returns the frozen switch set that the text stack (and, once the
// session exists, `BoardSession` built through this entry) is constructed with. Never persisted.
import { TEXT_SWITCHES_OFF, type TextTestSwitches } from '../text';

export type TestConfig = TextTestSwitches;
export type TestConfigOverrides = Partial<TextTestSwitches>;

const KEYS: readonly string[] = Object.freeze(Object.keys(TEXT_SWITCHES_OFF));

/** The switches with `overrides` applied over "all off". Unknown keys throw. */
export function setTestConfig(overrides: TestConfigOverrides = {}): TestConfig {
  for (const k of Object.keys(overrides)) {
    if (!KEYS.includes(k)) throw new TypeError(`Unknown test config key '${k}'`);
  }
  const pitch = overrides.linePitch;
  if (pitch !== undefined && !(pitch > 0)) throw new RangeError('linePitch must be > 0');
  return Object.freeze({ ...TEXT_SWITCHES_OFF, ...overrides });
}
