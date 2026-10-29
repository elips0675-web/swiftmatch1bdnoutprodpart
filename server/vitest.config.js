import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 10000,
    hookTimeout: 30000,
    include: ['src/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      reportsDirectory: 'node_modules/.cache/coverage',
      include: ['src/**/*.js'],
      exclude: ['src/**/*.test.js'],
      thresholds: {
        statements: 97,
        branches: 96,
        functions: 97,
        lines: 97,
      },
    },
  },
});
