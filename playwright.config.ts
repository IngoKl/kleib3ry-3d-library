import { defineConfig, devices } from '@playwright/test'

const PORT = 5190

/**
 * The smoke harness runs against the production bundle in headless Chromium.
 * WebGL needs a real GPU path, so ANGLE/SwiftShader is forced on rather than
 * left to the headless default, which silently drops the context.
 *
 * Which is also why the per-test allowance is minutes rather than seconds.
 * SwiftShader rasterises the whole cabin on the CPU, so a test that takes a
 * handful of seconds on a GPU takes the better part of a minute here — and on a
 * machine that is also compiling something, several times that. None of these
 * tests measure speed; every one of them waits for a *condition*. The timeout is
 * there to catch a stopped render loop, and a generous one still catches that
 * while a tight one turns "the host was busy" into a failing suite nobody can
 * act on.
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
