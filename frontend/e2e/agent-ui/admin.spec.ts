import { expect, test } from "@playwright/test";

import { collectApplicationErrors } from "../helpers/application-errors";

test("keeps an authenticated administrator session across reloads", async ({
  page,
}) => {
  const applicationErrors = collectApplicationErrors(page);

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin(?:\?.*)?$/);
  await expect(page.getByRole("heading", { name: "Admin overview" })).toBeVisible();
  expect((await page.request.get("/api/auth/session")).ok()).toBe(true);

  await page.reload();
  await expect(page).toHaveURL(/\/admin(?:\?.*)?$/);
  await expect(page.getByRole("heading", { name: "Admin overview" })).toBeVisible();
  expect(applicationErrors).toEqual([]);
});

test("shows the compact administrator profile and protects the mandatory passkey", async ({ page }) => {
  const applicationErrors = collectApplicationErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/admin/profile?tab=security");
  await expect(page.getByRole("heading", { name: "My profile" })).toBeVisible();
  await page.getByRole("button", { name: "Manage passkeys" }).click();
  await expect(page.getByRole("button", { name: "Remove passkey" })).toBeDisabled();
  await expect(page.getByText("Add another passkey before removing the last required one.")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("tab", { name: "Profile and preferences" }).click();
  await expect(page.getByRole("switch", { name: "Global quota watch" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Identity", exact: true })).toBeVisible();
  expect((await page.request.get("/api/auth/session")).ok()).toBe(true);
  expect(applicationErrors).toEqual([]);
});
