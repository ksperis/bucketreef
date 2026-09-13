/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import BrowserOperationsModal from "./BrowserOperationsModal";

function props(): ComponentProps<typeof BrowserOperationsModal> {
  return {
    totalOperationsCount: 2, activeOperationsCount: 1, queuedOperationsCount: 0,
    completedOperationsCount: 0, failedOperationsCount: 1,
    showActiveOperations: true, showQueuedOperations: false, showCompletedOperations: false,
    showFailedOperations: false, filtersAllInactive: false,
    onToggleActive: vi.fn(), onToggleQueued: vi.fn(), onToggleCompleted: vi.fn(), onToggleFailed: vi.fn(),
    visibleDownloadGroups: [], visibleDeleteGroups: [], visibleCopyGroups: [], visibleUploadGroups: [],
    visibleOtherOperations: [{ id: "restore-one", kind: "restore", status: "restoring", label: "Restore object",
      path: "bucket/ spaced//key ", progress: 35, cancelable: true }],
    operationSortIndexById: {}, uploadGroupSortIndexById: {}, operationSortFallback: 10,
    isGroupExpanded: () => false, toggleGroupExpanded: vi.fn(), getSectionVisibleCount: () => 10,
    showMoreSection: vi.fn(), cancelOperation: vi.fn(), cancelUploadGroup: vi.fn(), cancelUploadOperation: vi.fn(),
    removeQueuedUpload: vi.fn(), onDownloadOperationDetails: vi.fn(), hasFinishedOperations: true,
    onClearFinishedOperations: vi.fn(), onClose: vi.fn(),
  };
}

describe("Browser operations overview", () => {
  it("exposes filter selection to keyboard users and preserves counts, actions and progress", async () => {
    const user = userEvent.setup(); const value = props(); const { rerender } = render(<BrowserOperationsModal {...value} />);
    expect(screen.getByText("2 operations")).toBeVisible();
    expect(screen.getByRole("button", { name: "Active 1" })).toHaveAttribute("aria-pressed", "true");
    const failedFilter = screen.getByRole("button", { name: "Failed 1" });
    expect(failedFilter).toHaveAttribute("aria-pressed", "false");
    failedFilter.focus(); await user.keyboard(" "); expect(value.onToggleFailed).toHaveBeenCalledOnce();
    expect(screen.getByRole("progressbar", { name: "Restore object" })).toHaveAttribute("aria-valuenow", "35");
    await user.click(screen.getByRole("button", { name: "Stop", exact: true }));
    expect(value.cancelOperation).toHaveBeenCalledWith("restore-one");
    await user.click(screen.getByRole("button", { name: "Export operation details (JSON)" }));
    expect(value.onDownloadOperationDetails).toHaveBeenCalledWith("other", "restore-one");
    rerender(<BrowserOperationsModal {...value} showActiveOperations={false} showFailedOperations visibleOtherOperations={[
      { ...value.visibleOtherOperations[0], id: "restore-failed", completedAt: "10:00", completionStatus: "failed", errorMessage: "Fixture failure" },
    ]} />);
    expect(screen.getByRole("button", { name: "Failed 1" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Fixture failure")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Stop", exact: true })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear completed/failed" }));
    expect(value.onClearFinishedOperations).toHaveBeenCalledOnce();
    await user.keyboard("{Escape}"); expect(value.onClose).toHaveBeenCalledOnce();
    expect(value.cancelOperation).toHaveBeenCalledOnce();
  });

  it("announces no matching operations without losing the available filter counts", () => {
    render(<BrowserOperationsModal {...props()} visibleOtherOperations={[]} showActiveOperations={false} showQueuedOperations hasFinishedOperations={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("No operations to show.");
    expect(screen.getByRole("button", { name: "Queue 0" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Active 1" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Clear completed/failed" })).toBeDisabled();
  });
});
