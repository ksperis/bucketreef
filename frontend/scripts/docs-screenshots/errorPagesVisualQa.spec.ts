import { expect, test, type Page } from "@playwright/test";
import { registerApiMocks } from "./mockApi";
import { scenarios } from "./scenarios";
import { seedUiPreferences } from "./uiPreferences";

async function prepare(page: Page, scenarioId: string, theme: "light" | "dark") {
  const scenario = scenarios.find((item) => item.id === scenarioId)!;
  const mocks = await registerApiMocks(page, scenario.mockRules, scenarioId, { ...scenario.user, ui_language: "fr" });
  await page.emulateMedia({ colorScheme: theme });
  await seedUiPreferences(page, { ...scenario.storage, theme, extraEntries: { languagePreference: "fr" } });
  return mocks;
}

async function checkPage(page: Page, kind: string) {
  await expect(page.locator(`[data-error-kind="${kind}"]`)).toBeVisible();
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator("details")).not.toHaveAttribute("open", "");
  await expect(page.locator(".error-state-art")).toBeVisible();
  await expect.poll(() => page.locator(".error-state-art").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const theme of ["light", "dark"] as const) {
  for (const [route, kind] of [["/unknown-error-test", "not_found"], ["/unauthorized", "forbidden"], ["/session-expired", "session_expired"]]) {
    test(`${theme} full page ${kind}`, async ({ page }, info) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const mocks = await prepare(page, "workspace-admin", theme);
      await page.goto(route);
      await checkPage(page, kind);
      await expect(page.locator(".error-state--full")).toBeVisible();
      await expect(page.locator("[data-topbar]")).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`${kind}-${theme}.png`) });
      await page.getByText("Détails techniques", { exact: true }).click();
      await expect(page.locator("details")).toHaveAttribute("open", "");
      await expect(page.getByRole("button", { name: "Copier les détails" })).toBeVisible();
      expect(errors).toEqual([]);
      mocks.assertNoUnmatched();
    });
  }
  for (const [workspace, scenarioId] of [
    ["admin", "workspace-admin"], ["manager", "workspace-manager"],
    ["browser", "workspace-browser"], ["portal", "workspace-portal"],
    ["ceph-admin", "workspace-ceph-admin"], ["storage-ops", "gallery-storage-ops-dashboard"],
  ]) {
    test(`${theme} ${workspace} retains navigation on 404`, async ({ page }, info) => {
      const mocks = await prepare(page, scenarioId, theme);
      await page.goto(`/${workspace}/unknown-error-test`);
      await checkPage(page, "not_found");
      await expect(page.locator(".error-state--embedded")).toBeVisible();
      await expect(page.locator("aside[data-sidebar-variant='desktop']")).toBeVisible();
      await expect(page.locator(".error-state-actions").getByRole("link", { name: "Revenir à mon espace" })).toHaveAttribute("href", `/${workspace}`);
      await page.screenshot({ path: info.outputPath(`${workspace}-${theme}.png`) });
      mocks.assertNoUnmatched();
    });
  }
  test(`${theme} mobile recovery controls stay usable`, async ({ page }, info) => {
    await prepare(page, "workspace-admin", theme);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/unknown-error-test");
    await checkPage(page, "not_found");
    await page.screenshot({ path: info.outputPath(`mobile-${theme}.png`), fullPage: true });
    await page.getByText("Détails techniques", { exact: true }).click();
    await expect(page.getByRole("button", { name: "Copier les détails" })).toBeVisible();
  });
}

test("bootstrap outage retries in place without signing out", async ({ page }, info) => {
  await prepare(page, "workspace-admin", "dark");
  let unavailable = true;
  await page.route("**/api/auth/session", (route) => unavailable
    ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "private-backend-detail" }) })
    : route.fallback());
  await page.goto("/admin/unknown-error-test");
  await checkPage(page, "unavailable");
  await expect(page).toHaveURL(/\/admin\/unknown-error-test$/);
  await expect(page.locator("body")).not.toContainText("private-backend-detail");
  await page.screenshot({ path: info.outputPath("unavailable-dark.png") });
  unavailable = false;
  await page.getByRole("button", { name: "Réessayer", exact: true }).click();
  await expect(page.locator(".error-state--embedded [data-error-kind='not_found']")).toBeVisible();
});

test("an authenticated request rejected after refresh reaches the session-ended page", async ({ page }) => {
  await prepare(page, "workspace-admin", "light");
  await page.goto("/admin/unknown-error-test");
  await expect(page.locator(".error-state--embedded")).toBeVisible();
  await page.route("**/api/admin/users**", (route) => route.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
  await page.route("**/api/auth/refresh", (route) => route.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
  await page.getByRole("link", { name: "UI Users", exact: true }).click();
  await expect(page).toHaveURL(/\/session-expired$/);
  await expect(page.locator('[data-error-kind="session_expired"]')).toBeVisible();
  await expect(page.getByRole("link", { name: "Se reconnecter", exact: true })).toHaveAttribute("href", "/login");
});
