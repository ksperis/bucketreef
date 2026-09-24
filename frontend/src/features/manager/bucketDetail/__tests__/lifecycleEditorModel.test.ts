import { describe, expect, it } from "vitest";
import {
  createVisualLifecycleRule,
  readLifecycleVisualRule,
  updateLifecycleVisualRule,
  validateLifecycleVisualRules,
} from "../lifecycleEditorModel";

describe("lifecycleEditorModel", () => {
  it("keeps a newly added rule explicitly incomplete until an action is configured", () => {
    const rule = createVisualLifecycleRule("rule-1");

    expect(rule).toEqual({ ID: "rule-1", Status: "Enabled" });
    expect(validateLifecycleVisualRules([rule])).toContain("Add at least one lifecycle action");

    const withExpiration = updateLifecycleVisualRule(rule, { expirationDays: "30" });
    expect(withExpiration.Expiration).toEqual({ Days: 30 });
    expect(validateLifecycleVisualRules([withExpiration])).toBeNull();

    const withCleanup = updateLifecycleVisualRule(rule, { abortMultipartDays: "7" });
    expect(withCleanup.AbortIncompleteMultipartUpload).toEqual({ DaysAfterInitiation: 7 });
    expect(validateLifecycleVisualRules([withCleanup])).toBeNull();
  });

  it("preserves transition storage class edits made before Days and never injects a default class", () => {
    const rule = createVisualLifecycleRule("rule-1");
    expect(readLifecycleVisualRule(rule).transitionStorageClass).toBe("");

    const storageFirst = updateLifecycleVisualRule(rule, {
      transitionStorageClass: "DEEP_ARCHIVE",
    });
    expect(storageFirst.Transitions).toEqual([{ StorageClass: "DEEP_ARCHIVE" }]);
    expect(readLifecycleVisualRule(storageFirst).transitionStorageClass).toBe("DEEP_ARCHIVE");
    expect(validateLifecycleVisualRules([storageFirst])).toContain(
      "requires both Days and Storage class",
    );

    const complete = updateLifecycleVisualRule(storageFirst, { transitionDays: "45" });
    expect(complete.Transitions).toEqual([
      { Days: 45, StorageClass: "DEEP_ARCHIVE" },
    ]);
    expect(validateLifecycleVisualRules([complete])).toBeNull();
  });

  it("accepts the other supported lifecycle actions as complete rules", () => {
    const base = createVisualLifecycleRule("rule-1");
    const deleteMarker = updateLifecycleVisualRule(base, {
      expiredObjectDeleteMarker: true,
    });
    const noncurrentExpiration = updateLifecycleVisualRule(base, {
      noncurrentExpirationDays: "90",
    });
    const noncurrentTransition = updateLifecycleVisualRule(base, {
      noncurrentTransitionStorageClass: "GLACIER",
      noncurrentTransitionDays: "30",
    });

    expect(validateLifecycleVisualRules([deleteMarker])).toBeNull();
    expect(validateLifecycleVisualRules([noncurrentExpiration])).toBeNull();
    expect(validateLifecycleVisualRules([noncurrentTransition])).toBeNull();
  });

  it("keeps expired delete marker and day expiration mutually exclusive", () => {
    const base = createVisualLifecycleRule("rule-1");

    const expiration = updateLifecycleVisualRule(base, { expirationDays: "7" });
    expect(expiration.Expiration).toEqual({ Days: 7 });

    const deleteMarker = updateLifecycleVisualRule(expiration, {
      expiredObjectDeleteMarker: true,
    });
    expect(deleteMarker.Expiration).toEqual({ ExpiredObjectDeleteMarker: true });
    expect(validateLifecycleVisualRules([deleteMarker])).toBeNull();

    const invalidImportedRule = {
      ...base,
      Expiration: { Days: 7, ExpiredObjectDeleteMarker: true },
    };
    expect(validateLifecycleVisualRules([invalidImportedRule])).toContain(
      "cannot be enabled together",
    );
  });
});
