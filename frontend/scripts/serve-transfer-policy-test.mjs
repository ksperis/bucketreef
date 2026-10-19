/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
// Isolated production-Nginx/worker fixture. Storage and authentication are simulated;
// backend authorization itself is covered by test_browser_transfer_policy.py.
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { build } from "vite";

const root = process.cwd();
const temp = await mkdtemp(join(tmpdir(), "bucketreef-csp-test-"));
const nginxBin = process.env.E2E_NGINX_BIN || "nginx";
const frontendPort = Number(process.env.CSP_E2E_PORT || 19493);
const servers = [];
const objects = new Map();
let nginx;
const listen = server => new Promise(resolveListen => server.listen(0, "127.0.0.1", () => {
  servers.push(server); resolveListen(server.address().port);
}));
const json = (response, status, data) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(data)); };
const storage = () => createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (request.headers.cookie) { response.writeHead(500); response.end("Application cookies must not reach storage"); return; }
  response.setHeader("Access-Control-Allow-Origin", `http://localhost:${frontendPort}`);
  response.setHeader("Access-Control-Allow-Methods", "GET,PUT");
  response.setHeader("Access-Control-Allow-Headers", "content-type,x-amz-*");
  if (!url.searchParams.has("hidden-etag")) response.setHeader("Access-Control-Expose-Headers", "ETag");
  response.setHeader("ETag", '"fixture-etag"');
  if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
  if (url.pathname === "/denied") { response.writeHead(403); response.end("<Error><Code>QuotaExceeded</Code><Message>Fixture quota</Message></Error>"); return; }
  const key = `${request.socket.localPort}:${url.pathname}`;
  if (request.method === "PUT") {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    objects.set(key, Buffer.concat(chunks)); response.writeHead(200); response.end();
  } else {
    response.setHeader("Content-Type", "application/octet-stream");
    response.end(objects.get(key) ?? Buffer.from("storage fixture bytes"));
  }
});
const [storageA, storageB] = await Promise.all([listen(storage()), listen(storage())]);
let activeOrigin = `http://localhost:${storageA}`;
const backendPort = await listen(createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/api/fixture/config") {
    if (request.method === "POST") activeOrigin = url.searchParams.get("origin") || activeOrigin;
    return json(response, 200, { storageA: `http://localhost:${storageA}`, storageB: `http://localhost:${storageB}` });
  }
  if (url.pathname !== "/api/browser/direct-transfer-policy") return json(response, 404, {});
  if (!request.headers.cookie?.includes("bkr_fixture=ok")) return json(response, 401, {});
  const workspace = url.searchParams.get("workspace");
  const contextId = url.searchParams.get("context_id");
  if (!({ browser: ["conn-1", "conn-2"], manager: ["conn-1"], portal: ["1", "2"], "ceph-admin": ["ceph-admin-1"] }[workspace] ?? []).includes(contextId)) return json(response, 403, {});
  const sources = [contextId === "conn-2" || contextId === "2" ? `http://localhost:${storageB}` : activeOrigin];
  const policyId = createHash("sha256").update(JSON.stringify([workspace, contextId, sources])).digest("hex");
  if (url.searchParams.has("policy_id") && url.searchParams.get("policy_id") !== policyId) return json(response, 403, {});
  if (!url.searchParams.has("omit_csp")) response.setHeader("X-BucketReef-Transfer-CSP", `default-src 'none'; script-src 'self'; worker-src 'none'; connect-src ${sources.join(" ")}`);
  response.setHeader("Cache-Control", "no-store");
  return json(response, 200, { workspace, context_id: contextId, connect_sources: sources, policy_id: policyId });
}));

try {
  const entry = join(temp, "entry.ts");
  await writeFile(entry, `export {createBrowserDirectFetch} from ${JSON.stringify(resolve(root, "src/features/browser/browserDirectTransfer.ts"))};
import workerSource from ${JSON.stringify(resolve(root, "src/features/browser/browserDirectTransfer.worker.ts") + "?worker&url")};
export function browserTransferWorkerUrl() {
  const url = new URL(workerSource, location.origin);
  url.pathname = '/api/browser/direct-transfer-worker/' + url.pathname.split('/').at(-1);
  return url;
}\n`);
  const dist = join(temp, "dist");
  await build({ configFile: false, root, logLevel: "warn", build: { outDir: dist, lib: { entry, formats: ["es"], fileName: () => "transport.js" } } });
  await writeFile(join(dist, "entry.js"), "import * as transport from '/transport.js'; window.cspTransport = transport;");
  await writeFile(join(dist, "index.html"), '<!doctype html><title>BucketReef CSP integration</title><script type="module" src="/entry.js"></script>');
  await mkdir(join(temp, "logs"));
  let config = await readFile(join(root, "nginx.conf.template"), "utf8");
  config = config.replaceAll("${CSP_CONNECT_SRC}", "'self'")
    .replaceAll("${BACKEND_UPSTREAM}", `127.0.0.1:${backendPort}`)
    .replaceAll("${BROWSER_PROXY_UPLOAD_MAX_BODY_SIZE}", "5g")
    .replace("listen 8080;", `listen ${frontendPort};`)
    .replace("/usr/share/nginx/html", dist)
    .replaceAll("/etc/nginx/bucketreef-security-headers.conf", join(root, "security-headers.conf"))
    .replace("include /etc/nginx/mime.types;", "types { text/javascript js; text/html html; }")
    .replaceAll("/tmp/nginx.pid", join(temp, "nginx.pid"))
    .replace(/\/tmp\/(client|proxy|fastcgi|uwsgi|scgi)_temp/g, (_, kind) => join(temp, `${kind}_temp`));
  const configPath = join(temp, "nginx.conf");
  await writeFile(configPath, config);
  const info = spawnSync(nginxBin, ["-V"], { encoding: "utf8" });
  if (!info.stderr?.includes("--with-http_auth_request_module")) throw new Error("Test requires Nginx with http_auth_request_module");
  const check = spawnSync(nginxBin, ["-t", "-p", `${temp}/`, "-c", configPath], { encoding: "utf8" });
  if (check.status !== 0) throw new Error(check.stderr);
  nginx = spawn(nginxBin, ["-p", `${temp}/`, "-c", configPath, "-g", "daemon off;"], { stdio: ["ignore", "ignore", "inherit"] });
  nginx.on("exit", code => { if (code) process.exitCode = code; });
  console.log(`CSP fixture ready at http://localhost:${frontendPort}`);
} catch (error) {
  console.error(error); await cleanup(); process.exit(1);
}

async function cleanup() {
  if (nginx && nginx.exitCode === null) {
    nginx.kill("SIGTERM");
    await new Promise(done => nginx.once("exit", done));
  }
  await Promise.all(servers.map(server => new Promise(done => { server.closeAllConnections(); server.close(done); })));
  await rm(temp, { recursive: true, force: true });
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { await cleanup(); process.exit(0); });
