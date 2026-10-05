import { expect, test } from "@playwright/test";

import { E2E_ADMIN_STORAGE_STATE_PATH } from "../helpers/config";

import { collectApplicationErrors } from "../helpers/application-errors";

test("validates controlled Ceph Admin activation and pending revocation", async ({ page }, testInfo) => {
  const errors = collectApplicationErrors(page);
  let enabled = false;
  let activationAttempts = 0;
  const requests: { enabled: boolean; endpoint_ids: number[]; grant_current_user: boolean }[] = [];
  await page.route("**/api/admin/settings", async route => {
    const response = await route.fetch();
    const settings = await response.json();
    settings.general.ceph_admin_enabled = enabled;
    await route.fulfill({ response, json: settings });
  });
  await page.route(/\/api\/admin\/storage-endpoints(?:\?.*)?$/, async route => {
    const response = await route.fetch();
    const rows = await response.json();
    const endpoint = rows[0];
    await route.fulfill({ response, json: [
      { ...endpoint, id: 901, name: "Ceph managed candidate", provider: "ceph", ceph_admin_allowed: enabled, service_identities: [{ kind: "ceph_admin", mode: "external", status: "ready" }], admin_ops_permissions: { users_read: true, users_write: true, accounts_read: true, accounts_write: false } },
      { ...endpoint, id: 902, name: "Ceph read-only operator", provider: "ceph", admin_ops_permissions: { users_read: true, users_write: false, accounts_read: true, accounts_write: false } },
    ] });
  });
  await page.route("**/api/admin/settings/ceph-admin", async route => {
    const payload = route.request().postDataJSON();
    requests.push(payload);
    enabled = payload.enabled;
    activationAttempts += 1;
    const pending = activationAttempts === 1 || !enabled;
    await route.fulfill({ json: { enabled, endpoints: [{ endpoint_id: 901, active: enabled && !pending, status: pending ? enabled ? "error" : "revocation_pending" : "ready", error: pending ? "RGW operation pending; retry." : null }] } });
  });
  await page.goto("/admin/general-settings");
  await page.getByRole("switch", { name: "Ceph Admin feature" }).click();
  const dialog = page.getByRole("dialog", { name: "Authorize Ceph Admin endpoints" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: /Ceph read-only operator/ })).toBeDisabled();
  const grant = dialog.getByRole("checkbox", { name: "Grant me access to the Ceph Admin workspace" });
  await expect(grant).not.toBeChecked();
  await dialog.getByRole("checkbox", { name: /Ceph managed candidate/ }).check();
  await dialog.getByRole("button", { name: "Activate Ceph Admin", exact: true }).click();
  await expect(dialog.getByText("RGW operation pending; retry.")).toBeVisible();
  expect(requests[0]).toEqual({ enabled: true, endpoint_ids: [901], grant_current_user: false });
  await grant.check();
  await dialog.getByRole("button", { name: "Retry pending operations" }).click();
  await expect(dialog.getByText("Ceph managed candidate · Active")).toBeVisible();
  expect(requests[1].grant_current_user).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("ceph-admin-activation.png") });
  await dialog.getByRole("button", { name: "Done" }).click();
  await page.getByRole("switch", { name: "Ceph Admin feature" }).click();
  const revoke = page.getByRole("dialog", { name: "Disable Ceph Admin", exact: true });
  await revoke.getByRole("button", { name: "Disable and revoke identities" }).click();
  await expect(revoke.getByText(/revocation_pending/)).toBeVisible();
  await expect(revoke.getByRole("button", { name: "Retry pending operations" })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("ceph-admin-revocation-pending.png") });
  expect(errors).toEqual([]);
  await page.context().storageState({ path: E2E_ADMIN_STORAGE_STATE_PATH });
});

test("keeps Runtime and Supervision permanent and requires explicit external replacements", async ({ page }, testInfo) => {
  const errors = collectApplicationErrors(page);
  await page.route(/\/api\/admin\/storage-endpoints(?:\?.*)?$/, async route => {
    const response = await route.fetch();
    const rows = await response.json();
    await route.fulfill({ response, json: [{ ...rows[0], id: 901, name: "Ceph Runtime identity", provider: "ceph", is_editable: true,
      admin_access_key: "OPERATOR", has_admin_secret: true,
      capabilities: { admin: true, account: true, metrics: false, usage: false },
      features: { ...rows[0].features, admin: { enabled: true }, account: { enabled: true }, metrics: { enabled: false }, usage: { enabled: false } },
      service_identities: [
        { kind: "runtime", mode: "managed", status: "ready", credentials_configured: true },
        { kind: "supervision", mode: "managed", status: "ready", credentials_configured: true },
      ],
      admin_ops_permissions: { users_read: true, users_write: true, accounts_read: true, accounts_write: false },
    }] });
  });
  await page.route("**/api/admin/storage-endpoints/detect-features", route => route.fulfill({ json: {
    admin: true, account: true, metrics: false, usage: false, warnings: [],
    admin_ops_permissions: { users_read: true, users_write: true, accounts_read: true, accounts_write: false },
    credential_checks: { admin: { status: "valid" }, runtime: { status: "not_configured" }, supervision: { status: "not_configured" } },
  } }));
  await page.goto("/admin/storage-endpoints/901");
  await page.getByRole("tab", { name: "Credentials", exact: true }).click();
  await expect(page.getByText("Runtime Read Ops · managed · ready", { exact: true })).toBeVisible();
  await expect(page.getByText("Supervision Ops · managed · ready", { exact: true })).toBeVisible();
  await expect(page.getByText("Recommended Admin Ops", { exact: true })).toBeVisible();
  await expect(page.getByText("Advanced: restrict Admin Ops permissions", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Runtime access key", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Supervision access key", { exact: true })).toHaveCount(0);
  await page.getByLabel("Identity management").selectOption("external");
  await expect(page.getByLabel("Runtime access key", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Runtime secret key", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Supervision access key", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Supervision secret key", { exact: true })).toHaveValue("");
  for (const label of ["Runtime access key", "Runtime secret key", "Supervision access key", "Supervision secret key"]) {
    await expect(page.getByLabel(label, { exact: true })).toHaveAttribute("required", "");
  }
  await page.screenshot({ path: testInfo.outputPath("runtime-external-replacement.png") });
  expect(errors).toEqual([]);
  await page.context().storageState({ path: E2E_ADMIN_STORAGE_STATE_PATH });
});

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

test("keeps all production readiness levels visible across desktop and mobile", async ({
  page,
}) => {
  const applicationErrors = collectApplicationErrors(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/admin/production-readiness");
  await expect(
    page.getByRole("heading", { name: "Production readiness" }),
  ).toBeVisible();
  const overview = page.getByLabel("Readiness levels");
  await expect(overview).toBeVisible();
  await expect(overview.locator("dt")).toHaveText([
    "Blocked",
    "Critical",
    "Warning",
    "Manual",
    "OK",
  ]);
  const successfulChecks = page.getByText(/Show \d+ successful checks?/);
  await successfulChecks.click();
  await expect(successfulChecks.locator("xpath=ancestor::details")).toHaveAttribute(
    "open",
    "",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(overview).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(2);
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
