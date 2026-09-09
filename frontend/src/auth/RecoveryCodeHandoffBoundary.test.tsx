import { transferableAbortController } from "node:util";
/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import client from "../api/client";
import { LanguageProvider } from "../components/language";
import SecurityPage from "../features/shared/SecurityPage";
import { readStoredUser } from "../utils/workspaces";
import { RequireAuth } from "../routerGuards";
import { SessionProvider, useSession } from "./SessionProvider";
import RecoveryCodeHandoffBoundary from "./RecoveryCodeHandoffBoundary";
import { deferRecoveryAuthRedirect, recoveryCodeHandoff } from "./recoveryCodeHandoff";

vi.mock("../components/GeneralSettingsContext", () => ({ useGeneralSettings: () => ({ generalSettings: { require_passkey_for_users: false } }) }));
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
function SessionProbe() {
  const { authenticated } = useSession();
  return <output aria-label="Authentication state">{String(authenticated)}</output>;
}
const syntheticCodes = ["fixture-recovery-one", "fixture-recovery-two"];
let respondToRotation: (response: Response) => void;

describe("memory-only recovery code handoff", () => {
  beforeEach(() => {
    // Node fetch requires its own AbortSignal rather than the JSDOM implementation.
    vi.stubGlobal("AbortController", function () { return transferableAbortController(); });
    recoveryCodeHandoff.reset();
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState(null, "", "/browser/profile?tab=security");
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/auth/session") return json({ user: { id: 1, role: "ui_user", email: "test@example.test", ui_language: "de", has_local_password: true }, auth_session: { auth_type: "password" } });
      if (path.endsWith("/webauthn/credentials")) return json([{ id: "key", name: "Laptop", created_at: "2026-01-01T12:00:00Z" }]);
      if (path.endsWith("/external-identities") || path.endsWith("/sessions")) return json([]);
      if (path.endsWith("/recovery-codes")) return new Promise<Response>(resolve => { respondToRotation = resolve; });
      return json({ detail: "Not authenticated" }, 401);
    });
  });
  afterEach(() => { cleanup(); recoveryCodeHandoff.reset(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  function mount() {
    const router = createMemoryRouter([
      { element: <RequireAuth />, children: [{ path: "/browser/profile", element: <><div>Authenticated shell</div><SecurityPage /></> }] },
      { path: "/login", element: <h1>Login</h1> },
    ], { initialEntries: ["/browser/profile?tab=security"] });
    render(<LanguageProvider><SessionProvider><SessionProbe /><RecoveryCodeHandoffBoundary><RouterProvider router={router} /></RecoveryCodeHandoffBoundary></SessionProvider></LanguageProvider>);
    return router;
  }
  async function rotate() {
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Codes erneuern" }));
    await user.click(within(screen.getByRole("dialog", { name: "Codes erneuern" })).getByRole("button", { name: "Codes erneuern" }));
    await waitFor(() => expect(recoveryCodeHandoff.getSnapshot().phase).toBe("pending"));
    return user;
  }

  it.each(["before", "after"] as const)("delivers codes with a concurrent 401 %s the rotation response, without preserving authenticated access", async timing => {
    const router = mount();
    const user = await rotate();
    const loseSession = async () => {
      await act(async () => { await expect(client.get("/users/me")).rejects.toBeDefined(); });
      expect(readStoredUser()).toBeNull();
      expect(screen.getByLabelText("Authentication state")).toHaveTextContent("false");
      expect(screen.queryByText("Authenticated shell")).not.toBeInTheDocument();
    };
    if (timing === "before") {
      await loseSession();
      await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
      await act(async () => { await router.navigate("/browser/profile"); });
      await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    }
    await act(async () => respondToRotation(json({ codes: syntheticCodes })));
    if (timing === "after") await loseSession();
    expect(await screen.findByRole("heading", { name: "Wiederherstellungscodes" })).toHaveFocus();
    expect(screen.getByRole("main")).toHaveAttribute("lang", "de");
    expect(screen.queryByText("Authenticated shell")).not.toBeInTheDocument();
    expect(readStoredUser()).toBeNull();
    for (const code of syntheticCodes) {
      expect(screen.getByText(code)).toBeInTheDocument();
      for (const storage of [localStorage, sessionStorage]) {
        const values = Array.from({ length: storage.length }, (_, index) => storage.getItem(storage.key(index)!));
        expect(values.join(" ")).not.toContain(code);
      }
      expect(window.location.href).not.toContain(code);
    }
    await user.click(screen.getByRole("button", { name: "Codes gespeichert — Anmelden" }));
    expect(recoveryCodeHandoff.getSnapshot()).toEqual({ phase: "idle", codes: [] });
    expect(screen.queryByText(syntheticCodes[0])).not.toBeInTheDocument();
    expect(deferRecoveryAuthRedirect()).toBe(false);
  });

  it("releases the redirect deferral on failure and keeps the error by the confirmed action", async () => {
    mount();
    await rotate();
    await act(async () => respondToRotation(json({ detail: "Unavailable" }, 503)));
    expect(recoveryCodeHandoff.getSnapshot().phase).toBe("idle");
    expect(deferRecoveryAuthRedirect()).toBe(false);
    expect(within(screen.getByRole("dialog", { name: "Codes erneuern" })).getByRole("alert")).toHaveTextContent("Der Dienst ist nicht verfügbar.");
    expect(screen.getByLabelText("Authentication state")).toHaveTextContent("true");
  });

  it("restores normal unauthenticated navigation when rotation fails after a concurrent 401", async () => {
    mount();
    await rotate();
    await act(async () => { await expect(client.get("/users/me")).rejects.toBeDefined(); });
    await act(async () => respondToRotation(json({ detail: "Unavailable" }, 503)));
    expect(recoveryCodeHandoff.getSnapshot()).toEqual({ phase: "idle", codes: [] });
    expect(deferRecoveryAuthRedirect()).toBe(false);
    expect(readStoredUser()).toBeNull();
    expect(await screen.findByRole("heading", { name: "Login" })).toBeInTheDocument();
  });

  it("clears the handoff after leaving the page and refuses stale completion", () => {
    const operation = recoveryCodeHandoff.begin();
    expect(deferRecoveryAuthRedirect()).toBe(true);
    recoveryCodeHandoff.reset();
    operation.complete(syntheticCodes);
    expect(recoveryCodeHandoff.getSnapshot()).toEqual({ phase: "idle", codes: [] });
    expect(deferRecoveryAuthRedirect()).toBe(false);
  });
});
