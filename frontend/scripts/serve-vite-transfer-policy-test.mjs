/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
// Isolated Vite-development worker fixture. It verifies the dev-only CSP adapter
// independently from the production Nginx worker contract.
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const frontendPort = Number(process.env.CSP_VITE_E2E_PORT || 19494);
const connectSource = "https://s3.example.test";
let vite;

const backend = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname !== "/api/browser/direct-transfer-policy") {
    response.writeHead(404).end();
    return;
  }
  if (!request.headers.cookie?.includes("bkr_fixture=ok")) {
    response.writeHead(401).end();
    return;
  }
  const workspace = url.searchParams.get("workspace");
  const contextId = url.searchParams.get("context_id");
  if (workspace !== "browser" || contextId !== "conn-1") {
    response.writeHead(403).end();
    return;
  }
  const policyId = createHash("sha256")
    .update(JSON.stringify([workspace, contextId, [connectSource]]))
    .digest("hex");
  if (url.searchParams.has("policy_id") && url.searchParams.get("policy_id") !== policyId) {
    response.writeHead(403).end();
    return;
  }
  const body = JSON.stringify({
    workspace,
    context_id: contextId,
    connect_sources: [connectSource],
    policy_id: policyId,
  });
  response.writeHead(200, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store, private",
    "X-BucketReef-Transfer-CSP":
      `default-src 'none'; script-src 'self'; worker-src 'none'; connect-src ${connectSource}`,
  });
  response.end(body);
});

backend.listen(0, "127.0.0.1", () => {
  const address = backend.address();
  if (!address || typeof address === "string") throw new Error("Unable to resolve fixture backend port");
  const viteBin = resolve(root, "node_modules/vite/bin/vite.js");
  vite = spawn(
    process.execPath,
    [viteBin, "--host", "127.0.0.1", "--port", String(frontendPort), "--strictPort"],
    {
      cwd: root,
      env: {
        ...process.env,
        VITE_API_URL: "/api",
        VITE_API_PROXY_TARGET: `http://127.0.0.1:${address.port}`,
      },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  vite.on("exit", code => {
    if (code && process.exitCode == null) process.exitCode = code;
  });
});

async function cleanup() {
  if (vite && vite.exitCode === null) {
    vite.kill("SIGTERM");
    await new Promise(done => vite.once("exit", done));
  }
  await new Promise(done => backend.close(done));
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await cleanup();
    process.exit();
  });
}
