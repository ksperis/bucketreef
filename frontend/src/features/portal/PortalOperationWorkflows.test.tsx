/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { StrictMode } from "react";
import { transferableAbortController } from "node:util";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { axe } from "jest-axe";
import { LanguageProvider } from "../../components/language";
import { setSessionUserCache } from "../../utils/workspaces";
import PortalDeletedPrefixRestoreWorkflow from "./PortalDeletedPrefixRestoreWorkflow";
import PortalStorageSpaceHistoryCleanupWorkflow from "./PortalStorageSpaceHistoryCleanupWorkflow";

const mocks = vi.hoisted(() => ({ restore: vi.fn(), cleanup: vi.fn(), start: vi.fn(), completed: vi.fn(), refresh: vi.fn(), browser: vi.fn(), close: vi.fn() }));
vi.mock("../../api/portal", () => ({
  streamPortalDeletedPrefixRestore: mocks.restore,
  streamPortalStorageSpaceVersionCleanup: mocks.cleanup,
  portalStorageSpaceVersionCleanupConfirmationPhrase: (name: string) => `CLEAN HISTORY ${name.toUpperCase()}`,
}));
const routers: ReturnType<typeof createMemoryRouter>[] = [];
const cleanupResult = { status: "completed", storage_space_id: "research", storage_space_name: "Research", scanned_versions: 120, scanned_delete_markers: 30, deleted_versions: 80, deleted_delete_markers: 20, bytes_freed: 2048 };
const restoreResult = { status: "partial", storage_space_id: "research", storage_space_name: "Research", prefix: " leading//folder/", scanned_versions: 12, scanned_delete_markers: 3, restore_candidates: 4, restored_objects: 2, failed_objects: 2, failures: [{ key: " leading//folder/file.csv", detail: "Access denied" }], failures_truncated: true };
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubGlobal("AbortController", function () { return transferableAbortController(); });
  setSessionUserCache({ role: "ui_user", authType: "password" });
  mocks.restore.mockResolvedValue(restoreResult);
  mocks.cleanup.mockResolvedValue(cleanupResult);
});
afterEach(() => {
  cleanup(); routers.splice(0).forEach(router => router.dispose());
  setSessionUserCache(null); vi.unstubAllGlobals();
});
function renderWorkflow(kind: "restore" | "cleanup", enabled = true) {
  const element = kind === "restore"
    ? <PortalDeletedPrefixRestoreWorkflow accountId="101" spaceId="research" spaceName="Research" target={{ key: " leading//folder/", isPrefix: true }} onClose={mocks.close} onBrowserRefresh={mocks.browser} onWorkspaceRefresh={mocks.refresh} />
    : <PortalStorageSpaceHistoryCleanupWorkflow accountId="101" spaceId="research" spaceName="Research" usedBytes={4096} enabled={enabled} onClose={mocks.close} onStart={mocks.start} onCompleted={mocks.completed} onRefresh={mocks.refresh} />;
  const router = createMemoryRouter([
    { path: "/portal/storage-spaces/research", element: <main>{element}</main> },
    { path: "/portal/storage-spaces", element: <p>Spaces destination</p> },
  ], { initialEntries: ["/portal/storage-spaces/research"] });
  routers.push(router);
  const view = render(<StrictMode><LanguageProvider><RouterProvider router={router} /></LanguageProvider></StrictMode>);
  return { ...view, router };
}

it("starts confirmed cleanup once under StrictMode and exposes indeterminate progress until the total is final", async () => {
  let options: { signal: AbortSignal; onProgress: (value: unknown) => void };
  let finish!: (value: unknown) => void;
  mocks.cleanup.mockImplementation((_account, _space, _payload, value) => { options = value; return new Promise(resolve => { finish = resolve; }); });
  renderWorkflow("cleanup");
  const bar = await screen.findByRole("progressbar", { name: "Storage Space history cleanup progress" });
  expect(mocks.cleanup).toHaveBeenCalledExactlyOnceWith("101", "research", { confirmation: "CLEAN HISTORY RESEARCH" }, expect.any(Object));
  expect(options!.signal.aborted).toBe(false);
  expect(mocks.start).toHaveBeenCalledOnce();
  expect(bar).not.toHaveAttribute("aria-valuenow");
  const progress = { ...cleanupResult, stage: "delete", delete_candidates: 150, deleted_versions: 30, deleted_delete_markers: 0, total_candidates_final: false };
  act(() => options!.onProgress(progress));
  expect(bar).not.toHaveAttribute("aria-valuenow");
  expect(screen.getByText("30 / at least 150")).toBeVisible();
  act(() => options!.onProgress({ ...progress, total_candidates_final: true }));
  expect(bar).toHaveAttribute("aria-valuenow", "20");
  await act(async () => finish(cleanupResult));
  expect(bar).toHaveAttribute("aria-valuenow", "100");
  expect(screen.getByText("100 removed")).toBeVisible();
  expect(mocks.completed).toHaveBeenCalledExactlyOnceWith(2048);
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "Start cleanup" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Done" })).toBeVisible();
});

it.each(["canceled", "failed"])("retains the partial cleanup result for %s without announcing success", async status => {
  mocks.cleanup.mockResolvedValue({ ...cleanupResult, status });
  renderWorkflow("cleanup");
  expect(await screen.findByRole("status")).toHaveTextContent(status === "canceled" ? "stopped before completion" : "Cleanup failed");
  expect(mocks.completed).not.toHaveBeenCalled();
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(screen.getByText("2.0 KB")).toBeVisible();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
});

it("guards pending cleanup navigation, stops explicitly and permits a deliberate retry", async () => {
  const user = userEvent.setup();
  mocks.cleanup.mockImplementationOnce((_a, _s, _p, options) => new Promise((_resolve, reject) => {
    options.onProgress({ ...cleanupResult, stage: "list", delete_candidates: 200, total_candidates_final: false, message: "Scanning..." });
    options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }));
  const { router } = renderWorkflow("cleanup");
  await screen.findByRole("button", { name: "Stop cleanup" });
  expect(screen.getByRole("button", { name: "Back to the space" })).toBeDisabled();
  const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
  await act(async () => { void router.navigate("/portal/storage-spaces"); });
  expect(screen.getByRole("dialog", { name: "Operation in progress" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Leave page" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Stay here" }));
  await user.click(screen.getByRole("button", { name: "Stop cleanup" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("History already removed cannot be restored");
  expect(screen.getByText("Last reported progress")).toBeVisible();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  expect(mocks.completed).not.toHaveBeenCalled();
  expect(mocks.refresh).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("button", { name: "Start cleanup" }));
  expect(await screen.findByRole("button", { name: "Done" })).toBeVisible();
  expect(mocks.cleanup).toHaveBeenCalledTimes(2);
  await act(async () => { void router.navigate("/portal/storage-spaces"); });
  expect(await screen.findByText("Spaces destination")).toBeVisible();
});

it("preserves literal restore scope, rejects duplicate starts and presents partial failures accessibly", async () => {
  const user = userEvent.setup();
  let finish!: (value: unknown) => void;
  mocks.restore.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { container, router } = renderWorkflow("restore");
  const start = screen.getByRole("button", { name: "Restore files" });
  act(() => { fireEvent.click(start); fireEvent.click(start); });
  expect(mocks.restore).toHaveBeenCalledExactlyOnceWith("101", "research", " leading//folder/", expect.any(Object));
  expect(screen.getByRole("button", { name: "Back to files" })).toBeDisabled();
  await act(async () => { void router.navigate("/portal/storage-spaces"); });
  expect(screen.getByRole("dialog", { name: "Operation in progress" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Stay here" }));
  await act(async () => finish(restoreResult));
  expect(screen.getByText("Only some failure details are shown.")).toBeVisible();
  expect(screen.getByText("Access denied", { exact: false })).toBeVisible();
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  expect(mocks.browser).toHaveBeenCalledOnce();
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(await axe(container)).toHaveNoViolations();
  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(mocks.close).toHaveBeenCalledOnce();
});

it("retains a restore failure for explicit retry", async () => {
  const user = userEvent.setup();
  mocks.restore.mockRejectedValueOnce(new Error("Stream unavailable"));
  renderWorkflow("restore");
  await user.click(screen.getByRole("button", { name: "Restore files" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Stream unavailable");
  expect(mocks.refresh).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Restore files" }));
  expect(await screen.findByRole("button", { name: "Done" })).toBeVisible();
  expect(mocks.restore).toHaveBeenCalledTimes(2);
});

it("aborts on unmount and ignores late stream progress and results", async () => {
  let options: { signal: AbortSignal; onProgress: (value: unknown) => void };
  let finish!: (value: unknown) => void;
  mocks.cleanup.mockImplementation((_a, _s, _p, value) => { options = value; return new Promise(resolve => { finish = resolve; }); });
  const { unmount } = renderWorkflow("cleanup");
  await screen.findByRole("button", { name: "Stop cleanup" });
  unmount();
  expect(options!.signal.aborted).toBe(true);
  await act(async () => { options!.onProgress({ ...cleanupResult, stage: "completed" }); finish(cleanupResult); });
  expect(mocks.completed).not.toHaveBeenCalled();
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("does not run disabled cleanup", async () => {
  renderWorkflow("cleanup", false);
  await waitFor(() => expect(screen.getByRole("button", { name: "Start cleanup" })).toBeDisabled());
  expect(mocks.cleanup).not.toHaveBeenCalled();
});
