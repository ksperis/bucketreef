import { test, expect, type Page } from "@playwright/test";

async function api(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(`/api${path}`, { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    const text = await response.text(); return { status: response.status, data: text ? JSON.parse(text) : null };
  }, { path, method, body });
}
async function open(page: Page, path: string) { await page.goto(path); await expect(page.locator("main")).toBeVisible(); }

test("cross-workspace: real bucket form, shared configuration, persistence and reset", async ({ page }) => {
  await open(page, "/manager/buckets");
  await page.getByRole("button", { name: "Create bucket", exact: true }).click();
  await page.getByLabel("Bucket name", { exact: true }).fill("demo-created-bucket");
  await page.getByRole("button", { name: "Create bucket", exact: true }).click();
  await expect(page.getByText("demo-created-bucket", { exact: true })).toBeVisible();
  expect((await api(page, "/manager/buckets/demo-created-bucket/versioning?account_id=101", "PUT", { enabled: true })).status).toBe(204);
  expect((await api(page, "/manager/buckets/demo-created-bucket/lifecycle?account_id=101", "PUT", { rules: [{ ID: "archive", Status: "Enabled", Filter: { Prefix: "archive/" }, Expiration: { Days: 30 } }] })).status).toBe(200);
  await open(page, "/ceph-admin/buckets");
  await expect(page.getByText("demo-created-bucket", { exact: true }).first()).toBeVisible();
  expect((await api(page, "/ceph-admin/endpoints/11/buckets/demo-created-bucket/versioning")).data.enabled).toBe(true);
  await page.reload(); await expect(page.locator("main")).toBeVisible();
  expect((await api(page, "/ceph-admin/endpoints/11/buckets/demo-created-bucket/lifecycle")).data.rules[0].ID).toBe("archive");
  page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Reset demo", exact: true }).click();
  await expect(page.getByText("demo-created-bucket", { exact: true })).toHaveCount(0);
});

test("portal-approval: request form to Admin approval to Portal collaborator", async ({ page }) => {
  await open(page, "/portal/requests?demoPersona=project-manager");
  await page.getByRole("button", { name: "Manage membership", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Demo Reviewer");
  await page.getByLabel("Email", { exact: true }).fill("reviewer@example.com");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await expect.poll(async () => (await api(page, "/portal/requests?account_id=101")).data.some((r: { payload: { target_email?: string } }) => r.payload.target_email === "reviewer@example.com")).toBe(true);
  await open(page, "/admin/portal-requests");
  const row = page.getByRole("row").filter({ hasText: "reviewer@example.com" });
  await row.getByRole("button", { name: "Approve", exact: true }).click();
  await expect.poll(async () => (await api(page, "/admin/portal-requests")).data.find((r: { payload: { target_email?: string } }) => r.payload.target_email === "reviewer@example.com").status).toBe("approved");
  await open(page, "/portal/shares?demoPersona=project-manager");
  await expect(page.getByText("reviewer@example.com", { exact: true }).first()).toBeVisible();
  const result = await api(page, "/portal/requests?account_id=101");
  expect(result.data.find((r: { payload: { target_email?: string } }) => r.payload.target_email === "reviewer@example.com").status).toBe("approved");
});

test("files: bytes, tags, versions, restore, deletion and reload", async ({ page }) => {
  await open(page, "/manager/browser?bucket=helios-documents&ctx=101");
  const upload = (text: string) => page.evaluate(async text => {
    const form = new FormData(); form.append("key", "demo-note.txt"); form.append("file", new Blob([text], { type: "text/plain" }), "demo-note.txt");
    return (await fetch("/api/browser/buckets/helios-documents/proxy-upload?account_id=101", { method: "POST", body: form })).status;
  }, text);
  expect(await upload("first version")).toBe(204); expect(await upload("second version")).toBe(204);
  expect((await api(page, "/browser/buckets/helios-documents/object-tags?account_id=101", "PUT", { key: "demo-note.txt", tags: [{ key: "project", value: "demo" }] })).status).toBe(200);
  const versions = (await api(page, "/browser/buckets/helios-documents/versions?account_id=101&prefix=demo-note.txt")).data.versions;
  expect(versions).toHaveLength(2);
  await open(page, "/portal/storage-spaces/space-1");
  expect((await api(page, "/portal/storage-spaces/space-1/objects/restore?account_id=101", "POST", { key: "demo-note.txt", version_id: versions[1].version_id })).status).toBe(200);
  await page.reload(); await expect(page.locator("main")).toBeVisible();
  expect(await page.evaluate(async () => (await fetch("/api/portal/storage-spaces/space-1/objects/download?account_id=101&key=demo-note.txt")).text())).toBe("first version");
  expect((await api(page, "/browser/buckets/helios-documents/object-tags?account_id=101&key=demo-note.txt")).data.tags[0].value).toBe("demo");
  expect((await api(page, "/browser/buckets/helios-documents/delete?account_id=101", "POST", { objects: [{ key: "demo-note.txt" }] })).data.deleted).toBe(1);
  expect((await api(page, "/browser/buckets/helios-documents/objects?account_id=101&query=demo-note.txt")).data.objects).toHaveLength(0);
  expect(await page.evaluate(() => window.__bucketreefDemo.failures)).toEqual([]);
});

test("restrictions: immutable flags, missing requests and migration deep links", async ({ page }) => {
  await open(page, "/admin/general-settings");
  const settings = (await api(page, "/admin/settings")).data;
  expect(settings.general.bucket_migration_enabled).toBe(false);
  settings.general.bucket_migration_enabled = true;
  expect((await api(page, "/admin/settings", "PUT", settings)).status).toBe(403);
  for (const path of ["/manager/migrations", "/manager/buckets/purge/stream", "/browser/buckets/helios-documents/multipart", "/portal/storage-spaces/space-1/versions/cleanup/stream"]) expect((await api(page, path, "POST", {})).status).toBe(403);
  expect((await api(page, "/uncovered-demo-contract")).status).toBe(501);
  await page.goto("/manager/migrations/new");
  await expect(page.getByText("This operation is disabled in the demo.", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => window.__bucketreefDemo.requests.some(p => p.includes("/migrations")))).toBe(false);
});
