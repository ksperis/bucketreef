import { expect, type Page } from "@playwright/test";
export async function openDemo(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("main")).toBeVisible();
}
export async function demoApi(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(`/api${path}`, { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null };
  }, { path, method, body });
}
