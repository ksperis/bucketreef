/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { expect, test, type Page } from "@playwright/test";
import { S3Client, PutObjectCommand, PutBucketCorsCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import { E2E_BUCKET_NAME, E2E_S3_ENDPOINT, E2E_S3_ACCESS_KEY, E2E_S3_SECRET_KEY, E2E_S3_REGION, E2E_USER_EMAIL, E2E_USER_PASSWORD } from "../helpers/config";

const s3 = new S3Client({ endpoint: E2E_S3_ENDPOINT, region: E2E_S3_REGION, forcePathStyle: true, requestChecksumCalculation: "WHEN_REQUIRED", credentials: { accessKeyId: E2E_S3_ACCESS_KEY, secretAccessKey: E2E_S3_SECRET_KEY } });
const prefix = `evolutions-${Date.now()}/`;
const jsonVersions: string[] = [];
test.use({ video: "off", trace: "off", screenshot: "off" });
test.beforeEach(({ page }) => { page.setDefaultTimeout(15_000); });
async function open(page: Page) {
  await page.goto(`/browser?bucket=${E2E_BUCKET_NAME}&prefix=${encodeURIComponent(prefix)}`);
  await expect(page.getByRole("button", { name: "Upload", exact: true }).or(page.getByRole("button", { name: "Sign in", exact: true }))).toBeVisible();
  if (new URL(page.url()).pathname === "/login") {
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(E2E_USER_EMAIL);
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(E2E_USER_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL("**/browser**");
    await page.goto(`/browser?bucket=${E2E_BUCKET_NAME}&prefix=${encodeURIComponent(prefix)}`);
  }
  await expect(page.getByRole("button", { name: "Open file data.csv", exact: true })).toBeVisible();
}
async function more(page: Page) {
  await page.getByRole("toolbar", { name: "Browser context bar" }).getByRole("button", { name: "More", exact: true }).click();
  return page.getByRole("menu", { name: "More", exact: true });
}
test.beforeAll(async () => {
  await s3.send(new PutBucketCorsCommand({ Bucket: E2E_BUCKET_NAME, CORSConfiguration: { CORSRules: [{ AllowedOrigins: ["*"], AllowedMethods: ["GET", "PUT", "HEAD"], AllowedHeaders: ["*"], ExposeHeaders: ["ETag"] }] } }));
  for (const [key, body] of [["data.csv", "name,value\nAlice,42\n"], ["version.json", '{"revision":1}\n'], ["version.json", '{"revision":2}\n'], ["nested/readme.txt", "nested content"], ["empty/", ""]]) {
    const uploaded = await s3.send(new PutObjectCommand({ Bucket: E2E_BUCKET_NAME, Key: prefix + key, Body: Buffer.from(body), ContentType: key.endsWith("json") ? "application/json" : key.endsWith("csv") ? "text/csv" : "text/plain" }));
    if (key === "version.json") jsonVersions.push(uploaded.VersionId!);
  }
});

test("combines sidebar favorites, advanced search and accessible display menus", async ({ page, browser }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await open(page);
  await page.evaluate(async () => {
    const api = await import(/* @vite-ignore */ ["/src/api", "browserFavorites.ts"].join("/"));
    for (const preset of await api.listBrowserFavorites("browser")) {
      if (preset.prefix.startsWith("evolutions-")) await api.deleteBrowserFavorite(preset);
    }
  });
  await page.getByRole("tab", { name: "Favorites", exact: true }).click();
  await page.getByRole("button", { name: "Manage favorites", exact: true }).click();
  const favorites = page.getByRole("dialog", { name: "Favorites" });
  const label = "Documents du projet";
  await favorites.getByLabel("Name", { exact: true }).fill(label);
  await favorites.getByRole("button", { name: "Pin location", exact: true }).click();
  await expect(favorites.getByRole("button", { name: `★ ${label}`, exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  const sidebar = page.locator("[data-testid=browser-workspace-sidebar]:visible");
  await expect(sidebar).toContainText(E2E_BUCKET_NAME);
  await expect(sidebar.getByText(label, { exact: true })).toBeVisible();
  const second = await browser.newContext({ storageState: await page.context().storageState(), baseURL: new URL(page.url()).origin, viewport: { width: 1728, height: 972 } });
  try {
    const other = await second.newPage(); await open(other);
    await other.getByRole("tab", { name: "Favorites", exact: true }).click();
    await expect(other.getByText(label, { exact: true })).toBeVisible();
  } finally { await second.close(); }
  await page.getByRole("button", { name: "Search options", exact: true }).click();
  const advanced = page.getByRole("dialog", { name: "Advanced search" });
  await advanced.getByRole("combobox", { name: "Search scope" }).selectOption("recursive");
  await advanced.getByLabel("Extensions, separated by commas").fill("csv");
  await page.screenshot({ path: info.outputPath("search-dark.png"), animations: "disabled" });
  await advanced.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("button", { name: "Search options", exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "Open file version.json" })).toHaveCount(0);
  await page.getByRole("button", { name: "Manage favorites", exact: true }).click();

  const menu = await more(page);
  const display = menu.getByRole("menuitem", { name: "Display", exact: true });
  await display.focus(); await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("menu", { name: "Display", exact: true })).toBeVisible();
  await expect(page.getByRole("menu", { name: "Display", exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath("display-dark.png"), animations: "disabled" });
  await page.keyboard.press("ArrowLeft"); await expect(display).toBeFocused();
  await menu.getByRole("menuitem", { name: "Help and shortcuts" }).click();
  await expect(page.getByRole("dialog")).toContainText("Ctrl");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await page.screenshot({ path: info.outputPath("browser-light.png"), animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Search options", exact: true }).click();
  await expect(advanced).toBeVisible();
  const box = await advanced.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath("search-mobile.png"), animations: "disabled" });
  expect(errors).toEqual([]);
});

test("resolves an upload conflict, renames and downloads a mixed ZIP", async ({ page }) => {
  // Exercise the bounded Blob fallback; native save dialogs cannot be driven in headless CI.
  await page.addInitScript(() => Object.defineProperty(window, "showSaveFilePicker", { value: undefined }));
  await open(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await page.getByRole("menuitem", { name: "Upload files" }).click();
  await (await chooser).setFiles({ name: "data.csv", mimeType: "text/csv", buffer: Buffer.from("new,content\n") });
  const conflict = page.getByRole("dialog", { name: "Resolve destination conflicts" });
  await expect(conflict.getByRole("button", { name: "Apply decisions" })).toBeDisabled();
  await conflict.getByRole("button", { name: "Keep both for all" }).click();
  await conflict.getByRole("button", { name: "Apply decisions" }).click();
  await expect(page.getByRole("button", { name: "Open file data (1).csv", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "More actions for data (1).csv", exact: true }).click();
  await page.getByRole("menu").getByRole("button", { name: "Rename", exact: true }).click();
  const rename = page.getByRole("dialog", { name: "Rename", exact: true });
  await rename.getByLabel("New name").fill("renommé.csv");
  await rename.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open file renommé.csv", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open file data (1).csv", exact: true })).toHaveCount(0);
  for (const selected of await page.getByRole("checkbox", { checked: true }).all()) await selected.uncheck();
  await page.getByRole("checkbox", { name: "Select nested", exact: true }).check();
  await page.getByRole("checkbox", { name: "Select data.csv", exact: true }).check();
  const menu = await more(page);
  const [download] = await Promise.all([page.waitForEvent("download"), menu.getByRole("menuitem", { name: "Download as ZIP", exact: true }).click()]);
  const archive = await JSZip.loadAsync(await readFile((await download.path())!));
  expect(Object.keys(archive.files).filter(key => !archive.files[key].dir).sort()).toEqual(["data.csv", "nested/readme.txt"]);
  expect(await archive.file("nested/readme.txt")!.async("string")).toBe("nested content");
});

test("previews and compares exact historical JSON versions without changing the current object", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "More actions for version.json", exact: true }).click();
  await page.getByRole("menu").getByRole("button", { name: "Versions", exact: true }).click();
  const drawer = page.getByRole("complementary", { name: "version.json", exact: true });
  await drawer.getByRole("combobox", { name: "First version", exact: true }).selectOption(jsonVersions[0]);
  await drawer.getByRole("combobox", { name: "Second version", exact: true }).selectOption(jsonVersions[1]);
  await drawer.getByRole("button", { name: "Preview version", exact: true }).click();
  const inspection = page.getByRole("dialog", { name: "Read-only version inspection" });
  await expect(inspection).toContainText("revision: 1");
  await expect(inspection.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
  await inspection.getByRole("button", { name: "Raw text", exact: true }).click();
  await expect(inspection.locator("pre")).toHaveText('{"revision":1}\n');
  await page.keyboard.press("Escape");
  await drawer.getByRole("button", { name: "Compare versions", exact: true }).click();
  await expect(inspection.locator("pre")).toContainText('− {"revision":1}');
  await expect(inspection.locator("pre")).toContainText('+ {"revision":2}');
  const current = await s3.send(new GetObjectCommand({ Bucket: E2E_BUCKET_NAME, Key: prefix + "version.json" }));
  expect(current.VersionId).toBe(jsonVersions[1]);
  expect(await current.Body!.transformToString()).toBe('{"revision":2}\n');
});
