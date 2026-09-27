import assert from "node:assert/strict";
import { test } from "node:test";
import { assertDeploymentOrder } from "./deploy-demo.mjs";
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
