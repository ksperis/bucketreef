import { test, expect } from "@playwright/test";

const routes = [
  "/manager/buckets", "/manager/buckets/helios-documents", "/manager/users", "/manager/groups", "/manager/roles", "/manager/iam/policies", "/manager/metrics",
  "/manager/browser?bucket=helios-documents&ctx=101", "/manager/users/backup-service/keys",
  "/admin/users", "/admin/groups", "/admin/s3-accounts", "/admin/storage-endpoints", "/admin/s3-connections", "/admin/general-settings", "/admin/authentication-settings", "/admin/portal-requests", "/admin/access-audit", "/admin/audit", "/admin/metrics", "/admin/billing", "/admin/manager-settings", "/admin/browser-settings", "/admin/portal-settings", "/admin/webhook-settings", "/admin/api-tokens", "/admin/endpoint-status", "/admin/endpoint-status/11",
  "/portal/storage-spaces", "/portal/storage-spaces/space-1", "/portal/shares", "/portal/requests", "/portal/usage", "/portal/history", "/portal/access-keys",
  "/ceph-admin/accounts", "/ceph-admin/users", "/ceph-admin/buckets", "/ceph-admin/metrics", "/ceph-admin/buckets/helios-documents",
];
test("coverage: retained screens resolve every business request", async ({ page }) => {
  test.setTimeout(120_000);
  const problems: string[] = [];
  page.on("pageerror", error => problems.push(`${page.url()}: ${error.message}`));
  for (const route of routes) {
    await page.goto(route);
    await page.getByRole("navigation", { name: "Demo profiles" }).waitFor();
    await page.waitForTimeout(350);
    const failures = await page.evaluate(() => [...window.__bucketreefDemo.failures, ...window.__bucketreefDemo.responses.filter(r => r.status >= 400).map(r => `${r.path}: HTTP ${r.status}`)]);
    problems.push(...failures.map(f => `${route}: ${f}`));
    if (!(await page.locator("main").count())) problems.push(`${route}: no workspace rendered`);
  }
  expect(problems).toEqual([]);
});
