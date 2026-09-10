import { expect, test, type Page } from "@playwright/test";
import { waitForStableDashboardDonut } from "./chartCapture";
import { registerApiMocks } from "./mockApi";
import { scenarios } from "./scenarios";
import { seedUiPreferences } from "./uiPreferences";

const surfaces = [
  { workspace: "manager", scenarioId: "workspace-manager", kpis: 4, headings: ["Storage overview", "Top buckets by storage", "Data types", "Quota status", "Quick actions", "Access management", "Storage backend health", "Recent activity", "Ongoing / Recent incidents"] },
  { workspace: "portal", scenarioId: "workspace-portal", kpis: 5, headings: ["Storage overview", "Top storage spaces", "Recent activity", "Alerts & service status", "Quick links"] },
  { workspace: "ceph-admin", scenarioId: "workspace-ceph-admin", kpis: 0, headings: ["Endpoint Health", "Ongoing / Recent Incidents", "Usage & Metrics", "RGW Accounts", "RGW Users", "Buckets"] },
  { workspace: "storage-ops", scenarioId: "gallery-storage-ops-dashboard", kpis: 0, headings: [] },
] as const;

async function geometry(page: Page, touch: boolean) {
  const result = await page.locator("main").evaluate((main) => {
    const rect = main.getBoundingClientRect();
    const panels = Array.from(main.querySelectorAll<HTMLElement>(".ui-dashboard-panel, .ui-dashboard-kpi, .ui-dashboard-nav-card"));
    const actions = Array.from(main.querySelectorAll<HTMLElement>(".ui-dashboard-action, .ui-dashboard-link-row, .ui-dashboard-text-link"));
    return {
      overflow: panels.filter((panel) => panel.scrollWidth > panel.clientWidth + 2 || panel.getBoundingClientRect().right > rect.right + 2).map((panel) => panel.textContent),
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
}

for (const surface of surfaces) {
  const languages = surface.workspace === "portal" ? ["en", "fr", "de"] as const : ["en"] as const;
  for (const language of languages) for (const theme of ["light", "dark"] as const) for (const mode of ["desktop", "mobile", "zoom-200", "touch-desktop"] as const) {
    test(`Dashboard presentation ${surface.workspace} ${language} ${theme} ${mode}`, async ({ browser }, testInfo) => {
      const mobile = mode === "mobile";
      const zoom = mode === "zoom-200";
      const custom = language === "de" || mode === "touch-desktop";
      const touch = mobile || mode === "touch-desktop";
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : zoom ? { width: 720, height: 450 } : { width: 1440, height: 900 }, deviceScaleFactor: zoom ? 2 : 1, hasTouch: touch, timezoneId: "Europe/Paris", locale: "en-US" });
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
