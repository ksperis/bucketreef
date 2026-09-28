/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { expect, test, type Page } from "@playwright/test";
import { S3Client, PutObjectCommand, PutBucketCorsCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import { E2E_BUCKET_NAME, E2E_S3_ENDPOINT, E2E_S3_ACCESS_KEY, E2E_S3_SECRET_KEY, E2E_S3_REGION, E2E_USER_EMAIL, E2E_USER_PASSWORD } from "../helpers/config";

const s3 = new S3Client({ endpoint: E2E_S3_ENDPOINT, region: E2E_S3_REGION, forcePathStyle: true, requestChecksumCalculation: "WHEN_REQUIRED", credentials: { accessKeyId: E2E_S3_ACCESS_KEY, secretAccessKey: E2E_S3_SECRET_KEY } });
const prefix = `simplification-${Date.now()}/`;
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
  await s3.send(new PutBucketCorsCommand({ Bucket: E2E_BUCKET_NAME, CORSConfiguration: { CORSRules: [{ AllowedOrigins: ["*"], AllowedMethods: ["GET", "PUT", "POST", "HEAD"], AllowedHeaders: ["*"], ExposeHeaders: ["ETag"] }] } }));
  for (const [key, body] of [["clipboard.txt", "clipboard content"], ["data.csv", "name,value\nAlice,42\n"], ["version.json", '{"revision":1}\n'], ["version.json", '{"revision":2}\n'], ["nested/readme.txt", "nested content"], ["empty/", ""]]) {
    await s3.send(new PutObjectCommand({ Bucket: E2E_BUCKET_NAME, Key: prefix + key, Body: Buffer.from(body), ContentType: key.endsWith("json") ? "application/json" : key.endsWith("csv") ? "text/csv" : "text/plain" }));
  }
});

async function upload(page: Page, name: string, body: Buffer, mimeType = "text/plain") {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await page.getByRole("menuitem", { name: "Upload files" }).click();
  await (await chooser).setFiles({ name, mimeType, buffer: body });
}

test("synchronizes path favorites across sessions and retains the original search menu", async ({ page, browser }) => {
  await open(page);
  await page.getByRole("tab", { name: "Favorites", exact: true }).click();
  await page.getByRole("button", { name: "Manage favorites", exact: true }).click();
  const favorites = page.getByRole("dialog", { name: "Favorites" });
  const name = `Documents ${prefix}`;
  await favorites.getByLabel("Name", { exact: true }).fill(name);
  await favorites.getByRole("button", { name: "Pin location", exact: true }).click();
  const saved = favorites.getByRole("listitem").filter({ hasText: name });
  await expect(saved).toBeVisible();
  await expect(favorites.getByRole("button", { name: "Save view" })).toHaveCount(0);
  await saved.getByRole("button", { name: "Rename", exact: true }).click();
  await favorites.getByLabel("Rename saved item").fill(name + " renamed");
  await favorites.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(saved).toContainText("renamed");
  await page.keyboard.press("Escape");
  const sidebar = page.locator("[data-testid=browser-workspace-sidebar]:visible");
  await expect(sidebar).toContainText(E2E_BUCKET_NAME);
  await expect(sidebar).toContainText("Browser Moto E2E");
  const second = await browser.newContext({ storageState: await page.context().storageState(), baseURL: new URL(page.url()).origin, viewport: { width: 1728, height: 972 } });
  try {
    const other = await second.newPage(); await open(other);
    await other.getByRole("tab", { name: "Favorites", exact: true }).click();
    await expect(other.getByText(name + " renamed", { exact: true })).toBeVisible();
    await other.getByRole("button", { name: `Manage favorites: ${name} renamed`, exact: true }).click();
    await other.getByRole("dialog", { name: "Favorites" }).getByRole("listitem").filter({ hasText: name }).getByRole("button", { name: "Remove", exact: true }).click();
    await expect(other.getByRole("button", { name: `★ ${name} renamed`, exact: true })).toHaveCount(0);
  } finally { await second.close(); }
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(sidebar.getByText(name + " renamed", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Search options", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Search scope" })).toBeDisabled();
  await expect(page.getByRole("dialog", { name: "Advanced search" })).toHaveCount(0);
  await expect(page.getByLabel("Minimum bytes")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Search objects", exact: true }).fill("csv");
  await page.getByRole("combobox", { name: "Search scope" }).selectOption("bucket");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open file version.json" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Open file ${prefix}data.csv`, exact: true })).toBeVisible();
});

test("overwrites normally and downloads files plus folders as one ZIP", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "showSaveFilePicker", { value: undefined }));
  await open(page);
  await upload(page, "data.csv", Buffer.from("name,value\nAlice,43\n"), "text/csv");
  await expect(page.getByText(/Uploaded.*data.csv|Uploaded 1/)).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Resolve destination conflicts" })).toHaveCount(0);
  for (const selected of await page.getByRole("checkbox", { checked: true }).all()) await selected.uncheck();
  await page.getByRole("checkbox", { name: "Select nested", exact: true }).check();
  await page.getByRole("checkbox", { name: "Select data.csv", exact: true }).check();
  await expect(page.getByRole("toolbar", { name: "Browser context bar" }).getByRole("status")).toHaveText("2 selected");
  const menu = await more(page);
  for (const name of ["Rename", "Copy to…", "Move to…", "Calculate volume", "Help and shortcuts", "Display", "Transfers and recovery"]) await expect(menu.getByRole("menuitem", { name, exact: true })).toHaveCount(0);
  const [download] = await Promise.all([page.waitForEvent("download"), menu.getByRole("menuitem", { name: "Download as ZIP", exact: true }).click()]);
  const archive = await JSZip.loadAsync(await readFile((await download.path())!));
  expect(Object.keys(archive.files).filter(key => !archive.files[key].dir).sort()).toEqual(["data.csv", "nested/readme.txt"]);
  expect(await archive.file("data.csv")!.async("string")).toBe("name,value\nAlice,43\n");
  expect(await archive.file("nested/readme.txt")!.async("string")).toBe("nested content");
});

test("previews current CSV and JSON with search and loaded-file navigation", async ({ page }) => {
  await open(page);
  await page.getByRole("checkbox", { name: "Select data.csv", exact: true }).check();
  await page.getByRole("button", { name: "Open file data.csv", exact: true }).click();
  let drawer = page.getByRole("complementary", { name: "data.csv", exact: true });
  await expect(drawer.getByRole("table")).toContainText("Alice");
  await drawer.getByRole("searchbox", { name: "Find in displayed text" }).fill("Alice");
  await expect(drawer.locator("mark")).toHaveText("Alice");
  await drawer.getByRole("button", { name: "Next", exact: true }).click();
  drawer = page.getByRole("complementary", { name: "version.json", exact: true });
  await expect(drawer).toContainText("revision: 2");
  await expect(page.getByRole("checkbox", { name: "Select data.csv", exact: true })).toBeChecked();
  await drawer.getByRole("button", { name: "Raw text", exact: true }).click();
  await expect(drawer.locator("pre")).toHaveText('{"revision":2}\n');
  await drawer.getByRole("tab", { name: "Versions", exact: true }).click();
  await expect(drawer.getByRole("button", { name: "Restore", exact: true })).toHaveCount(1);
  await expect(drawer.getByRole("button", { name: "Preview version" })).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: "Compare versions" })).toHaveCount(0);
  const current = await s3.send(new GetObjectCommand({ Bucket: E2E_BUCKET_NAME, Key: prefix + "version.json" }));
  expect(await current.Body!.transformToString()).toBe('{"revision":2}\n');
});

test("keeps desktop and mobile layouts usable in both themes", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await open(page);
  await page.reload();
  await expect(page.getByRole("button", { name: "Open file data.csv", exact: true })).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => document.documentElement.classList.toggle("dark", theme === "dark"), theme);
      await expect(page.getByRole("textbox", { name: "Search objects", exact: true })).toBeInViewport();
      const menu = await more(page);
      await expect(menu).toBeInViewport();
      await expect(menu.getByRole("menuitemradio", { name: "Compact" })).toBeVisible();
      await expect(menu.getByRole("menuitem", { name: "Help and shortcuts" })).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`browser-${width}-${theme}.png`), animations: "disabled" });
      await page.keyboard.press("Escape");
    }
  }
  expect(errors).toEqual([]);
});

test("uploads classic multipart directly and an ordinary file through the proxy", async ({ page }) => {
  await open(page);
  const completed = page.waitForResponse(response => response.url().includes("/multipart/") && response.url().includes("/complete") && response.status() === 200);
  await upload(page, "large.bin", Buffer.alloc(26 * 1024 * 1024, 65), "application/octet-stream");
  await completed;
  await expect(page.getByRole("button", { name: "Open file large.bin", exact: true })).toBeVisible();
  const head = await s3.send(new HeadObjectCommand({ Bucket: E2E_BUCKET_NAME, Key: prefix + "large.bin" }));
  expect(head.ContentLength).toBe(26 * 1024 * 1024);
  await s3.send(new PutBucketCorsCommand({ Bucket: E2E_BUCKET_NAME, CORSConfiguration: { CORSRules: [{ AllowedOrigins: ["https://unrelated.test"], AllowedMethods: ["GET", "PUT"], AllowedHeaders: ["*"] }] } }));
  try {
    await page.reload();
    await expect(page.getByText("Direct download/upload is not allowed on this bucket.")).toBeVisible();
    const uploaded = page.waitForResponse(response => response.url().includes("/proxy-upload") && response.status() === 200);
    await upload(page, "proxy.txt", Buffer.from("proxy content"));
    await uploaded;
    await expect(page.getByRole("button", { name: "Open file proxy.txt", exact: true })).toBeVisible();
    const stored = await s3.send(new GetObjectCommand({ Bucket: E2E_BUCKET_NAME, Key: prefix + "proxy.txt" }));
    expect(await stored.Body!.transformToString()).toBe("proxy content");
  } finally {
    await s3.send(new PutBucketCorsCommand({ Bucket: E2E_BUCKET_NAME, CORSConfiguration: { CORSRules: [{ AllowedOrigins: ["*"], AllowedMethods: ["GET", "PUT", "POST", "HEAD"], AllowedHeaders: ["*"], ExposeHeaders: ["ETag"] }] } }));
  }
});


test("copies and cuts through the original clipboard actions", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "More actions for clipboard.txt", exact: true }).click();
  await page.getByRole("menu").getByRole("button", { name: "Copy", exact: true }).click();
  await page.getByRole("button", { name: "Open folder nested", exact: true }).click();
  await (await more(page)).getByRole("menuitem", { name: "Paste", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open file clipboard.txt", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "More actions for clipboard.txt", exact: true }).click();
  await page.getByRole("menu").getByRole("button", { name: "Cut", exact: true }).click();
  await page.getByRole("toolbar", { name: "Browser context bar" }).getByRole("button", { name: "Parent folder", exact: true }).click();
  await (await more(page)).getByRole("menuitem", { name: "Paste (Move)", exact: true }).click();
  await expect(page.getByText("Moved 1 of 1 item(s).", { exact: true })).toBeVisible();
  await expect(s3.send(new HeadObjectCommand({ Bucket: E2E_BUCKET_NAME, Key: prefix + "nested/clipboard.txt" }))).rejects.toThrow();
  const current = await s3.send(new GetObjectCommand({ Bucket: E2E_BUCKET_NAME, Key: prefix + "clipboard.txt" }));
  expect(await current.Body!.transformToString()).toBe("clipboard content");
});
