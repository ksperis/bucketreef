import { expect, type Page } from "@playwright/test";

/** Recharts uses JavaScript animation, which screenshot animations:disable does not stop. */
export async function waitForStableDashboardDonut(page: Page) {
  const sectors = page.locator(".recharts-pie-sector path");
  await expect(sectors.first()).toBeVisible();
  let previous = "";
  let stableSamples = 0;
  await expect.poll(async () => {
    const paths = await sectors.evaluateAll((elements) => elements.map((element) => element.getAttribute("d")).join("|"));
    stableSamples = paths === previous ? stableSamples + 1 : 0;
    previous = paths;
    return stableSamples;
  }, { intervals: [100], timeout: 5000 }).toBeGreaterThanOrEqual(3);
}
