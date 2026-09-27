import { test, expect } from "@playwright/test";

for (const path of ["/manager", "/admin", "/portal", "/browser", "/ceph-admin"]) {
  test(`workspaces: ${path} opens as a static deep link`, async ({ page }) => {
    const errors: string[] = []; const network: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.url().includes("/api/") || (request.url().startsWith("http") && !request.url().startsWith("http://127.0.0.1:4187/"))) network.push(request.url()); });
    await page.goto(path);
    await expect(page.getByRole("navigation", { name: "Demo profiles" })).toBeVisible();
    await expect(page.locator("main")).toBeVisible();
    await expect(page.getByText("Loading...", { exact: true })).toHaveCount(0);
    await page.waitForTimeout(600);
    expect(errors).toEqual([]);
    expect(network).toEqual([]);
    expect(await page.evaluate(() => window.__bucketreefDemo.failures)).toEqual([]);
    await expect(page.locator("main")).not.toContainText("Unable to");
    await page.reload();
    await expect(page.locator("main")).toBeVisible();
  });
}
