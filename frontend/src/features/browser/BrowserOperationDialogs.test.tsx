/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useState, type ReactNode } from "react";
import { transferableAbortController } from "node:util";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { setSessionUserCache } from "../../utils/workspaces";
import BrowserLayout from "./BrowserLayout";
import { useBrowserContext } from "./BrowserContext";
import BrowserBulkAttributesModal from "./BrowserBulkAttributesModal";
import BrowserBulkRestoreModal from "./BrowserBulkRestoreModal";
import BrowserCleanupModal from "./BrowserCleanupModal";
import { createBrowserBulkAttributesDraft } from "./useBrowserBulkAttributes";
import { createBrowserBulkRestoreDraft } from "./useBrowserBulkRestore";
import { createBrowserVersionCleanupDraft } from "./useBrowserVersionCleanup";

vi.mock("../../api/executionContexts", () => ({ listExecutionContexts: async () => [
  { id: "conn-one", kind: "connection", display_name: "One" },
  { id: "conn-two", kind: "connection", display_name: "Two" },
] }));
vi.mock("../../api/managerContext", () => ({ fetchManagerContext: async () => ({}) }));
vi.mock("../../components/Layout", () => ({ default: ({ children, topbarControlDescriptors }: {
  children: ReactNode; topbarControlDescriptors: { id: string; renderControl: (mode: "icon_label") => ReactNode }[];
}) => <>{topbarControlDescriptors.map((item) => <div key={item.id}>{item.renderControl("icon_label")}</div>)}{children}</> }));
vi.mock("../../components/TopbarContextAccountSelector", () => ({ default: ({ onContextChange }: {
  onContextChange: (value: string) => void;
}) => <button onClick={() => onContextChange("conn-two")}>Change context</button> }));

beforeEach(() => {
  vi.stubGlobal("AbortController", function () { return transferableAbortController(); });
  setSessionUserCache({ role: "ui_user", authType: "password" });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setSessionUserCache(null); localStorage.clear(); });

type Kind = "attributes" | "restore" | "cleanup";
const titles = { attributes: "Bulk attributes", restore: "Restore to date", cleanup: "Clean old versions" };
function Draft({ kind, onApply = vi.fn() }: { kind: Kind; onApply?: () => Promise<void> | void }) {
  const [attributes, setAttributes] = useState(createBrowserBulkAttributesDraft);
  const [restore, setRestore] = useState(createBrowserBulkRestoreDraft);
  const [cleanupDraft, setCleanupDraft] = useState(createBrowserVersionCleanupDraft);
  const [open, setOpen] = useState(true);
  const context = useBrowserContext();
  const common = { loading: false, error: null, summary: null, onApply, onClose: () => setOpen(false) };
  return <><p>Executor: {context.selectedContextId}</p>{open && (kind === "attributes" ?
    <BrowserBulkAttributesModal {...common} draft={attributes} setDraft={setAttributes} fileCount={2} folderCount={1} /> : kind === "restore" ?
    <BrowserBulkRestoreModal {...common} draft={restore} setDraft={setRestore} fileCount={2} folderCount={1}
      targetPath="bucket/ path//" preview={{ restoreKeys: [" path//file"], deleteKeys: [], unchangedKeys: [], totalRestore: 4, totalDelete: 0, totalUnchanged: 0 }} /> :
    <BrowserCleanupModal {...common} draft={cleanupDraft} setDraft={setCleanupDraft} currentPath="bucket/ path//" />)}</>;
}
async function edit(kind: Kind, user: ReturnType<typeof userEvent.setup>) {
  if (kind === "attributes") {
    await user.click(screen.getByRole("checkbox", { name: "Metadata headers", exact: true }));
    await user.type(screen.getByRole("textbox", { name: "Content-Type", exact: true }), "text/plain");
    return screen.getByRole("textbox", { name: "Content-Type", exact: true });
  }
  if (kind === "restore") {
    const field = screen.getByLabelText("Target date", { exact: true });
    fireEvent.change(field, { target: { value: "2026-09-01T10:30" } });
    return field;
  }
  const field = screen.getByRole("spinbutton", { name: "Keep only the N most recent versions per object" });
  await user.type(field, "3");
  return field;
}

describe("Browser operation dialogs", () => {
  it.each<Kind>(["attributes", "restore", "cleanup"])("preserves the %s draft and executor until navigation is accepted", async (kind) => {
    const user = userEvent.setup();
    const router = createMemoryRouter([{ path: "/browser", element: <BrowserLayout />, children: [
      { index: true, element: <Draft kind={kind} /> },
    ] }], { initialEntries: ["/browser?ctx=conn-one"] });
    render(<RouterProvider router={router} />);
    await screen.findByText("Executor: conn-one");
    const field = await edit(kind, user);
    const value = (field as HTMLInputElement).value;
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    await user.click(screen.getByRole("button", { name: "Change context" }));
    await screen.findByRole("dialog", { name: "Discard changes?" });
    expect(router.state.location.search).toBe("?ctx=conn-one");
    expect(localStorage.getItem("selectedBrowserExecutionContextId")).toBe("conn-one");
    expect(screen.getByText("Executor: conn-one")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect((field as HTMLInputElement).value).toBe(value);
    await user.click(screen.getByRole("button", { name: "Change context" }));
    await user.click(screen.getByRole("button", { name: "Discard changes", exact: true }));
    await screen.findByText("Executor: conn-two");
    expect(router.state.location.search).toBe("?ctx=conn-two");
    expect(localStorage.getItem("selectedBrowserExecutionContextId")).toBe("conn-two");
    router.dispose();
  });

  it.each<Kind>(["attributes", "restore", "cleanup"])("locks %s fields, close paths and navigation until the submit promise settles", async (kind) => {
    const user = userEvent.setup();
    let resolve!: () => void;
    const onApply = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    const router = createMemoryRouter([
      { path: "/browser", element: <Draft kind={kind} onApply={onApply} /> },
      { path: "/next", element: <p>Next page</p> },
    ], { initialEntries: ["/browser"] });
    render(<RouterProvider router={router} />);
    const field = await edit(kind, user);
    const form = screen.getByRole("form", { name: titles[kind] });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(onApply).toHaveBeenCalledOnce();
    expect(field).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close", exact: true })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: titles[kind] })).toBeVisible();
    await act(async () => { void router.navigate("/next"); });
    expect(screen.getByRole("dialog", { name: "Operation in progress" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Discard changes", exact: true })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    await act(async () => resolve());
    expect(field).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Cancel", exact: true }));
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(field).toBeEnabled();
    router.dispose();
  });

  it("keeps all metadata and retention fields labelled and preserves collapsed draft values", async () => {
    const user = userEvent.setup();
    render(<Draft kind="attributes" />);
    await edit("attributes", user);
    for (const name of ["Tags (key=value per line)", "Storage class", "ACL", "Legal hold", "Retention"]) {
      await user.click(screen.getByRole("checkbox", { name, exact: true }));
    }
    for (const name of ["Cache-Control", "Content-Disposition", "Content-Encoding", "Content-Language", "Expires", "Custom metadata", "Tags", "Storage class", "ACL", "Legal hold status", "Retention mode", "Retain until"]) {
      expect(screen.getByLabelText(name, { exact: true, selector: "input:not([type=checkbox]),textarea,select" })).toBeVisible();
    }
    await user.click(screen.getByRole("checkbox", { name: "Metadata headers", exact: true }));
    await user.click(screen.getByRole("checkbox", { name: "Metadata headers", exact: true }));
    expect(screen.getByRole("textbox", { name: "Content-Type" })).toHaveValue("text/plain");
  });

  it("preserves restore modes, dry-run actions and complete preview keys", async () => {
    const user = userEvent.setup();
    render(<Draft kind="restore" />);
    await user.click(screen.getByRole("checkbox", { name: "Delete objects not present at the selected date" }));
    await user.click(screen.getByRole("checkbox", { name: "Restore deleted objects to their latest version" }));
    expect(screen.getByLabelText("Target date")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Delete objects not present at the selected date" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Delete objects not present at the selected date" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Dry run (preview only)" }));
    expect(screen.getByRole("button", { name: "Preview changes" })).toBeEnabled();
    const preview = screen.getByRole("region", { name: "Restore preview" });
    expect(within(preview).getByRole("listitem").textContent).toBe(" path//file");
    expect(within(preview).getByText("+3 more")).toBeVisible();
  });
});
