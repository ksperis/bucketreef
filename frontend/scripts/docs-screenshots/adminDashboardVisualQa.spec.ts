import { expect, test, type Page } from "@playwright/test";
import { buildBaseRules } from "./fixtures/base";
import { superAdminUser } from "./fixtures/users";
import { registerApiMocks } from "./mockApi";
import { seedUiPreferences } from "./uiPreferences";
import type { MockRule } from "./types";

async function openDashboard(page: Page, theme: "light" | "dark", customColor = false, overrides: MockRule[] = []) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const rules = buildBaseRules().map((rule) => {
    if (customColor && rule.id === "branding") return { ...rule, body: { ...(rule.body as object), primary_color: "#7c3aed" } };
    return rule;
  });
  const registry = await registerApiMocks(page, [...overrides, { id: "navigation-pending", path: /^\/admin\/navigation\/pending-requests$/, body: { identity_link_requests: 0, portal_requests: 0 } }, ...rules], "admin-dashboard-compact", superAdminUser);
  await page.emulateMedia({ colorScheme: theme });
  await seedUiPreferences(page, { selectedWorkspace: "admin", theme });
  await page.goto("/admin");
  await expect(page.getByRole("region", { name: "Administration", exact: true }).getByRole("link", { name: /UI Users.*10/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh admin dashboard" })).toBeEnabled();
  return { registry, errors };
}

async function checkGeometry(page: Page, touch: boolean) {
  const geometry = await page.getByTestId("admin-dashboard").evaluate((dashboard) => {
    const rect = dashboard.getBoundingClientRect();
    const buttons = Array.from(dashboard.querySelectorAll<HTMLElement>(".ui-dashboard-action"));
    const clipped = Array.from(dashboard.querySelectorAll<HTMLElement>("span, p, h2, h3, a, button")).filter((element) => {
      const style = getComputedStyle(element);
      return element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 2 && style.overflowX === "hidden";
    }).map((element) => element.textContent);
    return {
      right: rect.right, viewport: innerWidth, clipped,
      actions: buttons.map((button) => ({ height: button.getBoundingClientRect().height, width: button.getBoundingClientRect().width, font: getComputedStyle(button).fontSize, weight: getComputedStyle(button).fontWeight })),
      titles: Array.from(dashboard.querySelectorAll("h2")).map((title) => getComputedStyle(title).fontSize),
    };
  });
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 2);
  expect(geometry.clipped).toEqual([]);
  expect(geometry.actions.length).toBeGreaterThan(2);
  for (const action of geometry.actions) {
    expect(action.height).toBeGreaterThanOrEqual(touch ? 44 : 28);
    if (touch) expect(action.width).toBeGreaterThanOrEqual(44);
    expect(action.font).toBe("12px");
    expect(action.weight).toBe("400");
  }
  expect(geometry.titles.every((size) => size === "14px")).toBe(true);
  await page.getByRole("button", { name: "Refresh admin dashboard" }).focus();
  await page.keyboard.press("Tab");
  const review = page.getByRole("button", { name: "Review", exact: true });
  const nextAction = await review.count() ? review : page.getByRole("link", { name: "Open Endpoint Status" });
  await expect(nextAction).toBeFocused();
  const focus = await nextAction.evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(focus).not.toBe("none");
}

for (const theme of ["light", "dark"] as const) {
  for (const customColor of [false, true]) {
    for (const mode of ["desktop", "mobile", "zoom-200", "touch-desktop"] as const) {
      test(`Admin compact dashboard ${theme} ${customColor ? "custom" : "blue"} ${mode}`, async ({ browser }, testInfo) => {
        const context = await browser.newContext({
          viewport: mode === "mobile" ? { width: 390, height: 844 } : mode === "zoom-200" ? { width: 720, height: 450 } : { width: 1440, height: 900 },
          deviceScaleFactor: mode === "zoom-200" ? 2 : 1,
          hasTouch: mode === "mobile" || mode === "touch-desktop",
        });
        try {
          const page = await context.newPage();
          const { registry, errors } = await openDashboard(page, theme, customColor);
          await checkGeometry(page, mode !== "desktop");
          if (mode === "desktop") {
            const summary = await page.getByRole("region", { name: "Storage & traffic" }).boundingBox();
            expect(summary!.y + summary!.height).toBeLessThanOrEqual(900);
            const endpoints = await page.getByRole("region", { name: "Endpoint Health", exact: true }).boundingBox();
            const incidents = await page.getByRole("region", { name: "Ongoing / Recent Incidents" }).boundingBox();
            expect(endpoints!.width).toBeGreaterThan(incidents!.width * 1.8);
            expect(incidents!.height).toBeLessThan(endpoints!.height);
          }
          await page.screenshot({ path: testInfo.outputPath("dashboard.png"), animations: "disabled" });
          await page.getByRole("heading", { name: "Enabled features", exact: true }).scrollIntoViewIfNeeded();
          await page.screenshot({ path: testInfo.outputPath("dashboard-secondary.png"), animations: "disabled" });
          registry.assertNoUnmatched();
          expect(errors).toEqual([]);
        } finally { await context.close(); }
      });
    }
  }
}

test("Admin compact dashboard long names and nine endpoints", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const body = {
    generated_at: new Date().toISOString(), endpoint_count: 9, up_count: 0, degraded_count: 0, down_count: 0, unknown_count: 9,
    incident_highlight_minutes: 10080,
    endpoints: Array.from({ length: 9 }, (_, index) => ({ endpoint_id: index + 1, name: `Production infrastructure endpoint ${index + 1} with an intentionally long name`, status: "unknown", endpoint_url: "https://s3.example.test", latency_ms: 86, check_mode: "http", checked_at: null })),
    incidents: [{ endpoint_id: 1, endpoint_name: "Production infrastructure endpoint with an intentionally long name", ongoing: true, start: new Date().toISOString(), end: null }],
  };
  const { registry } = await openDashboard(page, "light", false, [{ id: "long-summary", path: /^\/admin\/health\/summary$/, body: { endpoints: body.endpoints.map((endpoint) => ({ ...endpoint, error_message: "No checks yet" })) } }, { id: "long-health", path: /^\/admin\/health\/workspace-overview$/, body }]);
  await expect(page.locator(".ui-dashboard-endpoint-row")).toHaveCount(8);
  await expect(page.getByText("+ 1 more endpoint(s)")).toBeVisible();
  await expect(page.getByText("No healthcheck yet")).toHaveCount(8);
  await checkGeometry(page, false);
  await page.screenshot({ path: testInfo.outputPath("long-endpoints.png") });
  registry.assertNoUnmatched();
});

for (const state of ["disabled", "partial-errors", "onboarding"] as const) {
  test(`Admin compact dashboard ${state}`, async ({ page }, testInfo) => {
    const base = buildBaseRules();
    const overrides: MockRule[] = state === "disabled" ? [
      { id: "disabled-health", path: /^\/settings\/general$/, body: { ...(base.find((rule) => rule.id === "settings-general")!.body as object), endpoint_status_enabled: false } },
    ] : state === "partial-errors" ? [
      { id: "failed-health", path: /^\/admin\/health\/workspace-overview$/, status: 503, body: { detail: "Endpoint health temporarily unavailable" } },
      { id: "failed-storage", path: /^\/admin\/stats\/storage$/, status: 503, body: { detail: "Storage temporarily unavailable" } },
      { id: "failed-audit", path: /^\/admin\/audit\/logs$/, status: 503, body: { detail: "Audit temporarily unavailable" } },
    ] : [
      { id: "setup", path: /^\/admin\/onboarding$/, body: { dismissed: false, complete: false, endpoint_configured: false, storage_access_configured: false } },
    ];
    await page.setViewportSize({ width: 390, height: 844 });
    const { registry, errors } = await openDashboard(page, "light", false, overrides);
    if (state === "disabled") {
      await expect(page.getByRole("region", { name: "Endpoint Health", exact: true }).getByText("Endpoint Status feature is disabled.")).toBeVisible();
      await expect(page.getByRole("img", { name: "Infrastructure endpoint map" })).toHaveCount(0);
    } else if (state === "partial-errors") {
      await expect(page.getByText("Storage: Storage temporarily unavailable")).toBeVisible();
      await expect(page.getByRole("region", { name: "Storage & traffic" }).getByText("27k")).toBeVisible();
      await expect(page.getByRole("region", { name: "Storage & traffic" }).getByText("97%")).toBeVisible();
      await expect(page.getByText("Audit temporarily unavailable")).toBeVisible();
    } else {
      await expect(page.getByRole("link", { name: "Configure endpoints", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Configure connections", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Collapse checklist" }).click();
      await expect(page.getByRole("button", { name: "Review" })).toBeVisible();
    }
    await checkGeometry(page, true);
    await page.screenshot({ path: testInfo.outputPath(`${state}.png`) });
    registry.assertNoUnmatched();
    expect(errors).toEqual([]);
  });
}
