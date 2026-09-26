import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'api',
          include: ['apps/api/src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'operations',
          include: ['tests/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'contracts',
          include: ['packages/contracts/src/**/*.test.ts'],
          environment: 'node',
        },
      },
      './apps/web/vite.config.ts',
    ],
  },
});
