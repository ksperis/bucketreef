import { describe, expect, it } from "vitest";

import {
  cloneBucketJsonValue,
  formatBucketJsonValue,
  jsonTextSignature,
  normalizeNotificationConfiguration,
  resolveFeatureVisualState,
  stableBucketJsonSignature,
} from "../bucketFeatureState";

describe("bucketFeatureState helpers", () => {
  it("clones nested JSON values without sharing mutable references", () => {
    const source = { rules: [{ id: "rule-1", enabled: true }] };
    const clone = cloneBucketJsonValue(source);

    clone.rules[0].enabled = false;

    expect(clone).toEqual({ rules: [{ id: "rule-1", enabled: false }] });
    expect(source).toEqual({ rules: [{ id: "rule-1", enabled: true }] });
  });

  it("produces stable signatures regardless of object key order", () => {
    const first = stableBucketJsonSignature({
      b: 1,
      a: { y: true, x: false },
    });
    const second = stableBucketJsonSignature({
      a: { x: false, y: true },
      b: 1,
    });
    expect(first).toBe(second);
  });

  it("formats bucket JSON values for editors", () => {
    expect(formatBucketJsonValue({ Rules: [{ ID: "rule-1" }] })).toBe(
      '{\n  "Rules": [\n    {\n      "ID": "rule-1"\n    }\n  ]\n}',
    );
  });

  it("marks invalid json signatures as invalid", () => {
    const result = jsonTextSignature("{ invalid", {});
    expect(result.valid).toBe(false);
    expect(result.signature.startsWith("__INVALID_JSON__")).toBe(true);
  });

  it("matches signatures again after draft reset to snapshot", () => {
    const snapshot = { Rules: [{ ID: "rule-1" }] };
    const firstDraft = jsonTextSignature(JSON.stringify(snapshot), snapshot);
    expect(firstDraft.signature).toBe(stableBucketJsonSignature(snapshot));

    const changedDraft = jsonTextSignature(JSON.stringify({ Rules: [{ ID: "rule-2" }] }), snapshot);
    expect(changedDraft.signature).not.toBe(stableBucketJsonSignature(snapshot));

    const resetDraft = jsonTextSignature(JSON.stringify(snapshot), snapshot);
    expect(resetDraft.signature).toBe(stableBucketJsonSignature(snapshot));
  });

  it("prioritizes visual state unsaved over configured", () => {
    expect(resolveFeatureVisualState({ configured: true, unsaved: false })).toBe("configured");
    expect(resolveFeatureVisualState({ configured: true, unsaved: true })).toBe("unsaved");
    expect(resolveFeatureVisualState({ configured: true, unsaved: true, disabled: true })).toBe("disabled");
  });

  it("treats empty notification arrays as empty configuration", () => {
    expect(normalizeNotificationConfiguration({ TopicConfigurations: [] })).toEqual({});

    const snapshot = normalizeNotificationConfiguration({});
    const draft = jsonTextSignature(
      '{ "TopicConfigurations": [] }',
      snapshot,
      normalizeNotificationConfiguration
    );

    expect(draft.signature).toBe(stableBucketJsonSignature(snapshot));
  });
});
