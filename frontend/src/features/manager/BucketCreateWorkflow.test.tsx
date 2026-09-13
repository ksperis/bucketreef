/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { transferableAbortController } from "node:util";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { setSessionUserCache } from "../../utils/workspaces";
import BucketCreateWorkflow from "./BucketCreateWorkflow";

beforeEach(() => {
  vi.stubGlobal("AbortController", function () { return transferableAbortController(); });
  setSessionUserCache({ role: "ui_user", authType: "password" });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setSessionUserCache(null); });

function setup(needsContext = false) {
  const create = vi.fn(async () => ({ created: false }));
  const close = vi.fn();
  const router = createMemoryRouter([
    { path: "/manager/buckets", element: <BucketCreateWorkflow contextLabel="Account Alpha"
      needsContext={needsContext} busy={false} error={null} onCreate={create} onClose={close} /> },
    { path: "/manager", element: <p>Manager destination</p> },
  ], { initialEntries: ["/manager/buckets"] });
  render(<RouterProvider router={router} />);
  return { user: userEvent.setup(), create, close, router };
}

it("shows all settings together and focuses adjacent name validation before creating", async () => {
  const { user, create } = setup();
  expect(screen.getByText("Context: Account Alpha")).toBeVisible();
  expect(screen.getByRole("heading", { name: "General" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Protection" })).toBeVisible();
  const name = screen.getByRole("textbox", { name: "Bucket name" });
  await user.click(screen.getByRole("button", { name: "Create bucket" }));
  await waitFor(() => expect(name).toHaveFocus());
  expect(name).toHaveAccessibleDescription(/Bucket name is required/);
  await user.type(name, "ab");
  await user.click(screen.getByRole("button", { name: "Create bucket" }));
  await waitFor(() => expect(name).toHaveFocus());
  expect(name).toHaveAttribute("aria-invalid", "true");
  expect(create).not.toHaveBeenCalled();
});

it("normalizes the name, preserves hidden location drafts and submits the selected S3 settings", async () => {
  const { user, create, close } = setup();
  await user.type(screen.getByRole("textbox", { name: "Bucket name" }), "REPORTS-DEMO");
  await user.click(screen.getByRole("switch", { name: "Custom LocationConstraint" }));
  await user.type(screen.getByRole("textbox", { name: "LocationConstraint" }), " eu-west-1 ");
  await user.click(screen.getByRole("switch", { name: "Custom LocationConstraint" }));
  await user.click(screen.getByRole("button", { name: "Create bucket" }));
  expect(create).toHaveBeenLastCalledWith("reports-demo", false, undefined);
  expect(close).not.toHaveBeenCalled();
  await user.click(screen.getByRole("switch", { name: "Custom LocationConstraint" }));
  expect(screen.getByRole("textbox", { name: "LocationConstraint" })).toHaveValue(" eu-west-1 ");
  await user.click(screen.getByRole("switch", { name: "Versioning" }));
  create.mockResolvedValueOnce({ created: true });
  await user.click(screen.getByRole("button", { name: "Create bucket" }));
  expect(create).toHaveBeenLastCalledWith("reports-demo", true, "eu-west-1");
  expect(close).toHaveBeenCalledOnce();
});

it("keeps the endpoint default for an empty custom location", async () => {
  const { user, create } = setup();
  await user.type(screen.getByRole("textbox", { name: "Bucket name" }), "reports-demo");
  await user.click(screen.getByRole("switch", { name: "Custom LocationConstraint" }));
  await user.type(screen.getByRole("textbox", { name: "LocationConstraint" }), "   ");
  await user.click(screen.getByRole("button", { name: "Create bucket" }));
  expect(create).toHaveBeenCalledWith("reports-demo", false, undefined);
});

it("guards dirty navigation and reload, then leaves only after discard", async () => {
  const { user, close, router } = setup();
  await user.type(screen.getByRole("textbox", { name: "Bucket name" }), "draft-bucket");
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  await user.click(screen.getByRole("button", { name: "Back to buckets" }));
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByRole("textbox", { name: "Bucket name" })).toHaveValue("draft-bucket");
  expect(close).not.toHaveBeenCalled();
  await user.click(screen.getByRole("link", { name: "Manager", exact: true }));
  await user.click(screen.getByRole("button", { name: "Discard changes", exact: true }));
  expect(await screen.findByText("Manager destination")).toBeVisible();
  expect(close).toHaveBeenCalledOnce();
  router.dispose();
});

it("locks the draft and navigation during creation and prevents duplicate submissions", async () => {
  const { user, create, close, router } = setup();
  let finish!: (value: { created: boolean }) => void;
  create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await user.type(screen.getByRole("textbox", { name: "Bucket name" }), "pending-bucket{Enter}");
  fireEvent.submit(screen.getByRole("form", { name: "Create bucket" }));
  expect(create).toHaveBeenCalledOnce();
  expect(screen.getByRole("textbox", { name: "Bucket name" })).toBeDisabled();
  expect(screen.getByRole("switch", { name: "Versioning" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Back to buckets" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await user.click(screen.getByRole("link", { name: "Manager", exact: true }));
  expect(screen.getByRole("dialog", { name: "Operation in progress" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Discard changes", exact: true })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  await act(async () => finish({ created: false }));
  expect(screen.getByRole("textbox", { name: "Bucket name" })).toHaveValue("pending-bucket");
  expect(screen.getByRole("button", { name: "Create bucket" })).toBeEnabled();
  expect(close).not.toHaveBeenCalled();
  expect(router.state.location.pathname).toBe("/manager/buckets");
  router.dispose();
});

it("cannot create without an execution context and can leave a clean form", async () => {
  const { user, create, close } = setup(true);
  expect(screen.getByRole("button", { name: "Create bucket" })).toBeDisabled();
  fireEvent.submit(screen.getByRole("form", { name: "Create bucket" }));
  expect(create).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(close).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
