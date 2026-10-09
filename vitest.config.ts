import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['test/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
          exclude: ['test/worker/**'],
          environment: 'node',
          environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']],
        },
      },
      defineWorkersProject({
        test: {
          name: 'worker',
          include: ['test/worker/**/*.test.ts'],
          poolOptions: {
          workers: {
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: { bindings: { ANTHROPIC_API_KEY: 'sk-ant-test-secret-do-not-leak' } },
          },
        },
        },
      }),
    ],
  },
})
