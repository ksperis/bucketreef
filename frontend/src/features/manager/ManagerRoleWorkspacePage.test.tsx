import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { transferableAbortController } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ManagerRoleWorkspacePage from "./ManagerRoleWorkspacePage";

const api = vi.hoisted(() => ({
  getRole: vi.fn(),
  updateRole: vi.fn(),
  putTags: vi.fn(),
  deleteTag: vi.fn(),
}));

vi.mock("./ExecutionContextProvider", () => ({
  useExecutionContext: () => ({
    selectedContextKind: "account",
    contextIdForApi: "acc-7",
    requiresContextSelection: false,
  }),
}));

vi.mock("../../api/managerIamRoles", async (original) => ({
  ...await original<typeof import("../../api/managerIamRoles")>(),
  getIamRole: api.getRole,
  updateIamRole: api.updateRole,
  putRoleTags: api.putTags,
  deleteRoleTag: api.deleteTag,
}));

function renderWorkspace(path: string) {
  const router = createMemoryRouter([
    { path: "/manager/roles/:roleName", element: <ManagerRoleWorkspacePage /> },
    { path: "/manager/roles/:roleName/trust", element: <ManagerRoleWorkspacePage /> },
  ], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe("ManagerRoleWorkspacePage", () => {
  const trust = { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { AWS: "*" }, Action: "sts:AssumeRole" }] };
  let currentRole: Record<string, unknown>;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("AbortController", function () { return transferableAbortController(); });
    currentRole = {
      name: "app-reader",
      path: "/application/",
      arn: "arn:aws:iam::acc-7:role/application/app-reader",
      assume_role_policy_document: trust,
      max_session_duration: 3600,
      tags: [{ key: "team", value: "storage" }],
    };
    api.getRole.mockImplementation(async () => currentRole);
    api.updateRole.mockImplementation(async (_account, _name, changes) => {
      currentRole = {
        ...currentRole,
        ...(changes.max_session_duration !== undefined ? { max_session_duration: changes.max_session_duration } : {}),
        ...(changes.assume_role_policy_document !== undefined ? { assume_role_policy_document: changes.assume_role_policy_document } : {}),
      };
      return currentRole;
    });
    api.putTags.mockResolvedValue([]);
    api.deleteTag.mockResolvedValue([]);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("updates General settings without rewriting the trust policy and navigates to the Trust tab", async () => {
    const router = renderWorkspace("/manager/roles/app-reader");
    const form = await screen.findByRole("form", { name: "Edit IAM role" });

    expect(within(form).getByLabelText("Role name")).toHaveAttribute("readonly");
    expect(within(form).getByLabelText("ARN")).toHaveValue("arn:aws:iam::acc-7:role/application/app-reader");
    expect(within(form).queryByLabelText("Assume role policy (JSON)")).not.toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText("Maximum session duration (seconds)"), { target: { value: "7200" } });
    fireEvent.submit(form);

    await waitFor(() => expect(api.updateRole).toHaveBeenCalledWith("acc-7", "app-reader", { max_session_duration: 7200 }));
    fireEvent.click(screen.getByRole("tab", { name: "Trust policy" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/manager/roles/app-reader/trust"));
    expect(await screen.findByRole("textbox", { name: "Assume role policy (JSON)" })).toBeEnabled();
  });

  it("updates only the trust policy from its deep link", async () => {
    renderWorkspace("/manager/roles/app-reader/trust");
    const form = await screen.findByRole("form", { name: "Edit IAM role" });
    const policy = within(form).getByRole("textbox", { name: "Assume role policy (JSON)" });
    const changedTrust = { Version: "2012-10-17", Statement: [] };

    expect(within(form).queryByLabelText("Maximum session duration (seconds)")).not.toBeInTheDocument();
    fireEvent.change(policy, { target: { value: JSON.stringify(changedTrust) } });
    fireEvent.submit(form);

    await waitFor(() => expect(api.updateRole).toHaveBeenCalledWith("acc-7", "app-reader", { assume_role_policy_document: changedTrust }));
    expect(api.putTags).not.toHaveBeenCalled();
    expect(api.deleteTag).not.toHaveBeenCalled();
  });
});
