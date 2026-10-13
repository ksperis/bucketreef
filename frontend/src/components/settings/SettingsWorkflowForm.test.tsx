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

it("keeps the form interactive when local validation rejects synchronously", () => {
  const save = vi.fn(() => undefined);
  const close = vi.fn();
  render(
    <SettingsWorkflowForm title="Create account" dirty onClose={close} onSubmit={save}
      submitLabel="Create account" backLabel="Back to accounts">
      <UiInput label="Name" value="" onChange={() => undefined} />
    </SettingsWorkflowForm>
  );

  const form = screen.getByRole("form", { name: "Create account" });
  fireEvent.submit(form);
  expect(save).toHaveBeenCalledOnce();
  expect(screen.getByRole("textbox", { name: "Name" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Back to accounts" })).toBeEnabled();

  fireEvent.submit(form);
  expect(save).toHaveBeenCalledTimes(2);
});

it("uses Done for a clean persistent editor and rebases back to Done after save", async () => {
  const user = userEvent.setup();
  const close = vi.fn();
  const save = vi.fn();
  function Page() {
    const [value, setValue] = useState("Stored");
    const [baseline, setBaseline] = useState("Stored");
    return <SettingsWorkflowForm title="Edit endpoint" persistentEdit dirty={value !== baseline}
      onClose={close} onSubmit={() => { save(value); setBaseline(value); }} submitLabel="Save changes">
      <UiInput label="Name" value={value} onChange={event => setValue(event.target.value)} />
    </SettingsWorkflowForm>;
  }
  render(<Page />);

  expect(screen.getByRole("button", { name: "Done" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("textbox", { name: "Name" }));
  await user.keyboard(" updated");
  expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();

  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(save).toHaveBeenCalledWith("Stored updated");
  expect(screen.getByRole("button", { name: "Done" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(close).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("keeps persistent editor actions locked while a save is pending", async () => {
  const user = userEvent.setup();
  let resolve!: () => void;
  const save = vi.fn(() => new Promise<void>(done => { resolve = done; }));
  render(<SettingsWorkflowForm title="Edit endpoint" persistentEdit dirty onClose={vi.fn()} onSubmit={save}
    submitLabel="Save changes" busyLabel="Saving...">
    <UiInput label="Name" value="Changed" onChange={() => undefined} />
  </SettingsWorkflowForm>);

  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
  expect(screen.getByRole("textbox", { name: "Name" })).toBeDisabled();
  await act(async () => resolve());
  expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
});

it("keeps consultation non-submittable and closes without a draft confirmation", async () => {
  const user = userEvent.setup();
  const save = vi.fn();
  const close = vi.fn();
  const router = createMemoryRouter([{
    path: "/view",
    element: <SettingsWorkflowForm title="View provider" dirty readOnly width="wide"
      submitLabel="Save provider" onSubmit={save} onClose={close}>
      <output aria-label="Stored credential">Stored — value hidden</output>
    </SettingsWorkflowForm>,
  }], { initialEntries: ["/view"] });
  render(<RouterProvider router={router} />);

  fireEvent.submit(screen.getByRole("form", { name: "View provider" }));
  expect(save).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Save provider" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Close", exact: true }));
  expect(close).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  router.dispose();
});
