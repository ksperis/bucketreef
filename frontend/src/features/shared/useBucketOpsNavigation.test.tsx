/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CephAdminBucket } from "../../api/cephAdminBuckets";
import { useBucketOpsNavigation } from "./useBucketOpsNavigation";

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return {
    ...actual,
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

  it("opens Storage Ops configuration in local drawer state", () => {
    const { result } = renderHook(() =>
      useBucketOpsNavigation({
        items: [storageBucket],
        mode: "storage-ops",
        selectedEndpointId: 1,
      }),
    );

    act(() => result.current.openBucketConfiguration(storageBucket));

    expect(result.current.configurationTarget).toEqual({
      bucketName: "bucket-a",
      contextId: "account-1",
    });
    expect(result.current.configurationNavigation?.position).toBe("1 / 1");
    expect(routerMocks.navigate).not.toHaveBeenCalled();
  });

  it("opens Ceph Admin configuration without routing", () => {
    const cephBucket: CephAdminBucket = { name: "bucket-a" };
    const { result } = renderHook(() =>
      useBucketOpsNavigation({
        items: [cephBucket],
        mode: "ceph-admin",
        selectedEndpointId: 7,
      }),
    );

    act(() => result.current.openBucketConfiguration(cephBucket));

    expect(result.current.configurationTarget).toEqual({
      bucketName: "bucket-a",
      contextId: null,
    });
    expect(routerMocks.navigate).not.toHaveBeenCalled();
  });

  it("navigates within loaded bucket order using local state", () => {
    const items = [storageBucket, storageBucketOtherContext, storageBucketNext];
    const { result } = renderHook(() =>
      useBucketOpsNavigation({
        items,
        mode: "storage-ops",
        selectedEndpointId: 1,
      }),
    );

    act(() => result.current.openBucketConfiguration(storageBucketOtherContext));
    expect(result.current.configurationTarget).toEqual({
      bucketName: "bucket-a",
      contextId: "account-2",
    });
    expect(result.current.configurationNavigation?.position).toBe("2 / 3");

    act(() => result.current.configurationNavigation?.next?.());
    expect(result.current.configurationTarget).toEqual({
      bucketName: "bucket-b",
      contextId: "account-2",
    });
    expect(result.current.configurationNavigation?.position).toBe("3 / 3");
    expect(routerMocks.navigate).not.toHaveBeenCalled();
  });

  it("closes the drawer without routing", () => {
    const { result } = renderHook(() =>
      useBucketOpsNavigation({
        items: [storageBucket],
        mode: "storage-ops",
        selectedEndpointId: 1,
      }),
    );

    act(() => result.current.openBucketConfiguration(storageBucket));
    act(() => result.current.closeBucketConfiguration());

    expect(result.current.configurationTarget).toBeNull();
    expect(routerMocks.navigate).not.toHaveBeenCalled();
  });
});
