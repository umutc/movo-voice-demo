import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'agent',
          include: ['agent/test/**/*.test.ts', 'db/test/fake.test.ts', 'scripts/**/*.test.ts', 'web/lib/**/*.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        test: {
          name: 'db',
          include: ['db/test/**/*.db.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
