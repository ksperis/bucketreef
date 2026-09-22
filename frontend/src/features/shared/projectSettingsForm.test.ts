import { describe, expect, it } from "vitest";
import { emptyForm, mergeProjectOverrides } from "./projectSettingsForm";

describe("project override merge", () => {
  it("preserves unrelated flags and defaults changed on the server", () => {
    const baseline = { ...emptyForm, versionHistoryRetentionDays: "90" };
    expect(
      mergeProjectOverrides(
        baseline,
        { ...baseline, browserAccess: "disabled" },
        {
          allow_portal_named_bucket_create: true,
          bucket_defaults: { versioning: true },
        },
      ),
    ).toEqual({
      browser_access_enabled: false,
      allow_portal_named_bucket_create: true,
      bucket_defaults: { versioning: true },
    });
  });
  it("treats null as inheritance and removes only overridden values edited in the draft", () => {
    const baseline = { ...emptyForm, browserAccess: "enabled" as const };
    expect(
      mergeProjectOverrides(baseline, emptyForm, {
        browser_access_enabled: true,
        allow_private_storage_space_create: null,
      }),
    ).toEqual({ allow_private_storage_space_create: null });
  });
  it("does not overwrite a numeric override changed by another administrator", () => {
    const baseline = {
      ...emptyForm,
      versionHistoryRetentionOverride: true,
      versionHistoryRetentionDays: "90",
    };
    expect(() =>
      mergeProjectOverrides(
        baseline,
        { ...baseline, versionHistoryRetentionDays: "30" },
        { bucket_defaults: { noncurrent_version_expiration_days: 60 } },
      ),
    ).toThrow("project_settings_conflict");
  });

  it("merges the Portal-user external sharing override independently", () => {
    const baseline = { ...emptyForm, externalSharing: "inherit" as const };
    expect(
      mergeProjectOverrides(
        baseline,
        { ...baseline, externalSharing: "enabled" },
        { allow_portal_user_access_key_create: false },
      ),
    ).toEqual({
      allow_portal_user_access_key_create: false,
      allow_portal_user_external_sharing: true,
    });
  });
});
