import { transferableAbortController } from "node:util";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, Link, MemoryRouter, Route, RouterProvider, Routes, useLocation } from "react-router-dom";

import AccountProfilePage from "./AccountProfilePage";
import { setSessionUserCache } from "../../utils/workspaces";

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({ generalSettings: {} }),
}));

vi.mock("./ProfilePage", () => ({
  default: ({ showConnectionsSection, listPresentation, onUnsavedChangesChange }: { showConnectionsSection?: boolean; listPresentation?: boolean; onUnsavedChangesChange?: (dirty: boolean) => void }) => (
    <div data-testid="profile-content" data-list-presentation={String(listPresentation ?? false)}>
      {showConnectionsSection ? "Connections content" : "Profile content"}
      <button type="button" onClick={() => onUnsavedChangesChange?.(true)}>Make dirty</button>
    </div>
  ),
}));

vi.mock("./SecurityPage", () => ({
  default: ({ onUnsavedChangesChange }: { onUnsavedChangesChange?: (dirty: boolean) => void }) => <div>Security content<button onClick={() => onUnsavedChangesChange?.(true)}>Edit password</button></div>,
}));

function LocationProbe() {
  const location = useLocation();
  return <output>{location.pathname + location.search}</output>;
}

function renderPage(initialEntry = "/profile") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="*" element={<><AccountProfilePage /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("AccountProfilePage", () => {
  beforeEach(() => {
    // Node fetch requires its own AbortSignal rather than the JSDOM implementation.
    vi.stubGlobal("AbortController", function () { return transferableAbortController(); });
    setSessionUserCache({
      role: "ui_superadmin",
      authType: "password",
      effective_access: {
        can_create_manual_private_connections: true,
        can_provision_managed_private_connections: false,
        has_owned_private_connections: false,
      },
    });
  });

  afterEach(() => {
    setSessionUserCache(null);
    window.localStorage.clear();
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  it("shows permitted tabs and synchronizes the selected tab with the URL", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByText("Profile content")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Private S3 connections" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Security" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "API tokens" })).not.toBeInTheDocument();
    expect(screen.getByText("Your details, preferences, and sign-in security.")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Private S3 connections" }));
    expect(screen.getByText("Connections content")).toBeInTheDocument();
    expect(screen.getByText("/profile?tab=connections")).toBeInTheDocument();
  });

  it("hides forbidden tabs and replaces a forbidden direct URL with profile", async () => {
    setSessionUserCache({ role: "ui_user", authType: "password" });
    renderPage("/profile?tab=api-tokens");

    expect(screen.queryByRole("button", { name: "Private S3 connections" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "API tokens" })).not.toBeInTheDocument();
    expect(screen.getByText("Your details, preferences, and sign-in security.")).toBeInTheDocument();
    expect(await screen.findByText("/profile?tab=profile")).toBeInTheDocument();
  });

  it("keeps the connections tab after permission revocation when a connection is owned", () => {
    setSessionUserCache({
      role: "ui_user",
      authType: "password",
      effective_access: {
        can_create_manual_private_connections: false,
        can_provision_managed_private_connections: false,
        has_owned_private_connections: true,
      },
    });

    renderPage();

    expect(screen.getByRole("tab", { name: "Private S3 connections" })).toBeInTheDocument();
  });

  it("protects dirty content before changing tabs", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Make dirty" }));
    await user.click(screen.getByRole("tab", { name: "Security" }));

    expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeInTheDocument();
    expect(screen.getByText("Profile content")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).not.toBeInTheDocument();
    expect(screen.getByText("Profile content")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Security" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByText("Security content")).toBeInTheDocument();
    expect(screen.getByText("/profile?tab=security")).toBeInTheDocument();
  });

  it.each(["admin", "browser", "manager", "portal", "ceph-admin", "storage-ops"])("limits the common connection header to non-Browser uses under /%s", workspace => {
    renderPage(`/${workspace}/profile?tab=connections`);
    expect(screen.getByTestId("profile-content")).toHaveAttribute("data-list-presentation", String(workspace !== "browser"));
  });

  it("uses the Browser breadcrumb on the standalone Browser profile route", () => {
    renderPage("/browser/profile");

    expect(screen.getByRole("link", { name: "Browser" })).toHaveAttribute("href", "/browser");
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  });
  it.each(["admin", "browser", "manager", "portal", "ceph-admin", "storage-ops"])("mounts the shared tabs under /%s/profile", async workspace => {
    renderPage(`/${workspace}/profile?tab=security`);
    expect(screen.getByText("Security content")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Profile and preferences" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Security" })).toHaveAttribute("aria-selected", "true");
  });

  it("protects route navigation and browser history as well as security tab changes", async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter([
      { path: "/browser/profile", element: <><AccountProfilePage /><Link to="/browser">Leave profile</Link></> },
      { path: "/browser", element: <div>Browser content</div> },
    ], { initialEntries: ["/browser", "/browser/profile?tab=security"] });
    render(<RouterProvider router={router} />);
    await user.click(screen.getByRole("button", { name: "Edit password" }));
    await user.click(screen.getByRole("tab", { name: "Profile and preferences" }));
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByText("Security content")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Leave profile" }));
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByText("Security content")).toBeInTheDocument();
    // POP navigation is subject to the same guard as a link or a tab.
    await import("@testing-library/react").then(({ act }) => act(async () => { await router.navigate(-1); }));
    expect(await screen.findByRole("dialog", { name: "Discard unsaved changes?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(screen.getByText("Browser content")).toBeInTheDocument());
  });

});
