/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { createRef, type ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BrowserBucketSelector from "./BrowserBucketSelector";

const buildProps = (
  overrides: Partial<ComponentProps<typeof BrowserBucketSelector>> = {},
): ComponentProps<typeof BrowserBucketSelector> => ({
  rootRef: createRef<HTMLDivElement>(),
  filterInputRef: createRef<HTMLInputElement>(),
  lockedBucketName: null,
  hasContext: true,
  open: true,
  buttonLabel: "Finance",
  buttonActionLabel: "Choose bucket",
  needsAttention: false,
  workspaceNoun: "bucket",
  workspaceNounPlural: "buckets",
  workspaceNounTitle: "Buckets",
  bucketManagementEnabled: true,
  filter: "",
  loading: false,
  hasError: false,
  totalCount: 2,
  total: 3,
  items: [{ name: "finance" }, { name: "archive" }],
  activeBucketName: "finance",
  displayNameByBucket: new Map([
    ["finance", "Finance"],
    ["archive", "Archive"],
  ]),
  canLoadMore: true,
  loadingMore: false,
  onToggle: vi.fn(),
  onCreateBucket: vi.fn(),
  onFilterChange: vi.fn(),
  onRetry: vi.fn(),
  onSelectBucket: vi.fn(),
  onLoadMore: vi.fn(),
  ...overrides,
});

describe("BrowserBucketSelector", () => {
  it("uses the shared filter control and delegates bucket actions", () => {
    const onFilterChange = vi.fn();
    const onSelectBucket = vi.fn();
    const onLoadMore = vi.fn();
    const filterInputRef = createRef<HTMLInputElement>();

    render(
      <BrowserBucketSelector
        {...buildProps({
          filterInputRef,
          onFilterChange,
          onSelectBucket,
          onLoadMore,
        })}
      />,
    );

    const filter = screen.getByRole("textbox", { name: "Filter buckets" });
    expect(filterInputRef.current).toBe(filter);
    expect(filter).toHaveClass("ui-control", "ui-control-compact", "ui-list-control");

    fireEvent.change(filter, { target: { value: "arch" } });
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(onFilterChange).toHaveBeenCalledWith("arch");
    expect(onSelectBucket).toHaveBeenCalledWith("archive");
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("keeps a locked bucket out of the selectable menu flow", () => {
    render(
      <BrowserBucketSelector
        {...buildProps({ lockedBucketName: "finance", open: true })}
      />,
    );

    expect(screen.getByRole("button", { name: "Choose bucket" })).not.toHaveAttribute("aria-haspopup");
    expect(screen.queryByRole("textbox", { name: "Filter buckets" })).not.toBeInTheDocument();
  });
});
