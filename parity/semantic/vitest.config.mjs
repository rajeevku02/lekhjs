import path from 'node:path';
import { defineConfig } from 'vitest/config';

// The semantic parity replay only (`replay.test.mjs`): one forked worker, rooted at lekhjs/ so the
// test imports `src/` directly. Not part of `npm test` (its inputs are a local capture).
export default defineConfig({
  root: path.resolve(import.meta.dirname, '..', '..'),
  test: {
    environment: 'node',
    include: ['parity/semantic/**/*.test.mjs'],
    pool: 'forks',
    maxWorkers: 1,
    testTimeout: 3_600_000,
  },
});
