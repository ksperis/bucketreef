import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, type Browser, type Page } from "@playwright/test";

import { waitForStableDashboardDonut } from "./chartCapture";
import { registerApiMocks } from "./mockApi";
import { scenarios } from "./scenarios";
import { seedUiPreferences } from "./uiPreferences";
import type {
  DocScreenshotScenario,
  ScenarioAction,
  ScreenshotThemeVariant,
} from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, "../../../doc/docs/assets/screenshots/user");
const SCREENSHOT_VARIANTS: ScreenshotThemeVariant[] = ["light", "dark"];
const ACTION_TIMEOUT_MS = 15_000;

async function writeDebugArtifacts(page: Page, scenarioId: string, runtimeErrors: string[]) {
  const debugPath = path.join(SCREENSHOT_DIR, `${scenarioId}.debug.png`);
  const htmlPath = path.join(SCREENSHOT_DIR, `${scenarioId}.debug.html`);
  const errorsPath = path.join(SCREENSHOT_DIR, `${scenarioId}.debug.log`);
  await page.screenshot({ path: debugPath, fullPage: true });
  const html = await page.content();
  await fs.writeFile(htmlPath, html, "utf8");
  await fs.writeFile(errorsPath, runtimeErrors.join("\n"), "utf8");
}

async function runAction(page: Page, action: ScenarioAction) {
  try {
    if (action.type === "wait") {
      await page.locator(action.selector).first().waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
      return;
    }
    if (action.type === "click") {
      const locator = page.locator(action.selector).first();
      await locator.waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
      await locator.click({ timeout: ACTION_TIMEOUT_MS });
      return;
    }
    if (action.type === "select") {
      const locator = page.locator(action.selector).first();
      await locator.waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
      await locator.selectOption(action.value, { timeout: ACTION_TIMEOUT_MS });
      return;
    }
    if (action.type === "fill") {
      const locator = page.locator(action.selector).first();
      await locator.waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
      await locator.fill(action.value, { timeout: ACTION_TIMEOUT_MS });
      return;
    }
    const locator = page.locator(action.selector).first();
    await locator.waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
    await locator.press(action.key, { timeout: ACTION_TIMEOUT_MS });
  } catch (error) {
    throw new Error(`Unable to run screenshot action ${action.type} on selector "${action.selector}"`, {
      cause: error,
    });
  }
}

async function screenshotScenario(
  page: Page,
  scenario: DocScreenshotScenario,
  outputPath: string,
) {
  if (!scenario.capture) {
    await page.screenshot({ path: outputPath, fullPage: false });
    return;
  }

  const target = page.locator(scenario.capture.selector).first();
  await target.waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
  const box = await target.boundingBox();
  if (!box) {
    throw new Error(
      `Unable to resolve screenshot bounds for selector "${scenario.capture.selector}"`,
    );
  }

  const viewport = page.viewportSize();
  if (!viewport) {
    throw new Error("Documentation screenshot page has no viewport");
  }
  const padding = Math.max(0, scenario.capture.padding ?? 24);
  const x = Math.max(0, Math.floor(box.x - padding));
  const y = Math.max(0, Math.floor(box.y - padding));
  const right = Math.min(viewport.width, Math.ceil(box.x + box.width + padding));
  const bottom = Math.min(viewport.height, Math.ceil(box.y + box.height + padding));

  await page.screenshot({
    path: outputPath,
    clip: {
      x,
      y,
      width: right - x,
      height: bottom - y,
    },
  });
}

async function captureScenarioVariant(
  basePage: Page,
  scenario: DocScreenshotScenario,
  variant: ScreenshotThemeVariant
) {
  const page = await basePage.context().newPage();
  const runtimeErrors: string[] = [];

  page.on("pageerror", (error) => {
    runtimeErrors.push(`[pageerror] ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(`[console.error] ${message.text()}`);
    }
  });
  page.on("dialog", (dialog) => {
    runtimeErrors.push(`[dialog ${dialog.type()}] ${dialog.message()}`);
    void dialog.accept();
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      runtimeErrors.push(`[http ${response.status()}] ${response.request().method()} ${response.url()}`);
    }
  });

  const debugScenarioId = `${scenario.id}.${variant}`;
  try {
    await page.emulateMedia({ colorScheme: variant });
    const mockRegistry = await registerApiMocks(
      page,
      scenario.mockRules,
      debugScenarioId,
      scenario.user
    );
    await seedUiPreferences(page, { ...scenario.storage, theme: variant });

    await page.goto(scenario.route, { waitUntil: "domcontentloaded" });
    try {
      await page.locator(scenario.waitFor).first().waitFor({ state: "visible", timeout: 30_000 });
    } catch (error) {
      await writeDebugArtifacts(page, debugScenarioId, runtimeErrors);
      throw error;
    }

    try {
      for (const action of scenario.actions ?? []) {
        await runAction(page, action);
      }

      await page.waitForTimeout(250);
      if (scenario.route === "/manager") await waitForStableDashboardDonut(page);

      const outputPath = path.join(SCREENSHOT_DIR, `${scenario.outputBasename}.${variant}.png`);
      await screenshotScenario(page, scenario, outputPath);
      if (scenario.postScreenshotWaitMs && scenario.postScreenshotWaitMs > 0) {
        await page.waitForTimeout(scenario.postScreenshotWaitMs);
      }
      for (const action of scenario.postScreenshotActions ?? []) {
        await runAction(page, action);
      }

      mockRegistry.assertNoUnmatched();
    } catch (error) {
      await writeDebugArtifacts(page, debugScenarioId, runtimeErrors);
      throw error;
    }
  } finally {
    await page.close();
  }
}

async function captureScenarioWorkflowVideo(browser: Browser, scenario: DocScreenshotScenario) {
  if (!scenario.workflowVideo) return;

  const temporaryVideoDir = path.join(
    SCREENSHOT_DIR,
    `.video-${scenario.id}-${process.pid}`,
  );
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1728, height: 972 },
    locale: "en-US",
    timezoneId: "UTC",
    recordVideo: {
      dir: temporaryVideoDir,
      size: { width: 1440, height: 810 },
    },
  });
  const page = await context.newPage();
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(`[pageerror] ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(`[console.error] ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      runtimeErrors.push(
        `[http ${response.status()}] ${response.request().method()} ${response.url()}`,
      );
    }
  });

  try {
    await page.emulateMedia({ colorScheme: "light" });
    const mockRegistry = await registerApiMocks(
      page,
      scenario.mockRules,
      `${scenario.id}.workflow`,
      scenario.user,
    );
    await seedUiPreferences(page, { ...scenario.storage, theme: "light" });
    await page.goto(scenario.route, { waitUntil: "domcontentloaded" });
    await page.locator(scenario.waitFor).first().waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(600);

    const pauseAfterActionMs = scenario.workflowVideo.pauseAfterActionMs ?? 650;
    for (const action of scenario.actions ?? []) {
      await runAction(page, action);
      if (action.type !== "wait") await page.waitForTimeout(pauseAfterActionMs);
    }
    await page.waitForTimeout(scenario.workflowVideo.finalPauseMs ?? 1_500);
    mockRegistry.assertNoUnmatched();

    const video = page.video();
    await context.close();
    if (!video) throw new Error(`Workflow video was not recorded for ${scenario.id}`);
    await video.saveAs(
      path.join(SCREENSHOT_DIR, `${scenario.workflowVideo.outputBasename}.webm`),
    );
  } catch (error) {
    if (!page.isClosed()) {
      await writeDebugArtifacts(page, `${scenario.id}.workflow`, runtimeErrors);
      await context.close();
    }
    throw error;
  } finally {
    await fs.rm(temporaryVideoDir, { recursive: true, force: true });
  }
}

test.describe.configure({ mode: "serial" });

for (const scenario of scenarios) {
  test(`docs screenshot: ${scenario.id}`, async ({ browser, page }) => {
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    for (const variant of SCREENSHOT_VARIANTS) {
      await captureScenarioVariant(page, scenario, variant);
    }
    await captureScenarioWorkflowVideo(browser, scenario);
  });
}
