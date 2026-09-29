import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { demoApi as api, openDemo as open } from "./helpers";

test("files UI: folder, upload, preview, download and multiple deletion", async ({ page }) => {
  await open(page, "/manager/browser?bucket=helios-documents&ctx=101");
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  await page.getByLabel("Folder name", { exact: true }).fill("ui-review");
  await page.getByRole("dialog", { name: "Create folder" }).getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("ui-review", { exact: true }).first()).toBeVisible();
  await page.locator('input[type="file"]:not([webkitdirectory])').setInputFiles([
    { name: "ui-demo.txt", mimeType: "text/plain", buffer: Buffer.from("Preview and download from the static demo.") },
    { name: "ui-second.txt", mimeType: "text/plain", buffer: Buffer.from("A second local file.") },
  ]);
  await expect(page.getByText("ui-demo.txt", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "More actions for ui-demo.txt", exact: true }).click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByText("Preview and download from the static demo.", { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("complementary", { name: "ui-demo.txt" }).getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloadPromise;
  expect(await readFile((await download.path())!, "utf8")).toBe("Preview and download from the static demo.");
  await page.getByRole("button", { name: "Close details", exact: true }).click();
  await page.getByRole("checkbox", { name: "Select ui-demo.txt", exact: true }).check();
  await page.getByRole("checkbox", { name: "Select ui-second.txt", exact: true }).check();
  await page.getByRole("button", { name: "Delete", exact: true }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: /Delete/, exact: false }).click();
  await expect.poll(async () => (await api(page, "/browser/buckets/helios-documents/objects?account_id=101&query=ui-demo.txt")).data.objects.length).toBe(0);
  expect(await page.evaluate(() => window.__bucketreefDemo.failures)).toEqual([]);
});

test("portal primary listing links keep button contrast in dark mode", async ({ page }) => {
  await open(page, "/portal/shares?demoPersona=project-manager");
  await page.getByRole("button", { name: "Toggle theme", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);

  const requestMember = page.getByRole("button", { name: "Request member", exact: true });
  const openSpaces = page.getByRole("link", { name: "Open spaces", exact: true }).first();
  await expect(requestMember).toBeVisible();
  await expect(openSpaces).toBeVisible();

  const buttonColor = await requestMember.evaluate((element) => getComputedStyle(element).color);
  const linkColor = await openSpaces.evaluate((element) => getComputedStyle(element).color);
  expect(linkColor).toBe(buttonColor);
  expect(linkColor).toBe("rgb(255, 255, 255)");

  await openSpaces.hover();
  expect(await openSpaces.evaluate((element) => getComputedStyle(element).color)).toBe("rgb(255, 255, 255)");
});

test("workspaces UI: profiles, keyboard, mobile and both themes", async ({ page }, info) => {
  const external: string[] = [];
  page.on("request", request => { const url = request.url(); if (url.startsWith("http") && (!url.startsWith("http://127.0.0.1:4187/") || new URL(url).pathname.startsWith("/api/"))) external.push(url); });
  await page.emulateMedia({ colorScheme: "light" });
  await open(page, "/");
  await expect(page).toHaveURL(/\/manager(?:\?|$)/);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole("button", { name: "Coverage & limits", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Demo coverage" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Demo coverage" })).toHaveCount(0);
  await page.getByRole("button", { name: "Toggle theme", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.screenshot({ path: info.outputPath("manager-desktop-dark.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Toggle theme", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  for (const profile of ["admin", "ceph-admin", "member", "manager"]) {
    await page.getByLabel("Demo profile", { exact: true }).selectOption(profile);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.getByLabel("Demo profile", { exact: true })).toHaveValue(profile);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ["/manager", "/admin", "/portal", "/browser", "/ceph-admin"]) {
    await open(page, route);
    await expect(page.getByRole("navigation", { name: "Demo profiles" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await page.evaluate(() => window.__bucketreefDemo.failures)).toEqual([]);
  }
  await page.screenshot({ path: info.outputPath("ceph-mobile-light.png"), fullPage: true, animations: "disabled" });
  await page.getByLabel("Demo profile", { exact: true }).selectOption("member");
  await page.getByLabel("End user identity").selectOption("project-manager");
  await expect(page.getByLabel("End user identity")).toHaveValue("project-manager");
  await page.getByRole("navigation", { name: "Demo profiles" }).getByRole("link", { name: "Browser", exact: true }).click();
  await expect(page).toHaveURL(/\/browser/);
  expect(external).toEqual([]);
});
