import { expect, test } from "@playwright/test";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { getFileButton, openBucket, openFolder } from "../helpers/browser";
import {
  E2E_S3_ACCESS_KEY,
  E2E_S3_ENDPOINT,
  E2E_S3_REGION,
  E2E_S3_SECRET_KEY,
} from "../helpers/config";

test("navigates to a seeded object and exposes metadata from Details", async ({
  page,
}) => {
  await openBucket(page);
  await openFolder(page, "navigation");
  await openFolder(page, "daily");

  const objectRow = page.locator("tr").filter({
    has: getFileButton(page, "report-2026-03-08.json"),
  });
  await objectRow.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menu").getByRole("button", { name: "Properties" }).click();

  const detailsDrawer = page.getByRole("complementary", {
    name: "report-2026-03-08.json",
    exact: true,
  });
  await expect(detailsDrawer).toBeVisible();
  await expect(
    detailsDrawer.getByRole("tab", { name: "Properties" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(detailsDrawer).toContainText("Metadata");
  await expect(detailsDrawer).toContainText("Content type");
  await expect(detailsDrawer).toContainText("Storage class");
});

test("recovers when the selected bucket is deleted by another S3 client", async ({
  page,
}) => {
  const bucketName = `browser-stale-${Date.now()}`;
  const s3 = new S3Client({
    endpoint: E2E_S3_ENDPOINT,
    region: E2E_S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: E2E_S3_ACCESS_KEY,
      secretAccessKey: E2E_S3_SECRET_KEY,
    },
  });

  await s3.send(new CreateBucketCommand({ Bucket: bucketName }));
  try {
    await page.goto("/browser");
    const sidebar = page.getByTestId("browser-workspace-sidebar");
    await sidebar.getByRole("button", { name: "Refresh buckets" }).click();
    const externalBucket = sidebar.locator(
      `[data-bucket-panel-name="${bucketName}"]`,
    );
    await expect(externalBucket).toBeVisible({ timeout: 15_000 });
    await externalBucket.click();
    await expect(page.getByRole("button", { name: "Select bucket" })).toContainText(
      bucketName,
    );

    await s3.send(new DeleteBucketCommand({ Bucket: bucketName }));

    await sidebar.getByRole("button", { name: "Refresh buckets" }).click();

    await expect(page.getByRole("button", { name: "Select bucket" })).not.toContainText(
      bucketName,
    );
    await expect(externalBucket).toHaveCount(0);
    await expect(
      page.getByText("Unable to load objects for this bucket.", { exact: true }),
    ).toHaveCount(0);
  } finally {
    await s3.send(new DeleteBucketCommand({ Bucket: bucketName })).catch(() => undefined);
    s3.destroy();
  }
});
