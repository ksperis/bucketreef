// Static preview with the same response headers as Cloudflare Pages. No API routes.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
const root = resolve("dist-demo");
const headers = Object.fromEntries((await readFile(`${root}/_headers`, "utf8")).split("\n").filter(line => /^\s+\S+:/.test(line)).map(line => { const at = line.indexOf(":"); return [line.slice(0, at).trim(), line.slice(at + 1).trim()]; }));
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain" };
createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (pathname.startsWith("/api/")) { response.writeHead(501, headers).end("The static demo has no API server"); return; }
    let file = resolve(root, `.${pathname}`);
    if (!file.startsWith(root + sep) && file !== root) { response.writeHead(403).end(); return; }
    if (!(await stat(file).catch(() => null))?.isFile()) file = `${root}/index.html`;
    response.writeHead(200, { ...headers, "Content-Type": types[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    response.end(await readFile(file));
  } catch { response.writeHead(500).end("Static file unavailable"); }
}).listen(4187, "127.0.0.1", () => console.log("Static demo: http://127.0.0.1:4187"));
