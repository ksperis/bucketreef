import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({
  delete: vi.fn(),
  get: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
}));

vi.mock("./client", () => ({ default: clientMock }));

import {
  browserBucketDetails,
  deleteBucketPolicy,
  getBucketStats,
  putBucketPolicy,
  updateBucketQuota,
} from "./bucketDetails";

describe("bucket details api", () => {
  beforeEach(() => {
    clientMock.delete.mockReset();
    clientMock.get.mockReset();
    clientMock.patch.mockReset();
    clientMock.put.mockReset();
    clientMock.get.mockResolvedValue({ data: {} });
    clientMock.patch.mockResolvedValue({ data: undefined });
    clientMock.put.mockResolvedValue({ data: {} });
  });

  it("keeps named detail operations on the manager route", async () => {
    await getBucketStats("account-a", "reports/2026", {
      with_stats: true,
    });

    expect(clientMock.get).toHaveBeenCalledWith(
      "/manager/buckets/reports%2F2026/stats",
      { params: { with_stats: true, context_id: "account-a" } },
    );
  });

  it("exposes the browser detail route explicitly", async () => {
    await browserBucketDetails.getBucketProperties("account-7", "reports/2026");

    expect(clientMock.get).toHaveBeenCalledWith(
      "/browser/buckets/config/reports%2F2026/properties",
      { params: { context_id: "account-7" } },
    );
  });

  it("shares stats query handling across manager and browser detail routes", async () => {
    await browserBucketDetails.getBucketStats("conn-a", "reports/2026", {
      with_stats: false,
    });

    expect(clientMock.get).toHaveBeenCalledWith(
      "/browser/buckets/config/reports%2F2026/stats",
      { params: { with_stats: false, context_id: "conn-a" } },
    );
  });

  it("limits browser bucket details to inspector reads", () => {
    expect(Object.keys(browserBucketDetails).sort()).toEqual([
      "getBucketLogging",
      "getBucketPolicy",
      "getBucketProperties",
      "getBucketStats",
      "getBucketWebsite",
    ]);
  });

  it("keeps manager writes and deletes on their detail resource", async () => {
    const policy = { Version: "2012-10-17", Statement: [] };

    await putBucketPolicy("account-7", "reports/2026", policy);
    await deleteBucketPolicy("account-7", "reports/2026");

    expect(clientMock.put).toHaveBeenCalledWith(
      "/manager/buckets/reports%2F2026/policy",
      { policy },
      { params: { context_id: "account-7" } },
    );
    expect(clientMock.delete).toHaveBeenCalledWith(
      "/manager/buckets/reports%2F2026/policy",
      { params: { context_id: "account-7" } },
    );
  });

  it("patches sparse manager bucket quota updates", async () => {
    await updateBucketQuota("account-7", "reports/2026", { max_objects: 100 });

    expect(clientMock.patch).toHaveBeenCalledWith(
      "/manager/buckets/reports%2F2026/quota",
      { max_objects: 100 },
      { params: { context_id: "account-7" } },
    );
  });
});
