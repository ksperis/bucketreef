import { expect, test } from "@playwright/test";

import { collectApplicationErrors } from "../helpers/application-errors";

test("keeps the compact endpoint inventory authenticated and preserves filters through its editor", async ({ page }, testInfo) => {
  const errors = collectApplicationErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/admin/storage-endpoints");
  await expect(page.getByRole("heading", { name: "S3 Endpoints" })).toBeVisible();
  await expect(page.locator("tbody tr").first().locator(".endpoint-name")).toBeVisible();
  const name = await page.locator(".endpoint-name").first().innerText();
  await page.getByRole("searchbox", { name: "Search" }).fill(name);
  await page.locator(".endpoint-actions [data-table-default-action]").first().click();
  await expect(page.getByRole("tab")).toHaveCount(3);
  await page.getByRole("tab", { name: "Credentials", exact: true }).click();
  await page.getByRole("tab", { name: "Capabilities & health", exact: true }).click();
  await page.getByRole("button", { name: "Back to endpoints", exact: true }).first().click();
  await expect(page.getByRole("searchbox", { name: "Search" })).toHaveValue(name);
  await page.screenshot({ path: testInfo.outputPath("endpoints-authenticated.png") });
  await page.reload();
  await expect(page.getByRole("heading", { name: "S3 Endpoints" })).toBeVisible();
  expect((await page.request.get("/api/auth/session")).ok()).toBe(true);
  expect(errors).toEqual([]);
});

test("keeps an authenticated administrator session across reloads", async ({
  page,
}) => {
  const applicationErrors = collectApplicationErrors(page);

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin(?:\?.*)?$/);
  await expect(
    page.getByRole("heading", { name: "Admin overview" }),
  ).toBeVisible();
  expect((await page.request.get("/api/auth/session")).ok()).toBe(true);

  await page.reload();
  await expect(page).toHaveURL(/\/admin(?:\?.*)?$/);
  await expect(
    page.getByRole("heading", { name: "Admin overview" }),
  ).toBeVisible();
  expect(applicationErrors).toEqual([]);
});

test("shows the compact administrator profile and protects the mandatory passkey", async ({
  page,
}) => {
  const applicationErrors = collectApplicationErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/admin/profile?tab=security");
  await expect(page.getByRole("heading", { name: "My profile" })).toBeVisible();
  await page.getByRole("button", { name: "Manage passkeys" }).click();
  await expect(
    page.getByRole("button", { name: "Remove passkey" }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      "Add another passkey before removing the last required one.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("tab", { name: "Profile and preferences" }).click();
  await expect(
    page.getByRole("switch", { name: "Global quota watch" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Identity", exact: true }),
  ).toBeVisible();
  expect((await page.request.get("/api/auth/session")).ok()).toBe(true);
  expect(applicationErrors).toEqual([]);
});

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`renders all compact settings in ${theme} at ${width}px`, async ({
      page,
    }, testInfo) => {
      const errors = collectApplicationErrors(page);
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(
        (value) => localStorage.setItem("theme", value),
        theme,
      );
      await page.goto("/admin/general-settings");
      const portal = page.getByRole("switch", { name: "Portal feature" });
      await expect(portal).toBeEnabled();
      if (!(await portal.isChecked())) {
        await portal.click();
        await page.getByRole("button", { name: "Save changes" }).click();
        await expect(page.getByRole("status")).toContainText("Settings saved.");
      }
      const routes = [
        ["general-settings", "Available workspaces"],
        ["browser-settings", "Workspace availability"],
        ["manager-settings", "Usage and metrics"],
        ["portal-settings", "Access and creation"],
        ["authentication-settings", "Identity security policy"],
        ["key-rotation", "Previous keys"],
      ];
      for (const [route, section] of routes) {
        await page.goto(`/admin/${route}`);
        await expect(
          page.getByRole("heading", { name: section, exact: true }),
        ).toBeVisible();
        await expect(
          page.locator(".settings-section-compact").first(),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - innerWidth,
          ),
        ).toBeLessThanOrEqual(2);
        if (width === 390) {
          const heights = await page
            .locator("main .settings-control, main input[role=switch]")
            .evaluateAll((elements) =>
              elements
                .filter((element) => element.getBoundingClientRect().width > 0)
                .map((element) => element.getBoundingClientRect().height),
            );
          expect(heights.every((height) => height >= 44)).toBe(true);
        }
        await page.screenshot({
          path: testInfo.outputPath(`${route}-${theme}-${width}.png`),
          fullPage: true,
          animations: "disabled",
        });
      }
      for (const kind of ["oidc", "ldap"] as const) {
        await page.goto(`/admin/authentication-settings/${kind}/new`);
        await expect(
          page.getByRole("heading", {
            name: `Add ${kind.toUpperCase()} provider`,
          }),
        ).toBeVisible();
        const providerId = page.getByRole("textbox", {
          name: kind === "ldap" ? "LDAP Provider ID" : "Provider ID",
          exact: true,
        });
        const controlHeight = await providerId.evaluate(
          (element) => element.getBoundingClientRect().height,
        );
        if (width === 1440) expect(controlHeight).toBe(28);
        else expect(controlHeight).toBeGreaterThanOrEqual(44);
        const sidebar = page.locator(
          `aside[data-sidebar-variant="${width === 390 ? "mobile" : "desktop"}"]`,
        );
        await expect(
          sidebar.locator('a[href="/admin/authentication-settings"]'),
        ).toHaveAttribute("aria-current", "page");
        if (width === 1440) {
          await page.getByRole("button", { name: "Collapse sidebar" }).click();
          await expect(
            sidebar.locator('a[href="/admin/authentication-settings"]'),
          ).toHaveAttribute("aria-current", "page");
          await page.getByRole("button", { name: "Expand sidebar" }).click();
        } else {
          await page
            .getByRole("button", { name: "Open navigation", exact: true })
            .click();
          await expect(
            sidebar.locator('a[href="/admin/authentication-settings"]'),
          ).toBeVisible();
          await page
            .getByRole("button", { name: "Close navigation", exact: true })
            .click();
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - innerWidth,
          ),
        ).toBeLessThanOrEqual(2);
        await page.screenshot({
          path: testInfo.outputPath(`${kind}-${theme}-${width}.png`),
          animations: "disabled",
        });
        await providerId.fill("draft-only");
        await page
          .getByRole("button", { name: "Back to authentication" })
          .click();
        await expect(page.getByRole("dialog")).toHaveCount(1);
        await page.getByRole("button", { name: "Discard changes" }).click();
        await expect(page).toHaveURL(/\/admin\/authentication-settings$/);
      }
      expect(errors).toEqual([]);
    });
  }
}

test("keeps branding preview local and applies a custom accent only after a successful save", async ({
  page,
}, testInfo) => {
  await page.goto("/admin/general-settings");
  const picker = page.getByLabel("Primary color picker");
  await expect(picker).toBeVisible();
  const original = await picker.inputValue();
  const rootColor = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue(
        "--ui-primary-600-rgb",
      ),
    );
  const before = await rootColor();
  await picker.fill("#7c3aed");
  expect(await rootColor()).toBe(before);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Settings saved.");
  expect(await rootColor()).not.toBe(before);
  await page.screenshot({
    path: testInfo.outputPath("settings-custom-accent.png"),
    fullPage: true,
    animations: "disabled",
  });
  await picker.fill(original);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Settings saved.");
});
