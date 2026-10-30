/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OidcLinkStatus } from "../../api/auth";
import { LanguageProvider } from "../../components/language";
import OidcLinkPage, { oidcLinkCompletionPath } from "./OidcLinkPage";

const mocks = vi.hoisted(() => ({
  beginAuthentication: vi.fn(),
  beginRegistration: vi.fn(),
  confirm: vi.fn(),
  fetchStatus: vi.fn(),
  finishAuthentication: vi.fn(),
  finishRegistration: vi.fn(),
  requestAdmin: vi.fn(),
  startOidcProof: vi.fn(),
  verifyLdap: vi.fn(),
  verifyPassword: vi.fn(),
  authenticatePasskey: vi.fn(),
  createPasskey: vi.fn(),
}));

vi.mock("../../api/auth", () => ({
  beginOidcLinkWebAuthnAuthentication: mocks.beginAuthentication,
  beginOidcLinkWebAuthnRegistration: mocks.beginRegistration,
  confirmOidcLink: mocks.confirm,
  fetchOidcLinkStatus: mocks.fetchStatus,
  finishOidcLinkWebAuthnAuthentication: mocks.finishAuthentication,
  finishOidcLinkWebAuthnRegistration: mocks.finishRegistration,
  requestOidcLinkAdminApproval: mocks.requestAdmin,
  startOidcLinkProof: mocks.startOidcProof,
  verifyOidcLinkLdap: mocks.verifyLdap,
  verifyOidcLinkPassword: mocks.verifyPassword,
}));

vi.mock("../../auth/webauthn", () => ({
  authenticatePasskey: mocks.authenticatePasskey,
  createPasskey: mocks.createPasskey,
}));

function status(
  stage: OidcLinkStatus["stage"],
  overrides: Partial<OidcLinkStatus> = {},
): OidcLinkStatus {
  return {
    attempt_id: "attempt-123",
    target_email: "existing@example.com",
    provider_id: "company",
    source: "login_collision",
    stage,
    proof_methods: [],
    expires_at: "2099-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderPage() {
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={["/oidc/link/attempt-123"]}>
        <Routes>
          <Route path="/oidc/link/:attemptId" element={<OidcLinkPage />} />
        </Routes>
      </MemoryRouter>
    </LanguageProvider>,
  );
}

describe("OidcLinkPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("verifies the existing local password before showing final confirmation", async () => {
    const user = userEvent.setup();
    mocks.fetchStatus.mockResolvedValue(status("proof", {
      proof_methods: [{ type: "password", provider_id: null, display_name: null }],
    }));
    mocks.verifyPassword.mockResolvedValue(status("confirm", {
      proof_methods: [{ type: "password", provider_id: null, display_name: null }],
    }));

    renderPage();

    await user.type(await screen.findByLabelText("Local account password"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "Verify password" }));

    expect(mocks.verifyPassword).toHaveBeenCalledWith("attempt-123", "correct horse battery staple");
    expect(await screen.findByRole("heading", { name: "Confirm account link" })).toBeInTheDocument();
  });

  it("supports proof through an already-linked LDAP identity", async () => {
    const user = userEvent.setup();
    mocks.fetchStatus.mockResolvedValue(status("proof", {
      proof_methods: [{ type: "ldap", provider_id: "corp", display_name: "Corporate directory" }],
    }));
    mocks.verifyLdap.mockResolvedValue(status("confirm"));

    renderPage();

    await user.type(await screen.findByLabelText("Username"), "laurent");
    await user.type(screen.getByLabelText("Password"), "directory-secret");
    await user.click(screen.getByRole("button", { name: "Verify directory account" }));

    expect(mocks.verifyLdap).toHaveBeenCalledWith(
      "attempt-123",
      "corp",
      "laurent",
      "directory-secret",
    );
  });

  it("starts proof through an already-linked OIDC identity", async () => {
    const user = userEvent.setup();
    mocks.fetchStatus.mockResolvedValue(status("proof", {
      proof_methods: [{ type: "oidc", provider_id: "existing-sso", display_name: "Existing SSO" }],
    }));
    mocks.startOidcProof.mockResolvedValue({
      provider: "existing-sso",
      authorization_url: "https://issuer.example.test/authorize",
      state: "state-1",
    });

    renderPage();

    await user.click(await screen.findByRole("button", { name: "Continue with Existing SSO" }));
    await waitFor(() => expect(mocks.startOidcProof).toHaveBeenCalledWith("attempt-123", "existing-sso"));
  });

  it("can fall back to administrator approval", async () => {
    const user = userEvent.setup();
    mocks.fetchStatus.mockResolvedValue(status("proof"));
    mocks.requestAdmin.mockResolvedValue(status("admin_requested"));

    renderPage();

    await user.click(await screen.findByRole("button", { name: "Request administrator approval" }));

    expect(mocks.requestAdmin).toHaveBeenCalledWith("attempt-123");
    expect(await screen.findByText(/sent to a superadministrator for approval/i)).toBeInTheDocument();
  });

  it("completes an existing-passkey MFA step before confirmation", async () => {
    const user = userEvent.setup();
    mocks.fetchStatus.mockResolvedValue(status("mfa"));
    mocks.beginAuthentication.mockResolvedValue({ challenge: "challenge" });
    mocks.authenticatePasskey.mockResolvedValue({ id: "credential" });
    mocks.finishAuthentication.mockResolvedValue(status("confirm"));

    renderPage();

    await user.click(await screen.findByRole("button", { name: "Use passkey" }));

    expect(mocks.beginAuthentication).toHaveBeenCalledWith("attempt-123");
    expect(mocks.authenticatePasskey).toHaveBeenCalledWith({ challenge: "challenge" });
    expect(mocks.finishAuthentication).toHaveBeenCalledWith("attempt-123", { id: "credential" });
    expect(await screen.findByRole("heading", { name: "Confirm account link" })).toBeInTheDocument();
  });

  it("requires recovery-code acknowledgement after passkey enrollment", async () => {
    const user = userEvent.setup();
    mocks.fetchStatus.mockResolvedValue(status("mfa_enrollment"));
    mocks.beginRegistration.mockResolvedValue({ challenge: "registration" });
    mocks.createPasskey.mockResolvedValue({ id: "created-credential" });
    mocks.finishRegistration.mockResolvedValue({
      status: status("confirm"),
      recovery_codes: ["recovery-one", "recovery-two"],
    });

    renderPage();

    await user.click(await screen.findByRole("button", { name: "Create passkey" }));
    expect(await screen.findByText("recovery-one")).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Link account" });
    expect(confirm).toBeDisabled();

    await user.click(screen.getByRole("checkbox"));
    expect(confirm).toBeEnabled();
  });

  it("submits the final explicit confirmation", async () => {
    const user = userEvent.setup();
    mocks.fetchStatus.mockResolvedValue(status("confirm"));
    mocks.confirm.mockResolvedValue(status("confirm"));

    renderPage();

    await user.click(await screen.findByRole("button", { name: "Link account" }));
    expect(mocks.confirm).toHaveBeenCalledWith("attempt-123");
  });

  it("returns profile links to profile and login-collision links to the app root", () => {
    expect(oidcLinkCompletionPath(status("completed", { source: "profile" }))).toBe("/profile");
    expect(oidcLinkCompletionPath(status("completed", { source: "login_collision" }))).toBe("/");
  });
});
