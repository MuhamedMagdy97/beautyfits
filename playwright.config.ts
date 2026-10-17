import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, E2E_PORT, serverEnv } from "./e2e/config";

/**
 * End-to-end regression suite (TASK-063, ADR-0071): `npm run test:e2e`.
 * Runs the production build (`npm run build` first) against a dedicated
 * database that the global setup recreates and seeds on every run.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // One database and one shared customer journey: run one test at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "node server.mjs",
    url: `${BASE_URL}/api/v1/health`,
    env: serverEnv(),
    // Never attach to a server started elsewhere: it may use another database.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
  outputDir: "test-results/e2e",
  metadata: { port: E2E_PORT },
});
