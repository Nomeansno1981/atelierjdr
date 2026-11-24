import { defineConfig, devices } from '@playwright/test'

/**
 * Les tests tournent sur la version construite (CSP comprise), servie par
 * `vite preview`. Seul Chromium est disponible ici : les tailles tablette et
 * téléphone sont émulées. La validation sur Safari se fait sur un vrai appareil.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173/',
    locale: 'fr-FR',
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: 'ordinateur', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'tablette', use: { ...devices['iPad (gen 7)'], browserName: 'chromium' } },
    { name: 'telephone', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
})
