/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { transferableAbortController } from "node:util";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, Link, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUserCache } from "../../utils/workspaces";
import GroupsPage from "./GroupsPage";
import UsersPage from "./UsersPage";

const fixtures = vi.hoisted(() => ({
  user: { id: 2, email: "alice@example.com", full_name: "Alice", role: "ui_user" },
  group: { id: 50, name: "ops-group", description: null, account_links: [] },
  updateUser: vi.fn(),
  updateGroup: vi.fn(),
  setPassword: vi.fn(),
  uploadAvatar: vi.fn(),
  deleteAvatar: vi.fn(),
}));
vi.mock("../../api/users", () => ({
  listUsers: async () => ({ items: [fixtures.user], total: 1, page: 1, page_size: 25, has_next: false }),
  listMinimalUsers: async () => [fixtures.user],
  updateUser: fixtures.updateUser,
  uploadUserAvatar: fixtures.uploadAvatar,
  deleteUserAvatar: fixtures.deleteAvatar,
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  assignUserToS3Account: vi.fn(),
}));
vi.mock("../../api/groups", () => ({
  listGroups: async () => ({ items: [fixtures.group], total: 1, page: 1, page_size: 25, has_next: false }),
  listMinimalGroups: async () => [fixtures.group],
  updateGroup: fixtures.updateGroup,
  createGroup: vi.fn(),
  deleteGroup: vi.fn(),
  uploadGroupAvatar: vi.fn(),
  deleteGroupAvatar: vi.fn(),
}));
vi.mock("../../api/accounts", () => ({ listMinimalS3Accounts: async () => [] }));
vi.mock("../../api/s3Users", () => ({ listMinimalS3Users: async () => [] }));
vi.mock("../../api/s3ConnectionsAdmin", () => ({ listMinimalS3Connections: async () => [] }));
vi.mock("../../api/security", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAdminUserSecurity: async () => ({
    user_id: 2, email: "alice@example.com", role: "ui_user", has_local_password: true,
    passkey_required: false, passkeys: [], external_identities: [], sessions: [],
  }),
  setAdminUserPassword: fixtures.setPassword,
}));

const editors = [
  { name: "UI User", path: "/admin/users", Page: UsersPage, field: "Full name", initial: "Alice",
    update: fixtures.updateUser, form: "Edit UI user", create: "Create user", tab: "Groups",
    add: "Add UI groups", selection: "ops-group" },
  { name: "UI Group", path: "/admin/groups", Page: GroupsPage, field: "Name", initial: "ops-group",
    update: fixtures.updateGroup, form: "Edit UI group", create: "Create group", tab: "Members",
    add: "Add UI users", selection: "alice@example.com" },
] as const;

function mount({ path, Page }: typeof editors[number]) {
  const router = createMemoryRouter([
    { path, element: <><Link to="/other">Other page</Link><Page /></> },
    { path: "/other", element: <h1>Other page</h1> },
  ], { initialEntries: ["/other", path] });
  render(<RouterProvider router={router} />);
  return router;
}

function unloadBlocked() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("Admin principal editor navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("AbortController", function () { return transferableAbortController(); });
    window.history.replaceState({}, "", "/");
    setSessionUserCache({ id: 1, role: "ui_superadmin" });
    fixtures.updateUser.mockResolvedValue(fixtures.user);
    fixtures.updateGroup.mockResolvedValue(fixtures.group);
    fixtures.setPassword.mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  describe.each(editors)("$name", (editor) => {
    async function openEditor() {
      const router = mount(editor);
      fireEvent.click(await screen.findByRole("button", { name: "Edit", exact: true }));
      await screen.findByRole("form", { name: editor.form });
      return router;
    }

    it("allows leaving an unchanged or reverted form", async () => {
      const router = await openEditor();
      expect(unloadBlocked()).toBe(false);
      const field = screen.getByLabelText(editor.field);
      fireEvent.change(field, { target: { value: "Draft" } });
      expect(unloadBlocked()).toBe(true);
      fireEvent.change(field, { target: { value: editor.initial } });
      expect(unloadBlocked()).toBe(false);
      fireEvent.click(screen.getByRole("link", { name: "Other page" }));
      await screen.findByRole("heading", { name: "Other page" });
      expect(router.state.location.pathname).toBe("/other");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("protects menu navigation, browser back and unload with one confirmation", async () => {
      const router = await openEditor();
      fireEvent.change(screen.getByLabelText(editor.field), { target: { value: "Draft" } });
      fireEvent.click(screen.getByRole("link", { name: "Other page" }));
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
      expect(router.state.location.pathname).toBe(editor.path);
      expect(screen.getByLabelText(editor.field)).toHaveValue("Draft");
      expect(unloadBlocked()).toBe(true);
      await act(async () => { void router.navigate(-1); });
      fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
      await screen.findByRole("heading", { name: "Other page" });
      expect(router.state.location.pathname).toBe("/other");
      expect(unloadBlocked()).toBe(false);
      expect(editor.update).not.toHaveBeenCalled();
    });

    it("discards pending association selections on query navigation without retaining an editor", async () => {
      const router = await openEditor();
      fireEvent.click(screen.getByRole("tab", { name: editor.tab, exact: true }));
      fireEvent.click(screen.getByRole("button", { name: editor.add }));
      fireEvent.click(await screen.findByRole("checkbox", { name: editor.selection }));
      expect(unloadBlocked()).toBe(true);
      await act(async () => { void router.navigate(`${editor.path}?search=another`); });
      fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
      await waitFor(() => expect(router.state.location.search).toBe("?search=another"));
      expect(screen.queryByRole("form", { name: editor.form })).not.toBeInTheDocument();
      expect(unloadBlocked()).toBe(false);
      fireEvent.click(screen.getByRole("button", { name: "Edit", exact: true }));
      fireEvent.click(screen.getByRole("tab", { name: editor.tab, exact: true }));
      fireEvent.click(screen.getByRole("button", { name: editor.add }));
      expect(await screen.findByRole("checkbox", { name: editor.selection })).not.toBeChecked();
      expect(unloadBlocked()).toBe(false);
    });

    it("retains navigation protection after a failed save and clears it after success", async () => {
      const router = await openEditor();
      fireEvent.change(screen.getByLabelText(editor.field), { target: { value: "Draft" } });
      editor.update.mockRejectedValueOnce(new Error("Fixture save failed"));
      fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Save", exact: true })).toBeEnabled());
      expect(editor.update).toHaveBeenCalledOnce();
      expect(screen.getByLabelText(editor.field)).toHaveValue("Draft");
      fireEvent.click(screen.getByRole("link", { name: "Other page" }));
      fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
      expect(unloadBlocked()).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
      await waitFor(() => expect(screen.queryByRole("form", { name: editor.form })).not.toBeInTheDocument());
      expect(editor.update).toHaveBeenCalledTimes(2);
      expect(editor.update.mock.calls[1]).toEqual(editor.update.mock.calls[0]);
      expect(unloadBlocked()).toBe(false);
      await act(async () => { await router.navigate("/other"); });
      expect(screen.getByRole("heading", { name: "Other page" })).toBeInTheDocument();
    });

    it("uses the same navigation protection for a new principal draft", async () => {
      mount(editor);
      fireEvent.click(await screen.findByRole("button", { name: editor.create, exact: true }));
      fireEvent.change(screen.getByLabelText(editor.field), { target: { value: "Draft" } });
      fireEvent.click(screen.getByRole("link", { name: "Other page" }));
      expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
      await screen.findByRole("heading", { name: "Other page" });
      expect(unloadBlocked()).toBe(false);
    });

    it("keeps operational, Manager and Browser access together across tab changes and saves", async () => {
      await openEditor();
      fireEvent.click(screen.getByRole("tab", { name: "Workspaces", exact: true }));
      expect(screen.queryByRole("tab", { name: "Manager" })).not.toBeInTheDocument();
      expect(screen.queryByRole("tab", { name: "Browser" })).not.toBeInTheDocument();
      expect(within(screen.getByRole("tabpanel")).getAllByRole("heading", { level: 2 }).map(heading => heading.textContent)).toEqual([
        "Mass management workspaces", "Manager", "Browser",
      ]);
      const labels = [editor.name === "UI User" ? "Allow access to /storage-ops" : "Allow group access to /storage-ops",
        "Bucket compare", "Enable technical S3 tools"];
      for (const label of labels) fireEvent.click(screen.getByRole("switch", { name: label, exact: true }));
      fireEvent.click(screen.getByRole("tab", { name: "Connections", exact: true }));
      fireEvent.click(screen.getByRole("tab", { name: "Workspaces", exact: true }));
      fireEvent.click(screen.getByRole("link", { name: "Other page" }));
      fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
      for (const label of labels) expect(screen.getByRole("switch", { name: label, exact: true })).toBeChecked();
      fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
      await waitFor(() => expect(editor.update).toHaveBeenCalledOnce());
      expect(editor.update.mock.calls[0][1]).toEqual(expect.objectContaining({
        can_access_storage_ops: true, browser_advanced_features_enabled: true,
        manager_tool_access: expect.objectContaining({ bucket_compare: true }),
      }));
      await waitFor(() => expect(unloadBlocked()).toBe(false));
    });
  });

  it("protects a group avatar change even when text and permissions are unchanged", async () => {
    mount(editors[1]);
    const edit = await screen.findByRole("button", { name: "Edit", exact: true });
    await act(async () => { fireEvent.click(edit); });
    fireEvent.click(screen.getByRole("button", { name: "Use Security pictogram" }));
    fireEvent.click(screen.getByRole("link", { name: "Other page" }));
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
    expect(unloadBlocked()).toBe(true);
  });

  it("keeps authentication fields across cancelled tab and page exits, and discards only that tab draft", async () => {
    mount(editors[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Edit", exact: true }));
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Alice draft" } });
    fireEvent.click(screen.getByRole("tab", { name: "Security" }));
    const provider = await screen.findByLabelText("Provider ID");
    fireEvent.change(provider, { target: { value: "fixture-provider" } });
    fireEvent.click(screen.getByRole("tab", { name: "Profile and preferences" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(provider).toHaveValue("fixture-provider");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    fireEvent.click(screen.getByRole("link", { name: "Other page" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(provider).toHaveValue("fixture-provider");
    fireEvent.click(screen.getByRole("tab", { name: "Profile and preferences" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByLabelText("Full name")).toHaveValue("Alice draft");
    expect(unloadBlocked()).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "Security" }));
    expect(await screen.findByLabelText("Provider ID")).toHaveValue("");
  });

  it("protects an authentication-only draft after failure and allows navigation after its successful action", async () => {
    mount(editors[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Edit", exact: true }));
    fireEvent.click(screen.getByRole("tab", { name: "Security" }));
    fireEvent.change(await screen.findByLabelText("New password"), { target: { value: "fixture-password" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "fixture-password" } });
    fixtures.setPassword.mockRejectedValueOnce(new Error("Fixture password failure"));
    fireEvent.click(screen.getByRole("button", { name: "Set password" }));
    await within(screen.getByRole("group", { name: "Change local password" })).findByText("Fixture password failure");
    fireEvent.click(screen.getByRole("link", { name: "Other page" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(unloadBlocked()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Set password" }));
    await waitFor(() => expect(screen.getByLabelText("New password")).toHaveValue(""));
    await waitFor(() => expect(unloadBlocked()).toBe(false));
    fireEvent.click(screen.getByRole("link", { name: "Other page" }));
    await screen.findByRole("heading", { name: "Other page" });
    expect(fixtures.updateUser).not.toHaveBeenCalled();
  });

  it("saves account language and alerts with the protected principal draft", async () => {
    mount(editors[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Edit", exact: true }));
    expect(screen.getByRole("tab", { name: "Profile and preferences" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Theme" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Global quota watch" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), { target: { value: "de" } });
    fireEvent.click(screen.getByRole("switch", { name: "Quota alert emails" }));
    fireEvent.click(screen.getByRole("tab", { name: "Groups" }));
    fireEvent.click(screen.getByRole("link", { name: "Other page" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    fireEvent.click(screen.getByRole("tab", { name: "Profile and preferences" }));
    expect(screen.getByRole("combobox", { name: "Language" })).toHaveValue("de");
    expect(screen.getByRole("switch", { name: "Quota alert emails" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
    await waitFor(() => expect(fixtures.updateUser).toHaveBeenCalledWith(2, expect.objectContaining({
      ui_language: "de", quota_alerts_enabled: false, quota_alerts_global_watch: false,
    })));
    await waitFor(() => expect(unloadBlocked()).toBe(false));
  });

  it("saves an avatar independently without submitting or resetting the parent draft", async () => {
    mount(editors[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Edit", exact: true }));
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Unsaved name" } });
    fireEvent.click(screen.getByRole("button", { name: "Edit profile image" }));
    const dialog = screen.getByRole("dialog", { name: "Edit profile image" });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Image source" }), { target: { value: "initials" } });
    fixtures.updateUser.mockRejectedValueOnce(new Error("Fixture avatar save failure"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save", exact: true }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Unable to save your changes.");
    expect(fixtures.updateUser).toHaveBeenCalledExactlyOnceWith(2, { avatar_preference: "initials" });
    expect(within(dialog).getByRole("combobox", { name: "Image source" })).toHaveValue("initials");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save", exact: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fixtures.updateUser).toHaveBeenCalledTimes(2);
    expect(fixtures.updateUser.mock.calls[1]).toEqual(fixtures.updateUser.mock.calls[0]);
    expect(screen.getByLabelText("Full name")).toHaveValue("Unsaved name");
    expect(unloadBlocked()).toBe(true);
    fireEvent.click(screen.getByRole("link", { name: "Other page" }));
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
  });

  it("protects avatar-only changes and discards them without a request", async () => {
    const router = mount(editors[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Edit", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Edit profile image" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Image source" }), { target: { value: "initials" } });
    expect(unloadBlocked()).toBe(true);
    await act(async () => { void router.navigate("/other"); });
    fireEvent.click(within(screen.getByRole("dialog", { name: "Discard changes?" })).getByRole("button", { name: "Keep editing" }));
    const dialog = screen.getByRole("dialog", { name: "Edit profile image" });
    expect(within(dialog).getByRole("combobox", { name: "Image source" })).toHaveValue("initials");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel", exact: true }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).getByRole("button", { name: "Discard changes" }));
    expect(unloadBlocked()).toBe(false);
    expect(fixtures.updateUser).not.toHaveBeenCalled();
  });

});
