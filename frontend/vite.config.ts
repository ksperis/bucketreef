import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const demo = mode === "demo";
  const revision = demo ? (env.CI_COMMIT_SHA || execFileSync("git", ["rev-parse", "HEAD"]).toString().trim()) : "";
  const allowedHosts = (env.VITE_ALLOWED_HOSTS || "localhost")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  const apiUrl = env.VITE_API_URL || "/api";
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || "http://localhost:8000";
  const shouldProxyApi = apiUrl.startsWith("/");

  return {
    plugins: [react(), ...(demo ? [{
      name: "bucketreef-static-demo",
      generateBundle() {
        this.emitFile({ type: "asset", fileName: "demo-release.json", source: JSON.stringify({
          version: JSON.parse(readFileSync("package.json", "utf8")).version,
          revision, pipelineId: Number(env.CI_PIPELINE_ID) || 0,
          demoDataVersion: JSON.parse(readFileSync("demo-data-version.json", "utf8")).demoDataVersion,
        }) });
        this.emitFile({ type: "asset", fileName: "_headers", source: `/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob:; media-src 'self' blob:; object-src 'none'; frame-src blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'none'\n` });
        this.emitFile({ type: "asset", fileName: "robots.txt", source: "User-agent: *\nDisallow: /\n" });
      },
    } satisfies import("vite").Plugin] : [])],
    define: {
      "import.meta.env.DEMO_REVISION": JSON.stringify(revision),
    },
    build: {
      outDir: demo ? "dist-demo" : "dist",
      manifest: true,
      chunkSizeWarningLimit: 2048,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (
              id.includes("@aws-sdk") ||
              id.includes("@smithy") ||
              id.includes("@aws-crypto") ||
              id.includes("@aws/lambda-invoke-store")
            ) {
              return "aws-sdk";
            }
            if (id.includes("recharts")) return "charts";
            if (id.includes("jszip") || id.includes("@zip.js")) return "zip";
            return "vendor";
          },
        },
      },
    },
    server: {
      host: env.VITE_DEV_HOST || true,
      port: Number(env.VITE_DEV_PORT) || 5173,
      allowedHosts,
      proxy: shouldProxyApi && !demo
        ? {
            [apiUrl]: {
              target: apiProxyTarget,
              changeOrigin: true,
              secure: false,
            },
          }
        : undefined,
    },
  };
});
