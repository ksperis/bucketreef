import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/demo",
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  timeout: 45_000,
  expect: { timeout: process.env.CI ? 20_000 : 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["junit", { outputFile: "../gl-test-reports/demo-junit.xml" }]] : "list",
  outputDir: "test-results/demo",
  use: { baseURL: "http://127.0.0.1:4187", trace: process.env.CI ? "retain-on-failure" : "off", screenshot: "only-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: { command: "npm run preview:demo", url: "http://127.0.0.1:4187", reuseExistingServer: !process.env.CI },
});
