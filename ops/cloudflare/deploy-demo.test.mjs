import assert from "node:assert/strict";
import { test } from "node:test";
import { assertDeploymentOrder, assertPublication } from "./deploy-demo.mjs";
const release = { version: "0.3.0", revision: "a".repeat(40), pipelineId: 100 };
test("bootstrap is one-time; retries of the same revision are allowed", () => {
  assert.doesNotThrow(() => assertDeploymentOrder(null, release, true));
  assert.throws(() => assertDeploymentOrder(null, release, false));
  assert.doesNotThrow(() => assertDeploymentOrder(release, release, true));
  assert.throws(() => assertDeploymentOrder(release, { ...release, revision: "b".repeat(40) }, true));
});
test("older versions, older pipelines and same-version replacements cannot overwrite production", () => {
  assert.throws(() => assertDeploymentOrder(release, { ...release, version: "0.2.9", pipelineId: 101 }, false));
  assert.throws(() => assertDeploymentOrder(release, { ...release, version: "0.3.1", pipelineId: 99 }, false));
  assert.throws(() => assertDeploymentOrder(release, { ...release, revision: "b".repeat(40), pipelineId: 101 }, false));
  assert.doesNotThrow(() => assertDeploymentOrder(release, { ...release, version: "0.3.1", revision: "b".repeat(40), pipelineId: 101 }, false));
});
test("recovery deploys the published source artifact with distinct orchestration identity", () => {
  const sha = "b".repeat(40);
  const plan = { profile: "resume-release", sha };
  const proof = { schema: 2, sha: release.revision, version: release.version, orchestration_sha: sha };
  assert.doesNotThrow(() => assertPublication(plan, release, proof, sha));
  assert.throws(() => assertPublication(plan, release, null, sha));
  assert.throws(() => assertPublication(plan, { ...release, revision: sha }, proof, sha));
  assert.throws(() => assertPublication({ ...plan, profile: "qualify" }, release, proof, sha));
  assert.throws(() => assertPublication(plan, release, { ...proof, orchestration_sha: release.revision }, sha));
});
