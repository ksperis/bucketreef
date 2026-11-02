/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BrowserWorkspaceSidebar from "./BrowserWorkspaceSidebar";

describe("BrowserWorkspaceSidebar", () => {
  it("uses one compact toggle and numbers bucket shortcuts", () => {
    const { container } = render(
      <BrowserWorkspaceSidebar
        favorites={<div>Favorite locations</div>}
        compact
        variant="desktop"
        isPortalContext={false}
        rows={[
          {
            bucket: { name: "archive" },
            access: { status: "available", detail: null },
          },
          {
            bucket: { name: "reports" },
            access: { status: "available", detail: null },
          },
        ]}
        activeBucketName="reports"
        bucketFilter=""
        loadingBuckets={false}
        bucketError={null}
        bucketManagementEnabled={false}
        canLoadMore={false}
        bucketMenuLoadingMore={false}
        bucketMenuTotal={2}
        bucketTotalCount={2}
        usageSummary={null}
        usageLoading={false}
        usageError={null}
        closeMobile={vi.fn()}
        onBucketFilterChange={vi.fn()}
        onRetryBuckets={vi.fn()}
        onCreateBucket={vi.fn()}
        onSelectBucket={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );

    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Show favorites" });
    expect(toggle).toHaveClass("h-8", "w-8");
    expect(toggle.querySelector("svg")).toHaveClass(
      "h-4",
      "w-4",
      "shrink-0",
    );
    expect(screen.getByRole("button", { name: "1. archive" })).toHaveTextContent("1");
    const activeBucket = screen.getByRole("button", { name: "2. reports" });
    expect(activeBucket).toHaveTextContent("2");
    expect(activeBucket).toHaveAttribute("aria-current", "page");
    expect(activeBucket.querySelector("span[aria-hidden='true']")).toHaveClass("bg-primary");
    const viewport = container.querySelector(".shell-sidebar-scroll-compact");
    expect(viewport).toBeInTheDocument();
    expect(viewport?.firstElementChild).toHaveClass("shell-sidebar-compact-rail");

    fireEvent.click(toggle);
    expect(screen.getByText("Favorite locations")).toBeVisible();
    expect(screen.getByRole("button", { name: "Show buckets" }).querySelector("svg")).toHaveClass(
      "h-4",
      "w-4",
    );
  });

  it("keeps separate bucket and favorite tabs when expanded", () => {
    render(
      <BrowserWorkspaceSidebar
        favorites={<div>Favorite locations</div>}
        compact={false}
        variant="desktop"
        isPortalContext={false}
        rows={[]}
        activeBucketName=""
        bucketFilter=""
        loadingBuckets={false}
        bucketError={null}
        bucketManagementEnabled={false}
        canLoadMore={false}
        bucketMenuLoadingMore={false}
        bucketMenuTotal={0}
        bucketTotalCount={0}
        usageSummary={null}
        usageLoading={false}
        usageError={null}
        closeMobile={vi.fn()}
        onBucketFilterChange={vi.fn()}
        onRetryBuckets={vi.fn()}
        onCreateBucket={vi.fn()}
        onSelectBucket={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );

    expect(screen.getByRole("tab", { name: "Buckets" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Favorites" })).toBeVisible();
  });

  it("renders the Portal Storage Space descriptor instead of the generic bucket icon", () => {
    render(
      <BrowserWorkspaceSidebar
        compact={false}
        variant="desktop"
        isPortalContext
        rows={[
          {
            bucket: {
              name: "research-data",
              display_name: "Research data",
              icon: {
                source: "preset",
                preset: "media",
                url: null,
                updated_at: null,
              },
            },
            access: { status: "available", detail: null },
          },
        ]}
        activeBucketName="research-data"
        bucketFilter=""
        loadingBuckets={false}
        bucketError={null}
        bucketManagementEnabled={false}
        canLoadMore={false}
        bucketMenuLoadingMore={false}
        bucketMenuTotal={1}
        bucketTotalCount={1}
        usageSummary={null}
        usageLoading={false}
        usageError={null}
        closeMobile={vi.fn()}
        onBucketFilterChange={vi.fn()}
        onRetryBuckets={vi.fn()}
        onCreateBucket={vi.fn()}
        onSelectBucket={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );

    const row = screen.getByRole("button", { name: /Research data/ });
    expect(row.querySelector('[data-storage-space-icon-preset="media"]')).toHaveClass("h-6", "w-6");
  });

  it("uses the shared search control for workspace filtering", () => {
    const onBucketFilterChange = vi.fn();
    render(
      <BrowserWorkspaceSidebar
        compact={false}
        variant="desktop"
        isPortalContext={false}
        rows={[]}
        activeBucketName=""
        bucketFilter="archive"
        loadingBuckets={false}
        bucketError={null}
        bucketManagementEnabled={false}
        canLoadMore={false}
        bucketMenuLoadingMore={false}
        bucketMenuTotal={0}
        bucketTotalCount={0}
        usageSummary={null}
        usageLoading={false}
        usageError={null}
        closeMobile={vi.fn()}
        onBucketFilterChange={onBucketFilterChange}
        onRetryBuckets={vi.fn()}
        onCreateBucket={vi.fn()}
        onSelectBucket={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );

    const filter = screen.getByRole("searchbox", { name: "Search buckets" });
    expect(filter).toHaveClass("ui-control", "ui-list-control", "ui-list-control-with-icon");
    expect(filter).toHaveAttribute("spellcheck", "false");
    fireEvent.change(filter, { target: { value: "logs" } });
    expect(onBucketFilterChange).toHaveBeenCalledWith("logs");
  });

  it("keeps the bucket summary row limited to the count and icon actions", () => {
    const onCreateBucket = vi.fn();
    const onRetryBuckets = vi.fn();
    render(
      <BrowserWorkspaceSidebar
        compact={false}
        variant="desktop"
        isPortalContext={false}
        rows={[]}
        activeBucketName=""
        bucketFilter=""
        loadingBuckets={false}
        bucketError={null}
        bucketManagementEnabled
        canLoadMore={false}
        bucketMenuLoadingMore={false}
        bucketMenuTotal={45}
        bucketTotalCount={45}
        usageSummary={null}
        usageLoading={false}
        usageError={null}
        closeMobile={vi.fn()}
        onBucketFilterChange={vi.fn()}
        onRetryBuckets={onRetryBuckets}
        onCreateBucket={onCreateBucket}
        onSelectBucket={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );

    expect(screen.getByText("45 buckets")).toBeInTheDocument();
    expect(screen.queryByText("Buckets")).not.toBeInTheDocument();
    expect(screen.queryByText("+ Bucket")).not.toBeInTheDocument();
    const createButton = screen.getByRole("button", { name: "Create bucket" });
    const refreshButton = screen.getByRole("button", { name: "Refresh buckets" });
    expect(createButton.textContent).toBe("");
    expect(refreshButton.textContent).toBe("");
    fireEvent.click(createButton);
    fireEvent.click(refreshButton);
    expect(onCreateBucket).toHaveBeenCalledOnce();
    expect(onRetryBuckets).toHaveBeenCalledOnce();
  });
});
