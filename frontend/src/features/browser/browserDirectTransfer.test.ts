/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { MessageChannel as NodeMessageChannel } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserDirectFetch } from "./browserDirectTransfer";
import { isAllowedTransferUrl } from "./browserDirectTransferProtocol";
import type { DirectTransferRequest } from "./browserDirectTransferProtocol";

const policy = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../../api/browserTransferPolicy", () => ({ getBrowserTransferPolicy: policy.get }));

class FakeWorker {
  static instances: FakeWorker[] = [];
  static failures = 0;
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { preventDefault: () => void }) => void;
  onmessageerror?: () => void;
  terminated = false;
  reads = 0;
  requests: DirectTransferRequest[] = [];
  constructor(readonly url: URL) {
    FakeWorker.instances.push(this);
    queueMicrotask(() => {
      if (FakeWorker.failures-- > 0) this.onerror?.({ preventDefault() {} });
      else this.onmessage?.({ data: { type: "ready" } });
    });
  }
  terminate() { this.terminated = true; }
  postMessage({ request }: { request: DirectTransferRequest }, ports: MessagePort[]) {
    this.requests.push(request);
    const port = ports[0];
    let sent = false;
    const body = request.url.includes("denied") ? "<Error><Code>QuotaExceeded</Code></Error>" : "streamed bytes";
    port.postMessage({ type: "headers", status: request.url.includes("denied") ? 403 : 200, statusText: "", headers: [["etag", "part-etag"]], hasBody: true });
    port.onmessage = event => {
      if (event.data.type === "cancel") { port.close(); return; }
      this.reads++;
      if (sent) { port.postMessage({ type: "end" }); port.close(); }
      else {
        sent = true;
        const bytes = new TextEncoder().encode(body).buffer;
        port.postMessage({ type: "chunk", bytes }, [bytes]);
      }
    };
  }
}
const scope = { contextId: "conn-1", workspace: "browser" as const };

describe("context-bound direct transfer workers", () => {
  beforeEach(() => {
    FakeWorker.instances = []; FakeWorker.failures = 0;
    policy.get.mockReset().mockResolvedValue({ workspace: "browser", context_id: "conn-1", connect_sources: ["https://s3.example.test"], policy_id: "a".repeat(64) });
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("MessageChannel", NodeMessageChannel);
  });
  afterEach(() => {
    window.dispatchEvent(new Event("bucketreef:session-ended"));
    vi.unstubAllGlobals();
  });

  it("streams on demand and preserves CORS-visible headers", async () => {
    const response = await createBrowserDirectFetch(scope)("https://s3.example.test/object");
    expect(FakeWorker.instances[0].reads).toBe(0);
    expect(response.headers.get("ETag")).toBe("part-etag");
    expect(await response.text()).toBe("streamed bytes");
    expect(FakeWorker.instances[0].reads).toBe(2);
    expect(FakeWorker.instances[0].url.searchParams.get("context_id")).toBe("conn-1");
  });

  it("keeps one policy and worker for concurrent multipart requests", async () => {
    const directFetch = createBrowserDirectFetch(scope);
    await Promise.all([1, 2, 3].map(async part => {
      const response = await directFetch(`https://s3.example.test/part-${part}`, { method: "PUT", body: new Blob(["part"]) });
      await response.body?.cancel();
    }));
    expect(policy.get).toHaveBeenCalledOnce();
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].requests).toHaveLength(3);
  });

  it("refuses foreign destinations before dispatch", async () => {
    await expect(createBrowserDirectFetch(scope)("https://foreign.test/object")).rejects.toThrow("does not match");
    expect(FakeWorker.instances[0].requests).toHaveLength(0);
  });

  it("revalidates the policy at the next operation and isolates changed endpoints", async () => {
    const old = await createBrowserDirectFetch(scope)("https://s3.example.test/object");
    policy.get.mockResolvedValueOnce({ workspace: "browser", context_id: "conn-1", connect_sources: ["https://new.example.test"], policy_id: "b".repeat(64) });
    const next = await createBrowserDirectFetch(scope)("https://new.example.test/object");
    expect(FakeWorker.instances).toHaveLength(2);
    expect(await old.text()).toBe("streamed bytes");
    expect(await next.text()).toBe("streamed bytes");
  });

  it("retries startup once before sending any S3 request", async () => {
    FakeWorker.failures = 1;
    const result = await createBrowserDirectFetch(scope)("https://s3.example.test/object", { method: "PUT", body: new Blob() });
    await result.body?.cancel();
    expect(policy.get).toHaveBeenCalledTimes(2);
    expect(FakeWorker.instances[0].requests).toHaveLength(0);
    expect(FakeWorker.instances[1].requests).toHaveLength(1);
  });

  it("propagates cancellation while reading without replaying requests", async () => {
    const controller = new AbortController();
    const result = await createBrowserDirectFetch(scope)("https://s3.example.test/object", { signal: controller.signal });
    controller.abort();
    await expect(result.text()).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeWorker.instances[0].requests).toHaveLength(1);
    expect(policy.get).toHaveBeenCalledOnce();
  });

  it("retains S3 error bodies for the existing error parser", async () => {
    const result = await createBrowserDirectFetch(scope)("https://s3.example.test/denied");
    expect(result.status).toBe(403);
    expect(await result.text()).toContain("QuotaExceeded");
  });

  it("closes active streams and workers at logout", async () => {
    const result = await createBrowserDirectFetch(scope)("https://s3.example.test/object");
    window.dispatchEvent(new Event("bucketreef:session-ended"));
    expect(FakeWorker.instances[0].terminated).toBe(true);
    await expect(result.text()).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("S3 origin matching", () => {
  it("matches exact schemes, ports and bucket subdomains without suffix confusion", () => {
    const sources = ["https://s3.example.test:9443", "https://*.s3.example.test:9443"];
    expect(isAllowedTransferUrl("https://bucket.s3.example.test:9443/a", sources)).toBe(true);
    for (const url of ["http://bucket.s3.example.test:9443/a", "https://bucket.s3.example.test/a", "https://evil-s3.example.test:9443/a", "https://s3.example.test.evil:9443/a", "https://user:" + "secret" + "@s3.example.test:9443/a"]) {
      expect(isAllowedTransferUrl(url, sources)).toBe(false);
    }
  });
});
