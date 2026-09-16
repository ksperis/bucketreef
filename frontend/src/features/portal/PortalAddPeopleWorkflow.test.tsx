/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useState } from "react";
import { transferableAbortController } from "node:util";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { axe } from "jest-axe";
import { LanguageProvider } from "../../components/language";
import { setSessionUserCache } from "../../utils/workspaces";
import PortalAddPeopleWorkflow from "./PortalAddPeopleWorkflow";

const mocks = vi.hoisted(() => ({ list: vi.fn(), grant: vi.fn(), request: vi.fn(), added: vi.fn() }));
vi.mock("../../api/portalSharing", () => ({ listPortalStorageSpaceShareCandidates: mocks.list, grantPortalStorageSpaceShare: mocks.grant }));
vi.mock("../../api/portalRequests", () => ({ createPortalRequest: mocks.request }));
const candidates = [
  { user_id: 1, display_name: "Alice", email: "alice@example.test", portal_role: "portal_user", access_source: "direct", already_shared: true },
  { user_id: 2, display_name: "Bob", email: "bob@example.test", portal_role: "portal_user", access_source: "group", already_shared: false },
  { user_id: 3, display_name: "Chen", email: "chen@example.test", portal_role: "portal_user", access_source: "direct", already_shared: false },
];
const routers: ReturnType<typeof createMemoryRouter>[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("AbortController", function () { return transferableAbortController(); });
  localStorage.clear();
  setSessionUserCache({ role: "ui_user", authType: "password" });
  mocks.list.mockResolvedValue(candidates);
  mocks.grant.mockResolvedValue({});
  mocks.request.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  routers.splice(0).forEach(router => router.dispose());
  setSessionUserCache(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function renderWorkflow() {
  function Page() {
    const [open, setOpen] = useState(true);
    return <main>{open ? <PortalAddPeopleWorkflow accountId="101" spaceId="research" spaceName="Research"
      existingRoles={{ 1: "Editor" }} disabled={false} onClose={() => setOpen(false)}
      onAdded={async count => { mocks.added(count); setOpen(false); }} /> : <p>Space view</p>}</main>;
  }
  const router = createMemoryRouter([
    { path: "/portal/storage-spaces/research", element: <Page /> },
    { path: "/portal/storage-spaces", element: <p>Spaces destination</p> },
  ], { initialEntries: ["/portal/storage-spaces/research"] });
  routers.push(router);
  const view = render(<LanguageProvider><RouterProvider router={router} /></LanguageProvider>);
  return { router, ...view };
}
async function openRequest(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole("textbox", { name: "People" }), "missing@example.test");
  await user.click(screen.getByRole("button", { name: "Request collaborator access" }));
  return screen.getByRole("dialog", { name: "Request collaborator access" });
}

it("keeps roles and counts across searches, excludes existing grants and submits the exact selected scope", async () => {
  const user = userEvent.setup();
  const { container } = renderWorkflow();
  expect(await screen.findByRole("checkbox", { name: /Alice/ })).toBeDisabled();
  expect(screen.getByText("Already invited · Editor")).toBeVisible();
  await user.click(screen.getByRole("checkbox", { name: /Bob/ }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Access for bob@example.test" }), "Editor");
  await user.type(screen.getByRole("textbox", { name: "People" }), "Chen");
  await user.click(screen.getByRole("checkbox", { name: /Chen/ }));
  expect(screen.getByText("2 selected")).toBeVisible();
  await user.clear(screen.getByRole("textbox", { name: "People" }));
  expect(screen.getByRole("combobox", { name: "Access for bob@example.test" })).toHaveValue("Editor");
  await user.click(screen.getByRole("checkbox", { name: /Chen/ }));
  expect(screen.getByText("1 selected")).toBeVisible();
  expect(await axe(container)).toHaveNoViolations();
  await user.click(screen.getByRole("button", { name: "Add people" }));
  expect(await screen.findByText("Space view")).toBeVisible();
  expect(mocks.grant).toHaveBeenCalledExactlyOnceWith("101", "research", { user_id: 2, role: "Editor" });
  expect(mocks.added).toHaveBeenCalledWith(1);
});

it("retries a catalogue error and a failed invitation without losing its selected role", async () => {
  const user = userEvent.setup();
  mocks.list.mockRejectedValueOnce(new Error("Catalogue unavailable"));
  mocks.grant.mockRejectedValueOnce(new Error("Invitation failed"));
  const { router } = renderWorkflow();
  expect(await screen.findByRole("alert")).toHaveTextContent("Catalogue unavailable");
  expect(screen.queryByText("Only people already added to this project can be invited here.")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await user.click(await screen.findByRole("checkbox", { name: /Bob/ }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Access for bob@example.test" }), "Editor");
  await user.click(screen.getByRole("button", { name: "Add people" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Invitation failed");
  expect(screen.getByRole("combobox", { name: "Access for bob@example.test" })).toHaveValue("Editor");
  await user.click(screen.getByRole("button", { name: "Back to the space" }));
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  let finish!: () => void;
  mocks.grant.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await user.click(screen.getByRole("button", { name: "Add people" }));
  fireEvent.submit(screen.getByRole("form", { name: "Add people" }));
  expect(mocks.grant).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("checkbox", { name: /Bob/ })).toBeDisabled();
  await act(async () => { void router.navigate("/portal/storage-spaces"); });
  expect(screen.getByRole("dialog", { name: "Operation in progress" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Discard changes", exact: true })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  await act(async () => finish());
  expect(await screen.findByText("Space view")).toBeVisible();
});

it("guards a nested request once, retains failed values and never submits the invitation form", async () => {
  const user = userEvent.setup();
  const { router } = renderWorkflow();
  await user.click(await screen.findByRole("checkbox", { name: /Bob/ }));
  const dialog = await openRequest(user);
  fireEvent.submit(within(dialog).getByRole("form"));
  expect(mocks.grant).not.toHaveBeenCalled();
  expect(mocks.request).not.toHaveBeenCalled();
  await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Missing person");
  await user.clear(within(dialog).getByRole("textbox", { name: "Email" }));
  expect(within(dialog).getByRole("textbox", { name: "Email" })).toHaveValue("");
  await user.type(within(dialog).getByRole("textbox", { name: "Email" }), "partner@example.test");
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveValue("Missing person");
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  let reject!: (cause: Error) => void;
  mocks.request.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  await user.click(within(dialog).getByRole("button", { name: "Send request" }));
  fireEvent.submit(within(dialog).getByRole("form"));
  expect(mocks.request).toHaveBeenCalledOnce();
  expect(within(dialog).getByRole("textbox", { name: "Name" })).toBeDisabled();
  await act(async () => { void router.navigate("/portal/storage-spaces"); });
  expect(screen.getAllByRole("dialog", { name: "Operation in progress" })).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  await act(async () => reject(new Error("Request unavailable")));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Request unavailable");
  await user.click(within(dialog).getByRole("button", { name: "Send request" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Request sent.");
  expect(screen.getByRole("button", { name: "Request collaborator access" })).toHaveFocus();
  expect(mocks.request).toHaveBeenLastCalledWith("101", { request_type: "portal_user_access", target_name: "Missing person", target_email: "partner@example.test" });
  expect(mocks.grant).not.toHaveBeenCalled();
  await user.clear(screen.getByRole("textbox", { name: "People" }));
  expect(screen.getByRole("checkbox", { name: /Bob/ })).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Discard changes", exact: true }));
  expect(await screen.findByText("Space view")).toBeVisible();
});

it("protects a membership-request draft even with no selected people and discards both on navigation", async () => {
  const user = userEvent.setup();
  const { router } = renderWorkflow();
  await screen.findByRole("checkbox", { name: /Bob/ });
  const dialog = await openRequest(user);
  await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "New person");
  await act(async () => { void router.navigate("/portal/storage-spaces"); });
  expect(screen.getAllByRole("dialog", { name: "Discard changes?" })).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Discard changes", exact: true }));
  expect(await screen.findByText("Spaces destination")).toBeVisible();
  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.grant).not.toHaveBeenCalled();
});

it("ignores a catalogue result after the owning workflow has closed", async () => {
  let finish!: (value: typeof candidates) => void;
  mocks.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const user = userEvent.setup();
  renderWorkflow();
  await user.click(screen.getByRole("button", { name: "Back to the space" }));
  await act(async () => finish(candidates));
  expect(screen.getByText("Space view")).toBeVisible();
  expect(screen.queryByText("Bob")).not.toBeInTheDocument();
});
