import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBrowserBucketInteractions } from "./useBrowserBucketInteractions";

function createOptions() {
  return {
    bucketConfigurationEnabled: true,
    bucketManagementEnabled: true,
    clearActiveItem: vi.fn(),
    openBucketConfigurationTarget: vi.fn(),
    openCreateBucketForm: vi.fn(),
    requestDetailsDrawerTransition: vi.fn((transition: () => void) => {
      transition();
      return true;
    }),
    selectBucket: vi.fn(() => true),
    setBucketFilter: vi.fn(),
    setShowBucketMenu: vi.fn(),
  };
}

describe("useBrowserBucketInteractions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("owns bucket selection transitions and clears the active item after a change", () => {
    const options = createOptions();
    const { result } = renderHook(() => useBrowserBucketInteractions(options));

    act(() => result.current.selectBucketFromMenu("archive"));

    expect(options.setShowBucketMenu).toHaveBeenCalledWith(false);
    expect(options.requestDetailsDrawerTransition).toHaveBeenCalledOnce();
    expect(options.selectBucket).toHaveBeenCalledWith("archive");
    expect(options.clearActiveItem).toHaveBeenCalledOnce();
  });

  it("does not clear the active item when the bucket selection does not change", () => {
    const options = createOptions();
    options.selectBucket.mockReturnValue(false);
    const { result } = renderHook(() => useBrowserBucketInteractions(options));

    act(() => result.current.selectBucketFromMenu("archive"));

    expect(options.clearActiveItem).not.toHaveBeenCalled();
  });

  it("resets the bucket menu before opening create and configuration flows", () => {
    const options = createOptions();
    const { result } = renderHook(() => useBrowserBucketInteractions(options));

    act(() => result.current.openCreateBucket());
    act(() => result.current.openBucketConfiguration("  archive  "));

    expect(options.setShowBucketMenu).toHaveBeenCalledTimes(2);
    expect(options.setBucketFilter).toHaveBeenCalledTimes(2);
    expect(options.setBucketFilter).toHaveBeenNthCalledWith(1, "");
    expect(options.setBucketFilter).toHaveBeenNthCalledWith(2, "");
    expect(options.openCreateBucketForm).toHaveBeenCalledOnce();
    expect(options.openBucketConfigurationTarget).toHaveBeenCalledWith(
      "archive",
    );
  });

  it("keeps disabled bucket commands inert", () => {
    const options = createOptions();
    const { result } = renderHook(() =>
      useBrowserBucketInteractions({
        ...options,
        bucketConfigurationEnabled: false,
        bucketManagementEnabled: false,
      }),
    );

    act(() => result.current.openCreateBucket());
    act(() => result.current.openBucketConfiguration("archive"));

    expect(options.setShowBucketMenu).not.toHaveBeenCalled();
    expect(options.setBucketFilter).not.toHaveBeenCalled();
    expect(options.openCreateBucketForm).not.toHaveBeenCalled();
    expect(options.openBucketConfigurationTarget).not.toHaveBeenCalled();
  });
});
