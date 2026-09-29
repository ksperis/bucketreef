import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const PROJECT = "bucketreef-demo";
export function assertDeploymentOrder(previous, current, bootstrap) {
  if (!/^[0-9a-f]{40}$/.test(current.revision) || !/^\d+\.\d+\.\d+$/.test(current.version) || !Number.isSafeInteger(current.pipelineId) || current.pipelineId <= 0) throw new Error("Demo artifact has invalid revision, version or pipeline metadata");
  if (!previous) { if (!bootstrap) throw new Error("Run the one-time bootstrap-demo pipeline first"); return; }
  if (bootstrap && previous.revision !== current.revision) throw new Error("The initial demo has already been published; subsequent updates require a finalized release");
  const oldVersion = previous.version.split(".").map(Number), nextVersion = current.version.split(".").map(Number);
  const difference = nextVersion.map((n, i) => n - oldVersion[i]).find(n => n !== 0) ?? 0;
  if (difference < 0 || current.pipelineId < previous.pipelineId) throw new Error("Refusing to replace the demo with an older deployment");
  if (difference === 0 && previous.revision !== current.revision) throw new Error("A different revision of this version is already deployed");
}

export function assertPublication(plan, artifact, publication, sha) {
  if (plan.sha !== sha) throw new Error("Demo orchestration differs from the pipeline revision");
  if (plan.profile === "bootstrap-demo") {
    if (artifact.revision !== sha) throw new Error("Bootstrap artifact differs from the pipeline revision");
    return;
  }
  if (!["prepare-release", "resume-release"].includes(plan.profile) || publication?.schema !== 2
    || publication.sha !== artifact.revision || publication.version !== artifact.version
    || publication.orchestration_sha !== sha) throw new Error("Demo requires matching final publication evidence");
}

async function deploy() {
  const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token, CI_COMMIT_SHA: sha } = process.env;
  if (!account || !token || !sha) throw new Error("Protected demo-production Cloudflare variables and CI revision are required");
  const plan = JSON.parse(readFileSync("ci-plan.json", "utf8"));
  const artifact = JSON.parse(readFileSync("frontend/dist-demo/demo-release.json", "utf8"));
  const bootstrap = plan.profile === "bootstrap-demo";
  const publication = bootstrap ? null : JSON.parse(readFileSync("publication.json", "utf8"));
  assertPublication(plan, artifact, publication, sha);
  if (publication) for (const [name, expected] of Object.entries(publication.demo_files)) {
    if (name.startsWith("/") || name.split("/").includes("..")) throw new Error("Unsafe demo artifact member");
    if (createHash("sha256").update(readFileSync(`frontend/dist-demo/${name}`)).digest("hex") !== expected) throw new Error("Demo file differs from its tested publication evidence");
  }
  const releaseSha = artifact.revision;
  if (process.env.CI_COMMIT_REF_PROTECTED !== "true" || process.env.CI_COMMIT_BRANCH !== "main") throw new Error("Demo publication requires protected main");
  const api = async (path, options = {}, allowMissing = false) => {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
    if (allowMissing && response.status === 404) return null;
    const data = await response.json(); if (!response.ok || !data.success) throw new Error(`Cloudflare Pages request failed (${response.status})`); return data.result;
  };
  let project = await api(`/${PROJECT}`, {}, bootstrap);
  if (!project) {
    assertDeploymentOrder(null, artifact, bootstrap);
    project = await api("", { method: "POST", body: JSON.stringify({ name: PROJECT, production_branch: "main" }) });
  }
  const current = project.canonical_deployment;
  let previous = null;
  if (current) {
    const url = new URL(current.url);
    if (!url.hostname.endsWith(`.${PROJECT}.pages.dev`)) throw new Error("Unexpected production deployment hostname");
    const response = await fetch(new URL("/demo-release.json", url), { cache: "no-store" });
    if (!response.ok) throw new Error("Cannot verify the previously deployed demo revision");
    previous = await response.json();
  }
  assertDeploymentOrder(previous, artifact, bootstrap);
  execFileSync("ops/cloudflare/node_modules/.bin/wrangler", ["pages", "deploy", "frontend/dist-demo", "--project-name", PROJECT, "--branch", "main", "--commit-hash", releaseSha, "--commit-message", `BucketReef demo ${artifact.version} · pipeline ${artifact.pipelineId}`], { stdio: "inherit" });
  const published = (await api(`/${PROJECT}`)).canonical_deployment;
  if (published?.deployment_trigger?.metadata?.commit_hash !== releaseSha) throw new Error("Cloudflare did not confirm the requested demo revision");
  writeFileSync("demo-deployment.json", JSON.stringify({ ...artifact, deploymentId: published.id, url: published.url, previousDeploymentId: current?.id ?? null }, null, 2) + "\n");
  console.log(`Demo deployment confirmed: ${published.id} (${releaseSha})`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await deploy();
