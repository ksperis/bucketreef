/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context, page, baseURL }) => {
  await context.addCookies([
    { name: "bkr_fixture", value: "ok", domain: "localhost", path: "/api" },
    { name: "bkr_storage_cookie_probe", value: "must-not-reach-storage", url: baseURL! },
  ]);
  await page.goto("/");
  await page.waitForFunction(() => "cspTransport" in window);
  await page.request.post("/api/fixture/config", { params: { origin: (await (await page.request.get("/api/fixture/config")).json()).storageA } });
});

for (const [workspace, contextId] of [["browser", "conn-1"], ["manager", "conn-1"], ["ceph-admin", "ceph-admin-1"], ["portal", "1"]]) {
  test(`${workspace}: direct PUT, streaming GET and multipart ETags through production CSP`, async ({ page }) => {
    const { storageA } = await (await page.request.get("/api/fixture/config")).json();
    const result = await page.evaluate(async ({ workspace, contextId, storageA }) => {
      const transport = (window as any).cspTransport;
      const direct = transport.createBrowserDirectFetch({ workspace, contextId });
      const body = new Blob([new Uint8Array(26 * 1024 * 1024).fill(42)]);
      const upload = await direct(`${storageA}/large`, { method: "PUT", body });
      const response = await direct(`${storageA}/large`);
      const reader = response.body.getReader();
      let size = 0; let intact = true;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; intact &&= value.every((byte: number) => byte === 42);
      }
      const etags = await Promise.all([1, 2, 3, 4].map(async part => {
        const result = await direct(`${storageA}/part-${part}`, { method: "PUT", body: body.slice(0, 8 * 1024 * 1024) });
        return result.headers.get("ETag");
      }));
      const pageBlocked = await fetch(`${storageA}/large`).then(() => false, () => true);
      return { upload: upload.status, size, intact, etags, pageBlocked };
    }, { workspace, contextId, storageA });
    expect(result).toEqual({ upload: 200, size: 26 * 1024 * 1024, intact: true, etags: Array(4).fill('"fixture-etag"'), pageBlocked: true });
  });
}

test("worker response has a single CSP and cannot be loaded without authorization", async ({ page, playwright, baseURL }) => {
  const asset = await page.evaluate(() => (window as any).cspTransport.browserTransferWorkerUrl().pathname);
  const policy = await (await page.request.get("/api/browser/direct-transfer-policy?workspace=portal&context_id=1")).json();
  const query = new URLSearchParams({ workspace: "portal", context_id: "1", policy_id: policy.policy_id });
  const result = await page.request.get(`${asset}?${query}`);
  expect(result.status()).toBe(200);
  expect(result.headersArray().filter(header => header.name.toLowerCase() === "content-security-policy")).toHaveLength(1);
  expect(result.headers()["content-security-policy"]).toContain("worker-src 'none'");
  expect(result.headers()["content-security-policy"]).toContain(`connect-src ${policy.connect_sources[0]}`);
  expect(result.headers()["cache-control"]).toContain("no-store");
  expect(result.headers()["etag"]).toBeUndefined();
  const conditional = await page.request.get(`${asset}?${query}`, { headers: { "If-None-Match": "*", "If-Modified-Since": "Mon, 01 Jan 2035 00:00:00 GMT" } });
  expect(conditional.status()).toBe(200);
  const missingPolicy = await page.request.get(`${asset}?${query}&omit_csp=1`);
  expect(missingPolicy.status()).toBe(404);
  expect(missingPolicy.headers()["content-security-policy"]).toContain("connect-src 'none'");
  const anonymous = await playwright.request.newContext({ baseURL });
  expect((await anonymous.get(`${asset}?${query}`)).status()).toBe(401);
  expect((await page.request.get(`${asset}?workspace=portal&context_id=999`)).status()).toBe(403);
  await anonymous.dispose();
});

test("endpoint changes and cross-context copies preserve the page and isolate destinations", async ({ page }) => {
  const config = await (await page.request.get("/api/fixture/config")).json();
  const result = await page.evaluate(async ({ storageA, storageB }) => {
    const transport = (window as any).cspTransport;
    const source = transport.createBrowserDirectFetch({ workspace: "browser", contextId: "conn-1" });
    const destination = transport.createBrowserDirectFetch({ workspace: "browser", contextId: "conn-2" });
    const response = await source(`${storageA}/source`);
    await destination(`${storageB}/copied`, { method: "PUT", body: await response.blob() });
    const copied = await (await destination(`${storageB}/copied`)).text();
    const blocked = await source(`${storageB}/forbidden`).then(() => false, () => true);
    await fetch(`/api/fixture/config?origin=${encodeURIComponent(storageB)}`, { method: "POST" });
    const changed = transport.createBrowserDirectFetch({ workspace: "browser", contextId: "conn-1" });
    const updated = await (await changed(`${storageB}/new-endpoint`)).text();
    return { copied, blocked, updated };
  }, config);
  expect(result).toEqual({ copied: "storage fixture bytes", blocked: true, updated: "storage fixture bytes" });
  expect(page.url()).toMatch(/\/$/);
});

test("authoritative CSP blocks forged worker destinations even if message validation is bypassed", async ({ page }) => {
  const { storageB } = await (await page.request.get("/api/fixture/config")).json();
  const result = await page.evaluate(async storageB => {
    const policy = await (await fetch("/api/browser/direct-transfer-policy?workspace=browser&context_id=conn-1")).json();
    const url = (window as any).cspTransport.browserTransferWorkerUrl();
    url.search = new URLSearchParams({ workspace: "browser", context_id: "conn-1", policy_id: policy.policy_id }).toString();
    const worker = new Worker(url, { type: "module" });
    return await new Promise(resolve => {
      worker.onmessage = () => {
        const channel = new MessageChannel();
        channel.port1.onmessage = event => { worker.terminate(); resolve(event.data.type); };
        worker.postMessage({ request: { url: `${storageB}/foreign`, method: "PUT", headers: [], body: new Blob(["forbidden"]) }, sources: [storageB] }, [channel.port2]);
      };
    });
  }, storageB);
  expect(result).toBe("error");
});

test("S3 errors and CORS-hidden ETags survive the transport", async ({ page }) => {
  const { storageA } = await (await page.request.get("/api/fixture/config")).json();
  const result = await page.evaluate(async origin => {
    const direct = (window as any).cspTransport.createBrowserDirectFetch({ workspace: "portal", contextId: "1" });
    const denied = await direct(`${origin}/denied`);
    const part = await direct(`${origin}/hidden?hidden-etag=1`, { method: "PUT", body: new Blob(["part"]) });
    const controller = new AbortController();
    const stream = await direct(`${origin}/stream`, { signal: controller.signal });
    controller.abort();
    const cancelled = await stream.text().then(value => `resolved:${value}`, (error: Error) => `${error.name}:${error.message}`);
    return { status: denied.status, error: await denied.text(), etag: part.headers.get("etag"), cancelled };
  }, storageA);
  expect(result.status).toBe(403);
  expect(result.error).toContain("QuotaExceeded");
  expect(result.etag).toBeNull();
  expect(result.cancelled).toMatch(/^AbortError:/);
});
