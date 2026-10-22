/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import BucketConfigurationDrawer from "./BucketConfigurationDrawer";

const detailProps = vi.hoisted(() => ({ latest: null as Record<string, unknown> | null }));

vi.mock("../manager/BucketDetailPage", () => ({
  BucketDetailContent: (props: {
    bucketNameOverride?: string;
    contextIdOverride?: string | null;
    mode?: string;
    hideQuotaTab?: boolean;
    onDirtyChange?: (dirty: boolean) => void;
    onBusyChange?: (busy: boolean) => void;
  }) => {
    detailProps.latest = props as unknown as Record<string, unknown>;
    return (
      <div>
        <span>Bucket detail content</span>
        <button type="button" onClick={() => props.onDirtyChange?.(true)}>
          Mark dirty
        </button>
        <button type="button" onClick={() => props.onBusyChange?.(true)}>
          Mark busy
        </button>
      </div>
    );
  },
}));

function installMatchMedia(matches = false) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("BucketConfigurationDrawer", () => {
  beforeEach(() => {
    installMatchMedia(false);
    detailProps.latest = null;
  });

  it("uses the wide shared drawer and preserves the Storage Ops execution context", () => {
    const next = vi.fn();
    render(
      <BucketConfigurationDrawer
        bucketName="archive"
        contextId="account-1"
        mode="storage-ops"
        navigation={{ next, position: "1 / 2" }}
        onClose={vi.fn()}
      />,
    );

    const drawer = screen.getByRole("complementary", { name: "archive" });
    expect(drawer).toHaveClass("lg:w-[min(64rem,calc(100vw-24rem))]");
    expect(screen.getByRole("group", { name: "Loaded buckets" })).toHaveTextContent("1 / 2");
    expect(detailProps.latest).toEqual(
      expect.objectContaining({
        bucketNameOverride: "archive",
        contextIdOverride: "account-1",
        mode: "manager",
        hideQuotaTab: true,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Next bucket" }));
    expect(next).toHaveBeenCalledOnce();
  });

  it("guards previous/next transitions when the current bucket has unsaved settings", () => {
    const next = vi.fn();
    render(
      <BucketConfigurationDrawer
        bucketName="archive"
        mode="ceph-admin"
        navigation={{ next, position: "1 / 2" }}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Mark dirty" }));
    fireEvent.click(screen.getByRole("button", { name: "Next bucket" }));

    expect(next).not.toHaveBeenCalled();
    expect(screen.getByText(/unsaved bucket settings/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(next).toHaveBeenCalledOnce();
  });

  it("does not close while a bucket configuration operation is in progress", () => {
    const onClose = vi.fn();
    render(
      <BucketConfigurationDrawer
        bucketName="archive"
        mode="ceph-admin"
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Mark busy" }));
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
