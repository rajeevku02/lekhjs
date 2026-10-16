// Global vitest setup (AC-ENG-03, verification 04): every `EngineConfig` a suite builds has the
// index shadow check (`debug.verifyIndex`) on unless the suite sets it explicitly, so every
// hit-test query in every suite also runs the linear scan and throws `index_mismatch` on any
// difference. The product default stays off (`CONFIG_DEFAULTS.debug.verifyIndex`).
import { vi } from 'vitest';
import type { ConfigOverrides } from '../../src/base/config';

vi.mock(import('../../src/base/config'), async (importOriginal) => {
  const actual = await importOriginal();
  class VerifyingEngineConfig extends actual.EngineConfig {
    constructor(overrides: ConfigOverrides = {}) {
      super({ ...overrides, debug: { verifyIndex: true, ...overrides.debug } });
    }
  }
  return { ...actual, EngineConfig: VerifyingEngineConfig };
});
