import { expect, test } from "@playwright/test";
import { assertListHeaders } from "./listHeaderAssertions";
import fs from "node:fs/promises";
import { registerApiMocks } from "./mockApi";
import { scenarios } from "./scenarios";
import { seedUiPreferences } from "./uiPreferences";

const listingCases = [
  "gallery-admin-storage-endpoints", "gallery-admin-ui-users", "feature-iam", "feature-buckets",
  "gallery-portal-storage-spaces", "gallery-portal-access-keys", "workspace-ceph-admin",
  "workspace-storage-ops", "workspace-browser", "feature-bucket-compare",
];
const modes = [
  { name: "desktop-light", width: 1440, height: 900, theme: "light" as const },
  { name: "desktop-dark", width: 1440, height: 900, theme: "dark" as const },
  { name: "mobile-light", width: 390, height: 900, theme: "light" as const },
  { name: "reflow-dark", width: 720, height: 450, theme: "dark" as const },
  { name: "touch-dark", width: 1440, height: 900, theme: "dark" as const },
];
for (const id of listingCases) for (const mode of modes) {
  test(`${id} ${mode.name}`, async ({ browser }, testInfo) => {
    const scenario = scenarios.find((item) => item.id === id)!;
    const touch = mode.name === "touch-dark";
    const context = await browser.newContext({ viewport: mode, colorScheme: mode.theme, hasTouch: touch });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      const registry = await registerApiMocks(page, [
        { id: "pending-listings", path: /^\/admin\/navigation\/pending-requests$/, body: { identity_link_requests: 0, portal_requests: 0 } },
        ...scenario.mockRules.map((rule) => rule.id === "branding" && mode.theme === "dark"
          ? { ...rule, body: { primary_color: "#7c3aed", login_logo_url: null } } : rule),
      ], `${id}-${mode.name}`, { ...scenario.user, ui_language: mode.theme === "dark" ? "de" : mode.width < 768 ? "fr" : "en" });
      await seedUiPreferences(page, { ...scenario.storage, theme: mode.theme });
      await page.goto(`http://127.0.0.1:4173${scenario.route}`);
      await page.locator(scenario.route.startsWith("/portal") ? "h1" : scenario.waitFor).first().waitFor();
      for (const action of scenario.actions ?? []) {
        if (id === "gallery-portal-access-keys") break;
        if (action.type !== "wait") break;
        await page.locator(action.selector).first().waitFor();
      }
      await expect(page.locator(mode.width < 768 && id === "workspace-browser" ? "[data-browser-item]" : "table tbody tr").first()).toBeVisible();
      await assertListHeaders(page, { singleLine: mode.width === 1440 && !["workspace-ceph-admin", "workspace-storage-ops", "workspace-browser"].includes(id) });
      const metrics = await page.evaluate(() => {
        const visible = (element: Element) => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
        return {
          overflow: document.documentElement.scrollWidth - innerWidth,
          overlappingRows: [...document.querySelectorAll(".responsive-data-table tbody")].some((body) => {
            const rows = [...body.children].filter(visible);
            return rows.some((row, index) => index > 0 && row.getBoundingClientRect().top < rows[index - 1].getBoundingClientRect().bottom - 1);
          }),
          tables: [...document.querySelectorAll("table")].filter(visible).map((table) => ({
            font: getComputedStyle(table.querySelector("td")!).fontSize,
            headers: [...table.querySelectorAll("th")].map((th) => getComputedStyle(th).textTransform),
            rows: [...table.querySelectorAll("tbody tr")].slice(0, 3).map((row) => row.getBoundingClientRect().height),
          })),
          actions: [...document.querySelectorAll(".ui-list-action")].filter(visible).map((button) => ({
            text: button.textContent?.trim(), height: button.getBoundingClientRect().height,
            font: getComputedStyle(button).fontSize, weight: getComputedStyle(button).fontWeight,
          })),
          groups: [...document.querySelectorAll("td .ui-list-actions")].filter(visible).map((group) => {
            const actions = [...group.children].filter(visible).map((element) => element.getBoundingClientRect());
            const cell = group.closest("td")!.getBoundingClientRect();
            return { tops: actions.map((rect) => Math.round(rect.top)), fits: actions.every((rect) => rect.left >= cell.left - 1 && rect.right <= cell.right + 1) };
          }),
        };
      });
      await testInfo.attach("geometry", { body: JSON.stringify(metrics, null, 2), contentType: "application/json" });
      await fs.writeFile(testInfo.outputPath("geometry.json"), JSON.stringify(metrics, null, 2));
      await page.screenshot({ path: testInfo.outputPath(`${id}-${mode.name}.png`), fullPage: true, animations: "disabled" });
      expect(metrics.overflow).toBeLessThanOrEqual(2);
      expect(metrics.overlappingRows).toBe(false);
      for (const table of metrics.tables) {
        expect(table.font).toBe("12px");
        if (mode.width >= 768) expect(table.headers.every((value) => value === "none")).toBe(true);
      }
      for (const action of metrics.actions) {
        expect(action.font).toBe("12px"); expect(action.weight).toBe("400");
        expect(action.height).toBeGreaterThanOrEqual(mode.width < 768 || touch ? 44 : 28);
      }
      if (mode.width >= 768) for (const group of metrics.groups) {
        expect(new Set(group.tops).size).toBeLessThanOrEqual(1);
        expect(group.fits).toBe(true);
      }
      const action = page.locator(".ui-list-action:visible:not(:disabled):not([aria-disabled=true])").first();
      if (await action.count()) {
        await page.keyboard.press("Tab");
        await action.focus();
        await expect(action).toBeFocused();
        expect(await action.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
      }
      if (id === "feature-bucket-compare") {
        const run = page.getByRole("button", { name: "Compare selected" });
        await expect(run).toBeDisabled();
        await expect(page.locator(".ui-list-toolbar-heading")).toContainText("Compare selected");
        await page.getByRole("button", { name: "Select filtered" }).click();
        await expect(run).toBeEnabled();
        await page.getByRole("button", { name: "Clear", exact: true }).click();
        await expect(run).toBeDisabled();
      }
      registry.assertNoUnmatched();
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}
