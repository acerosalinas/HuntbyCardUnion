import { defineConfig } from "@playwright/test";

// Browser smoke tests for the public pages and the sign-in redirects. Run with `npm run test:e2e`
// (starts the dev server if one is not already running). They only read; nothing is written.
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000" },
  webServer: process.env.E2E_BASE_URL ? undefined : { command: "npm run dev", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000 },
});
