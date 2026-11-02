import { describe, expect, it } from "vitest";

import {
  buildBucketPropertySummary,
  type BucketPropertySummaryInput,
} from "../bucketPropertySummary";

const text = (message: string) => message;

function baseInput(): BucketPropertySummaryInput {
  return {
    accessLogging: { configured: false, loading: false, hasError: false },
    bucketAvailable: true,
    cors: { configured: false, loading: false, hasError: false },
    encryption: { configured: false, loading: false, hasError: false },
    lifecycle: { configured: false, loading: false, hasError: false },
    notifications: { configured: false, loading: false, hasError: false },
    notificationsEnabled: true,
    objectLock: { configured: false, loading: false, hasError: false },
    policy: { configured: false, loading: false, hasError: false },
    publicAccess: { blocked: false, partial: false, loading: false, hasError: false },
    quota: { configured: false, enabled: true },
    replication: {
      configured: false,
      loading: false,
      hasError: false,
      enabled: true,
      endpointSupported: true,
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

function byLabel(input: BucketPropertySummaryInput) {
  return Object.fromEntries(
    buildBucketPropertySummary(input, text).map((item) => [item.label, item]),
  );
}

describe("buildBucketPropertySummary", () => {
  it("preserves feature states and suspended versioning semantics", () => {
    const input = baseInput();
    input.objectLock.configured = true;
    input.publicAccess.partial = true;
    input.lifecycle.configured = true;
    input.policy.configured = true;
    input.encryption.configured = true;

    const summary = byLabel(input);

    expect(summary.Versioning).toMatchObject({ state: "Suspended", tone: "unknown" });
    expect(summary["Object Lock"]).toMatchObject({ state: "Enabled", tone: "active" });
    expect(summary["Block public access"]).toMatchObject({ state: "Partial", tone: "active" });
    expect(summary["Lifecycle rules"]).toMatchObject({ state: "Enabled", tone: "active" });
    expect(summary["Bucket policy"]).toMatchObject({ state: "Configured", tone: "active" });
    expect(summary["Server-side encryption"]).toMatchObject({ state: "Enabled", tone: "active" });
  });

  it("reports loading and unavailable states without treating them as inactive", () => {
    const input = baseInput();
    input.objectLock.loading = true;
    input.policy.hasError = true;
    input.replication.endpointSupported = false;

    const summary = byLabel(input);

    expect(summary["Object Lock"]).toMatchObject({ state: "Loading...", tone: "unknown" });
    expect(summary["Bucket policy"]).toMatchObject({ state: "Unavailable", tone: "unknown" });
    expect(summary.Replication).toMatchObject({ state: "Unavailable", tone: "unknown" });
  });

  it("omits endpoint features that are disabled by the surface contract", () => {
    const input = baseInput();
    input.staticWebsite.enabled = false;
    input.quota.enabled = false;
    input.serverSideEncryptionEnabled = false;
    input.notificationsEnabled = false;
    input.replication.enabled = false;

    const summary = byLabel(input);

    expect(summary["Static website"]).toBeUndefined();
    expect(summary.Quota).toBeUndefined();
    expect(summary["Server-side encryption"]).toBeUndefined();
    expect(summary.Notifications).toBeUndefined();
    expect(summary.Replication).toBeUndefined();
    expect(summary["Access logging"]).toBeDefined();
  });

  it("keeps quota unknown until bucket metadata is available", () => {
    const input = baseInput();
    input.bucketAvailable = false;

    expect(byLabel(input).Quota).toMatchObject({ state: "Unknown", tone: "unknown" });
  });
});
