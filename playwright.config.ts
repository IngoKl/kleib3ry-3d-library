import { defineConfig, devices } from '@playwright/test'

const PORT = 5190

/**
 * ANGLE/SwiftShader is forced on because the headless default silently drops the
 * WebGL context. Timeouts are in minutes for the same reason: SwiftShader
 * rasterises the cabin on the CPU. No test here measures speed — each waits on a
 * condition, so the timeout only has to catch a stopped render loop.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 180_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
          ],
        },
      },
    },
  ],
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
