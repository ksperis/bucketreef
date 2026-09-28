import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./scripts/docs-screenshots",
  testMatch: "errorPagesVisualQa.spec.ts",
  workers: 1,
  timeout: 30_000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:14377",
    viewport: { width: 1487, height: 1058 },
    deviceScaleFactor: 1,
    locale: "fr-FR",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 14377 --strictPort",
    url: "http://127.0.0.1:14377",
    reuseExistingServer: !process.env.CI,
  },
});
