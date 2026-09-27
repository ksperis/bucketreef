import { test, expect } from "@playwright/test";
import { demoApi as api, openDemo as open } from "./helpers";

test("governance: users, groups, associations, endpoints and manual declarations persist", async ({ page }) => {
  await open(page, "/admin/users");
  const created = await api(page, "/admin/users", "POST", { email: "new.user@example.com", full_name: "New User", password: "discard-this", account_links: [{ account_id: 101, portal_role: "portal_user" }] });
  expect(created.status).toBe(201); expect(created.data.password).toBeUndefined();
  const id = created.data.id;
  const group = (await api(page, "/admin/groups", "POST", { name: "Demo reviewers", user_ids: [id, 3], account_links: [{ account_id: 103, portal_role: "portal_user" }] })).data;
  expect((await api(page, `/admin/users/${id}`)).data.group_details.some((g: { id: number }) => g.id === group.id)).toBe(true);
  expect((await api(page, "/admin/accounts/103")).data.group_links.some((g: { group_id: number }) => g.group_id === group.id)).toBe(true);
  await open(page, "/portal");
  expect((await api(page, "/portal/accounts")).data.some((a: { id: number }) => a.id === 103)).toBe(true);
  await open(page, "/admin/s3-connections");
  const endpoint = await api(page, "/admin/storage-endpoints", "POST", { name: "Demo test endpoint", endpoint_url: "https://local-scenario.demo.invalid" });
  expect(endpoint.status).toBe(200);
  const connection = await api(page, "/admin/s3-connections", "POST", { name: "Declared service", storage_endpoint_id: endpoint.data.id, access_key_id: "discard-identifier", secret_access_key: "discard-secret" });
  expect(connection.status).toBe(201); expect(connection.data.secret_access_key).toBeUndefined();
  expect(connection.data.access_key_id).toBe("DEMO_NOT_A_REAL_KEY");
  await api(page, `/admin/s3-connections/${connection.data.id}`, "PUT", { user_ids: [id], group_ids: [group.id], credentials: { secret_access_key: "nested-secret" } });
  await page.reload(); await expect(page.locator("main")).toBeVisible();
  const saved = (await api(page, `/admin/s3-connections/${connection.data.id}`)).data;
  expect(saved.user_details[0].id).toBe(id); expect(JSON.stringify(saved)).not.toContain("nested-secret");
  expect((await api(page, `/admin/groups/${group.id}`, "DELETE")).status).toBe(204);
  expect((await api(page, `/admin/users/${id}`, "DELETE")).status).toBe(204);
  expect((await api(page, `/admin/s3-connections/${connection.data.id}`, "DELETE")).status).toBe(204);
  expect((await api(page, `/admin/storage-endpoints/${endpoint.data.id}`, "DELETE")).status).toBe(204);
  expect(await page.evaluate(() => window.__bucketreefDemo.failures)).toEqual([]);
});

test("iam: policies, membership and fictitious keys share Ceph inventory", async ({ page }) => {
  await open(page, "/manager/users");
  const user = await api(page, "/manager/iam/users?account_id=101", "POST", { name: "demo-service", create_key: true });
  expect(user.status).toBe(200); expect(user.data.access_key.secret_access_key).toContain("DEMO-ONLY");
  const document = { Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: ["s3:GetObject"], Resource: ["arn:aws:s3:::helios-documents/*"] }] };
  const policy = (await api(page, "/manager/iam/policies?account_id=101", "POST", { name: "DemoReader", document })).data;
  expect((await api(page, "/manager/iam/users/demo-service/policies?account_id=101", "POST", { arn: policy.arn })).status).toBe(200);
  expect((await api(page, "/manager/iam/groups/applications/users?account_id=101", "POST", { name: "demo-service" })).status).toBe(200);
  expect((await api(page, "/manager/iam/users/demo-service/inline-policies/ReadOnly?account_id=101", "PUT", { document })).status).toBe(200);
  await open(page, "/ceph-admin/users");
  const rgw = (await api(page, "/ceph-admin/endpoints/11/users/101%3Ademo-service/detail")).data;
  expect(rgw.keys[0].access_key).toBe(user.data.access_key.access_key_id);
  const account = (await api(page, "/ceph-admin/endpoints/11/accounts")).data.items.find((a: { account_name: string }) => a.account_name === "Helios Retail");
  await api(page, `/ceph-admin/endpoints/11/accounts/${account.account_id}/config`, "PUT", { quota_enabled: true, quota_max_size_bytes: 700 * 1024 ** 3, max_users: 150 });
  const created = await api(page, "/ceph-admin/endpoints/11/users", "POST", { uid: "new-rgw-user", account_id: account.account_id, display_name: "Demo RGW", generate_key: true, quota_enabled: true, quota_max_size_bytes: 2 * 1024 ** 3 });
  expect(created.data.generated_key.secret_key).toContain("DEMO-ONLY"); expect(created.data.detail.quota.max_size_bytes).toBe(2 * 1024 ** 3);
  await open(page, "/manager/users");
  await expect(page.getByText("new-rgw-user", { exact: true }).first()).toBeVisible();
  expect((await api(page, "/manager/context?account_id=101")).data.quota_max_size_gb).toBe(700);
  expect((await api(page, "/manager/iam/users/demo-service/inline-policies?account_id=101")).data[0].document).toEqual(document);
  expect(await page.evaluate(() => window.__bucketreefDemo.failures)).toEqual([]);
});

test("portal: shared space, Viewer restrictions, settings, archive and removal", async ({ page }) => {
  await open(page, "/portal/storage-spaces?demoPersona=project-manager");
  const created = await api(page, "/portal/storage-spaces?account_id=101", "POST", { name: "Team review", visibility: "shared", share_scope: "restricted", initial_shares: [{ user_id: 3, role: "Viewer" }] });
  expect(created.status).toBe(201); const space = created.data;
  await api(page, `/portal/storage-spaces/${space.id}/settings?account_id=101`, "PUT", { versioning_enabled: true, lifecycle_enabled: true, version_history_retention_days: 45 });
  expect((await api(page, `/portal/storage-spaces/${space.id}/settings?account_id=101`)).data.version_history_retention_days).toBe(45);
  await open(page, "/browser?demoPersona=member");
  const bucket = (await api(page, "/browser/buckets?account_id=101")).data.items.find((b: { name: string }) => b.name === space.internal_bucket_name);
  expect(bucket.role).toBe("Viewer");
  expect((await api(page, `/browser/buckets/${bucket.name}/folders?account_id=101`, "POST", { prefix: "forbidden/" })).status).toBe(403);
  await open(page, "/portal/storage-spaces?demoPersona=project-manager");
  await api(page, `/portal/storage-spaces/${space.id}`, "PATCH", { archived: true }); // explicit context is required
  expect((await api(page, `/portal/storage-spaces/${space.id}?account_id=101`, "PATCH", { archived: true })).status).toBe(200);
  expect((await api(page, `/portal/storage-spaces/${space.id}/settings?account_id=101`, "PUT", { versioning_enabled: false })).status).toBe(403);
  await api(page, `/portal/storage-spaces/${space.id}?account_id=101`, "PATCH", { archived: false });
  expect((await api(page, `/portal/storage-spaces/${space.id}?account_id=101`, "DELETE")).status).toBe(204);
  expect(await page.evaluate(() => window.__bucketreefDemo.failures)).toEqual([]);
});

test("files: import boundaries include retained versions and rejected writes are atomic", async ({ page }) => {
  await open(page, "/manager/browser?bucket=helios-documents&ctx=101");
  const statuses = await page.evaluate(async () => {
    const upload = async (bytes: number) => {
      const data = new FormData(); data.append("key", "limits.bin"); data.append("file", new Blob([new Uint8Array(bytes)]), "limits.bin");
      return (await fetch("/api/browser/buckets/helios-documents/proxy-upload?account_id=101", { method: "POST", body: data })).status;
    };
    const results = [await upload(20 * 1024 ** 2 + 1)];
    for (let i = 0; i < 5; i++) results.push(await upload(20 * 1024 ** 2));
    results.push(await upload(1)); return results;
  });
  expect(statuses).toEqual([413, 204, 204, 204, 204, 204, 413]);
  expect((await api(page, "/browser/buckets/helios-documents/versions?account_id=101&prefix=limits.bin")).data.versions).toHaveLength(5);
  expect(await page.evaluate(() => window.__bucketreefDemo.failures)).toEqual([]);
});

test("persistence: incompatible data waits for explicit reset", async ({ page }) => {
  await open(page, "/manager");
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("bucketreef-demo", 1);
    request.onsuccess = () => { const db = request.result; const tx = db.transaction("demo", "readwrite"); const store = tx.objectStore("demo"); const read = store.get("state"); read.onsuccess = () => store.put({ ...read.result, demoDataVersion: 999 }, "state"); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
  }));
  await page.reload();
  await expect(page.getByText("Your saved data has been kept.", { exact: false })).toBeVisible();
  page.once("dialog", dialog => dialog.dismiss()); await page.getByRole("button", { name: "Reset saved demo data" }).click();
  await expect(page.getByText("Your saved data has been kept.", { exact: false })).toBeVisible();
  page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Reset saved demo data" }).click();
  await expect(page.locator("main")).toBeVisible();
});
