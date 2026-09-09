/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "jest-axe";
import { LanguageProvider } from "../../components/language";
import { setSessionUserCache } from "../../utils/workspaces";
import ProfilePreferencesPage from "./ProfilePreferencesPage";
import { readSelectorTagsPreference } from "../../utils/selectorTagsPreference";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), update: vi.fn(), upload: vi.fn(), remove: vi.fn(), theme: vi.fn() }));
const settings = vi.hoisted(() => ({ allow_user_profile_name_edit: true, browser_enabled: true, browser_root_enabled: true, manager_enabled: true }));
vi.mock("../../api/users", () => ({ fetchCurrentUser: mocks.fetch, updateCurrentUser: mocks.update, uploadCurrentUserAvatar: mocks.upload, deleteCurrentUserAvatar: mocks.remove }));
vi.mock("../../api/executionContexts", () => ({ getWorkspaceAccess: async () => ({ manager: { available: false }, browser: { available: true }, portal: { available: false } }) }));
vi.mock("../../components/theme", () => ({ useTheme: () => ({ theme: "light", setTheme: mocks.theme }) }));
vi.mock("../../components/GeneralSettingsContext", () => ({ useGeneralSettings: () => ({ generalSettings: settings }) }));
const profile = { id: 7, email: "person@example.test", full_name: "Test Person", role: "ui_user", ui_language: "en", quota_alerts_enabled: true, quota_alerts_global_watch: false, avatar: { preference: "auto", source: "initials", initials: "TP" } };
const renderPage = (callback = vi.fn()) => render(<LanguageProvider><ProfilePreferencesPage onUnsavedChangesChange={callback} /></LanguageProvider>);

describe("compact profile preferences", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    settings.allow_user_profile_name_edit = true;
    setSessionUserCache({ ...profile, role: "ui_user", authType: "password", ui_language: "en" });
    mocks.fetch.mockResolvedValue(profile);
    mocks.update.mockImplementation(async payload => ({ ...profile, ...payload }));
    URL.createObjectURL = vi.fn(() => "blob:profile-preview");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => { cleanup(); setSessionUserCache(null); });

  it("applies local preferences only after the server commits, and translates the result", async () => {
    const user = userEvent.setup();
    let finish!: (value: unknown) => void;
    mocks.update.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const dirty = vi.fn();
    renderPage(dirty);
    await screen.findByText("Test Person");
    expect(screen.queryByRole("button", { name: "Save preferences" })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Theme" }), "dark");
    await user.selectOptions(screen.getByRole("combobox", { name: "Language" }), "de");
    const tagsInitially = readSelectorTagsPreference();
    await user.click(screen.getByRole("switch", { name: "Show selector tags" }));
    await user.click(screen.getByRole("switch", { name: "Quota alert emails" }));
    expect(mocks.update).not.toHaveBeenCalled();
    expect(dirty).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole("button", { name: "Save preferences" }));
    expect(mocks.theme).not.toHaveBeenCalled();
    expect(readSelectorTagsPreference()).toBe(tagsInitially);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ quota_alerts_enabled: false }));
    expect(screen.getByRole("heading", { name: "Identity" })).toBeInTheDocument();
    await act(async () => finish({ ...profile, ui_language: "de" }));
    expect(mocks.theme).toHaveBeenCalledWith("dark");
    expect(readSelectorTagsPreference()).toBe(!tagsInitially);
    expect(await screen.findByText("Einstellungen gespeichert.")).toBeInTheDocument();
    expect(dirty).toHaveBeenLastCalledWith(false);
  });

  it("keeps drafts after a server failure and confirms cancel before restoring the baseline", async () => {
    const user = userEvent.setup();
    mocks.update.mockRejectedValue(new Error("server rejected"));
    renderPage();
    await screen.findByText("Test Person");
    await user.selectOptions(screen.getByRole("combobox", { name: "Theme" }), "dark");
    await user.click(screen.getByRole("switch", { name: "Quota alert emails" }));
    await user.click(screen.getByRole("button", { name: "Save preferences" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to save your changes.");
    expect(mocks.theme).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: "Theme" })).toHaveValue("dark");
    expect(screen.getByRole("switch", { name: "Quota alert emails" })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Cancel", exact: true }));
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("combobox", { name: "Theme" })).toHaveValue("dark");
    await user.click(screen.getByRole("button", { name: "Cancel", exact: true }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByRole("combobox", { name: "Theme" })).toHaveValue("light");
    expect(screen.getByRole("switch", { name: "Quota alert emails" })).toBeChecked();
    expect(screen.queryByRole("button", { name: "Save preferences" })).not.toBeInTheDocument();
  });

  it("keeps name edits through Escape and saves the trimmed name", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Test Person");
    await user.click(screen.getByRole("button", { name: "Edit name" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "  New name  ");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByLabelText("Name")).toHaveValue("  New name  ");
    await user.click(screen.getByRole("button", { name: "Save", exact: true }));
    expect(mocks.update).toHaveBeenCalledWith({ full_name: "New name" });
    expect(await screen.findByText("New name")).toBeInTheDocument();
  });

  it("keeps an avatar file in memory until save and releases its preview when discarded", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Test Person");
    await user.click(screen.getByRole("button", { name: "Edit profile image" }));
    const file = new File(["image"], "photo.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Choose image"), file);
    expect(mocks.upload).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel", exact: true }));
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByText("photo.png")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:profile-preview");
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("rejects unsupported and oversized avatar files next to the action", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Test Person");
    await user.click(screen.getByRole("button", { name: "Edit profile image" }));
    for (const file of [new File(["x"], "x.svg", { type: "image/svg+xml" }), new File([new Uint8Array(1024 * 1024 + 1)], "big.png", { type: "image/png" })]) {
      fireEvent.change(screen.getByLabelText("Choose image"), { target: { files: [file] } });
      expect(screen.getByRole("alert")).toHaveTextContent("Choose a PNG or JPEG image, no larger than 1 MiB.");
      expect(mocks.upload).not.toHaveBeenCalled();
    }
  });

  it("honors managed names, global notification permissions, and resolved Browser access", async () => {
    settings.allow_user_profile_name_edit = false;
    renderPage();
    await screen.findByText("Test Person");
    expect(screen.queryByRole("button", { name: "Edit name" })).not.toBeInTheDocument();
    expect(screen.getByText("Managed by your administrator.")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Global quota watch" })).not.toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Browser (objects)" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Default workspace" })).toHaveValue("browser"));
  });

  it.each(["en", "fr", "de"] as const)("has translated accessible controls and no a11y violations in %s", async language => {
    mocks.fetch.mockResolvedValue({ ...profile, ui_language: language });
    setSessionUserCache({ role: "ui_admin", authType: "password", ui_language: language });
    const { container } = renderPage();
    await screen.findByText("Test Person");
    const names = { en: "Language", fr: "Langue", de: "Sprache" };
    expect(screen.getByRole("combobox", { name: names[language] })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    const edit = { en: "Edit name", fr: "Modifier le nom", de: "Namen bearbeiten" };
    fireEvent.click(screen.getByRole("button", { name: edit[language] }));
    expect(within(screen.getByRole("dialog")).getByRole("textbox")).toHaveAccessibleName();
  });
});
