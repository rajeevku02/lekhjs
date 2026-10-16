import { defineConfig } from 'vitest/config';

// Node environment only (no DOM). On the 2-core box at most two forked workers.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['test/lint/fixtures/**', 'node_modules/**', 'dist/**'],
    pool: 'forks',
    maxWorkers: 2,
    testTimeout: 30_000,
  },
});
