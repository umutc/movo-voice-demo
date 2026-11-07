import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'agent', include: ['agent/test/**/*.test.ts'], testTimeout: 60_000, hookTimeout: 60_000 } },
      { test: { name: 'db', include: ['db/test/**/*.test.ts'], testTimeout: 60_000, hookTimeout: 60_000, fileParallelism: false } },
    ],
  },
});
