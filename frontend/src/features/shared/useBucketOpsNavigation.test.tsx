/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CephAdminBucket } from "../../api/cephAdminBuckets";
import { useBucketOpsNavigation } from "./useBucketOpsNavigation";

const routerMocks = vi.hoisted(() => ({
  location: {
    pathname: "/storage-ops/buckets",
    search: "",
  },
  navigate: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return {
    ...actual,
    useLocation: () => routerMocks.location,
    useNavigate: () => routerMocks.navigate,
  };
});

const storageBucket: CephAdminBucket = {
  name: "account-1::bucket-a",
  bucket_name: "bucket-a",
  context_id: "account-1",
};
const storageBucketOtherContext: CephAdminBucket = {
  name: "account-2::bucket-a",
  bucket_name: "bucket-a",
  context_id: "account-2",
};
const storageBucketNext: CephAdminBucket = {
  name: "account-2::bucket-b",
  bucket_name: "bucket-b",
  context_id: "account-2",
};

describe("useBucketOpsNavigation", () => {
  beforeEach(() => {
    routerMocks.location.pathname = "/storage-ops/buckets";
    routerMocks.location.search = "";
    routerMocks.navigate.mockReset();
  });

  it("navigates compatible row actions to their separate workspace", () => {
    const { result } = renderHook(() =>
      useBucketOpsNavigation({
        items: [storageBucket],
        mode: "storage-ops",
        selectedEndpointId: 1,
      }),
    );

    act(() => result.current.navigateToBucketAction("manager", storageBucket));

    expect(routerMocks.navigate).toHaveBeenCalledWith({
      pathname: "/manager/buckets/bucket-a",
      search: "?ctx=account-1",
    });
  });

  it("opens Storage Ops configuration in-place and preserves list query state", () => {
    routerMocks.location.search = "?owner=alice";
    const { result } = renderHook(() =>
      useBucketOpsNavigation({
        items: [storageBucket],
        mode: "storage-ops",
        selectedEndpointId: 1,
      }),
    );

    act(() => result.current.openBucketConfiguration(storageBucket));

    expect(routerMocks.navigate).toHaveBeenCalledWith(
      {
        pathname: "/storage-ops/buckets",
        search: "?owner=alice&configure=bucket-a&configure_ctx=account-1",
      },
      { replace: false },
    );
  });

  it("opens Ceph Admin configuration with an endpoint-qualified deep link", () => {
    routerMocks.location.pathname = "/ceph-admin/buckets";
    const cephBucket: CephAdminBucket = { name: "bucket-a" };
    const { result } = renderHook(() =>
      useBucketOpsNavigation({
        items: [cephBucket],
        mode: "ceph-admin",
        selectedEndpointId: 7,
      }),
    );

    act(() => result.current.openBucketConfiguration(cephBucket));

    expect(routerMocks.navigate).toHaveBeenCalledWith(
      {
        pathname: "/ceph-admin/buckets",
        search: "?configure=bucket-a&ep=7",
      },
      { replace: false },
    );
  });

  it("resolves a deep link by bucket and context and navigates within loaded order", () => {
    routerMocks.location.search = "?configure=bucket-a&configure_ctx=account-2";
    const items = [storageBucket, storageBucketOtherContext, storageBucketNext];
    const { result } = renderHook(() =>
      useBucketOpsNavigation({
        items,
        mode: "storage-ops",
        selectedEndpointId: 1,
      }),
    );

    expect(result.current.configurationTarget).toEqual({
      bucketName: "bucket-a",
      contextId: "account-2",
    });
    expect(result.current.configurationNavigation?.position).toBe("2 / 3");

    act(() => result.current.configurationNavigation?.next?.());
    expect(routerMocks.navigate).toHaveBeenCalledWith(
      {
        pathname: "/storage-ops/buckets",
        search: "?configure=bucket-b&configure_ctx=account-2",
      },
      { replace: true },
    );
  });

  it("closes the drawer without losing unrelated list query state", () => {
    routerMocks.location.search =
      "?owner=alice&configure=bucket-a&configure_ctx=account-1";
    const { result } = renderHook(() =>
      useBucketOpsNavigation({
        items: [storageBucket],
        mode: "storage-ops",
        selectedEndpointId: 1,
      }),
    );

    act(() => result.current.closeBucketConfiguration());

    expect(routerMocks.navigate).toHaveBeenCalledWith(
      {
        pathname: "/storage-ops/buckets",
        search: "?owner=alice",
      },
      { replace: true },
    );
  });
});
