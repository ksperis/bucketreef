import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { transferableAbortController } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ManagerIamIdentityWorkspacePage from "./ManagerIamIdentityWorkspacePage";

vi.mock("./ManagerIamIdentityDetailPage", () => ({ default: ({ kind }: { kind: string }) => <p>{kind} general</p> }));
vi.mock("./ManagerUserKeysPage", () => ({ default: () => <p>user keys</p> }));
vi.mock("./ManagerUserGroupsPage", () => ({ default: () => <p>user groups</p> }));
vi.mock("./ManagerUserPoliciesPage", () => ({ default: () => <p>user policies</p> }));
vi.mock("./ManagerGroupUsersPage", () => ({ default: () => <p>group members</p> }));
vi.mock("./ManagerGroupPoliciesPage", () => ({ default: () => <p>group policies</p> }));

describe("ManagerIamIdentityWorkspacePage", () => {
  beforeEach(() => {
    vi.stubGlobal("AbortController", function () { return transferableAbortController(); });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("opens user deep links in the shared workspace and navigates between tabs", async () => {
    const router = createMemoryRouter([
      { path: "/manager/users/:userName", element: <ManagerIamIdentityWorkspacePage kind="user" /> },
      { path: "/manager/users/:userName/keys", element: <ManagerIamIdentityWorkspacePage kind="user" /> },
      { path: "/manager/users/:userName/groups", element: <ManagerIamIdentityWorkspacePage kind="user" /> },
      { path: "/manager/users/:userName/policies", element: <ManagerIamIdentityWorkspacePage kind="user" /> },
    ], { initialEntries: ["/manager/users/alice/keys"] });
    render(<RouterProvider router={router} />);

    expect(screen.getByRole("heading", { name: "IAM user: alice" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Keys" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("user keys")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Groups" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/manager/users/alice/groups"));
    expect(screen.getByText("user groups")).toBeInTheDocument();
  });

  it("redirects the legacy group users route to the canonical Members tab", async () => {
    const router = createMemoryRouter([
      { path: "/manager/groups/:groupName/members", element: <ManagerIamIdentityWorkspacePage kind="group" /> },
      { path: "/manager/groups/:groupName/users", element: <ManagerIamIdentityWorkspacePage kind="group" /> },
    ], { initialEntries: ["/manager/groups/research/users?ctx=acc-7#members"] });
    render(<RouterProvider router={router} />);

    await waitFor(() => expect(router.state.location.pathname).toBe("/manager/groups/research/members"));
    expect(router.state.location.search).toBe("?ctx=acc-7");
    expect(router.state.location.hash).toBe("#members");
    expect(screen.getByRole("tab", { name: "Members" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("group members")).toBeInTheDocument();
  });
});
