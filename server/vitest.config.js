import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 10000,
    include: ['src/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      include: ['src/**/*.js'],
      exclude: ['src/**/*.test.js'],
      thresholds: {
        statements: 90,
        branches: 88,
        functions: 89,
        lines: 91,
      },
    },
  },
});
