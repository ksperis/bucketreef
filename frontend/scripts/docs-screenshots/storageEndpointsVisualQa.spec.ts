import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import type { StorageEndpoint } from "../../src/api/storageEndpoints";
import { buildBaseRules } from "./fixtures/base";
import { superAdminUser } from "./fixtures/users";
import { registerApiMocks } from "./mockApi";
import { seedUiPreferences } from "./uiPreferences";

for (const theme of ["light", "dark"] as const) {
  for (const viewport of [
    { width: 1440, height: 900, suffix: "", touch: false, scale: 1 },
    { width: 390, height: 900, suffix: "", touch: false, scale: 1 },
    { width: 1440, height: 900, suffix: "-touch", touch: true, scale: 1 },
    // Equivalent layout geometry for a 1440 × 900 viewport at 200% zoom.
    { width: 720, height: 450, suffix: "-reflow", touch: false, scale: 2 },
  ]) {
    const { width, height, suffix, touch, scale } = viewport;
    test(`endpoint inventory ${theme} ${width}${suffix}`, async ({ browser }, testInfo) => {
      const context = await browser.newContext({ baseURL: "http://127.0.0.1:4173", viewport: { width, height }, hasTouch: touch, deviceScaleFactor: scale });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
      const rules = [
        { id: "endpoint-pending", path: /^\/admin\/navigation\/pending-requests$/, body: { identity_link_requests: 0, portal_requests: 0 } },
        { id: "endpoint-tags", path: /^\/admin\/tag-definitions$/, body: [] },
        ...buildBaseRules(),
      ];
      const listRule = rules.find((rule) => rule.id === "admin-storage-endpoints")!;
      const endpoints = listRule.body as StorageEndpoint[];
      listRule.body = [...endpoints, {
        ...endpoints[1], id: 13, name: width === 720 ? "AWS Europe — a long endpoint name for research and development across international storage regions" : "AWS Europe", provider: "aws", is_editable: true,
        endpoint_url: "https://s3.eu-central-1.amazonaws.com", region: "eu-central-1", tags: [],
      }];
      if (theme === "dark") rules.find((rule) => rule.id === "branding")!.body = { primary_color: "#7c3aed", login_logo_url: null };
      const registry = await registerApiMocks(page, rules, "endpoint-inventory", superAdminUser);

      await seedUiPreferences(page, { selectedWorkspace: "admin", theme });
      await page.goto("/admin/storage-endpoints");
      await expect(page.getByRole("cell", { name: "AWS Europe", exact: false })).toBeVisible();
      await expect(page.locator("tbody tr")).toHaveCount(3);
      const geometry = await page.locator("table").evaluate((table) => ({
        width: table.getBoundingClientRect().width,
        container: table.parentElement!.clientWidth,
        rows: Array.from(table.querySelectorAll("tbody tr")).map((row) => row.getBoundingClientRect().height),
      }));
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
      if (width === 1440) {
        expect(geometry.width).toBeLessThanOrEqual(geometry.container + 2);
        if (!touch) expect(geometry.rows.every((row) => row <= 72)).toBe(true);
      }
      const controls = await page.locator(".storage-endpoint-list button, .storage-endpoint-list .ui-control").evaluateAll((nodes) => nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }).filter((rect) => rect.width > 0));
      const target = width < 1024 || touch ? 44 : 28;
      expect(controls.every((control) => control.height >= target && control.width >= target)).toBe(true);
      const rowButtons = await page.locator(".endpoint-actions button").evaluateAll((nodes) => nodes.map((node) => ({ size: getComputedStyle(node).fontSize, weight: getComputedStyle(node).fontWeight })));
      expect(rowButtons.every((button) => button.size === "12px" && button.weight === "400")).toBe(true);
      await writeFile(testInfo.outputPath("geometry.json"), JSON.stringify(geometry));
      await page.screenshot({ path: testInfo.outputPath(`endpoints-${theme}-${width}.png`), fullPage: true });
      const search = page.getByRole("searchbox", { name: "Search" });
      await search.fill("archive");
      await page.getByRole("combobox", { name: "Provider" }).selectOption("other");
      await expect(page.getByText("1 of 3 endpoints", { exact: true })).toBeVisible();
      const actions = page.locator(".endpoint-actions button");
      await expect(actions).toHaveText(["Set as default", "View"]);
      const view = page.getByRole("button", { name: "View", exact: true });
      await view.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: "Storage endpoint · Archive" })).toBeVisible();
      await expect(page.getByRole("tab")).toHaveCount(3);
      await page.getByRole("tab", { name: "Credentials", exact: true }).click();
      await expect(page.getByRole("tab", { name: "Credentials", exact: true })).toHaveAttribute("aria-selected", "true");
      await page.getByRole("button", { name: "Back to endpoints", exact: true }).first().click();
      await expect(search).toHaveValue("archive");
      await expect(page.getByRole("combobox", { name: "Provider" })).toHaveValue("other");
      await page.getByRole("button", { name: "Clear all" }).click();
      await expect(page.locator("tbody tr")).toHaveCount(3);
      expect(errors).toEqual([]);
      registry.assertNoUnmatched();
      } finally { await context.close(); }
    });
  }
}
