/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BrowserArchivePreparationDialog from "./BrowserArchivePreparationDialog";

describe("BrowserArchivePreparationDialog", () => {
  it("shows inventory progress and keeps download disabled", () => {
    const onCancel = vi.fn();

    render(
      <BrowserArchivePreparationDialog
        preparation={{
          phase: "inventorying",
          folderLabel: "photos",
          completedFolders: 2,
          totalFolders: 5,
        }}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText("Preparing ZIP archive")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Checking folders and archive paths (2/5). No object content is downloaded during this step.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Choose file and download" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel preparation" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows the completed inventory and enables download when available", () => {
    const onConfirm = vi.fn();

    render(
      <BrowserArchivePreparationDialog
        preparation={{
          phase: "ready",
          folderLabel: "photos",
          fileCount: 3,
          totalBytes: 2048,
          excludedCount: 1,
          canDownload: true,
          basePrefix: "photos/",
          plan: { targets: [], excluded: [], totalBytes: 2048 },
        }}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText("Save large ZIP archive")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();

    const confirm = screen.getByRole("button", {
      name: "Choose file and download",
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
