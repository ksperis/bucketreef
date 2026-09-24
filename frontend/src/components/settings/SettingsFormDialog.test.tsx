/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useState } from "react";
import { transferableAbortController } from "node:util";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider, useNavigate } from "react-router-dom";
import { LanguageProvider } from "../language";
import UiInput from "../ui/UiInput";
import { setSessionUserCache } from "../../utils/workspaces";
import SettingsFormDialog from "./SettingsFormDialog";
import SettingsNavigationGuard from "./SettingsNavigationGuard";

beforeEach(() => {
  // React Router's Node Request must receive a Node-compatible AbortSignal.
  vi.stubGlobal("AbortController", function () { return transferableAbortController(); });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setSessionUserCache(null); localStorage.clear(); });

function Draft({ onSubmit = vi.fn(), onClose = vi.fn(), busy = false, completed = false }: {
  onSubmit?: () => void | Promise<void>; onClose?: (reason?: "navigation") => void; busy?: boolean; completed?: boolean;
}) {
  const [email, setEmail] = useState("");
  return <SettingsFormDialog title="Invite" draftKey={email} busy={busy} completed={completed}
    submitLabel="Send" onSubmit={onSubmit} onClose={onClose}>
    <UiInput label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
  </SettingsFormDialog>;
}

describe("SettingsFormDialog", () => {
  it("keeps pristine fields editable while disabling submit until the draft changes", async () => {
    const user = userEvent.setup();
    render(<Draft />);

    expect(screen.getByLabelText("Email")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    await user.type(screen.getByLabelText("Email"), "person@example.org");
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  it.each(["Cancel", "Close", "Escape", "Backdrop"])("guards %s and restores the draft after Keep editing", async (action) => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Draft onClose={onClose} />);
    await waitFor(() => expect(screen.getByLabelText("Email")).toHaveFocus());
    await user.type(screen.getByLabelText("Email"), "person@example.org");
    const dismiss = async () => {
      if (action === "Escape") await user.keyboard("{Escape}");
      else if (action === "Backdrop") fireEvent.mouseDown(document.querySelector(".modal-surface")!);
      else await user.click(screen.getByRole("button", { name: action, exact: true }));
    };
    await dismiss();
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByLabelText("Email")).toHaveValue("person@example.org");
    await dismiss();
    await user.click(screen.getByRole("button", { name: "Discard changes", exact: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps browser validation and suppresses repeated submissions and dismissal until the promise settles", async () => {
    const user = userEvent.setup();
    let resolve!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    const onClose = vi.fn();
    render(<Draft onSubmit={onSubmit} onClose={onClose} />);
    await user.type(screen.getByLabelText("Email"), "invalid");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onSubmit).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText("Email"));
    await user.type(screen.getByLabelText("Email"), "person@example.org");
    await user.keyboard("{Enter}");
    fireEvent.submit(screen.getByRole("form", { name: "Invite" }));
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Email")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close", exact: true })).toBeDisabled();
    await user.keyboard("{Escape}");
    fireEvent.mouseDown(document.querySelector(".modal-surface")!);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => resolve());
    expect(screen.getByLabelText("Email")).toBeEnabled();
  });

  it("warns on reload only for unapplied drafts and lets a completed form close without another submission", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(<Draft onClose={onClose} />);
    await user.type(screen.getByLabelText("Email"), "person@example.org");
    const unsaved = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unsaved);
    expect(unsaved.defaultPrevented).toBe(true);
    rerender(<Draft onClose={onClose} completed />);
    const saved = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(saved);
    expect(saved.defaultPrevented).toBe(false);
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "Discard changes?" })).not.toBeInTheDocument();
  });

  it.each(["close", "navigate"])("protects route changes and handles %s after one discard confirmation", async (action) => {
    setSessionUserCache({ role: "ui_user", authType: "password" });
    const user = userEvent.setup();
    function Page() {
      const navigate = useNavigate();
      const [open, setOpen] = useState(true);
      return open ? <Draft onClose={(reason) => { setOpen(false); if (reason !== "navigation") navigate("/edit"); }} /> : <p>Closed</p>;
    }
    const router = createMemoryRouter([
      { path: "/edit", element: <Page /> },
      { path: "/next", element: <p>Next page</p> },
    ], { initialEntries: ["/edit?create=1"] });
    render(<RouterProvider router={router} />);
    await user.type(screen.getByLabelText("Email"), "person@example.org");
    await act(async () => { void router.navigate("/next"); });
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(router.state.location.pathname).toBe("/edit");
    if (action === "close") await user.click(screen.getByRole("button", { name: "Cancel", exact: true }));
    else await act(async () => { void router.navigate("/next"); });
    await user.click(screen.getByRole("button", { name: "Discard changes", exact: true }));
    expect(await screen.findByText(action === "close" ? "Closed" : "Next page")).toBeVisible();
    expect(router.state.location.search).toBe("");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    router.dispose();
  });

  it("blocks leaving a pending operation even when no field changed and an idle page guard exists", async () => {
    setSessionUserCache({ role: "ui_user", authType: "password" });
    const user = userEvent.setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const router = createMemoryRouter([
      { path: "/edit", element: <><SettingsNavigationGuard dirty={false} /><Draft busy /></> },
      { path: "/next", element: <p>Next page</p> },
    ], { initialEntries: ["/edit"] });
    render(<RouterProvider router={router} />);
    await act(async () => { void router.navigate("/next"); });
    expect(screen.getByRole("dialog", { name: "Operation in progress" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Discard changes", exact: true })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(router.state.location.pathname).toBe("/edit");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    router.dispose();
  });

  it.each([
    ["fr", "Annuler", "Abandonner les modifications ?", "Continuer la modification"],
    ["de", "Abbrechen", "Änderungen verwerfen?", "Weiter bearbeiten"],
  ] as const)("localizes draft controls in %s", async (language, cancel, title, keep) => {
    setSessionUserCache({ role: "ui_user", authType: "password", ui_language: language });
    const user = userEvent.setup();
    render(<LanguageProvider><Draft /></LanguageProvider>);
    await user.type(screen.getByLabelText("Email"), "person@example.org");
    await user.click(screen.getByRole("button", { name: cancel }));
    expect(screen.getByRole("dialog", { name: title })).toBeVisible();
    expect(screen.getByRole("button", { name: keep })).toBeVisible();
  });
});
