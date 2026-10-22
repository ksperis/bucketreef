/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import type { Plugin } from "vite";

function developmentWorkerCsp(csp: string): string {
  return csp.replace("worker-src 'none'", "worker-src 'self'");
}

function lockAuthenticatedWorkerHeaders(response: import("node:http").ServerResponse): void {
  const setHeader = response.setHeader.bind(response);
  response.setHeader = ((name: string, value: number | string | readonly string[]) => {
    const normalized = name.toLowerCase();
    if (normalized === "cache-control") {
      return setHeader("Cache-Control", "no-store, private");
    }
    if (normalized === "etag") {
      response.removeHeader("ETag");
      return response;
    }
    return setHeader(name, value);
  }) as typeof response.setHeader;
}

/** Apply the production worker authorization contract before Vite transforms it. */
export function browserTransferPolicyPlugin(apiTarget: string, apiPrefix: string): Plugin {
  return {
    name: "bucketreef-browser-transfer-policy",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        const isWorkerRoute = url.pathname === "/api/browser/direct-transfer-worker/browserDirectTransfer.worker.ts";
        const isWorkerSource = url.pathname === "/src/features/browser/browserDirectTransfer.worker.ts" && url.searchParams.has("worker_file");
        if (!isWorkerRoute && !isWorkerSource) return next();
        delete request.headers["if-none-match"];
        delete request.headers["if-modified-since"];
        response.setHeader("Cache-Control", "no-store, private");
        try {
          const policyUrl = new URL(`${apiPrefix.replace(/\/$/, "")}/browser/direct-transfer-policy`, apiTarget);
          for (const key of ["workspace", "context_id", "policy_id"]) {
            const value = url.searchParams.get(key);
            if (value != null) policyUrl.searchParams.set(key, value);
          }
          const result = await fetch(policyUrl, {
            headers: { Cookie: request.headers.cookie ?? "" }, redirect: "error",
            signal: AbortSignal.timeout(10_000),
          });
          const csp = result.headers.get("X-BucketReef-Transfer-CSP");
          if (!result.ok || !csp) {
            response.statusCode = result.ok ? 502 : result.status;
            response.end("Direct transfer worker is unavailable");
            return;
          }
          // Vite serves workers as unbundled ES modules in development. WebKit applies
          // worker-src to their same-origin module imports, so allow only those dev
          // imports while keeping the backend/production worker policy unchanged.
          response.setHeader("Content-Security-Policy", developmentWorkerCsp(csp));
          // Vite's transform middleware normally replaces these with no-cache + ETag.
          // Authenticated worker responses must never be reusable across policy changes.
          lockAuthenticatedWorkerHeaders(response);
          request.url = `/src/features/browser/browserDirectTransfer.worker.ts?${url.searchParams.toString()}`;
          next();
        } catch {
          response.statusCode = 502;
          response.end("Direct transfer policy is unavailable");
        }
      });
    },
  };
}
