import { describe, expect, it } from "vitest";

import {
  buildBucketOverviewSummary,
  type BucketOverviewSummaryInput,
} from "../bucketOverviewSummary";

const text = (message: string) => message;

function baseInput(): BucketOverviewSummaryInput {
  return {
    accessLogging: { configured: false, loading: false, hasError: false },
    cors: { configured: false, loading: false, hasError: false },
    encryption: { configured: false, loading: false, hasError: false },
    lifecycle: { configured: false, loading: false, hasError: false, count: 0 },
    notifications: { configured: false, loading: false, hasError: false, count: 0 },
    notificationsEnabled: true,
    objectLock: { configured: false, loading: false, hasError: false },
    policy: { configured: false, loading: false, hasError: false },
    publicAccess: { blocked: false, partial: false, loading: false, hasError: false },
    replication: {
      configured: false,
      loading: false,
      hasError: false,
      count: 0,
      enabled: true,
    },
    serverSideEncryptionEnabled: true,
    staticWebsite: {
      configured: false,
      loading: false,
      hasError: false,
      enabled: true,
    },
    versioning: {
      enabled: false,
      loading: false,
      hasError: false,
      status: "Suspended",
    },
  };
}

function byLabel(input: BucketOverviewSummaryInput) {
  const summary = buildBucketOverviewSummary(input, text);
  return Object.fromEntries(
    [...summary.dataProtection, ...summary.accessExposure, ...summary.dataManagement]
      .map((item) => [item.label, item.value]),
  );
}

describe("buildBucketOverviewSummary", () => {
  it("uses stable feature identifiers independently from translated labels", () => {
    const summary = buildBucketOverviewSummary(baseInput(), (message) => `translated:${message}`);

    expect(summary.dataProtection.map((item) => item.id)).toEqual([
      "versioning",
      "object-lock",
      "server-side-encryption",
      "replication",
    ]);
    expect(summary.accessExposure.map((item) => item.id)).toEqual([
      "public-access-block",
      "bucket-policy",
      "cors",
      "static-website",
    ]);
    expect(summary.dataManagement.map((item) => item.id)).toEqual([
      "lifecycle",
      "access-logging",
      "notifications",
    ]);
  });

  it("preserves detailed feature states and configured counts", () => {
    const input = baseInput();
    input.objectLock.configured = true;
    input.publicAccess.partial = true;
    input.lifecycle = { configured: true, loading: false, hasError: false, count: 2 };
    input.policy.configured = true;
    input.encryption.configured = true;
    input.replication = { configured: true, loading: false, hasError: false, count: 1, enabled: true };
    input.notifications = { configured: true, loading: false, hasError: false, count: 3 };

    const summary = byLabel(input);

    expect(summary.Versioning).toBe("Suspended");
    expect(summary["Object Lock"]).toBe("Enabled");
    expect(summary["Block public access"]).toBe("Partially blocked");
    expect(summary.Lifecycle).toBe("2 rules");
    expect(summary["Bucket policy"]).toBe("Configured");
    expect(summary["Server-side encryption"]).toBe("Configured");
    expect(summary.Replication).toBe("1 rule");
    expect(summary.Notifications).toBe("3 notifications");
  });

  it("builds a compact list containing only active or attention-worthy features", () => {
    const input = baseInput();
    input.versioning = { enabled: true, loading: false, hasError: false, status: "Enabled" };
    input.objectLock.configured = true;
    input.publicAccess.partial = true;
    input.lifecycle = { configured: true, loading: false, hasError: false, count: 2 };
    input.replication = { configured: true, loading: false, hasError: false, count: 1, enabled: true };
    input.notifications = { configured: true, loading: false, hasError: false, count: 3 };

    const summary = buildBucketOverviewSummary(input, text);

    expect(summary.activeFeatures).toEqual([
      { label: "Versioning", state: "active" },
      { label: "Object Lock", state: "active" },
      { label: "Replication", detail: "1 rule", state: "active" },
      { label: "Public access partially blocked", state: "warning" },
      { label: "Lifecycle", detail: "2 rules", state: "active" },
      { label: "Notifications", detail: "3 notifications", state: "active" },
    ]);
  });

  it("keeps the active-feature summary in loading state until visible feature states settle", () => {
    const input = baseInput();
    input.policy.loading = true;

    expect(buildBucketOverviewSummary(input, text).loadingFeatures).toBe(true);

    input.policy.loading = false;
    expect(buildBucketOverviewSummary(input, text).loadingFeatures).toBe(false);
  });

  it("keeps open public access attention-worthy when every configurable feature is inactive", () => {
    const summary = buildBucketOverviewSummary(baseInput(), text);

    expect(summary.activeFeatures).toEqual([
      { label: "Public access not blocked", state: "warning" },
    ]);
    expect(summary.loadingFeatures).toBe(false);
  });

  it("reports loading and unavailable states independently from unconfigured features", () => {
    const input = baseInput();
    input.objectLock.loading = true;
    input.policy.hasError = true;
    input.notifications.hasError = true;

    const summary = byLabel(input);

    expect(summary["Object Lock"]).toBe("Loading...");
    expect(summary["Bucket policy"]).toBe("Unavailable");
    expect(summary.Notifications).toBe("Unavailable");
    expect(summary.CORS).toBe("Not configured");
  });

  it("omits endpoint features that are disabled by the surface contract", () => {
    const input = baseInput();
    input.staticWebsite.enabled = false;
    input.serverSideEncryptionEnabled = false;
    input.notificationsEnabled = false;
    input.replication.enabled = false;

    const summary = byLabel(input);

    expect(summary["Static website"]).toBeUndefined();
    expect(summary["Server-side encryption"]).toBeUndefined();
    expect(summary.Notifications).toBeUndefined();
    expect(summary.Replication).toBeUndefined();
    expect(summary["Access logging"]).toBe("Disabled");
  });

  it("distinguishes fully blocked, partially blocked, and open public-access blocking", () => {
    const input = baseInput();
    let summary = buildBucketOverviewSummary(input, text);
    expect(summary.accessExposure.find((item) => item.id === "public-access-block")).toMatchObject({
      value: "Not blocked",
      state: "warning",
    });

    input.publicAccess.partial = true;
    summary = buildBucketOverviewSummary(input, text);
    expect(summary.accessExposure.find((item) => item.id === "public-access-block")).toMatchObject({
      value: "Partially blocked",
      state: "warning",
    });

    input.publicAccess.partial = false;
    input.publicAccess.blocked = true;
    summary = buildBucketOverviewSummary(input, text);
    expect(summary.accessExposure.find((item) => item.id === "public-access-block")).toMatchObject({
      value: "Blocked",
      state: "active",
    });
  });
});
