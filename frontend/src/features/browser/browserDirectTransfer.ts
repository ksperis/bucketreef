/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import workerUrl from "./browserDirectTransfer.worker.ts?worker&url";
import { getBrowserTransferPolicy, type BrowserTransferScope, type BrowserTransferPolicy } from "../../api/browserTransferPolicy";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import type { S3ExecutionContextSelector } from "../../api/accountParams";
import { SESSION_ENDED_EVENT, isSessionEndedStorageEvent } from "../../auth/sessionEvents";
import { isAllowedTransferUrl, type DirectTransferRequest, type DirectTransferResponse } from "./browserDirectTransferProtocol";

export type BrowserDirectFetch = (url: string, init?: RequestInit) => Promise<Response>;
type Entry = {
  worker: Worker;
  policy: BrowserTransferPolicy;
  ready: Promise<void>;
  closed: boolean;
  active: Set<(error: Error) => void>;
  idle?: ReturnType<typeof setTimeout>;
  cancelStartup?: (error: Error) => void;
};
const workers = new Map<string, Entry>();
const idleTimeoutMs = 30_000;

// Chromium can turn errors from a constructed Response's stream into TypeError
// in body readers. Preserve the cancellation contract used by Browser callers.
class BrowserDirectTransferResponse extends Response {
  constructor(body: BodyInit | null, init: ResponseInit, private readonly transferSignal?: AbortSignal | null) {
    super(body, init);
  }
  private async readBody<T>(read: () => Promise<T>): Promise<T> {
    const checkAbort = () => {
      if (this.transferSignal?.aborted) throw new DOMException("Transfer cancelled", "AbortError");
    };
    try { checkAbort(); return await read(); }
    catch (error) { checkAbort(); throw error; }
  }
  override text() { return this.readBody(() => super.text()); }
  override blob() { return this.readBody(() => super.blob()); }
  override arrayBuffer() { return this.readBody(() => super.arrayBuffer()); }
  override json(): Promise<unknown> { return this.readBody(() => super.json()); }
}

export function browserTransferScope(contextId: S3ExecutionContextSelector, options?: BrowserRequestOptions): BrowserTransferScope {
  return { contextId, workspace: options?.workspaceSurface ?? (contextId?.startsWith("ceph-admin-") ? "ceph-admin" : "browser") };
}

function browserTransferWorkerUrl(): URL {
  const url = new URL(workerUrl, window.location.origin);
  if (url.origin !== window.location.origin) throw new Error("Direct transfer worker must use the application origin");
  // The HttpOnly access cookie is deliberately scoped to /api.
  url.pathname = `/api/browser/direct-transfer-worker/${url.pathname.split("/").at(-1)}`;
  return url;
}

function terminate(entry: Entry, error = new Error("Direct transfer worker closed")) {
  if (entry.closed) return;
  entry.closed = true;
  entry.cancelStartup?.(error);
  clearTimeout(entry.idle);
  entry.worker.terminate();
  for (const fail of [...entry.active]) fail(error);
  for (const [key, item] of workers) if (item === entry) workers.delete(key);
}

function idle(entry: Entry) {
  if (!entry.closed && entry.active.size === 0) {
    clearTimeout(entry.idle);
    entry.idle = setTimeout(() => terminate(entry), idleTimeoutMs);
  }
}

function clearWorkers() {
  for (const entry of [...workers.values()]) terminate(entry, new DOMException("Session ended", "AbortError"));
}
if (typeof window !== "undefined") {
  window.addEventListener(SESSION_ENDED_EVENT, clearWorkers);
  window.addEventListener("storage", event => { if (isSessionEndedStorageEvent(event)) clearWorkers(); });
}

async function acquire(scope: BrowserTransferScope): Promise<Entry> {
  // Refresh per logical transfer. Multipart parts share the resulting entry.
  for (let attempt = 0; attempt < 2; attempt++) {
    const policy = await getBrowserTransferPolicy(scope);
    const key = JSON.stringify([scope.workspace, scope.contextId ?? null, policy.policy_id]);
    let entry = workers.get(key);
    if (!entry || entry.closed) {
      const url = browserTransferWorkerUrl();
      url.searchParams.set("workspace", scope.workspace);
      if (scope.contextId != null) url.searchParams.set("context_id", String(scope.contextId));
      url.searchParams.set("policy_id", policy.policy_id);
      const worker = new Worker(url, { type: "module", credentials: "same-origin" });
      let resolveReady: () => void;
      let rejectReady: (error: Error) => void;
      const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
      entry = { worker, policy, ready, active: new Set(), closed: false };
      const current = entry;
      const timer = setTimeout(() => {
        const error = new Error("Direct transfer worker could not start");
        rejectReady(error); terminate(current, error);
      }, 10_000);
      entry.cancelStartup = error => { clearTimeout(timer); rejectReady(error); };
      worker.onmessage = event => {
        if (event.data?.type === "ready") { clearTimeout(timer); current.cancelStartup = undefined; resolveReady(); idle(current); }
      };
      worker.onerror = event => {
        event.preventDefault();
        clearTimeout(timer);
        const error = new Error("Direct transfer worker failed. Check its CSP and endpoint configuration.");
        rejectReady(error); terminate(current, error);
      };
      worker.onmessageerror = () => {
        clearTimeout(timer);
        const error = new Error("Invalid direct transfer worker response");
        rejectReady(error); terminate(current, error);
      };
      workers.set(key, entry);
    }
    try { await entry.ready; return entry; }
    catch (error) { if (attempt === 1) throw error; }
  }
  throw new Error("Direct transfer worker could not start");
}

function request(entry: Entry, url: string, init: RequestInit): Promise<Response> {
  const signal = init.signal;
  signal?.throwIfAborted();
  if (!isAllowedTransferUrl(url, entry.policy.connect_sources)) {
    return Promise.reject(new Error("The signed S3 destination does not match the current endpoint. Refresh the transfer credentials and retry."));
  }
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "PUT") return Promise.reject(new Error("Unsupported direct transfer method"));
  if (init.body != null && !(init.body instanceof Blob)) return Promise.reject(new Error("Direct uploads require a Blob or File"));
  const headers: [string, string][] = [...new Headers(init.headers).entries()];
  return new Promise<Response>((resolve, reject) => {
    const { port1, port2 } = new MessageChannel();
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let settled = false;
    let finished = false;
    let pendingPull: (() => void) | undefined;
    const finish = () => {
      if (finished) return;
      finished = true;
      entry.active.delete(fail);
      signal?.removeEventListener("abort", abort);
      port1.close();
      pendingPull?.();
      idle(entry);
    };
    const fail = (error: Error) => {
      if (finished) return;
      if (settled) streamController?.error(error); else reject(error);
      port1.postMessage({ type: "cancel" });
      finish();
    };
    const abort = () => fail(new DOMException("Transfer cancelled", "AbortError"));
    clearTimeout(entry.idle);
    entry.active.add(fail);
    signal?.addEventListener("abort", abort, { once: true });
    port1.onmessage = ({ data }: MessageEvent<DirectTransferResponse>) => {
      if (finished) return;
      if (data.type === "headers") {
        settled = true;
        const body = data.hasBody ? new ReadableStream<Uint8Array>({
          start(controller) { streamController = controller; },
          pull() {
            return new Promise<void>(done => { pendingPull = done; port1.postMessage({ type: "pull" }); });
          },
          cancel() { port1.postMessage({ type: "cancel" }); finish(); },
        }, { highWaterMark: 0 }) : null;
        resolve(new BrowserDirectTransferResponse(body, { status: data.status, statusText: data.statusText, headers: data.headers }, signal));
      } else if (data.type === "chunk") {
        streamController?.enqueue(new Uint8Array(data.bytes));
        const done = pendingPull; pendingPull = undefined; done?.();
      } else if (data.type === "end") {
        streamController?.close(); finish();
      } else if (data.type === "error") {
        const error = new Error(data.message); error.name = data.name; fail(error);
      }
    };
    port1.onmessageerror = () => fail(new Error("Invalid direct transfer message"));
    const payload: DirectTransferRequest = {
      url, method, headers, body: init.body as Blob | undefined,
    };
    try { entry.worker.postMessage({ request: payload, sources: entry.policy.connect_sources }, [port2]); }
    catch { fail(new Error("Unable to send the direct transfer request")); }
  });
}

export function createBrowserDirectFetch(scope: BrowserTransferScope): BrowserDirectFetch {
  let entry: Promise<Entry> | undefined;
  return async (url, init = {}) => {
    if (import.meta.env.MODE === "demo") {
      const target = new URL(url, window.location.origin);
      if (target.origin !== window.location.origin || !["http:", "https:", "blob:"].includes(target.protocol)) {
        throw new Error("Demo transfers must stay local");
      }
      return fetch(url, init);
    }
    init.signal?.throwIfAborted();
    entry ??= acquire(scope);
    let current = await entry;
    if (current.closed) { entry = acquire(scope); current = await entry; }
    return request(current, url, init);
  };
}
