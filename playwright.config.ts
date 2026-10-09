import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://localhost:4173' },
  webServer: {
    command: 'npm run build && npx wrangler dev --port 4173',
    port: 4173,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
})
