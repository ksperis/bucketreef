/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { expect, test } from "@playwright/test";
import { collectApplicationErrors } from "../helpers/application-errors";
import { E2E_ADMIN_STORAGE_STATE_PATH } from "../helpers/config";

test.setTimeout(45_000);

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === "passed") await page.context().storageState({ path: E2E_ADMIN_STORAGE_STATE_PATH });
});

test("OpenStack administration renders and persists a disabled cloud through the real API", async ({ page }, testInfo) => {
  const errors = collectApplicationErrors(page);
  await page.goto("/admin/openstack");
  await expect(page.getByRole("heading", { name: "OpenStack", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add cloud" }).click();
  await page.getByLabel("Name", { exact: true }).fill("OpenStack UI smoke");
  await page.getByLabel("Keystone v3 URL").fill("https://identity.example.invalid/v3");
  await expect(page.getByRole("switch", { name: "Enabled", exact: true })).not.toBeChecked();
  await expect(page.getByRole("switch", { name: "All authorized UI users" })).not.toBeChecked();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("OpenStack UI smoke", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("openstack-admin-dark.png"), fullPage: true });
  const row = page.getByRole("row").filter({ hasText: "OpenStack UI smoke" });
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("OpenStack UI smoke", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("standalone profile supports cloud and key selection in desktop dark and mobile light (simulated Keystone metadata)", async ({ page }, testInfo) => {
  const errors = collectApplicationErrors(page);
  let connected = false;
  const connection = { id: "ui-fixture", cloud_id: 100, cloud_name: "Cloud fixture", display_name: "Fixture person", keystone_user_id: "fixture-user", connected: true, expires_at: "2099-01-01T00:00:00Z" };
  await page.route("**/api/me/openstack/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/clouds")) return route.fulfill({ json: [{ id: 100, name: "Cloud fixture", allow_password: true, allow_token: true, default_domain: "People", endpoints: [{ id: 100, name: "Fixture S3", region: "A" }] }] });
    if (path.endsWith("/connections")) {
      if (route.request().method() === "POST") { connected = true; return route.fulfill({ json: connection }); }
      return route.fulfill({ json: connected ? [connection] : [] });
    }
    if (path.endsWith("/projects")) return route.fulfill({ json: [{ id: "fixture-project", name: "Fixture project", domain_id: "domain" }] });
    if (path.endsWith("/credentials")) return route.fulfill({ json: ["fixture-key-a", "fixture-key-b"] });
    return route.fulfill({ status: 404, json: { detail: "Unexpected fixture request" } });
  });
  await page.goto("/profile?tab=openstack");
  await expect(page.getByRole("tab", { name: "OpenStack" })).toHaveAttribute("aria-selected", "true");
  await page.getByLabel("Cloud", { exact: true }).selectOption("100");
  await page.getByLabel("User name", { exact: true }).fill("fixture-person");
  await page.getByLabel("Password", { exact: true }).fill("fictitious-password");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByLabel("EC2 access key")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Open Browser" })).toBeDisabled();
  await page.getByLabel("EC2 access key").selectOption("fixture-key-b");
  await expect(page.getByRole("button", { name: "Open Browser" })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("openstack-profile-desktop-dark.png"), fullPage: true });
  const lightTheme = page.getByRole("button", { name: "Switch to light theme", exact: true });
  if (await lightTheme.count()) await lightTheme.click();
  await expect(page.getByRole("button", { name: "Switch to dark theme", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.getByLabel("EC2 access key")).toHaveValue("fixture-key-b");
  await page.getByRole("heading", { name: "My profile", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("openstack-profile-mobile-light.png"), fullPage: true, animations: "disabled", timeout: 10_000 });
  expect(errors).toEqual([]);
});
