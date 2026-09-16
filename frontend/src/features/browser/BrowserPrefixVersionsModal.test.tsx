/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { triggerDownload, triggerJsonDownload } from "../../utils/download";
import BrowserPrefixVersionsModal from "./BrowserPrefixVersionsModal";

vi.mock("../../utils/download", () => ({
  triggerDownload: vi.fn(), triggerJsonDownload: vi.fn(), formatDownloadTimestamp: () => "fixture",
}));
const oldVersion = { key: ' spaced//a,"b".csv ', version_id: "old-v", is_delete_marker: false, is_latest: false,
  last_modified: "2026-03-08T07:15:00Z", size: 12, etag: '"etag"', storage_class: "STANDARD" };
const latestVersion = { ...oldVersion, version_id: "current-v", is_latest: true };
const marker = { ...oldVersion, version_id: "marker-v", is_delete_marker: true, size: null };
function props(): ComponentProps<typeof BrowserPrefixVersionsModal> {
  return { bucketName: "bucket", normalizedPrefix: "/ spaced//", prefixVersionsLoading: false, prefixVersionsError: null,
    prefixVersionRows: [oldVersion, latestVersion, marker], canLoadMore: true, onClose: vi.fn(), onRefresh: vi.fn(),
    onLoadMore: vi.fn(), onRestoreVersion: vi.fn(), onDeleteVersion: vi.fn() };
}
describe("Browser prefix versions dialog", () => {
  it("routes eligible row actions with exact version identities and keeps literal export values", async () => {
    const user = userEvent.setup(); const value = props(); render(<BrowserPrefixVersionsModal {...value} />);
    expect(screen.getByText("3 loaded")).toBeVisible();
    expect(screen.getByRole("table")).toHaveClass("responsive-data-table");
    expect(screen.getAllByRole("button", { name: "Restore", exact: true })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Restore", exact: true }));
    expect(value.onRestoreVersion).toHaveBeenCalledWith(oldVersion);
    await user.click(screen.getByRole("button", { name: "Delete marker", exact: true }));
    expect(value.onDeleteVersion).toHaveBeenCalledWith(marker);
    await user.click(screen.getAllByRole("button", { name: "Delete version", exact: true })[1]);
    expect(value.onDeleteVersion).toHaveBeenLastCalledWith(latestVersion);
    await user.click(screen.getByRole("button", { name: "Export JSON" }));
    expect(triggerJsonDownload).toHaveBeenLastCalledWith(expect.stringMatching(/\.json$/), expect.objectContaining({
      bucket: "bucket", prefix: "/ spaced//", items: expect.arrayContaining([expect.objectContaining({ key: oldVersion.key, version_id: "old-v" })]),
    }));
    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(triggerDownload).toHaveBeenLastCalledWith(expect.stringMatching(/\.csv$/), expect.stringContaining('" spaced//a,""b"".csv "'), "text/csv;charset=utf-8");
    await user.click(screen.getByRole("button", { name: "Load more versions" })); expect(value.onLoadMore).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Refresh" })); expect(value.onRefresh).toHaveBeenCalledOnce();
    await user.keyboard("{Escape}"); expect(value.onClose).toHaveBeenCalledOnce();
  });

  it("keeps loaded versions during loading and retryable errors", () => {
    const value = props(); const { rerender } = render(<BrowserPrefixVersionsModal {...value} prefixVersionsLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading prefix versions...");
    expect(screen.getByText("old-v")).toBeVisible();
    for (const name of ["Refresh", "Export CSV", "Export JSON", "Load more versions"]) expect(screen.getByRole("button", { name })).toBeDisabled();
    rerender(<BrowserPrefixVersionsModal {...value} prefixVersionsError="Next page unavailable" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Next page unavailable");
    expect(screen.getByText("old-v")).toBeVisible();
    expect(screen.getByRole("button", { name: "Load more versions" })).toBeEnabled();
  });

  it("distinguishes an empty list from a failed load and literal slash from bucket root", () => {
    const value = { ...props(), prefixVersionRows: [], canLoadMore: false, normalizedPrefix: "" };
    const { rerender } = render(<BrowserPrefixVersionsModal {...value} />);
    expect(screen.getByRole("status")).toHaveTextContent("No versions found.");
    expect(screen.getByText("Bucket bucket · Prefix (bucket root)")).toBeVisible();
    rerender(<BrowserPrefixVersionsModal {...value} normalizedPrefix="/" prefixVersionsError="Access denied" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Access denied");
    expect(screen.queryByText("No versions found.")).not.toBeInTheDocument();
    expect(screen.getByText("Bucket bucket · Prefix /")).toBeVisible();
    expect(screen.getByRole("button", { name: "Export JSON" })).toBeDisabled();
  });
});
