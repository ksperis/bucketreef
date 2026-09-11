/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, type FormEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../api/client";
import UserAuthenticationPanel from "./UserAuthenticationPanel";

const mocks = vi.hoisted(() => ({
  addAdminExternalIdentity: vi.fn(),
  authenticatePasskey: vi.fn(),
  beginRecentWebAuthnVerification: vi.fn(),
  finishRecentWebAuthnVerification: vi.fn(),
  getAdminUserSecurity: vi.fn(),
  resetAdminUserMfa: vi.fn(),
  restoreAdminExternalIdentity: vi.fn(),
  revokeAdminExternalIdentity: vi.fn(),
  revokeAdminUserSession: vi.fn(),
  setAdminUserPassword: vi.fn(),
}));

vi.mock("../../api/security", () => ({
  addAdminExternalIdentity: mocks.addAdminExternalIdentity,
  beginRecentWebAuthnVerification: mocks.beginRecentWebAuthnVerification,
  finishRecentWebAuthnVerification: mocks.finishRecentWebAuthnVerification,
  getAdminUserSecurity: mocks.getAdminUserSecurity,
  resetAdminUserMfa: mocks.resetAdminUserMfa,
  restoreAdminExternalIdentity: mocks.restoreAdminExternalIdentity,
  revokeAdminExternalIdentity: mocks.revokeAdminExternalIdentity,
  revokeAdminUserSession: mocks.revokeAdminUserSession,
  setAdminUserPassword: mocks.setAdminUserPassword,
}));

vi.mock("../../auth/webauthn", () => ({ authenticatePasskey: mocks.authenticatePasskey }));

const security = {
  user_id: 42,
  email: "target@example.com",
  role: "ui_user",
  has_local_password: true,
  passkey_required: false,
  passkeys: [{ id: "passkey-1", name: "Laptop", created_at: "2026-08-14T10:00:00Z", revoked_at: null }],
  external_identities: [
    {
      id: "identity-1",
      provider_type: "oidc",
      provider_id: "company",
      subject: "immutable-subject",
      email: "target@example.com",
      email_verified: true,
      link_source: "trusted_email",
      created_at: "2026-08-14T10:00:00Z",
      revoked_at: null,
    },
  ],
  sessions: [
    {
      id: "session-1",
      principal_type: "user",
      auth_type: "password",
      created_at: "2026-08-14T10:00:00Z",
      last_activity_at: "2026-08-14T10:05:00Z",
      idle_expires_at: "2026-08-14T22:05:00Z",
      absolute_expires_at: "2026-08-21T10:00:00Z",
    },
  ],
};

describe("UserAuthenticationPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminUserSecurity.mockResolvedValue(security);
    mocks.addAdminExternalIdentity.mockResolvedValue({});
    mocks.resetAdminUserMfa.mockResolvedValue({});
    mocks.revokeAdminExternalIdentity.mockResolvedValue(undefined);
    mocks.setAdminUserPassword.mockResolvedValue(undefined);
    mocks.beginRecentWebAuthnVerification.mockResolvedValue({ challenge: "challenge" });
    mocks.authenticatePasskey.mockResolvedValue({ id: "credential" });
    mocks.finishRecentWebAuthnVerification.mockResolvedValue({ mfa_verified_at: "2026-08-14T10:00:00Z" });
  });

  it("shows passkeys, local password status, identities, and sessions", async () => {
    render(<UserAuthenticationPanel userId={42} canMutate />);

    expect(await screen.findByText("Laptop")).toBeInTheDocument();
    expect(screen.getByText("A local password is configured.")).toBeInTheDocument();
    expect(screen.getByText(/Authentication changes in this tab are applied immediately/)).toBeInTheDocument();
    expect(screen.getByText("At least 12 characters.")).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toHaveAttribute("minlength", "12");
    expect(screen.getByText("immutable-subject")).toBeInTheDocument();
    expect(screen.getByText(/password · Unknown address/i)).toBeInTheDocument();
  });

  it("confirms MFA reset and external identity revocation", async () => {
    const user = userEvent.setup();
    render(<UserAuthenticationPanel userId={42} canMutate />);

    await user.click(await screen.findByRole("button", { name: "Reset MFA" }));
    const resetDialog = screen.getByRole("dialog", { name: "Reset user MFA" });
    await user.click(within(resetDialog).getByRole("button", { name: "Reset MFA" }));
    await waitFor(() => expect(mocks.resetAdminUserMfa).toHaveBeenCalledWith(42));

    const identityCard = screen.getByRole("heading", { name: "External identities" }).closest("section");
    expect(identityCard).not.toBeNull();
    await user.click(within(identityCard!).getByRole("button", { name: "Revoke" }));
    const identityDialog = screen.getByRole("dialog", { name: "Revoke external identity" });
    await user.click(within(identityDialog).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(mocks.revokeAdminExternalIdentity).toHaveBeenCalledWith(42, "identity-1"));
  });

  it("keeps self-administration read-only in the Admin user view", async () => {
    render(<UserAuthenticationPanel userId={42} canMutate={false} />);

    expect(await screen.findByText(/Use your personal Security page/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset MFA" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set password" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
  });

  it("keeps authentication actions isolated from the parent user form", async () => {
    const user = userEvent.setup();
    const parentSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    render(
      <form onSubmit={parentSubmit}>
        <UserAuthenticationPanel userId={42} canMutate />
      </form>,
    );

    await user.type(await screen.findByLabelText("Provider ID"), "company-two");
    await user.type(screen.getByLabelText("Immutable subject"), "second-subject");
    await user.click(screen.getByRole("button", { name: "Link identity" }));

    await waitFor(() => expect(mocks.addAdminExternalIdentity).toHaveBeenCalled());
    expect(parentSubmit).not.toHaveBeenCalled();
  });

  it("keeps the action pending and retries it once after recent passkey verification", async () => {
    const user = userEvent.setup();
    mocks.resetAdminUserMfa
      .mockRejectedValueOnce(new ApiError("Request failed", {
        response: { status: 403, data: { detail: "Recent WebAuthn verification required" }, headers: {} },
      }))
      .mockResolvedValueOnce({});
    render(<UserAuthenticationPanel userId={42} canMutate />);

    await user.click(await screen.findByRole("button", { name: "Reset MFA" }));
    await user.click(within(screen.getByRole("dialog", { name: "Reset user MFA" })).getByRole("button", { name: "Reset MFA" }));
    const verificationDialog = await screen.findByRole("dialog", { name: "Verify with passkey" });
    await user.click(within(verificationDialog).getByRole("button", { name: "Verify with passkey" }));

    await waitFor(() => expect(mocks.resetAdminUserMfa).toHaveBeenCalledTimes(2));
    expect(mocks.beginRecentWebAuthnVerification).toHaveBeenCalledOnce();
    expect(await screen.findByText("MFA reset completed. Sessions and API tokens were revoked.")).toBeInTheDocument();
  });
  it("keeps unavailable security details out of the form until reload succeeds", async () => {
    mocks.getAdminUserSecurity.mockRejectedValueOnce(new Error("Fixture load failed"));
    render(<UserAuthenticationPanel userId={42} canMutate />);
    expect(await screen.findByText("Unable to load authentication details.")).toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset MFA" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Laptop")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset MFA" })).toBeEnabled();
  });

  it("ignores a stale failure after the latest authentication load succeeded", async () => {
    let rejectStaleLoad!: (error: Error) => void;
    mocks.getAdminUserSecurity.mockImplementationOnce(() => new Promise((_, reject) => { rejectStaleLoad = reject; }));
    render(<StrictMode><UserAuthenticationPanel userId={42} canMutate /></StrictMode>);
    expect(await screen.findByText("Laptop")).toBeInTheDocument();
    await act(async () => rejectStaleLoad(new Error("Stale authentication failure")));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset MFA" })).toBeEnabled();
  });

  it("validates password fields, isolates Enter, and retains a frozen draft after failure", async () => {
    const user = userEvent.setup(), parentSubmit = vi.fn((event: FormEvent) => event.preventDefault()), onBusyChange = vi.fn();
    let rejectSave!: (reason: Error) => void;
    mocks.setAdminUserPassword.mockImplementationOnce(() => new Promise((_, reject) => { rejectSave = reject; }));
    render(<form onSubmit={parentSubmit}><UserAuthenticationPanel userId={42} canMutate onBusyChange={onBusyChange} /></form>);
    const password = await screen.findByLabelText("New password");
    const confirm = screen.getByLabelText("Confirm password");
    await user.click(screen.getByRole("button", { name: "Set password" }));
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveFocus();
    await user.type(password, "fixture-password");
    await user.type(confirm, "different-password");
    await user.click(screen.getByRole("button", { name: "Set password" }));
    expect(confirm).toHaveFocus();
    expect(mocks.setAdminUserPassword).not.toHaveBeenCalled();
    await user.clear(confirm);
    await user.type(confirm, "fixture-password{Enter}");
    await waitFor(() => expect(mocks.setAdminUserPassword).toHaveBeenCalledWith(42, "fixture-password"));
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    expect(password).toBeDisabled();
    expect(screen.getByLabelText("Provider ID")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Set password" }));
    expect(mocks.setAdminUserPassword).toHaveBeenCalledTimes(1);
    await act(async () => rejectSave(new Error("Fixture password failure")));
    expect(await within(screen.getByRole("group", { name: "Change local password" })).findByRole("alert")).toHaveTextContent("Fixture password failure");
    expect(password).toHaveValue("fixture-password");
    expect(confirm).toHaveValue("fixture-password");
    expect(password).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Set password" }));
    await waitFor(() => expect(password).toHaveValue(""));
    expect(mocks.setAdminUserPassword.mock.calls[1]).toEqual(mocks.setAdminUserPassword.mock.calls[0]);
    expect(parentSubmit).not.toHaveBeenCalled();
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it.each(["oidc", "ldap"])("validates identity fields and preserves the %s payload on Enter", async (providerType) => {
    const user = userEvent.setup(), parentSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    render(<form onSubmit={parentSubmit}><UserAuthenticationPanel userId={42} canMutate /></form>);
    await user.click(await screen.findByRole("button", { name: "Link identity" }));
    expect(screen.getByLabelText("Provider ID")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Provider ID")).toHaveFocus();
    expect(screen.getByLabelText("Immutable subject")).toHaveAttribute("aria-invalid", "true");
    await user.selectOptions(screen.getByLabelText("Provider type"), providerType);
    await user.type(screen.getByLabelText("Provider ID"), " company-two ");
    await user.type(screen.getByLabelText("Immutable subject"), " immutable-subject-two ");
    const email = screen.getByLabelText("Claimed email (optional)");
    await user.type(email, "invalid-email");
    await user.click(screen.getByRole("button", { name: "Link identity" }));
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveFocus();
    expect(mocks.addAdminExternalIdentity).not.toHaveBeenCalled();
    await user.clear(email);
    await user.type(email, "claim@example.com");
    fireEvent.keyDown(email, { key: "Enter", isComposing: true });
    expect(mocks.addAdminExternalIdentity).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(mocks.addAdminExternalIdentity).toHaveBeenCalledWith(42, {
      provider_type: providerType, provider_id: " company-two ", subject: " immutable-subject-two ",
      email: "claim@example.com", email_verified: providerType === "oidc",
    }));
    await waitFor(() => expect(screen.getByLabelText("Provider ID")).toHaveValue(""));
    expect(parentSubmit).not.toHaveBeenCalled();
  });

  it("shows an action failure inside its confirmation and retries the same identity", async () => {
    const user = userEvent.setup();
    mocks.revokeAdminExternalIdentity.mockRejectedValueOnce(new ApiError("Request failed", {
      response: { status: 403, data: { detail: "Fixture permission denied" }, headers: {} },
    }));
    render(<UserAuthenticationPanel userId={42} canMutate />);
    const region = await screen.findByRole("region", { name: "External identities" });
    await user.click(within(region).getByRole("button", { name: "Revoke" }));
    const dialog = screen.getByRole("dialog", { name: "Revoke external identity" });
    expect(within(dialog).getByText("immutable-subject")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Fixture permission denied");
    expect(screen.queryByRole("dialog", { name: "Verify with passkey" })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(mocks.revokeAdminExternalIdentity.mock.calls).toEqual([[42, "identity-1"], [42, "identity-1"]]);
  });

  it("distinguishes a refresh failure after a successful action from a failed action", async () => {
    const user = userEvent.setup();
    mocks.getAdminUserSecurity.mockResolvedValueOnce(security).mockRejectedValueOnce(new Error("Fixture refresh failed"));
    render(<UserAuthenticationPanel userId={42} canMutate />);
    const password = await screen.findByLabelText("New password");
    await user.type(password, "fixture-password");
    await user.type(screen.getByLabelText("Confirm password"), "fixture-password");
    await user.click(screen.getByRole("button", { name: "Set password" }));
    expect(await screen.findByText("Fixture refresh failed")).toBeInTheDocument();
    expect(screen.getByText("Local password updated and user sessions revoked.")).toBeInTheDocument();
    expect(password).toHaveValue("");
    expect(password).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(password).toBeEnabled());
    expect(mocks.setAdminUserPassword).toHaveBeenCalledTimes(1);
  });

  it("retains the password draft when passkey verification is cancelled", async () => {
    const user = userEvent.setup(), onBusyChange = vi.fn();
    mocks.setAdminUserPassword.mockRejectedValueOnce(new ApiError("Request failed", {
      response: { status: 403, data: { detail: "Recent WebAuthn verification required" }, headers: {} },
    }));
    render(<UserAuthenticationPanel userId={42} canMutate onBusyChange={onBusyChange} />);
    const password = await screen.findByLabelText("New password");
    await user.type(password, "fixture-password");
    await user.type(screen.getByLabelText("Confirm password"), "fixture-password");
    await user.click(screen.getByRole("button", { name: "Set password" }));
    const dialog = await screen.findByRole("dialog", { name: "Verify with passkey" });
    expect(password).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(password).toHaveValue("fixture-password");
    await waitFor(() => expect(password).toBeEnabled());
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    expect(mocks.setAdminUserPassword).toHaveBeenCalledTimes(1);
    expect(mocks.authenticatePasskey).not.toHaveBeenCalled();
  });

  it("locks passkey verification dismissal only while the verification request is pending", async () => {
    const user = userEvent.setup();
    let completeVerification!: () => void;
    mocks.finishRecentWebAuthnVerification.mockImplementationOnce(() => new Promise<void>((resolve) => { completeVerification = resolve; }));
    mocks.resetAdminUserMfa.mockRejectedValueOnce(new ApiError("Request failed", {
      response: { status: 403, data: { detail: "Recent WebAuthn verification required" }, headers: {} },
    }));
    render(<UserAuthenticationPanel userId={42} canMutate />);
    await user.click(await screen.findByRole("button", { name: "Reset MFA" }));
    await user.click(within(screen.getByRole("dialog", { name: "Reset user MFA" })).getByRole("button", { name: "Reset MFA" }));
    const dialog = await screen.findByRole("dialog", { name: "Verify with passkey" });
    await user.click(within(dialog).getByRole("button", { name: "Verify with passkey" }));
    await waitFor(() => expect(mocks.finishRecentWebAuthnVerification).toHaveBeenCalledOnce());
    expect(within(dialog).getByRole("button", { name: "Close modal" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(dialog).toBeInTheDocument();
    await act(async () => completeVerification());
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(mocks.resetAdminUserMfa).toHaveBeenCalledTimes(2);
  });

});
