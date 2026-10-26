import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test, type Browser, type Locator, type Page } from "@playwright/test";

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
const moduleRequire = createRequire(import.meta.url);
const SCREENSHOT_DIR = path.resolve(__dirname, "../../../doc/docs/assets/screenshots/user");
const SCREENSHOT_VARIANTS: ScreenshotThemeVariant[] = ["light", "dark"];
const ACTION_TIMEOUT_MS = 15_000;
const WORKFLOW_POINTER_MOVE_MS = 320;
const WORKFLOW_POINTER_SETTLE_MS = 180;
const WORKFLOW_FIELD_FOCUS_MS = 220;

const WORKFLOW_POINTER_STYLE_ID = "docs-workflow-pointer-style";
const WORKFLOW_POINTER_ID = "docs-workflow-pointer";
const WORKFLOW_POINTER_RIPPLE_ID = "docs-workflow-pointer-ripple";
const WORKFLOW_POINTER_FOCUS_ID = "docs-workflow-pointer-focus";

type PlaywrightRegistryModule = {
  registry: {
    findExecutable(name: string): {
      executablePath(): string;
    };
  };
};

function playwrightFfmpegPath() {
  const playwrightCorePackage = moduleRequire.resolve("playwright-core/package.json");
  const registryModulePath = path.join(
    path.dirname(playwrightCorePackage),
    "lib/server/registry/index.js",
  );
  const { registry } = moduleRequire(registryModulePath) as PlaywrightRegistryModule;
  const executablePath = registry.findExecutable("ffmpeg").executablePath();
  if (!executablePath) {
    throw new Error("Playwright FFmpeg executable is unavailable");
  }
  return executablePath;
}

async function trimWorkflowVideo(inputPath: string, outputPath: string, trimStartMs: number) {
  const ffmpeg = playwrightFfmpegPath();
  await new Promise<void>((resolve, reject) => {
    execFile(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        (trimStartMs / 1_000).toFixed(3),
        "-i",
        inputPath,
        "-an",
        "-c:v",
        "libvpx",
        "-crf",
        "18",
        "-b:v",
        "0",
        "-y",
        outputPath,
      ],
      (error, _stdout, stderr) => {
        if (error) {
          reject(
            new Error(`Unable to trim workflow video: ${stderr.trim() || error.message}`, {
              cause: error,
            }),
          );
          return;
        }
        resolve();
      },
    );
  });
}

async function writeDebugArtifacts(page: Page, scenarioId: string, runtimeErrors: string[]) {
  const debugPath = path.join(SCREENSHOT_DIR, `${scenarioId}.debug.png`);
  const htmlPath = path.join(SCREENSHOT_DIR, `${scenarioId}.debug.html`);
  const errorsPath = path.join(SCREENSHOT_DIR, `${scenarioId}.debug.log`);
  await page.screenshot({ path: debugPath, fullPage: true });
  const html = await page.content();
  await fs.writeFile(htmlPath, html, "utf8");
  await fs.writeFile(errorsPath, runtimeErrors.join("\n"), "utf8");
}

async function installWorkflowPointer(page: Page) {
  await page.evaluate(
    ({ styleId, pointerId, rippleId, focusId, moveMs }) => {
      if (!document.getElementById(styleId)) {
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = `
          #${pointerId} {
            position: fixed;
            left: 0;
            top: 0;
            width: 30px;
            height: 36px;
            z-index: 2147483647;
            pointer-events: none;
            transform: translate3d(calc(100vw - 52px), calc(100vh - 58px), 0);
            transition: transform ${moveMs}ms cubic-bezier(.22,.75,.18,1);
            filter: drop-shadow(0 2px 2px rgba(15, 23, 42, .38));
          }
          #${pointerId} svg {
            display: block;
            width: 100%;
            height: 100%;
          }
          #${rippleId} {
            position: fixed;
            left: 0;
            top: 0;
            width: 42px;
            height: 42px;
            z-index: 2147483646;
            pointer-events: none;
            border: 3px solid rgba(37, 99, 235, .95);
            border-radius: 9999px;
            opacity: 0;
            transform: translate3d(-50%, -50%, 0) scale(.35);
          }
          #${rippleId}[data-active="true"] {
            animation: docs-workflow-pointer-ripple 520ms ease-out both;
          }
          #${focusId} {
            position: fixed;
            left: 0;
            top: 0;
            z-index: 2147483645;
            pointer-events: none;
            border: 2px solid rgba(37, 99, 235, .9);
            border-radius: 7px;
            box-shadow: 0 0 0 4px rgba(37, 99, 235, .18);
            opacity: 0;
            transition: opacity 120ms ease;
          }
          #${focusId}[data-active="true"] {
            opacity: 1;
          }
          @keyframes docs-workflow-pointer-ripple {
            0% { opacity: .95; transform: translate3d(-50%, -50%, 0) scale(.35); }
            70% { opacity: .45; }
            100% { opacity: 0; transform: translate3d(-50%, -50%, 0) scale(1.25); }
          }
        `;
        document.head.append(style);
      }

      if (!document.getElementById(pointerId)) {
        const pointer = document.createElement("div");
        pointer.id = pointerId;
        pointer.setAttribute("aria-hidden", "true");
        pointer.innerHTML = `
          <svg viewBox="0 0 30 36" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M3 2.5 25 20l-10.2 1.8 5.6 10.4-5.2 2.8-5.5-10.5L3 32V2.5Z" fill="#fff" stroke="#0f172a" stroke-width="2.2" stroke-linejoin="round"/>
          </svg>
        `;
        document.body.append(pointer);
      }

      if (!document.getElementById(rippleId)) {
        const ripple = document.createElement("div");
        ripple.id = rippleId;
        ripple.setAttribute("aria-hidden", "true");
        document.body.append(ripple);
      }

      if (!document.getElementById(focusId)) {
        const focus = document.createElement("div");
        focus.id = focusId;
        focus.setAttribute("aria-hidden", "true");
        document.body.append(focus);
      }
    },
    {
      styleId: WORKFLOW_POINTER_STYLE_ID,
      pointerId: WORKFLOW_POINTER_ID,
      rippleId: WORKFLOW_POINTER_RIPPLE_ID,
      focusId: WORKFLOW_POINTER_FOCUS_ID,
      moveMs: WORKFLOW_POINTER_MOVE_MS,
    },
  );
}

async function moveWorkflowPointer(page: Page, locator: Locator) {
  await locator.scrollIntoViewIfNeeded({ timeout: ACTION_TIMEOUT_MS });
  const box = await locator.boundingBox();
  if (!box) throw new Error("Unable to resolve workflow pointer target bounds");

  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await page.evaluate(
    ({ pointerId, x, y }) => {
      const pointer = document.getElementById(pointerId);
      if (!pointer) throw new Error("Workflow pointer overlay is missing");
      pointer.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    },
    { pointerId: WORKFLOW_POINTER_ID, x, y },
  );
  await page.waitForTimeout(WORKFLOW_POINTER_MOVE_MS + WORKFLOW_POINTER_SETTLE_MS);
  return { box, x, y };
}

async function pulseWorkflowClick(page: Page, x: number, y: number) {
  await page.evaluate(
    ({ rippleId, x, y }) => {
      const ripple = document.getElementById(rippleId);
      if (!ripple) throw new Error("Workflow click ripple overlay is missing");
      ripple.dataset.active = "false";
      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;
      void ripple.offsetWidth;
      ripple.dataset.active = "true";
    },
    { rippleId: WORKFLOW_POINTER_RIPPLE_ID, x, y },
  );
}

async function emphasizeWorkflowField(page: Page, box: { x: number; y: number; width: number; height: number }) {
  await page.evaluate(
    ({ focusId, box }) => {
      const focus = document.getElementById(focusId);
      if (!focus) throw new Error("Workflow field focus overlay is missing");
      focus.style.left = `${Math.round(box.x - 5)}px`;
      focus.style.top = `${Math.round(box.y - 5)}px`;
      focus.style.width = `${Math.round(box.width + 10)}px`;
      focus.style.height = `${Math.round(box.height + 10)}px`;
      focus.dataset.active = "true";
    },
    { focusId: WORKFLOW_POINTER_FOCUS_ID, box },
  );
  await page.waitForTimeout(WORKFLOW_FIELD_FOCUS_MS);
}

async function clearWorkflowFieldEmphasis(page: Page) {
  await page.evaluate((focusId) => {
    const focus = document.getElementById(focusId);
    if (focus) focus.dataset.active = "false";
  }, WORKFLOW_POINTER_FOCUS_ID);
}

async function runAction(page: Page, action: ScenarioAction, visualizeWorkflow = false) {
  try {
    if (action.type === "wait") {
      await page.locator(action.selector).first().waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
      return;
    }
    if (action.type === "click") {
      const locator = page.locator(action.selector).first();
      await locator.waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
      if (visualizeWorkflow) {
        const { x, y } = await moveWorkflowPointer(page, locator);
        await pulseWorkflowClick(page, x, y);
      }
      await locator.click({ timeout: ACTION_TIMEOUT_MS });
      return;
    }
    if (action.type === "select") {
      const locator = page.locator(action.selector).first();
      await locator.waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
      if (visualizeWorkflow) {
        const { box } = await moveWorkflowPointer(page, locator);
        await emphasizeWorkflowField(page, box);
      }
      await locator.selectOption(action.value, { timeout: ACTION_TIMEOUT_MS });
      if (visualizeWorkflow) await clearWorkflowFieldEmphasis(page);
      return;
    }
    if (action.type === "fill") {
      const locator = page.locator(action.selector).first();
      await locator.waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
      if (visualizeWorkflow) {
        const { box } = await moveWorkflowPointer(page, locator);
        await emphasizeWorkflowField(page, box);
      }
      await locator.fill(action.value, { timeout: ACTION_TIMEOUT_MS });
      if (visualizeWorkflow) await clearWorkflowFieldEmphasis(page);
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
    await installWorkflowPointer(page);

    const pauseAfterActionMs = scenario.workflowVideo.pauseAfterActionMs ?? 650;
    for (const action of scenario.actions ?? []) {
      await runAction(page, action, true);
      if (action.type !== "wait") await page.waitForTimeout(pauseAfterActionMs);
    }
    await page.waitForTimeout(scenario.workflowVideo.finalPauseMs ?? 1_500);
    mockRegistry.assertNoUnmatched();

    const video = page.video();
    await context.close();
    if (!video) throw new Error(`Workflow video was not recorded for ${scenario.id}`);
    const outputPath = path.join(
      SCREENSHOT_DIR,
      `${scenario.workflowVideo.outputBasename}.webm`,
    );
    const trimStartMs = scenario.workflowVideo.trimStartMs ?? 0;
    if (trimStartMs > 0) {
      const rawVideoPath = path.join(temporaryVideoDir, `${scenario.id}.raw.webm`);
      await video.saveAs(rawVideoPath);
      await trimWorkflowVideo(rawVideoPath, outputPath, trimStartMs);
    } else {
      await video.saveAs(outputPath);
    }
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
