import { expect, test } from "@playwright/test";
import { assertListHeaders } from "./listHeaderAssertions";
import fs from "node:fs/promises";
import { registerApiMocks } from "./mockApi";
import { buildBaseRules } from "./fixtures/base";
import { scenarios } from "./scenarios";
import { seedUiPreferences } from "./uiPreferences";
import type { MockRule } from "./types";

const cases = [
  { route: "/admin/usage-history", source: "workspace-admin" },
  { route: "/admin/audit", source: "workspace-admin" },
  { route: "/admin/metrics", source: "workspace-admin" },
  { route: "/admin/billing", source: "feature-billing-admin" },
  { route: "/admin/endpoint-status", source: "feature-endpoint-status-admin" },
  { route: "/admin/identity-security", source: "workspace-admin" },
  { route: "/portal/history", source: "workspace-portal" },
  { route: "/portal/history?view=access", source: "workspace-portal" },
];

const extraRules: MockRule[] = [
  { id: "header-access-logs", path: /^\/portal\/access-logs\/page$/, body: {
    entries: [{ id: "log-1", source: "server_access_logging", timestamp: "2026-03-08T09:00:00Z",
      storage_space_id: "genomics-2026", storage_space_name: "genomics-2026", bucket_name: "genomics-2026",
      operation: "REST.GET.OBJECT", operation_category: "download", object_key: "sample.csv", object_name: "sample.csv",
      status_code: 200, requester: "storage.user@example.com", bytes_sent: 512, log_object_key: "2026-03-08.log" }],
    total: 1, limit: 25, offset: 0,
  } },
  { ...buildBaseRules().find((rule) => rule.id === "manager-usage-stats-aggregate")!,
    id: "consultation-usage-composition", path: /^\/admin\/usage-stats\/latest$/ },
  {
    id: "consultation-history", path: /^\/admin\/usage-history$/,
    body: {
      items: [{ id: 1, granularity: "daily", period_start: "2026-03-08", storage_endpoint_id: 11,
        endpoint_name: "Default", subject_type: "account", subject_id: 101, subject_name: "Helios Retail",
        subject_identifier: "RGW-HELIOS", used_bytes: 2048, used_objects: 5, usage_ratio_pct: 50,
        samples_count: 2, collected_at: "2026-03-08T09:00:00Z" }],
      total: 1, page: 1, page_size: 100, has_next: false,
      summary: { total_records: 1, subjects_count: 1, latest_collected_at: "2026-03-08T09:00:00Z", max_usage_ratio_pct: 50 },
    },
  },
  {
    id: "consultation-identity-requests", path: /^\/admin\/identity\/link-requests$/,
    body: [{ id: "request-1", user_id: 2, user_email: "candidate@example.com", user_role: "ui_user",
      provider_type: "oidc", provider_id: "company", email: "candidate@example.com", status: "pending",
      created_at: "2026-03-08T10:00:00Z", expires_at: "2026-03-09T10:00:00Z" }],
  },
  { id: "consultation-sessions", path: /^\/admin\/identity\/sessions$/, body: [] },
];

for (const entry of cases) for (const mode of [
  { name: "desktop-light", width: 1440, height: 900, theme: "light" as const, locale: "en" as const },
  { name: "desktop-dark", width: 1440, height: 900, theme: "dark" as const, locale: "de" as const },
  { name: "mobile-light", width: 390, height: 844, theme: "light" as const, locale: "fr" as const },
  { name: "mobile-dark", width: 390, height: 844, theme: "dark" as const, locale: "de" as const },
  { name: "tablet-light", width: 1024, height: 768, theme: "light" as const, locale: "en" as const },
]) {
  test(`${entry.route} ${mode.name}`, async ({ browser }, testInfo) => {
    test.setTimeout(30_000);
    const scenario = scenarios.find((item) => item.id === entry.source)!;
    const context = await browser.newContext({ viewport: mode, colorScheme: mode.theme });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    try {
      const rules = scenario.mockRules.map((rule) => entry.route.includes("view=access") && rule.id === "portal-state" && typeof rule.body === "object"
        ? { ...rule, body: { ...rule.body, portal_role: "portal_manager", server_access_logging_enabled: true } }
        : rule.path.test("/settings/general") && typeof rule.body === "object"
        ? { ...rule, body: { ...rule.body, usage_history_enabled: entry.route === "/admin/usage-history" } } : rule);
      const registry = await registerApiMocks(page, [...extraRules, ...rules], testInfo.title,
        { ...scenario.user, ui_language: mode.locale });
      await seedUiPreferences(page, { ...scenario.storage, theme: mode.theme });
      await page.clock.setFixedTime(new Date("2026-03-08T12:00:00Z"));
      await page.goto(entry.route);
      await expect(page.locator("h1")).toBeVisible();
      if (entry.route.includes("view=access")) {
        // Exercise tab switching after the separately fetched project settings arrive.
        await expect(page.getByRole("tab")).toHaveCount(2);
        await page.getByRole("tab").last().click();
        await expect(page.getByRole("tab").last()).toHaveAttribute("aria-selected", "true");
        await expect(page.getByRole("region", { name: /Technical access logs|Journaux d'accès techniques|Technische Zugriffsprotokolle/ })).toBeVisible();
        await expect(page.getByText("sample.csv", { exact: true }).first()).toBeVisible();
      }
      const content = entry.route === "/admin/metrics"
        ? page.getByText("Storage snapshot", { exact: true })
        : entry.route === "/admin/endpoint-status"
          ? page.getByText("Endpoint Latency", { exact: true })
          : page.locator('table tbody td[data-mobile-primary="true"]').first();
      await expect(content).toBeVisible();
      if (entry.route === "/admin/metrics") await expect(page.getByText("Instant count", { exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("page.png"), fullPage: true, animations: "disabled" });
      await assertListHeaders(page, { singleLine: mode.width === 1440 && !entry.route.includes("view=access") });
      const geometry = await content.boundingBox();
      await fs.writeFile(testInfo.outputPath("geometry.json"), JSON.stringify(geometry));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect(overflow).toBeLessThanOrEqual(2);
      if (mode.width === 1440) {
        expect(geometry!.y + geometry!.height).toBeLessThan(900);
      }
      const controls = page.locator('main header :is(input, select), main .ui-list-toolbar :is(input, select)');
      const firstControl = controls.locator("visible=true").first();
      if (await firstControl.count()) {
        await firstControl.focus();
        await expect(firstControl).toBeFocused();
        // Native month/date inputs expose several segments in the tab order.
        for (let step = 0; step < 4 && await firstControl.evaluate((control) => control === document.activeElement); step++) {
          await page.keyboard.press("Tab");
        }
        await expect(firstControl).not.toBeFocused();
      }
      if (mode.width < 768) {
        for (const control of await controls.all()) {
          if (await control.isVisible()) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
      }
      if (["/admin/usage-history", "/admin/billing"].includes(entry.route)) {
        const sort = page.getByLabel("Sort by", { exact: true });
        if (mode.width < 768) {
          await expect(sort).toBeVisible();
          const field = entry.route === "/admin/billing" ? "cost" : "ratio";
          const request = page.waitForRequest((req) => req.url().includes("sort_by=" + field));
          await sort.selectOption(field);
          await request;
          await expect(sort).toHaveValue(field);
        } else {
          await expect(sort).toBeHidden();
          await expect(page.getByRole("columnheader").first()).toBeVisible();
        }
      }
      if (entry.route === "/admin/billing") {
        const disclosure = page.locator("details");
        await expect(disclosure).not.toHaveAttribute("open");
        await page.getByText("Manual daily collection", { exact: true }).click();
        await expect(page.getByRole("button", { name: "Collect daily", exact: true })).toBeVisible();
        await page.getByText("Manual daily collection", { exact: true }).click();
        await expect(page.getByRole("button", { name: "Collect daily", exact: true })).toBeHidden();
      }
      if (entry.route.includes("view=access")) {
        const tools = page.locator(".ui-list-toolbar-tools");
        const advanced = tools.getByRole("button").last();
        await advanced.click();
        await expect(page.locator(".ui-list-toolbar-secondary")).toBeVisible();
        const close = page.getByRole("button", { name: /Close advanced filter drawer|Fermer le panneau|Erweiterten Filter schließen/ });
        await expect(close).toBeAttached();
        // Close the drawer by its own button without changing the applied filters.
        await page.getByRole("button", { name: /^(Close|Fermer|Schließen)$/ }).last().click();
        await expect(close).toHaveCount(0);
      }
      registry.assertNoUnmatched();
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}
