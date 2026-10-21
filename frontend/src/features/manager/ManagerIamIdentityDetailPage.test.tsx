/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { transferableAbortController } from "node:util";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import ManagerIamIdentityDetailPage from "./ManagerIamIdentityDetailPage";

const api = vi.hoisted(() => ({
  getUser: vi.fn(),
  updateUser: vi.fn(),
  getGroup: vi.fn(),
  updateGroup: vi.fn(),
}));

vi.mock("./ExecutionContextProvider", () => ({
  useExecutionContext: () => ({
    selectedContextKind: "account",
    contextIdForApi: "acc-7",
    requiresContextSelection: true,
    accessMode: "default",
  }),
}));

vi.mock("../../api/managerIamUsers", async (original) => ({
  ...await original<typeof import("../../api/managerIamUsers")>(),
  getIamUser: api.getUser,
  updateIamUser: api.updateUser,
}));

vi.mock("../../api/managerIamGroups", async (original) => ({
  ...await original<typeof import("../../api/managerIamGroups")>(),
  getIamGroup: api.getGroup,
  updateIamGroup: api.updateGroup,
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("AbortController", function () { return transferableAbortController(); });
  api.getUser.mockImplementation(async (_account, name) => ({
    name,
    path: name === "alice-renamed" ? "/service/" : "/people/",
    arn: `arn:aws:iam::7:user/${name}`,
  }));
  api.updateUser.mockResolvedValue({
    name: "alice-renamed",
    path: "/service/",
    arn: "arn:aws:iam::7:user/alice-renamed",
  });
  api.getGroup.mockImplementation(async (_account, name) => ({
    name,
    path: "/teams/",
    arn: `arn:aws:iam::7:group/${name}`,
  }));
  api.updateGroup.mockResolvedValue({
    name: "research-renamed",
    path: "/science/",
    arn: "arn:aws:iam::7:group/research-renamed",
  });
});

afterEach(() => vi.unstubAllGlobals());

it("loads a native IAM user, renames it and follows the provider canonical name", async () => {
  const router = createMemoryRouter([
    { path: "/manager/users/:userName", element: <ManagerIamIdentityDetailPage kind="user" /> },
  ], { initialEntries: ["/manager/users/alice"] });
  render(<RouterProvider router={router} />);

  const form = await screen.findByRole("form", { name: "IAM user details" });
  const name = within(form).getByLabelText("User name");
  const path = within(form).getByLabelText("IAM path");
  expect(name).toHaveValue("alice");
  expect(path).toHaveValue("/people/");
  expect(within(form).getByLabelText("ARN")).toHaveValue("arn:aws:iam::7:user/alice");

  fireEvent.change(name, { target: { value: "alice-renamed" } });
  fireEvent.change(path, { target: { value: "/service/" } });
  fireEvent.submit(form);

  await waitFor(() => expect(api.updateUser).toHaveBeenCalledWith(
    "acc-7", "alice", { name: "alice-renamed", path: "/service/" },
  ));
  await waitFor(() => expect(router.state.location.pathname).toBe("/manager/users/alice-renamed"));
  await waitFor(() => expect(api.getUser).toHaveBeenCalledWith("acc-7", "alice-renamed"));
});

it("loads and updates a native IAM group", async () => {
  const router = createMemoryRouter([
    { path: "/manager/groups/:groupName", element: <ManagerIamIdentityDetailPage kind="group" /> },
  ], { initialEntries: ["/manager/groups/research"] });
  render(<RouterProvider router={router} />);

  const form = await screen.findByRole("form", { name: "IAM group details" });
  fireEvent.change(within(form).getByLabelText("Group name"), { target: { value: "research-renamed" } });
  fireEvent.change(within(form).getByLabelText("IAM path"), { target: { value: "/science/" } });
  fireEvent.submit(form);

  await waitFor(() => expect(api.updateGroup).toHaveBeenCalledWith(
    "acc-7", "research", { name: "research-renamed", path: "/science/" },
  ));
});

it("renders BucketReef-managed identities read-only", async () => {
  api.getUser.mockResolvedValue({
    name: "bkr-private-u1-acc7",
    path: "/",
    arn: "arn:aws:iam::7:user/bkr-private-u1-acc7",
    is_bucketreef_managed: true,
    management_source: "private_access",
  });
  const router = createMemoryRouter([
    { path: "/manager/users/:userName", element: <ManagerIamIdentityDetailPage kind="user" /> },
  ], { initialEntries: ["/manager/users/bkr-private-u1-acc7"] });
  render(<RouterProvider router={router} />);

  const form = await screen.findByRole("form", { name: "IAM user details" });
  await screen.findByText("This identity is managed by BucketReef and cannot be renamed or moved here.");
  expect(within(form).getByLabelText("User name")).toHaveAttribute("readonly");
  expect(within(form).getByLabelText("IAM path")).toHaveAttribute("readonly");
  expect(within(form).queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  expect(api.updateUser).not.toHaveBeenCalled();
});

it("validates IAM paths before sending an identity update", async () => {
  const router = createMemoryRouter([
    { path: "/manager/users/:userName", element: <ManagerIamIdentityDetailPage kind="user" /> },
  ], { initialEntries: ["/manager/users/alice"] });
  render(<RouterProvider router={router} />);
  const form = await screen.findByRole("form", { name: "IAM user details" });
  const path = within(form).getByLabelText("IAM path");
  fireEvent.change(path, { target: { value: "invalid" } });
  fireEvent.submit(form);
  await waitFor(() => expect(path).toHaveFocus());
  expect(path).toHaveAccessibleDescription(/IAM path must be '\/' or start and end with '\/'\./);
  expect(api.updateUser).not.toHaveBeenCalled();
});
