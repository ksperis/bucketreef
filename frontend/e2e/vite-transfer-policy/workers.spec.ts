/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context, page }) => {
  await context.addCookies([
    { name: "bkr_fixture", value: "ok", domain: "localhost", path: "/api" },
  ]);
  await page.goto("/");
});

test("WebKit loads Vite worker module imports with uncached contextual CSP", async ({ page }) => {
  const policy = await (
    await page.request.get("/api/browser/direct-transfer-policy?workspace=browser&context_id=conn-1")
  ).json();
  const query = new URLSearchParams({
    workspace: "browser",
    context_id: "conn-1",
    policy_id: policy.policy_id,
  });
  const workerPath = `/api/browser/direct-transfer-worker/browserDirectTransfer.worker.ts?${query}`;
  const response = await page.request.get(workerPath);

  expect(response.status()).toBe(200);
  expect(response.headers()["content-security-policy"]).toContain("worker-src 'self'");
  expect(response.headers()["content-security-policy"]).toContain(
    `connect-src ${policy.connect_sources[0]}`,
  );
  expect(response.headers()["cache-control"]).toBe("no-store, private");
  expect(response.headers()["etag"]).toBeUndefined();

  const conditional = await page.request.get(workerPath, {
    headers: {
      "If-None-Match": "*",
      "If-Modified-Since": "Mon, 01 Jan 2035 00:00:00 GMT",
    },
  });
  expect(conditional.status()).toBe(200);

  const result = await page.evaluate(async path => {
    const worker = new Worker(path, { type: "module", credentials: "same-origin" });
    return await new Promise<string>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Worker did not start")), 5_000);
      worker.onmessage = event => {
        if (event.data?.type !== "ready") return;
        window.clearTimeout(timer);
        worker.terminate();
        resolve("ready");
      };
      worker.onerror = event => {
        window.clearTimeout(timer);
        worker.terminate();
        reject(new Error(event.message || "Worker failed"));
      };
    });
  }, workerPath);
  expect(result).toBe("ready");
});
