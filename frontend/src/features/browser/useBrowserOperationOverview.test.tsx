import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { OperationItem } from "./browserTypes";
import { useBrowserOperationOverview } from "./useBrowserOperationOverview";

vi.mock("./browserI18n", () => ({
  useBrowserI18n: () => ({
    text: (message: string, values?: Record<string, string | number>) =>
      message.replace("{label}", String(values?.label ?? "")),
  }),
}));

describe("useBrowserOperationOverview", () => {
  it("announces each new non-upload operation once", () => {
    const setStatusMessage = vi.fn();
    const setters = {
      setOperations: vi.fn(),
      setDownloadDetails: vi.fn(),
      setDeleteDetails: vi.fn(),
      setCopyDetails: vi.fn(),
      startOperation: vi.fn(() => "operation-1"),
      recordCompletedActivity: vi.fn(),
    };
    const upload: OperationItem = {
      id: "upload-1",
      label: "Upload files",
      path: "bucket/",
      progress: 0,
      kind: "upload",
    };
    const download: OperationItem = {
      id: "download-1",
      label: "Download report",
      path: "bucket/report.csv",
      progress: 0,
      kind: "download",
    };

    const { rerender } = renderHook(
      ({ operations }: { operations: OperationItem[] }) =>
        useBrowserOperationOverview({
          operations,
          uploadQueue: [],
          downloadDetails: {},
          deleteDetails: {},
          copyDetails: {},
          setStatusMessage,
          ...setters,
        }),
      { initialProps: { operations: [] as OperationItem[] } },
    );

    rerender({ operations: [upload] });
    expect(setStatusMessage).not.toHaveBeenCalled();

    rerender({ operations: [download, upload] });
    expect(setStatusMessage).toHaveBeenCalledOnce();
    expect(setStatusMessage).toHaveBeenCalledWith("Queued: Download report.");

    rerender({
      operations: [{ ...download, progress: 50 }, { ...upload, progress: 50 }],
    });
    expect(setStatusMessage).toHaveBeenCalledOnce();
  });

  it("owns showing the operations panel for newly registered work and activity", () => {
    const startOperation = vi.fn(() => "operation-1");
    const recordCompletedActivity = vi.fn();
    const setStatusMessage = vi.fn();
    const baseOptions = {
      uploadQueue: [],
      downloadDetails: {},
      deleteDetails: {},
      copyDetails: {},
      setOperations: vi.fn(),
      setDownloadDetails: vi.fn(),
      setDeleteDetails: vi.fn(),
      setCopyDetails: vi.fn(),
      startOperation,
      recordCompletedActivity,
      setStatusMessage,
    };
    const operation: OperationItem = {
      id: "operation-1",
      label: "Download report",
      path: "bucket/report.csv",
      progress: 100,
      kind: "download",
      completedAt: "10:00:00",
      completionStatus: "done",
    };
    const { result, rerender } = renderHook(
      ({ operations }: { operations: OperationItem[] }) =>
        useBrowserOperationOverview({ ...baseOptions, operations }),
      { initialProps: { operations: [operation] } },
    );

    act(() => result.current.dismissOperationsPanel());
    expect(result.current.showOperationsPanel).toBe(false);

    act(() => {
      expect(
        result.current.startOperation(
          "downloading",
          "Download another report",
          "bucket/other.csv",
        ),
      ).toBe("operation-1");
    });
    expect(startOperation).toHaveBeenCalledOnce();

    rerender({ operations: [operation] });
    expect(result.current.showOperationsPanel).toBe(true);

    act(() => {
      result.current.recordCompletedActivity("Created", "bucket/reports/");
    });
    expect(recordCompletedActivity).toHaveBeenCalledWith(
      "Created",
      "bucket/reports/",
    );
  });
});
