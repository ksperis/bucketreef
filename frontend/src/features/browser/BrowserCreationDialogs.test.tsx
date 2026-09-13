/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { transferableAbortController } from "node:util";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { setSessionUserCache } from "../../utils/workspaces";
import { BrowserCreateBucketModal, BrowserCreateFolderModal, BrowserSseCustomerKeyModal } from "./BrowserBucketDialogModals";
import { BrowserCopyValueModal } from "./BrowserDialogModals";
import { useBrowserCreateBucket } from "./useBrowserCreateBucket";
import { useBrowserCreateFolder } from "./useBrowserCreateFolder";
import { useBrowserSseCustomerKeys } from "./useBrowserSseCustomerKeys";

const { createBucket, ensureCors, createFolder } = vi.hoisted(() => ({
  createBucket: vi.fn(), ensureCors: vi.fn(), createFolder: vi.fn(),
}));
vi.mock("../../api/browserBuckets", () => ({ createBrowserBucket: createBucket, ensureBrowserBucketCors: ensureCors }));
vi.mock("../../api/browserObjects", () => ({ createFolder }));
vi.mock("../manager/BucketDetailPage", () => ({ BucketDetailContent: () => null }));
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
function clipboard(writeText?: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: writeText ? { writeText } : undefined });
}
const created = vi.fn();
const status = vi.fn();
const manualCopy = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("AbortController", function () { return transferableAbortController(); });
  setSessionUserCache({ role: "ui_user", authType: "password" });
  ensureCors.mockResolvedValue({ enabled: true });
  clipboard(vi.fn().mockResolvedValue(undefined));
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); setSessionUserCache(null); localStorage.clear();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
});

type Kind = "bucket" | "folder" | "sse";
function Editor({ kind }: { kind: Kind }) {
  const bucket = useBrowserCreateBucket({ accountIdForApi: "conn-one", currentBucketName: "bucket-a", enabled: true, hasContext: true,
    uiOrigin: "https://ui.example.test", onCreated: created, setCorsError: vi.fn(), setCorsStatus: vi.fn(), setStatusMessage: status });
  const folder = useBrowserCreateFolder({ accountIdForApi: "conn-one", bucketName: "bucket-a", hasContext: true,
    parentPrefix: "/ spaced//", onCreated: created });
  const sse = useBrowserSseCustomerKeys({ accountIdForApi: "conn-one", bucketName: "bucket-a", enabled: true,
    onManualCopyRequired: manualCopy, setStatusMessage: status });
  const open = { bucket: bucket.open, folder: folder.open, sse: sse.open }[kind];
  return <><button onClick={open}>Open editor</button>
    {bucket.showModal && <BrowserCreateBucketModal {...bucket} hasS3AccountContext onNameChange={bucket.updateName}
      onVersioningChange={bucket.setVersioning} onSubmit={bucket.submit} onClose={bucket.close} />}
    {folder.showModal && <BrowserCreateFolderModal {...folder} hasS3AccountContext bucketName="bucket-a" currentPath="bucket-a/ spaced//"
      onNameChange={folder.setName} onSubmit={folder.submit} onClose={folder.close} />}
    {sse.showModal && <BrowserSseCustomerKeyModal {...sse} value={sse.input} onValueChange={sse.updateInput}
      onToggleVisibility={sse.toggleVisibility} onGenerate={sse.generate} onClear={sse.clear} onActivate={sse.activate} onClose={sse.close} />}
  </>;
}
const titles = { bucket: "Create bucket", folder: "Create folder", sse: "SSE-C key" };
const fields = { bucket: "Bucket name", folder: "Folder name", sse: "Customer key (base64, 32 bytes)" };

describe("Browser creation and utility dialogs", () => {
  it.each<Kind>(["bucket", "folder", "sse"])("guards the %s draft on closing and route departure", async (kind) => {
    const user = userEvent.setup();
    const router = createMemoryRouter([{ path: "/edit", element: <Editor kind={kind} /> },
      { path: "/next", element: <p>Next route</p> }], { initialEntries: ["/edit"] });
    render(<RouterProvider router={router} />);
    await user.click(screen.getByRole("button", { name: "Open editor" }));
    const field = screen.getByLabelText(fields[kind]);
    await waitFor(() => expect(field).toHaveFocus());
    await user.type(field, "draft-value");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(field).toHaveValue("draft-value");
    await act(async () => { void router.navigate("/next"); });
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(router.state.location.pathname).toBe("/edit");
    const unload = new Event("beforeunload", { cancelable: true });window.dispatchEvent(unload);expect(unload.defaultPrevented).toBe(true);
    await user.click(screen.getByRole("button", { name: "Cancel", exact: true }));
    await user.click(screen.getByRole("button", { name: "Discard changes", exact: true }));
    expect(screen.queryByRole("dialog", { name: titles[kind] })).not.toBeInTheDocument();
    expect(createBucket).not.toHaveBeenCalled();expect(createFolder).not.toHaveBeenCalled();
    router.dispose();
  });

  it.each(["bucket", "folder"] as const)("retains the %s draft after failure and submits one exact request on retry", async (kind) => {
    const user = userEvent.setup();
    const api = kind === "bucket" ? createBucket : createFolder;
    api.mockRejectedValueOnce(new Error("Fixture failure"));
    render(<Editor kind={kind} />);await user.click(screen.getByRole("button", { name: "Open editor" }));
    const field = screen.getByLabelText(fields[kind]);
    await user.type(field, kind === "bucket" ? "Report-Bucket" : " child//folder ");
    if (kind === "bucket") await user.click(screen.getByRole("checkbox", { name: "Enable versioning" }));
    await user.keyboard("{Enter}");
    if (!api.mock.calls.length) fireEvent.submit(screen.getByRole("form", { name: titles[kind] }));
    await screen.findByRole("alert");
    expect(field).toHaveValue(kind === "bucket" ? "report-bucket" : " child//folder ");
    let finish!: () => void;
    api.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    fireEvent.submit(screen.getByRole("form", { name: titles[kind] }));
    fireEvent.submit(screen.getByRole("form", { name: titles[kind] }));
    expect(api).toHaveBeenCalledTimes(2);
    expect(field).toBeDisabled();expect(screen.getByRole("button", { name: "Close", exact: true })).toBeDisabled();
    await user.keyboard("{Escape}");expect(screen.getByRole("dialog", { name: titles[kind] })).toBeVisible();
    await act(async () => finish());
    await waitFor(() => expect(screen.queryByRole("dialog", { name: titles[kind] })).not.toBeInTheDocument());
    if (kind === "bucket") {
      expect(createBucket).toHaveBeenLastCalledWith("conn-one", "report-bucket", { versioning: true });
      expect(ensureCors).toHaveBeenCalledWith("conn-one", "report-bucket", "https://ui.example.test", undefined);
      expect(created).toHaveBeenCalledWith("report-bucket");
    } else {
      expect(createFolder).toHaveBeenLastCalledWith("conn-one", "bucket-a", "/ spaced// child//folder /", undefined);
      expect(created).toHaveBeenCalledWith({ name: " child//folder ", prefix: "/ spaced// child//folder /" });
    }
  });

  it("keeps generated SSE-C keys accepted while sharing the pending lock across secondary and primary actions", async () => {
    const user = userEvent.setup();
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => { (array as Uint8Array).fill(1); return array; });
    let reject!: (error: Error) => void;
    const writeText = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));clipboard(writeText);
    render(<Editor kind="sse" />);await user.click(screen.getByRole("button", { name: "Open editor" }));
    const field = screen.getByLabelText(fields.sse);
    await user.click(screen.getByRole("button", { name: "Generate", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Generate", exact: true }));
    fireEvent.submit(screen.getByRole("form", { name: "SSE-C key" }));
    expect(writeText).toHaveBeenCalledOnce();expect(field).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear", exact: true })).toBeDisabled();
    expect(screen.getByRole("dialog", { name: "SSE-C key" })).toBeVisible();
    await act(async () => reject(new Error("Fixture denied")));
    expect(field).toBeEnabled();expect(manualCopy).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("Clipboard access failed");
    expect(field).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show", exact: true }));expect(field).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Cancel", exact: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open editor" }));
    expect(screen.getByLabelText(fields.sse)).not.toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Clear", exact: true }));
    await user.click(screen.getByRole("button", { name: "Open editor" }));expect(screen.getByLabelText(fields.sse)).toHaveValue("");
    cleanup();
    render(<Editor kind="sse" />);
    await user.click(screen.getByRole("button", { name: "Open editor" }));
    expect(screen.getByLabelText(fields.sse)).toHaveValue("");
    expect(screen.queryByText("SSE-C is currently enabled for this bucket.")).not.toBeInTheDocument();
  });

  it("labels and selects the exact copy value, suppresses duplicate attempts and announces fallback or success", async () => {
    const user = userEvent.setup();const success = vi.fn();
    let reject!: (error: Error) => void;
    const writeText = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));clipboard(writeText);
    render(<BrowserCopyValueModal title="Copy path" label="Object path" value="bucket/ spaced//key " onClose={vi.fn()} onCopySuccess={success} />);
    const field = screen.getByRole("textbox", { name: "Object path" }) as HTMLTextAreaElement;
    await waitFor(() => expect(field).toHaveFocus());expect(field.selectionStart).toBe(0);expect(field.selectionEnd).toBe(field.value.length);
    await user.click(screen.getByRole("button", { name: "Copy", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Copying...", exact: true }));expect(writeText).toHaveBeenCalledOnce();
    await act(async () => reject(new Error("Fixture denied")));
    expect(screen.getByRole("status")).toHaveTextContent("Select and copy manually.");expect(success).not.toHaveBeenCalled();
    expect(field).toHaveFocus();expect(field.selectionEnd).toBe(field.value.length);
    writeText.mockImplementation(async () => {});await user.click(screen.getByRole("button", { name: "Copy", exact: true }));
    expect(writeText).toHaveBeenLastCalledWith("bucket/ spaced//key ");expect(success).toHaveBeenCalledOnce();
    expect(within(screen.getByRole("dialog")).getByRole("status")).toHaveTextContent("Copied to clipboard.");
  });
});
