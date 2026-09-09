import { describe, expect, it } from "vitest";
import {
  mergeSettingsChanges,
  selectSettings,
  SettingsConflict,
  validateInteger,
} from "./appSettingsDraft";
import { createAppSettings } from "./settingsTestFixtures";

describe("page-owned settings merge", () => {
  it("preserves unrelated server changes, including within the same section", () => {
    const baseline = createAppSettings();
    const latest = structuredClone(baseline);
    latest.general.portal_enabled = false;
    latest.browser.proxy_download_parallelism = 9;
    latest.branding.primary_color = "#123456";
    const paths = [
      "browser.direct_upload_parallelism",
      "browser.proxy_download_parallelism",
    ] as const;
    const draft = {
      ...selectSettings(baseline, paths),
      "browser.direct_upload_parallelism": "8",
    };
    const merged = mergeSettingsChanges(baseline, latest, draft, paths);
    expect(merged.browser.direct_upload_parallelism).toBe(8);
    expect(merged.browser.proxy_download_parallelism).toBe(9);
    expect(merged.general.portal_enabled).toBe(false);
    expect(merged.branding.primary_color).toBe("#123456");
    expect(latest.browser.direct_upload_parallelism).toBe(5);
  });
  it("reports every conflicting field without mutating the server snapshot or draft", () => {
    const baseline = createAppSettings();
    const latest = structuredClone(baseline);
    latest.browser.direct_upload_parallelism = 7;
    const draft = { "browser.direct_upload_parallelism": "8" } as const;
    expect(() =>
      mergeSettingsChanges(baseline, latest, draft, [
        "browser.direct_upload_parallelism",
      ]),
    ).toThrow(SettingsConflict);
    expect(latest.browser.direct_upload_parallelism).toBe(7);
    expect(draft["browser.direct_upload_parallelism"]).toBe("8");
    expect(
      mergeSettingsChanges(
        baseline,
        latest,
        { "browser.direct_upload_parallelism": "7" },
        ["browser.direct_upload_parallelism"],
      ).browser.direct_upload_parallelism,
    ).toBe(7);
  });
  it("keeps nullable SMTP values and unrelated defaults out of the payload changes", () => {
    const baseline = createAppSettings();
    const latest = structuredClone(baseline);
    latest.quota_notifications.smtp_host = "mail.test";
    const paths = ["branding.login_logo_url"] as const;
    const merged = mergeSettingsChanges(
      baseline,
      latest,
      { "branding.login_logo_url": "" },
      paths,
    );
    expect(merged.branding.login_logo_url).toBeNull();
    expect(merged.quota_notifications.smtp_host).toBe("mail.test");
  });
  it.each(["", "1.5", "0", "21", undefined])(
    "rejects invalid bounded integers %s",
    (value) => {
      expect(validateInteger(value, "Parallelism", 1, 20)).toBeDefined();
    },
  );
});
