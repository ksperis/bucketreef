import { defineConfig } from "@playwright/test";

const port = Number(process.env.CSP_VITE_E2E_PORT || 19494);

export default defineConfig({
  testDir: "./e2e/vite-transfer-policy",
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    launchOptions: { timeout: 15_000 },
  },
  projects: [
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: "node scripts/serve-vite-transfer-policy-test.mjs",
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
