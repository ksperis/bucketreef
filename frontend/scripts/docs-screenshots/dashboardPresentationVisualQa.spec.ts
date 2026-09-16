import { expect, test, type Page } from "@playwright/test";
import { waitForStableDashboardDonut } from "./chartCapture";
import { registerApiMocks } from "./mockApi";
import { scenarios } from "./scenarios";
import { seedUiPreferences } from "./uiPreferences";
import type { MockRule } from "./types";

const surfaces = [
  { workspace: "manager", scenarioId: "workspace-manager", kpis: 4, headings: ["Storage overview", "Top buckets by storage", "Data types", "Quota status", "Quick actions", "Access management", "Storage backend health", "Recent activity", "Ongoing / Recent incidents"] },
  { workspace: "portal", scenarioId: "workspace-portal", kpis: 5, headings: ["Storage overview", "Top storage spaces", "Recent activity", "Alerts & service status", "Quick links"] },
  { workspace: "ceph-admin", scenarioId: "workspace-ceph-admin", kpis: 0, headings: ["Endpoint Health", "Ongoing / Recent Incidents", "Usage & Metrics", "RGW Accounts", "RGW Users", "Buckets"] },
  { workspace: "storage-ops", scenarioId: "gallery-storage-ops-dashboard", kpis: 0, headings: [] },
] as const;

async function equalRowGeometry(page: Page) {
  const grids = await page.locator("main .ui-dashboard-equal-row, main [data-workspace-dashboard-kpi-row]").evaluateAll((elements) => elements.map((grid) => {
    const rows: Array<{ top: number; cards: Array<{ title: string; top: number; bottom: number; height: number }> }> = [];
    for (const cell of Array.from(grid.children)) {
      const card = cell.matches(".ui-dashboard-panel, [data-kpi-card]") ? cell : cell.querySelector(".ui-dashboard-panel, [data-kpi-card]");
      if (!card) throw new Error("Missing dashboard card in grid cell");
      const rect = card.getBoundingClientRect();
      const entry = { title: card.querySelector("h2")?.textContent ?? card.textContent ?? "", top: rect.top, bottom: rect.bottom, height: rect.height };
      const top = cell.getBoundingClientRect().top;
      const row = rows.find((candidate) => Math.abs(candidate.top - top) <= 1);
      if (row) row.cards.push(entry);
      else rows.push({ top, cards: [entry] });
    }
    return rows.map((row) => row.cards);
  }));
  for (const rows of grids) for (const row of rows) {
    const titles = row.map((card) => card.title).join(" / ");
    for (const property of ["top", "bottom", "height"] as const) {
      const values = row.map((card) => card[property]);
      expect(Math.max(...values) - Math.min(...values), `${property}: ${titles}`).toBeLessThanOrEqual(1);
    }
  }
  return grids.map((rows) => rows.map((row) => row.length));
}

function expectedRows(workspace: "manager" | "portal", width: number, dataTypes = true) {
  const kpis = workspace === "manager" ? 4 : 5;
  const kpiRows = width >= 1280 ? [kpis] : width >= 768 ? (kpis === 4 ? [2, 2] : [2, 2, 1]) : Array<number>(kpis).fill(1);
  if (workspace === "portal") return [kpiRows, width >= 1024 ? [2] : [1, 1], width >= 1536 ? [3] : width >= 1024 ? [2, 1] : [1, 1, 1]];
  return [kpiRows, dataTypes ? (width >= 1280 ? [3] : width >= 1024 ? [2, 1] : [1, 1, 1]) : width >= 1024 ? [2] : [1, 1], width >= 1536 ? [4] : width >= 1024 ? [2, 2] : [1, 1, 1, 1], width >= 1280 ? [2] : [1, 1]];
}

async function panelContentGeometry(page: Page) {
  const offsets = await page.locator(".ui-dashboard-equal-row .ui-dashboard-panel").evaluateAll((panels) => panels.map((panel) => {
    const style = getComputedStyle(panel);
    return panel.firstElementChild!.getBoundingClientRect().top - panel.getBoundingClientRect().top - parseFloat(style.paddingTop) - parseFloat(style.borderTopWidth);
  }));
  for (const offset of offsets) expect(Math.abs(offset), "Panel content remains at the top").toBeLessThanOrEqual(1);
  for (const chart of await page.locator('.ui-dashboard-equal-row svg[viewBox="0 0 320 92"]').all()) {
    expect((await chart.boundingBox())!.height).toBe(92);
  }
}

async function naturalSingleColumnHeights(page: Page) {
  const sizes = await page.locator(".ui-dashboard-equal-row .ui-dashboard-panel").evaluateAll((panels) => panels.map((panel) => {
    const element = panel as HTMLElement;
    const height = element.getBoundingClientRect().height;
    const originalStyle = element.getAttribute("style");
    // Let each card size itself from its contents, independently of its grid cell.
    element.style.alignSelf = "start";
    const natural = element.getBoundingClientRect().height;
    if (originalStyle === null) element.removeAttribute("style");
    else element.setAttribute("style", originalStyle);
    return { height, natural };
  }));
  for (const { height, natural } of sizes) expect(Math.abs(height - natural)).toBeLessThanOrEqual(1);
}

async function geometry(page: Page, touch: boolean) {
  const result = await page.locator("main").evaluate((main) => {
    const rect = main.getBoundingClientRect();
    const panels = Array.from(main.querySelectorAll<HTMLElement>(".ui-dashboard-panel, .ui-dashboard-kpi, .ui-dashboard-nav-card"));
    const actions = Array.from(main.querySelectorAll<HTMLElement>(".ui-dashboard-action, .ui-dashboard-link-row, .ui-dashboard-text-link"));
    return {
      overflow: panels.filter((panel) => panel.scrollWidth > panel.clientWidth + 2 || panel.scrollHeight > panel.clientHeight + 2 || panel.getBoundingClientRect().right > rect.right + 2).map((panel) => panel.textContent),
      actions: actions.filter((action) => !action.hasAttribute("aria-disabled")).map((action) => ({ h: action.getBoundingClientRect().height, w: action.getBoundingClientRect().width, font: getComputedStyle(action).fontSize, weight: getComputedStyle(action).fontWeight })),
      values: Array.from(main.querySelectorAll("[data-kpi-value]")).map((value) => getComputedStyle(value).fontSize),
      icons: Array.from(main.querySelectorAll(".ui-dashboard-kpi-icon")).map((icon) => icon.getBoundingClientRect().width),
      titles: Array.from(main.querySelectorAll(".ui-dashboard-title")).map((title) => getComputedStyle(title).fontSize),
    };
  });
  expect(result.overflow).toEqual([]);
  for (const action of result.actions) {
    expect(action.h).toBeGreaterThanOrEqual(touch ? 44 : 28);
    if (touch) expect(action.w).toBeGreaterThanOrEqual(44);
    expect(action.font).toBe("12px");
    expect(action.weight).toBe("400");
  }
  expect(result.values.every((size) => size === "22px")).toBe(true);
  expect(result.icons.every((size) => size === 32)).toBe(true);
  expect(result.titles.every((size) => size === "14px")).toBe(true);
  const action = page.locator("main a.ui-dashboard-action, main a.ui-dashboard-link-row").first();
  await action.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(action).toBeFocused();
  expect(await action.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
  await equalRowGeometry(page);
  await panelContentGeometry(page);
}

for (const surface of surfaces) {
  const languages = surface.workspace === "portal" ? ["en", "fr", "de"] as const : ["en"] as const;
  const modes = surface.kpis ? ["desktop", "mobile", "zoom-200", "touch-desktop", "tablet", "wide"] as const : ["desktop", "mobile", "zoom-200", "touch-desktop"] as const;
  for (const language of languages) for (const theme of ["light", "dark"] as const) for (const mode of modes) {
    test(`Dashboard presentation ${surface.workspace} ${language} ${theme} ${mode}`, async ({ browser }, testInfo) => {
      const mobile = mode === "mobile";
      const zoom = mode === "zoom-200";
      const custom = language === "de" || mode === "touch-desktop";
      const touch = mobile || mode === "touch-desktop";
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : zoom ? { width: 720, height: 450 } : { width: mode === "tablet" ? 1024 : mode === "wide" ? 1728 : 1440, height: 900 }, deviceScaleFactor: zoom ? 2 : 1, hasTouch: touch, timezoneId: "Europe/Paris", locale: "en-US" });
      try {
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const scenario = scenarios.find((candidate) => candidate.id === surface.scenarioId)!;
        const rules = scenario.mockRules.map((rule) => custom && rule.id === "branding" ? { ...rule, body: { ...(rule.body as object), primary_color: "#7c3aed" } } : rule);
        const registry = await registerApiMocks(page, rules, testInfo.title, { ...scenario.user!, ui_language: language });
        await page.emulateMedia({ colorScheme: theme });
        await seedUiPreferences(page, { ...scenario.storage, theme });
        await page.goto(`/${surface.workspace}`);
        await expect(page.locator("main h1")).toBeVisible();
        await expect(page.locator("main [data-kpi-card]")).toHaveCount(surface.kpis);
        if (surface.workspace === "manager") {
          await expect(page.getByText("helios-retail-backups", { exact: true })).toBeVisible();
          await expect(page.getByRole("button", { name: "Refresh manager dashboard" })).toBeEnabled();
          // Recharts animates the donut; capture the chart only after its sectors exist.
          await waitForStableDashboardDonut(page);
          await expect(page.locator("[data-quota-status-row]")).toHaveCount(6);
          await expect(page.getByTestId("manager-dashboard-quick-actions-list").getByRole("link")).toHaveCount(2);
        } else if (surface.workspace === "portal") {
          await expect(page.getByText("genomics-2026", { exact: true }).first()).toBeVisible();
          await expect(page.locator("main [role=meter]").first()).toBeVisible();
        } else if (surface.workspace === "ceph-admin") {
          await expect(page.getByText("In progress", { exact: true })).toBeVisible();
          await expect(page.locator(".ui-dashboard-nav-card")).toHaveCount(4);
        } else {
          await expect(page.getByText(/Accounts: 2/)).toBeVisible();
          await expect(page.locator("main section")).toHaveCount(1);
        }
        if (language === "en") expect(await page.locator("main h2, main h3").allTextContents()).toEqual(surface.headings);
        await geometry(page, touch || zoom);
        if (surface.workspace === "manager" || surface.workspace === "portal") {
          expect(await equalRowGeometry(page)).toEqual(expectedRows(surface.workspace, page.viewportSize()!.width));
          if (mobile || zoom) await naturalSingleColumnHeights(page);
        } else {
          await expect(page.locator(".ui-dashboard-equal-row, .ui-dashboard-equal-cell")).toHaveCount(0);
        }
        if (surface.kpis && mode === "desktop" && language === "en") {
          const heights = await page.locator("[data-kpi-card]").evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().height));
          expect(Math.min(...heights)).toBeGreaterThanOrEqual(120);
          expect(Math.max(...heights)).toBeLessThan(164);
        }
        await page.locator("main h1").scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath("dashboard.png"), animations: "disabled" });
        await page.locator("main section").last().scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath("dashboard-lower.png"), animations: "disabled" });
        // Exercise wrapping with long real-world names without changing routes, IDs or calculations.
        await page.locator("main .ui-dashboard-label, main .ui-dashboard-note").evaluateAll((labels) => {
          for (const label of labels) if (label.textContent?.includes("helios-retail-backups") || label.textContent === "genomics-2026" || label.textContent === "Default") label.textContent += " — production-archive-infrastructure-with-an-intentionally-long-name";
        });
        await geometry(page, touch || zoom);
        registry.assertNoUnmatched();
        expect(errors).toEqual([]);
      } finally { await context.close(); }
    });
  }
}

type DashboardState = "empty" | "unavailable" | "loading" | "without-data-types" | "onboarding";

function stateRules(rules: MockRule[], state: DashboardState): MockRule[] {
  return rules.map((rule) => {
    if (state === "without-data-types" && rule.id === "settings-general") {
      return { ...rule, body: { ...(rule.body as object), bucket_usage_stats_enabled: false } };
    }
    if (state === "onboarding" && rule.id === "portal-storage-spaces") return { ...rule, body: [] };
    if (state === "empty") {
      if (["manager-activity", "manager-buckets", "portal-activity", "portal-alerts"].includes(rule.id)) return { ...rule, body: [] };
      if (rule.id === "manager-stats-overview") return { ...rule, body: { ...(rule.body as object), total_buckets: 0, total_bytes: 0, total_objects: 0, bucket_usage: [], bucket_overview: null } };
      if (rule.id === "manager-usage-stats-aggregate") return { ...rule, body: { aggregate: null } };
      if (rule.id === "manager-health") return { ...rule, body: { ...(rule.body as object), incidents: [] } };
      if (rule.id === "portal-endpoint-health") {
        return { ...rule, body: { ...(rule.body as object), endpoints: [], incidents: [], endpoint_count: 0, up_count: 0, degraded_count: 0, down_count: 0, unknown_count: 0 } };
      }
    }
    if (state === "unavailable" && [
      "manager-stats-overview", "manager-usage-stats-aggregate", "manager-usage-trends", "manager-traffic", "manager-health", "manager-activity", "manager-iam-overview",
      "portal-usage", "portal-usage-trends", "portal-traffic", "portal-endpoint-health", "portal-activity", "portal-alerts", "portal-collaborators",
    ].includes(rule.id)) return { ...rule, status: 503, body: { detail: "Dashboard metrics temporarily unavailable" } };
    return rule;
  });
}

for (const workspace of ["manager", "portal"] as const) {
  const states: DashboardState[] = workspace === "manager" ? ["empty", "unavailable", "loading", "without-data-types"] : ["empty", "unavailable", "loading", "onboarding"];
  for (const state of states) for (const width of [390, 1728]) {
    test(`Dashboard row heights ${workspace} ${state} ${width}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const scenario = scenarios.find((candidate) => candidate.id === `workspace-${workspace}`)!;
      const registry = await registerApiMocks(page, stateRules(scenario.mockRules, state), testInfo.title, { ...scenario.user, ui_language: "en" });
      let release = () => {};
      if (state === "loading") {
        const gate = new Promise<void>((resolve) => { release = resolve; });
        await page.route(/\/api\/(manager\/(usage-stats\/latest|activity)|portal\/(state|activity))(\?|$)/, async (route) => {
          await gate;
          await route.fallback();
        });
      }
      try {
        await seedUiPreferences(page, { ...scenario.storage, theme: "light" });
        await page.goto(`/${workspace}`);
        if (state === "onboarding") {
          await expect(page.getByRole("heading", { name: "Set up your first space" })).toBeVisible();
          await expect(page.getByTestId("portal-dashboard-onboarding").getByRole("link", { name: "Open Storage Spaces", exact: true })).toHaveAttribute("href", "/portal/storage-spaces");
          await expect(page.locator(".ui-dashboard-equal-row, [data-kpi-card]")).toHaveCount(0);
        } else {
          await expect(page.locator("main [data-kpi-card]")).toHaveCount(workspace === "manager" ? 4 : 5);
          if (workspace === "manager") {
            const dataTypes = page.getByTestId("manager-dashboard-data-types");
            if (state === "loading") await expect(dataTypes.locator(".animate-pulse")).toBeVisible();
            else {
              await expect(page.getByRole("button", { name: "Refresh manager dashboard" })).toBeEnabled();
              if (state === "without-data-types") await expect(dataTypes).toHaveCount(0);
              else await expect(dataTypes.getByText("No usage stats snapshot yet.")).toBeVisible();
            }
          } else {
            await expect(page.getByText("genomics-2026", { exact: true }).first()).toBeVisible();
            const loadingMessage = page.getByText("Some dashboard data is still loading. Available sections remain usable.");
            if (state === "loading") await expect(loadingMessage).toBeVisible();
            else await expect(loadingMessage).toHaveCount(0);
          }
          if (state === "empty") {
            await expect(page.getByText("No recent activity.", { exact: true })).toBeVisible();
            await expect(page.getByText(workspace === "manager" ? "No ongoing or recent incidents." : "No alerts to display.", { exact: true })).toBeVisible();
          }
          if (state === "unavailable" && workspace === "portal") await expect(page.getByText("Storage service status unavailable", { exact: true })).toBeVisible();
          await geometry(page, width < 768);
          expect(await equalRowGeometry(page)).toEqual(expectedRows(workspace, width, state !== "without-data-types"));
          if (width < 768) await naturalSingleColumnHeights(page);
          await page.screenshot({ path: testInfo.outputPath(`dashboard-${state}.png`), fullPage: true, animations: "disabled" });
          if (state === "loading") {
            release();
            if (workspace === "manager") {
              await expect(page.getByRole("button", { name: "Refresh manager dashboard" })).toBeEnabled();
              await waitForStableDashboardDonut(page);
            } else {
              await expect(page.getByText("Some dashboard data is still loading. Available sections remain usable.")).toHaveCount(0);
              await expect(page.getByText("No recent activity.", { exact: true })).toHaveCount(0);
            }
            await geometry(page, width < 768);
            expect(await equalRowGeometry(page)).toEqual(expectedRows(workspace, width));
          }
        }
        registry.assertNoUnmatched();
        expect(errors).toEqual([]);
      } finally { release(); }
    });
  }
}
