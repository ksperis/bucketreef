/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../api/client";
import { updateCurrentUser } from "../../api/users";
import SecurityPage from "./SecurityPage";

const mocks = vi.hoisted(() => ({
  beginSecurityPasskey: vi.fn(),
  beginRecentWebAuthnVerification: vi.fn(),
  clear: vi.fn(),
  finishSecurityPasskey: vi.fn(),
  finishRecentWebAuthnVerification: vi.fn(),
  authenticatePasskey: vi.fn(),
  createPasskey: vi.fn(),
  listExternalIdentities: vi.fn(),
  listSecurityCredentials: vi.fn(),
  listSecuritySessions: vi.fn(),
  logoutAllSessions: vi.fn(),
  regenerateRecoveryCodes: vi.fn(),
  revokeExternalIdentity: vi.fn(),
  revokeSecurityCredential: vi.fn(),
  revokeSecuritySession: vi.fn(),
}));
const policyState = vi.hoisted(() => ({
  require_passkey_for_admins: true,
  require_passkey_for_users: false,
  allow_user_external_identity_unlink: false,
}));
const storedUserState = vi.hoisted(() => ({
  role: "ui_superadmin",
  authType: "password",
  has_local_password: true,
}));

vi.mock("../../api/users", () => ({ updateCurrentUser: vi.fn() }));

vi.mock("../../auth/SessionProvider", () => ({
  useSession: () => ({ user: { id: 1, role: "ui_superadmin" }, clear: mocks.clear }),
}));

vi.mock("../../api/security", () => ({
  beginRecentWebAuthnVerification: mocks.beginRecentWebAuthnVerification,
  beginSecurityPasskey: mocks.beginSecurityPasskey,
  finishSecurityPasskey: mocks.finishSecurityPasskey,
  finishRecentWebAuthnVerification: mocks.finishRecentWebAuthnVerification,
  listExternalIdentities: mocks.listExternalIdentities,
  listSecurityCredentials: mocks.listSecurityCredentials,
  listSecuritySessions: mocks.listSecuritySessions,
  logoutAllSessions: mocks.logoutAllSessions,
  regenerateRecoveryCodes: mocks.regenerateRecoveryCodes,
  revokeExternalIdentity: mocks.revokeExternalIdentity,
  revokeSecurityCredential: mocks.revokeSecurityCredential,
  revokeSecuritySession: mocks.revokeSecuritySession,
}));

vi.mock("../../auth/webauthn", () => ({
  authenticatePasskey: mocks.authenticatePasskey,
  createPasskey: mocks.createPasskey,
}));

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({ generalSettings: policyState }),
}));

vi.mock("../../utils/workspaces", () => ({
  readStoredUser: () => storedUserState,
}));

function recentWebAuthnRequiredError() {
  return new ApiError("Request failed", {
    response: {
      status: 403,
      data: { detail: "Recent WebAuthn verification required" },
      headers: {},
    },
  });
}

describe("SecurityPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    policyState.require_passkey_for_admins = true;
    policyState.require_passkey_for_users = false;
    storedUserState.role = "ui_superadmin";
    storedUserState.authType = "password";
    storedUserState.has_local_password = true;
    mocks.createPasskey.mockResolvedValue({ id: "created-key" });
    mocks.beginSecurityPasskey.mockResolvedValue({ challenge: "registration" });
    mocks.finishSecurityPasskey.mockResolvedValue(undefined);
    mocks.listSecurityCredentials.mockResolvedValue([]);
    mocks.listSecuritySessions.mockResolvedValue([
      {
        id: "current-session",
        principal_type: "user",
        auth_type: "webauthn",
        created_at: "2026-08-14T10:00:00Z",
        last_activity_at: "2026-08-14T10:05:00Z",
        idle_expires_at: "2099-08-14T22:05:00Z",
        absolute_expires_at: "2099-08-21T10:00:00Z",
        current: true,
      },
    ]);
    mocks.listExternalIdentities.mockResolvedValue([
      {
        id: "identity-1",
        provider_type: "oidc",
        provider_id: "company",
        email: "admin@example.com",
        email_verified: true,
        created_at: "2026-08-14T10:00:00Z",
      },
    ]);
    mocks.revokeSecurityCredential.mockResolvedValue(undefined);
    mocks.regenerateRecoveryCodes.mockResolvedValue(["code-one", "code-two"]);
    mocks.beginRecentWebAuthnVerification.mockResolvedValue({ challenge: "challenge" });
    mocks.authenticatePasskey.mockResolvedValue({ id: "credential" });
    mocks.finishRecentWebAuthnVerification.mockResolvedValue({ mfa_verified_at: "2026-08-14T10:00:00Z" });
  });

  it("explains whether passkey enrollment is required for the current role", async () => {
    const { unmount } = render(<SecurityPage />);
    expect(await screen.findByText(/Required by your organization/)).toBeInTheDocument();
    expect(screen.getByText("Local password")).toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();

    unmount();
    storedUserState.role = "ui_user";
    render(<SecurityPage />);
    expect(await screen.findByText(/Optional; required at sign-in once added/)).toBeInTheDocument();
  });

  it("shows only the current user's identities and sessions", async () => {
    render(<SecurityPage />);

    expect(await screen.findByText("admin@example.com")).toBeInTheDocument();
    expect(screen.getByText("This session")).toBeInTheDocument();
    expect(screen.queryByText("External identity link requests")).not.toBeInTheDocument();
    expect(screen.queryByText("Platform sessions")).not.toBeInTheDocument();
  });

  it("keeps successful sections visible when one security resource fails and retries only that section", async () => {
    const user = userEvent.setup();
    mocks.listExternalIdentities.mockRejectedValueOnce(new Error("Identity service down"));

    render(<SecurityPage />);

    expect(await screen.findByText("This session")).toBeInTheDocument();
    expect(await screen.findByText("Unable to load linked accounts.")).toBeInTheDocument();
    expect(screen.queryByText("No accounts linked.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("admin@example.com")).toBeInTheDocument();
    expect(mocks.listExternalIdentities).toHaveBeenCalledTimes(2);
  });

  it("blocks revocation when the role requires the last passkey", async () => {
    const user = userEvent.setup();
    mocks.listSecurityCredentials.mockResolvedValue([
      { id: "credential-1", name: "Laptop", created_at: "2026-08-14T10:00:00Z" },
    ]);

    render(<SecurityPage />);

    await user.click(await screen.findByRole("button", { name: "Manage passkeys" }));
    const passkeysCard = screen.getByRole("dialog", { name: "Manage passkeys" });
    expect(passkeysCard).not.toBeNull();
    const revokeButton = within(passkeysCard!).getByRole("button", { name: "Remove passkey" });
    expect(revokeButton).toBeDisabled();
    expect(screen.getByText("Add another passkey before removing the last required one.")).toBeInTheDocument();
    await user.click(revokeButton);
    expect(screen.queryByRole("dialog", { name: "Remove passkey" })).not.toBeInTheDocument();
    expect(mocks.revokeSecurityCredential).not.toHaveBeenCalled();
  });

  it("confirms passkey revocation before executing it when another passkey remains", async () => {
    const user = userEvent.setup();
    mocks.listSecurityCredentials.mockResolvedValue([
      { id: "credential-1", name: "Laptop", created_at: "2026-08-14T10:00:00Z" },
      { id: "credential-2", name: "Phone", created_at: "2026-08-15T10:00:00Z" },
    ]);

    render(<SecurityPage />);

    await user.click(await screen.findByRole("button", { name: "Manage passkeys" }));
    const passkeysCard = screen.getByRole("dialog", { name: "Manage passkeys" });
    expect(passkeysCard).not.toBeNull();
    const laptopRow = screen.getByText("Laptop").closest("li");
    expect(laptopRow).not.toBeNull();
    await user.click(within(laptopRow!).getByRole("button", { name: "Remove passkey" }));
    const dialog = screen.getByRole("dialog", { name: "Remove passkey" });
    expect(mocks.revokeSecurityCredential).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Remove passkey" }));
    await waitFor(() => expect(mocks.revokeSecurityCredential).toHaveBeenCalledWith("credential-1"));
    expect(mocks.clear).toHaveBeenCalledOnce();
    expect(mocks.listSecurityCredentials).toHaveBeenCalledOnce();
  });

  it("confirms recovery-code rotation and global logout", async () => {
    const user = userEvent.setup();
    mocks.listSecurityCredentials.mockResolvedValue([
      { id: "credential-1", name: "Laptop", created_at: "2026-08-14T10:00:00Z" },
    ]);

    render(<SecurityPage />);

    await user.click(await screen.findByRole("button", { name: "Renew recovery codes" }));
    expect(screen.getByRole("dialog", { name: "Renew recovery codes" })).toBeInTheDocument();
    expect(mocks.regenerateRecoveryCodes).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Sign out all sessions" }));
    expect(screen.getByRole("dialog", { name: "Sign out all sessions" })).toBeInTheDocument();
    expect(mocks.logoutAllSessions).not.toHaveBeenCalled();
  });

  it("verifies and retries a previously confirmed sensitive action exactly once", async () => {
    const user = userEvent.setup();
    storedUserState.role = "ui_user";
    mocks.listSecurityCredentials.mockResolvedValue([
      { id: "credential-1", name: "Laptop", created_at: "2026-08-14T10:00:00Z" },
    ]);
    mocks.revokeSecurityCredential
      .mockRejectedValueOnce(recentWebAuthnRequiredError())
      .mockResolvedValueOnce(undefined);

    render(<SecurityPage />);

    await user.click(await screen.findByRole("button", { name: "Manage passkeys" }));
    const passkeysCard = screen.getByRole("dialog", { name: "Manage passkeys" });
    await user.click(within(passkeysCard!).getByRole("button", { name: "Remove passkey" }));
    await user.click(within(screen.getByRole("dialog", { name: "Remove passkey" })).getByRole("button", { name: "Remove passkey" }));

    const verificationDialog = await screen.findByRole("dialog", { name: "Verify with passkey" });
    await user.click(within(verificationDialog).getByRole("button", { name: "Verify with passkey" }));

    await waitFor(() => expect(mocks.revokeSecurityCredential).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Recent WebAuthn verification required")).not.toBeInTheDocument();
  });

  it("cancels an action step-up without retrying or exposing the raw guard", async () => {
    const user = userEvent.setup();
    storedUserState.role = "ui_user";
    mocks.listSecurityCredentials.mockResolvedValue([
      { id: "credential-1", name: "Laptop", created_at: "2026-08-14T10:00:00Z" },
    ]);
    mocks.revokeSecurityCredential.mockRejectedValueOnce(recentWebAuthnRequiredError());

    render(<SecurityPage />);
    await user.click(await screen.findByRole("button", { name: "Manage passkeys" }));
    const passkeysCard = screen.getByRole("dialog", { name: "Manage passkeys" });
    await user.click(within(passkeysCard!).getByRole("button", { name: "Remove passkey" }));
    await user.click(within(screen.getByRole("dialog", { name: "Remove passkey" })).getByRole("button", { name: "Remove passkey" }));
    const verificationDialog = await screen.findByRole("dialog", { name: "Verify with passkey" });
    await user.click(within(verificationDialog).getByRole("button", { name: "Cancel" }));

    expect(mocks.revokeSecurityCredential).toHaveBeenCalledOnce();
    expect(mocks.beginRecentWebAuthnVerification).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Remove passkey" })).toBeInTheDocument();
    expect(screen.queryByText("Recent WebAuthn verification required")).not.toBeInTheDocument();
  });
  it("asks for a passkey name and submits it through the existing contract", async () => {
    const user = userEvent.setup();
    render(<SecurityPage />);
    await user.click(await screen.findByRole("button", { name: "Add passkey" }));
    const dialog = screen.getByRole("dialog", { name: "Add passkey" });
    await user.click(within(dialog).getByRole("button", { name: "Add passkey" }));
    expect(screen.getByText("Enter a name for this passkey.")).toBeInTheDocument();
    expect(mocks.beginSecurityPasskey).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Passkey name"), "Work laptop");
    await user.click(within(dialog).getByRole("button", { name: "Add passkey" }));
    await waitFor(() => expect(mocks.finishSecurityPasskey).toHaveBeenCalledWith({ id: "created-key" }, "Work laptop"));
    expect(mocks.clear).toHaveBeenCalledOnce();
  });

  it("keeps password drafts when closing and validates mismatches beside the field", async () => {
    const user = userEvent.setup();
    render(<SecurityPage />);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.type(screen.getByLabelText("Current password"), "old-password");
    await user.type(screen.getByLabelText("New password"), "a-new-long-password");
    await user.type(screen.getByLabelText("Confirm password"), "different");
    await user.click(screen.getByRole("button", { name: "Save", exact: true }));
    expect(screen.getByLabelText("Confirm password")).toHaveAttribute("aria-invalid", "true");
    expect(updateCurrentUser).not.toHaveBeenCalled();
    await user.click(screen.getByLabelText("Show passwords"));
    expect(screen.getByLabelText("Current password")).toHaveAttribute("type", "text");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByLabelText("Current password")).toHaveValue("old-password");
  });

  it("shows externally managed passwords for SSO accounts without a local password", async () => {
    storedUserState.authType = "oidc";
    storedUserState.has_local_password = false;
    render(<SecurityPage />);
    expect(await screen.findByText("Managed by your sign-in provider.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

});
