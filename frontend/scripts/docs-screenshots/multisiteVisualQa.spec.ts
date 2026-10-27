/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { multisiteRules } from "./fixtures/multisite";
import { registerApiMocks } from "./mockApi";
import { scenarios } from "./scenarios";
import { seedUiPreferences } from "./uiPreferences";

const scenario = scenarios.find((entry) => entry.id === "workspace-ceph-admin")!;
const routes = [
  { name: "overview", path: "/ceph-admin/multisite?ep=11" },
  { name: "bucket", path: "/ceph-admin/multisite/bucket?ep=11&source_endpoint_id=11&destination_endpoint_id=12&source_zone_id=zone-a&bucket=archive&source_bucket=archive-source&tenant=team-a&source_tenant=team-a" },
  { name: "logs", path: "/ceph-admin/multisite/logs?ep=11&target_endpoint_id=11&family=bucket-index&bucket=archive-source&tenant=team-a&instance_id=source-instance&generation=9007199254740993&shard=0" },
];

for (const width of [1728, 1440, 390]) for (const theme of ["light", "dark"] as const) for (const entry of routes) {
  test(`multisite ${entry.name} ${width} ${theme}`, async ({ browser }, testInfo) => {
    test.setTimeout(45000);
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 972 }, colorScheme: theme });
    const page = await context.newPage();
    const errors: string[] = [];
    const multisiteRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("request", (request) => {
      if (request.url().includes("/multisite/")) {
        expect(request.method()).toBe("GET");
        multisiteRequests.push(request.url());
      }
    });
    const registry = await registerApiMocks(page, [...multisiteRules(), ...scenario.mockRules], testInfo.title, { ...scenario.user, ui_language: "en" });
    await seedUiPreferences(page, { ...scenario.storage, theme });
    try {
      await page.goto(entry.path);
      await expect(page.getByRole("heading", { name: "Multisite diagnostics", exact: true })).toBeVisible();
      if (width >= 1440) {
        const navigation = page.getByRole("navigation", { name: "CEPH ADMIN navigation", exact: true });
        await expect(navigation.locator(".shell-section-label")).toHaveText(["CEPH S3", "Data", "Monitoring"]);
        await expect(navigation.getByRole("link", { name: "Multisite", exact: true }).locator("svg rect")).toHaveCount(3);
      }
      await expect(page.getByRole("tab", { name: entry.name === "bucket" ? "Bucket replication" : entry.name === "logs" ? "Logs" : "Overview", exact: true }).first()).toHaveAttribute("aria-selected", "true");
      if (entry.name === "overview") {
        await expect(page.getByText("Paris", { exact: true }).first()).toBeVisible();
        const inspect = page.getByRole("button", { name: "View details", exact: true }).first();
        await inspect.click();
        await expect(page.getByRole("heading", { name: /replication flow/ })).toBeVisible();
        if (width === 390) await expect(page.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
        await page.keyboard.press("Escape");
        await expect(page.getByRole("heading", { name: /replication flow/ })).toHaveCount(0);
        await expect(inspect).toBeFocused();
      } else {
        const submit = page.getByRole("button", { name: entry.name === "bucket" ? "Read diagnostic" : "Read logs", exact: true });
        await expect(submit).toBeEnabled();
        await submit.click();
        if (entry.name === "bucket") {
          await expect(page.getByText("9007199254740993", { exact: true }).first()).toBeVisible();
          const shard = page.locator('[data-multisite-shard-open="0"]:visible').first();
          await shard.click();
          await expect(page.getByRole("heading", { name: "Shard 0 details", exact: true })).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(page.getByRole("heading", { name: "Shard 0 details", exact: true })).toHaveCount(0);
          await expect(shard).toBeFocused();
        } else {
          await expect(page.getByText('=HYPERLINK("untrusted")', { exact: true }).first()).toBeVisible();
          const next = page.getByRole("button", { name: "Next", exact: true });
          await next.click();
          await expect(page.getByText("second-entry", { exact: true }).first()).toBeVisible();
          await page.getByRole("button", { name: "Previous", exact: true }).click();
          await expect(page.getByText('=HYPERLINK("untrusted")', { exact: true }).first()).toBeVisible();
        }
      }
      await page.screenshot({ path: testInfo.outputPath("page.png"), fullPage: true, animations: "disabled" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
      expect(multisiteRequests.length).toBeGreaterThan(0);
      registry.assertNoUnmatched();
      expect(errors).toEqual([]);
      await page.reload();
      await expect(page.getByRole("heading", { name: "Multisite diagnostics", exact: true })).toBeVisible();
    } finally {
      await context.close();
    }
  });
}

test("bilog completes pages before changing generation and exports scoped safe entries", async ({ page }, testInfo) => {
  const baseRules = multisiteRules();
  const logRule = baseRules.find((rule) => rule.id === "multisite-logs")!;
  const original = logRule.body;
  logRule.body = (ctx) => {
    const result = (typeof original === "function" ? original(ctx) : original) as Record<string, unknown>;
    const data = result.data as Record<string, unknown>;
    const secondGeneration = ctx.url.searchParams.get("generation") === "9007199254740994";
    data.next_log = secondGeneration ? null : { generation: "9007199254740994", num_shards: 4 };
    if (secondGeneration) data.entries = [{ op_id: "new-gen", object: "new-generation-entry", op: "write", state: "complete" }];
    if (secondGeneration) { data.truncated = false; data.next_cursor = null; }
    return result;
  };
  const registry = await registerApiMocks(page, [...baseRules, ...scenario.mockRules], testInfo.title, { ...scenario.user, ui_language: "en" });
  await seedUiPreferences(page, scenario.storage);
  await page.goto(routes[2].path);
  await page.getByRole("button", { name: "Read logs", exact: true }).click();
  await expect(page.getByText('=HYPERLINK("untrusted")', { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next generation 9007199254740994", exact: true })).toHaveCount(0);
  const csvDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  const csv = await csvDownload;
  const csvPath = testInfo.outputPath("entries.csv");
  await csv.saveAs(csvPath);
  expect(await readFile(csvPath, "utf8")).toContain("'=HYPERLINK");
  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  const json = await jsonDownload;
  const jsonPath = testInfo.outputPath("entries.json");
  await json.saveAs(jsonPath);
  const exported = JSON.parse(await readFile(jsonPath, "utf8"));
  expect(exported.scope.generation).toBe("9007199254740993");
  expect(exported.entries).toHaveLength(1);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("second-entry", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next generation 9007199254740994", exact: true }).click();
  await expect(page.getByText("new-generation-entry", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Generation", { exact: true })).toHaveValue("9007199254740994");
  await page.getByLabel("Generation", { exact: true }).fill("9007199254740995");
  await expect(page.getByText("new-generation-entry", { exact: true })).toHaveCount(0);
  registry.assertNoUnmatched();
});

test("bucket scope changes invalidate results and discard an old in-flight diagnostic", async ({ page }, testInfo) => {
  const rules = multisiteRules();
  const registry = await registerApiMocks(page, [...rules, ...scenario.mockRules], testInfo.title, { ...scenario.user, ui_language: "en" });
  await seedUiPreferences(page, scenario.storage);
  await page.goto(routes[1].path);
  const read = page.getByRole("button", { name: "Read diagnostic", exact: true });
  await expect(read).toBeEnabled();
  await read.click();
  const oldGeneration = page.getByText("9007199254740993", { exact: true }).first();
  await expect(oldGeneration).toBeVisible();
  await page.getByLabel("Destination bucket", { exact: true }).fill("new-destination");
  await expect(page.getByText("9007199254740993", { exact: true })).toHaveCount(0);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let finished: () => void = () => {};
  const oldRequestSettled = new Promise<void>((resolve) => { finished = resolve; });
  await page.route("**/multisite/bucket/status?*", async (route) => {
    await gate;
    const body = rules.find((rule) => rule.id === "multisite-bucket")!.body;
    try { await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }); }
    finally { finished(); }
  });
  const requested = page.waitForRequest((request) => request.url().includes("/multisite/bucket/status"));
  await read.click();
  await requested;
  await page.getByLabel("Destination bucket", { exact: true }).fill("third-destination");
  release();
  await oldRequestSettled;
  await expect(page.getByText("9007199254740993", { exact: true })).toHaveCount(0);
  await expect(read).toBeEnabled();
  registry.assertNoUnmatched();
});
