import { describe, expect, it } from "vitest";
import { historyDraft, mergeSpaceHistory } from "./storageSpaceSettingsForm";

const current = { versioning_enabled: true, lifecycle_enabled: true, version_history_retention_days: 90, versioning_status: "Enabled" as const, can_update: true };

describe("Storage Space history updates", () => {
  it("preserves unrelated latest changes and identifies each conflicting field", () => {
    const baseline = historyDraft(current);
    expect(mergeSpaceHistory(baseline, { ...baseline, version_history_retention_days: "30" }, { ...current, versioning_enabled: false })).toEqual({
      conflicts: [], payload: { versioning_enabled: false, lifecycle_enabled: true, version_history_retention_days: 30 },
    });
    expect(mergeSpaceHistory(baseline, { ...baseline, version_history_retention_days: "30" }, { ...current, version_history_retention_days: 60 }).conflicts)
      .toEqual(["version_history_retention_days"]);
  });

  it("sends a valid existing duration when cleanup is disabled, without saving a dormant number", () => {
    const baseline = historyDraft(current);
    expect(mergeSpaceHistory(baseline, { ...baseline, lifecycle_enabled: false, version_history_retention_days: "" }, current)).toEqual({
      conflicts: [], payload: { versioning_enabled: true, lifecycle_enabled: false, version_history_retention_days: 90 },
    });
  });
});
