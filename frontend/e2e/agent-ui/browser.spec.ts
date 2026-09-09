import { expect, test } from "@playwright/test";

import { collectApplicationErrors } from "../helpers/application-errors";
import { E2E_BUCKET_NAME } from "../helpers/config";

test("keeps an authenticated Browser session with the Moto bucket", async ({
  page,
}) => {
  const applicationErrors = collectApplicationErrors(page);

  await page.goto("/browser");
  await expect(page).toHaveURL(/\/browser(?:\?.*)?$/);
  await expect(page.getByRole("button", { name: "Select bucket" })).toContainText(
    E2E_BUCKET_NAME,
  );
  await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeVisible();
  expect((await page.request.get("/api/auth/session")).ok()).toBe(true);

  await page.reload();
  await expect(page).toHaveURL(/\/browser(?:\?.*)?$/);
  await expect(page.getByRole("button", { name: "Select bucket" })).toContainText(
    E2E_BUCKET_NAME,
  );
  expect(applicationErrors).toEqual([]);
});

test("keeps compact profile drafts across navigation and persists translated preferences", async ({ page }) => {
  const applicationErrors = collectApplicationErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/browser/profile");
  await expect(page.getByRole("heading", { name: "My profile" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Default workspace" })).toHaveValue("browser");
  await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("de");
  await page.getByRole("tab", { name: "Security", exact: true }).click();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByRole("combobox", { name: "Language", exact: true })).toHaveValue("de");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByRole("status")).toHaveText("Einstellungen gespeichert.");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Mein Profil" })).toBeVisible();
  await page.getByRole("tab", { name: "Sicherheit", exact: true }).click();
  await expect(page.getByRole("region", { name: "Anmeldemethoden" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Zugriff wiederherstellen" })).toBeVisible();
  const sessions = page.getByRole("region", { name: "Offene Sitzungen" });
  await expect(sessions).toBeVisible();
  const bounds = await sessions.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900);
  expect(applicationErrors).toEqual([]);
});
