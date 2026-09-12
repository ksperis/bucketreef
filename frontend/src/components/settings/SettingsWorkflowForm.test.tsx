/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useState } from "react";
import { transferableAbortController } from "node:util";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { setSessionUserCache } from "../../utils/workspaces";
import UiInput from "../ui/UiInput";
import SettingsWorkflowForm from "./SettingsWorkflowForm";

beforeEach(() => {
  vi.stubGlobal("AbortController", function () { return transferableAbortController(); });
  setSessionUserCache({ role: "ui_user", authType: "password" });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setSessionUserCache(null); });

it("submits by Enter, freezes the draft and guards breadcrumbs until the operation settles", async () => {
  const user = userEvent.setup();
  let resolve!: () => void;
  const save = vi.fn(() => new Promise<void>(done => { resolve = done; }));
  const close = vi.fn();
  function Page() {
    const [value, setValue] = useState("");
    return <SettingsWorkflowForm title="Edit settings" dirty={Boolean(value)} onClose={close} onSubmit={save}
      submitLabel="Save settings" backLabel="Back to list"
      breadcrumbs={[{ label: "All settings", to: "/list" }, { label: "List", to: "/list" }, { label: "Edit" }]}>
      <UiInput label="Name" value={value} onChange={event => setValue(event.target.value)} />
    </SettingsWorkflowForm>;
  }
  const router = createMemoryRouter([
    { path: "/edit", element: <Page /> },
    { path: "/list", element: <p>List destination</p> },
  ], { initialEntries: ["/edit"] });
  render(<RouterProvider router={router} />);
  await user.type(screen.getByRole("textbox", { name: "Name" }), "Draft{Enter}");
  fireEvent.submit(screen.getByRole("form", { name: "Edit settings" }));
  expect(save).toHaveBeenCalledOnce();
  expect(screen.getByRole("textbox", { name: "Name" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Back to list" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await user.click(screen.getByRole("link", { name: "List" }));
  expect(close).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("link", { name: "All settings" }));
  expect(screen.getByRole("dialog", { name: "Operation in progress" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Discard changes", exact: true })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(router.state.location.pathname).toBe("/edit");
  await act(async () => resolve());
  expect(screen.getByRole("textbox", { name: "Name" })).toBeEnabled();
  await user.click(screen.getByRole("link", { name: "All settings" }));
  await user.click(screen.getByRole("button", { name: "Discard changes", exact: true }));
  expect(await screen.findByText("List destination")).toBeVisible();
  expect(close).toHaveBeenCalledWith("navigation");
  router.dispose();
});
