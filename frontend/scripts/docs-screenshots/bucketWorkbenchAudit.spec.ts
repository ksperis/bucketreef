import { expect, test, type Page } from "@playwright/test";

import { buildBaseRules } from "./fixtures/base";
import { superAdminUser } from "./fixtures/users";
import { registerApiMocks } from "./mockApi";
import { seedUiPreferences } from "./uiPreferences";
import type { MockRule } from "./types";

const lifecycleRule = {
  ID: "rule-98aeab6f-4a6b-490a-b2a1-75bb6ac5c124",
  Status: "Enabled",
  Filter: { Prefix: "" },
  Expiration: { ExpiredObjectDeleteMarker: true },
  NoncurrentVersionExpiration: { NoncurrentDays: 90 },
  AbortIncompleteMultipartUpload: { DaysAfterInitiation: 30 },
};

function bucketWorkbenchRules(): MockRule[] {
  const baseRules = buildBaseRules().filter((rule) => rule.id !== "workspace-access");
  return [
    {
      id: "workspace-access-manager",
      path: /^\/me\/workspace-access$/,
      body: {
        admin: { available: true, context_count: 1 },
        ceph_admin: { available: true, context_count: 1 },
        storage_ops: { available: false, context_count: 0 },
        manager: { available: true, context_count: 2 },
        browser: { available: true, context_count: 2 },
        portal: { available: true, context_count: 1 },
        default_workspace: "manager",
      },
    },
    {
      id: "bucket-workbench-resources",
      method: "GET",
      path: /^\/manager\/buckets\/helios-retail-logs\/(stats|versioning|object-lock|lifecycle|encryption|notifications|logging|website|replication|policy|acl|cors|tags|public-access-block)$/,
      body: ({ url }) => {
        const resource = url.pathname.split("/").at(-1);
        switch (resource) {
          case "stats":
            return { name: "helios-retail-logs", owner: "RGW-HELIOS", used_bytes: 182554321, object_count: 1284 };
          case "versioning":
            return { status: "Enabled", enabled: true };
          case "object-lock":
            return { enabled: false, mode: null, days: null, years: null };
          case "lifecycle":
            return { rules: [lifecycleRule] };
          case "encryption":
            return { rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }] };
          case "notifications":
            return { configuration: {} };
          case "logging":
            return { enabled: true, target_bucket: "helios-retail-logs", target_prefix: "access/" };
          case "website":
            return { index_document: "index.html", error_document: "error.html", redirect_all_requests_to: null, routing_rules: [] };
          case "replication":
            return { configuration: {} };
          case "policy":
            return { policy: { Version: "2012-10-17", Statement: [] } };
          case "acl":
            return { owner: "RGW-HELIOS", grants: [] };
          case "cors":
            return { rules: [] };
          case "tags":
            return { tags: [{ key: "env", value: "prod" }] };
          case "public-access-block":
            return {
              block_public_acls: true,
              ignore_public_acls: true,
              block_public_policy: false,
              restrict_public_buckets: false,
            };
          default:
            return null;
        }
      },
    },
    {
      id: "bucket-workbench-lifecycle-save",
      method: "PUT",
      path: /^\/manager\/buckets\/helios-retail-logs\/lifecycle$/,
      body: ({ requestBodyText }) => JSON.parse(requestBodyText),
    },
    ...baseRules,
  ];
}

async function openLifecycle(page: Page, theme: "light" | "dark", width: number) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const registry = await registerApiMocks(page, bucketWorkbenchRules(), `bucket-workbench-${theme}-${width}`, superAdminUser);
  await page.setViewportSize({ width, height: 900 });
  await seedUiPreferences(page, {
    selectedWorkspace: "manager",
    selectedManagerExecutionContextId: "acc-helios",
    theme,
  });
  await page.goto("/manager/buckets/helios-retail-logs");
  await page.getByRole("tab", { name: "Properties", exact: true }).click();
  const lifecycle = page.getByTestId("bucket-feature-lifecycle");
  await expect(lifecycle).toBeVisible();
  await expect(lifecycle).toHaveAttribute("data-feature-presentation", "workbench");
  return { errors, lifecycle, registry };
}

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`Manager bucket lifecycle workbench ${theme} ${width}`, async ({ page }, testInfo) => {
      const { errors, lifecycle, registry } = await openLifecycle(page, theme, width);
      await expect(lifecycle.getByText("1 rule", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
      await expect(page.getByTestId("bucket-feature-versioning")).toHaveAttribute("data-feature-presentation", "simple");
      await expect(page.getByTestId("bucket-feature-encryption")).toHaveAttribute("data-feature-presentation", "workbench");
      await expect(page.getByTestId("bucket-feature-object-lock")).toHaveAttribute("data-feature-presentation", "simple");
      await expect(page.getByTestId("bucket-feature-tags")).toHaveAttribute("data-feature-presentation", "simple");

      const table = lifecycle.getByRole("table");
      await expect(table).toBeVisible();
      if (width >= 768) {
        const statusButton = lifecycle.getByRole("button", { name: "Enabled", exact: true });
        const deleteButton = lifecycle.getByRole("button", { name: "Delete", exact: true });
        const statusBox = await statusButton.boundingBox();
        const deleteBox = await deleteButton.boundingBox();
        expect(statusBox?.width ?? 0).toBeGreaterThan(50);
        expect(statusBox?.height ?? 100).toBeLessThanOrEqual(36);
        expect(deleteBox?.width ?? 0).toBeGreaterThan(45);
        expect(deleteBox?.height ?? 100).toBeLessThanOrEqual(36);
        await expect(table.getByRole("columnheader", { name: "Rule actions" })).toBeVisible();
        await expect(table.getByRole("columnheader", { name: "Manage" })).toBeVisible();
      } else {
        expect(await table.locator("thead").evaluate((node) => getComputedStyle(node).display)).toBe("none");
        expect(await lifecycle.getByRole("button", { name: "Delete", exact: true }).evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      }

      await lifecycle.getByRole("button", { name: "Enabled", exact: true }).click();
      const success = lifecycle.getByText("Lifecycle updated", { exact: true });
      await expect(success).toBeVisible();
      expect(await success.evaluate((node) => node.getBoundingClientRect().height)).toBeLessThanOrEqual(28);

      await page.screenshot({
        path: testInfo.outputPath(`bucket-workbench-${theme}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });

      await page.getByRole("tab", { name: "Permissions", exact: true }).click();
      for (const testId of ["bucket-feature-acl", "bucket-feature-policy", "bucket-feature-cors"]) {
        await expect(page.getByTestId(testId)).toHaveAttribute("data-feature-presentation", "workbench");
      }
      await expect(page.getByTestId("bucket-feature-block-public-access")).toHaveAttribute(
        "data-feature-presentation",
        "simple",
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
      await page.screenshot({
        path: testInfo.outputPath(`bucket-permissions-${theme}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });

      await page.getByRole("tab", { name: "Advanced", exact: true }).click();
      for (const testId of ["bucket-feature-website", "bucket-feature-replication", "bucket-feature-notifications"]) {
        await expect(page.getByTestId(testId)).toHaveAttribute("data-feature-presentation", "workbench");
      }
      await expect(page.getByTestId("bucket-feature-access-logging")).toHaveAttribute(
        "data-feature-presentation",
        "simple",
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
      await page.screenshot({
        path: testInfo.outputPath(`bucket-advanced-${theme}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
      expect(errors).toEqual([]);
      registry.assertNoUnmatched();
    });
  }
}
