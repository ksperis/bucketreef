/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import type { Plugin } from "vite";

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
          response.setHeader("Content-Security-Policy", csp);
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
