import { defineConfig } from "@playwright/test";

const port = Number(process.env.CSP_E2E_PORT || 19493);
export default defineConfig({
  testDir: "./e2e/transfer-policy",
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  reporter: [["list"], ["junit", { outputFile: "../gl-test-reports/frontend-transfer-policy-junit.xml" }]],
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure", launchOptions: { timeout: 15_000 } },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: { command: "node scripts/serve-transfer-policy-test.mjs", url: `http://localhost:${port}`, reuseExistingServer: false, timeout: 60_000 },
});
