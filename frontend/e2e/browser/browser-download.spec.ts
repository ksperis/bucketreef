import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { getFileButton, openBucket, openFolder } from "../helpers/browser";

test("downloads a seeded object with the expected filename and bytes", async ({
  page,
}) => {
  await openBucket(page);
  await openFolder(page, "navigation");
  await openFolder(page, "daily");

  const objectRow = page.locator("tr").filter({
    has: getFileButton(page, "report-2026-03-08.json"),
  });
  const downloadPromise = page.waitForEvent("download");
  await objectRow
    .getByRole("button", {
      name: "Download report-2026-03-08.json",
      exact: true,
    })
    .click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe("report-2026-03-08.json");
  expect(await readFile((await download.path())!, "utf8")).toBe(
    JSON.stringify(
      {
        report: "ok",
        generated_at: "2026-03-08T07:15:00Z",
      },
      null,
      2,
    ),
  );
});
