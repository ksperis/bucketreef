/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BrowserFoldersPanel from "./BrowserFoldersPanel";

describe("BrowserFoldersPanel", () => {
  it("owns the accessible resize controls", () => {
    const onAdjustWidth = vi.fn();
    const onPointerDown = vi.fn();
    const onResetWidth = vi.fn();

    render(
      <BrowserFoldersPanel
        currentBucket={null}
        activePrefix=""
        currentBucketAccess={{ status: "unknown", detail: null }}
        treeRootNode={null}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onSelectPrefix={vi.fn()}
        onToggleTreeNode={vi.fn()}
        resize={{
          active: false,
          widthPx: 280,
          onAdjustWidth,
          onPointerDown,
          onResetWidth,
        }}
      />,
    );

    const separator = screen.getByRole("separator", {
      name: "Resize folders panel",
    });
    expect(separator).toHaveAttribute("aria-valuenow", "280");
    expect(separator).toHaveStyle({ left: "calc(280px + 6px)", width: "12px" });

    fireEvent.pointerDown(separator);
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    fireEvent.keyDown(separator, { key: "Home" });
    fireEvent.doubleClick(separator);

    expect(onPointerDown).toHaveBeenCalledOnce();
    expect(onAdjustWidth).toHaveBeenNthCalledWith(1, -16);
    expect(onAdjustWidth).toHaveBeenNthCalledWith(2, 16);
    expect(onResetWidth).toHaveBeenCalledTimes(2);
  });
});
