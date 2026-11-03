import { describe, expect, it } from "vitest";

import { resolveBucketUsageLimit } from "../bucketUsageLimit";

describe("resolveBucketUsageLimit", () => {
  it("uses the bucket quota when it is the only limit", () => {
    expect(resolveBucketUsageLimit({ used: 25, bucketQuota: 100 })).toEqual({
      limit: 100,
      bucketQuota: 100,
      ownerQuota: null,
      ratio: 25,
      source: "bucket",
      ownerConstraintUnavailable: false,
    });
  });

  it("derives bucket headroom from aggregate account usage", () => {
    const result = resolveBucketUsageLimit({
      used: 100,
      ownerUsed: 800,
      ownerQuota: 1000,
      ownerSource: "account",
    });
    expect(result.limit).toBe(300);
    expect(result.bucketQuota).toBeNull();
    expect(result.ownerQuota).toBe(1000);
    expect(result.ratio).toBeCloseTo(100 / 3);
    expect(result.source).toBe("account");
    expect(result.ownerConstraintUnavailable).toBe(false);
  });

  it("uses the bucket quota when it is tighter than the account headroom", () => {
    const result = resolveBucketUsageLimit({
      used: 100,
      bucketQuota: 250,
      ownerUsed: 800,
      ownerQuota: 1000,
      ownerSource: "account",
    });
    expect(result.limit).toBe(250);
    expect(result.bucketQuota).toBe(250);
    expect(result.ownerQuota).toBe(1000);
    expect(result.source).toBe("bucket");
  });

  it("uses the account-derived ceiling when it is tighter than the bucket quota", () => {
    const result = resolveBucketUsageLimit({
      used: 100,
      bucketQuota: 500,
      ownerUsed: 800,
      ownerQuota: 1000,
      ownerSource: "account",
    });
    expect(result.limit).toBe(300);
    expect(result.bucketQuota).toBe(500);
    expect(result.ownerQuota).toBe(1000);
    expect(result.source).toBe("account");
  });

  it("reports 100 percent when the owner quota is already exhausted", () => {
    const result = resolveBucketUsageLimit({
      used: 100,
      ownerUsed: 1200,
      ownerQuota: 1000,
      ownerSource: "account",
    });
    expect(result.limit).toBe(100);
    expect(result.bucketQuota).toBeNull();
    expect(result.ownerQuota).toBe(1000);
    expect(result.ratio).toBe(100);
    expect(result.source).toBe("account");
  });

  it("returns no limit when no quota exists", () => {
    expect(resolveBucketUsageLimit({ used: 100 })).toEqual({
      limit: null,
      bucketQuota: null,
      ownerQuota: null,
      ratio: null,
      source: null,
      ownerConstraintUnavailable: false,
    });
  });

  it("falls back to the bucket quota when owner usage is unavailable", () => {
    expect(resolveBucketUsageLimit({
      used: 100,
      bucketQuota: 500,
      ownerQuota: 300,
      ownerSource: "account",
    })).toEqual({
      limit: 500,
      bucketQuota: 500,
      ownerQuota: 300,
      ratio: 20,
      source: "bucket",
      ownerConstraintUnavailable: true,
    });
  });

  it("does not treat the raw owner quota as a bucket limit when aggregate usage is unavailable", () => {
    expect(resolveBucketUsageLimit({
      used: 100,
      ownerQuota: 300,
      ownerSource: "account",
    })).toEqual({
      limit: null,
      bucketQuota: null,
      ownerQuota: 300,
      ratio: null,
      source: null,
      ownerConstraintUnavailable: true,
    });
  });

  it("does not report owner usage as unavailable while only bucket usage is missing", () => {
    expect(resolveBucketUsageLimit({
      used: null,
      ownerUsed: 200,
      ownerQuota: 300,
      ownerSource: "account",
    })).toEqual({
      limit: null,
      bucketQuota: null,
      ownerQuota: 300,
      ratio: null,
      source: null,
      ownerConstraintUnavailable: false,
    });
  });

  it("clamps inconsistent aggregate usage to at least the bucket usage", () => {
    const result = resolveBucketUsageLimit({
      used: 100,
      ownerUsed: 50,
      ownerQuota: 500,
      ownerSource: "owner",
    });
    expect(result.limit).toBe(500);
    expect(result.bucketQuota).toBeNull();
    expect(result.ownerQuota).toBe(500);
    expect(result.ratio).toBe(20);
    expect(result.source).toBe("owner");
  });
});
