import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ManagerGroupsPage from "./ManagerGroupsPage";
import PoliciesPage from "./PoliciesPage";
import ManagerRolesPage from "./ManagerRolesPage";

const useExecutionContextMock = vi.fn();
const listIamGroupsPageMock = vi.fn();
const listIamRolesPageMock = vi.fn();
const listIamPoliciesPageMock = vi.fn();
const deleteIamGroupMock = vi.fn();
const deleteIamRoleMock = vi.fn();

vi.mock("./ExecutionContextProvider", () => ({
  useExecutionContext: () => useExecutionContextMock(),
}));

vi.mock("../../api/managerIamGroups", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamGroups")>("../../api/managerIamGroups");
  return {
    ...actual,
    attachGroupPolicy: vi.fn(),
    createIamGroup: vi.fn(),
    deleteIamGroup: (...args: unknown[]) => deleteIamGroupMock(...args),
    listIamGroupsPage: (...args: unknown[]) => listIamGroupsPageMock(...args),
  };
});

vi.mock("../../api/managerIamRoles", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamRoles")>("../../api/managerIamRoles");
  return {
    ...actual,
    attachRolePolicy: vi.fn(),
    createIamRole: vi.fn(),
    deleteIamRole: (...args: unknown[]) => deleteIamRoleMock(...args),
    getIamRole: vi.fn(),
    listIamRolesPage: (...args: unknown[]) => listIamRolesPageMock(...args),
    updateIamRole: vi.fn(),
  };
});

vi.mock("../../api/managerIamPolicies", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamPolicies")>("../../api/managerIamPolicies");
  return {
    ...actual,
    createIamPolicy: vi.fn(),
    listIamPoliciesPage: (...args: unknown[]) => listIamPoliciesPageMock(...args),
  };
});

function renderManagerPage(element: ReactElement) {
  return render(<MemoryRouter>{element}</MemoryRouter>);
}

describe("Manager IAM inventory tables", () => {
  beforeEach(() => {
    useExecutionContextMock.mockReset();
    listIamGroupsPageMock.mockReset();
    listIamRolesPageMock.mockReset();
    listIamPoliciesPageMock.mockReset();
    deleteIamGroupMock.mockReset();
    deleteIamRoleMock.mockReset();
    useExecutionContextMock.mockReturnValue({
      contexts: [
        {
          id: "acc-1",
          kind: "account",
          display_name: "Tenant account",
          endpoint_name: "Default",
        },
      ],
      selectedContextId: "acc-1",
      selectedContextKind: "account",
      contextIdForApi: "acc-1",
      requiresContextSelection: true,
      accessMode: "default",
      iamIdentity: null,
      sessionAccountName: null,
    });
    listIamGroupsPageMock.mockResolvedValue({ items: [], next_marker: null });
    listIamRolesPageMock.mockResolvedValue({ items: [], next_marker: null });
    listIamPoliciesPageMock.mockResolvedValue({ items: [], next_marker: null });
  });

  it("renders groups through the shared responsive inventory table", async () => {
    listIamGroupsPageMock.mockResolvedValue({
      items: [{
        name: "operators",
        arn: "arn:aws:iam::acc-1:group/operators",
        members: ["alice", "bob", "charlie"],
        policies: ["arn:aws:iam::aws:policy/ReadOnlyAccess"],
        inline_policies: ["local-read"],
      }],
      next_marker: null,
    });

    renderManagerPage(<ManagerGroupsPage />);

    expect(await screen.findByText("operators")).toBeInTheDocument();
    expect(screen.getByText("1 shown on this page")).toBeInTheDocument();
    expect(screen.getByLabelText("Search")).toHaveAttribute("type", "search");
    expect(screen.getByLabelText("Search")).toHaveAttribute("placeholder", "Search by name or ARN");
    expect(screen.getByRole("table")).toHaveClass("responsive-data-table");
    expect(screen.getByText("operators").closest("td")).toHaveAttribute("data-mobile-primary", "true");
    expect(screen.queryByText("arn:aws:iam::acc-1:group/operators")).not.toBeInTheDocument();
    expect(screen.getByText("alice").closest("td")).toHaveAttribute("data-label", "Members");
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.getByText("+1")).toHaveAttribute("title", "charlie");
    expect(screen.getByText("ReadOnlyAccess").closest("td")).toHaveAttribute("data-label", "Policies");
    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveClass("w-[22%]");
    expect(screen.getByRole("columnheader", { name: "Members" })).toHaveClass("w-[28%]");
    expect(screen.queryByText("Managed")).not.toBeInTheDocument();
    expect(screen.queryByText("Inline")).not.toBeInTheDocument();
    expect(screen.getByText("local-read").closest("td")).toHaveAttribute("data-label", "Policies");
    const groupEdit = screen.getByRole("link", { name: "Edit" });
    expect(groupEdit).toHaveAttribute("href", "/manager/groups/operators");
    expect(groupEdit).toHaveAttribute("data-table-default-action", "true");
    expect(groupEdit.closest("td")).toHaveAttribute("data-mobile-actions", "true");
    expect(groupEdit.closest("td")).toHaveClass("w-44");

    await waitFor(() => {
      expect(listIamGroupsPageMock).toHaveBeenCalledWith("acc-1", { marker: null, page_size: 25, include_details: true });
      expect(listIamPoliciesPageMock).toHaveBeenCalledWith("acc-1", { marker: null, page_size: 25 });
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteIamGroupMock).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Delete IAM group?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete group" }));
    await waitFor(() => expect(deleteIamGroupMock).toHaveBeenCalledWith("acc-1", "operators"));
  });

  it("renders roles through the shared responsive inventory table", async () => {
    listIamRolesPageMock.mockResolvedValue({
      items: [{
        name: "app-reader",
        path: "/application/",
        arn: "arn:aws:iam::acc-1:role/app-reader",
        policies: ["arn:aws:iam::aws:policy/ReadOnlyAccess"],
        inline_policies: ["local-read"],
      }],
      next_marker: null,
    });

    renderManagerPage(<ManagerRolesPage />);

    expect(await screen.findByText("app-reader")).toBeInTheDocument();
    expect(screen.getByLabelText("Search")).toHaveAttribute("type", "search");
    expect(screen.getByLabelText("Search")).toHaveAttribute("placeholder", "Search by name, path, or ARN");
    expect(screen.getByRole("table")).toHaveClass("responsive-data-table");
    expect(screen.getByText("app-reader").closest("td")).toHaveAttribute("data-mobile-primary", "true");
    expect(screen.getByText("/application/").closest("td")).toHaveAttribute("data-label", "Path");
    expect(screen.queryByText("arn:aws:iam::acc-1:role/app-reader")).not.toBeInTheDocument();
    expect(screen.getByText("ReadOnlyAccess").closest("td")).toHaveAttribute("data-label", "Policies");
    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveClass("w-[22%]");
    expect(screen.getByRole("columnheader", { name: "Path" })).toHaveClass("w-[18%]");
    expect(screen.queryByText("Managed")).not.toBeInTheDocument();
    expect(screen.queryByText("Inline")).not.toBeInTheDocument();
    expect(screen.getByText("local-read").closest("td")).toHaveAttribute("data-label", "Policies");
    const roleEdit = screen.getByRole("link", { name: "Edit" });
    expect(roleEdit).toHaveAttribute("href", "/manager/roles/app-reader");
    expect(roleEdit).toHaveAttribute("data-table-default-action", "true");
    expect(roleEdit.closest("td")).toHaveAttribute("data-mobile-actions", "true");
    expect(roleEdit.closest("td")).toHaveClass("w-44");

    await waitFor(() => {
      expect(listIamRolesPageMock).toHaveBeenCalledWith("acc-1", { marker: null, page_size: 25, include_details: true });
      expect(listIamPoliciesPageMock).toHaveBeenCalledWith("acc-1", { marker: null, page_size: 25 });
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteIamRoleMock).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Delete IAM role?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete role" }));
    await waitFor(() => expect(deleteIamRoleMock).toHaveBeenCalledWith("acc-1", "app-reader"));
  });

  it("renders policies through the shared responsive inventory table", async () => {
    const readOnlyPolicy = {
        name: "ReadOnlyAccess",
        arn: "arn:aws:iam::aws:policy/ReadOnlyAccess",
        default_version_id: "v1",
      };
    listIamPoliciesPageMock.mockImplementation(async (_contextId: unknown, query?: { search?: string }) => ({
      items: query?.search === "missing" ? [] : [readOnlyPolicy],
      next_marker: null,
    }));

    renderManagerPage(<PoliciesPage />);

    expect(await screen.findByText("ReadOnlyAccess")).toBeInTheDocument();
    expect(screen.getByLabelText("Search")).toHaveAttribute("type", "search");
    expect(screen.getByLabelText("Search")).toHaveAttribute("placeholder", "Search by name or ARN");
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "missing" } });
    await waitFor(() => expect(listIamPoliciesPageMock).toHaveBeenCalledWith("acc-1", {
      marker: null,
      page_size: 25,
      search: "missing",
      include_details: true,
    }));
    await waitFor(() => expect(screen.queryByText("ReadOnlyAccess")).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "readonly" } });
    expect(await screen.findByText("ReadOnlyAccess")).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveClass("responsive-data-table");
    expect(screen.getByText("ReadOnlyAccess").closest("td")).toHaveAttribute("data-mobile-primary", "true");
    expect(screen.getByText("arn:aws:iam::aws:policy/ReadOnlyAccess").closest("td")).toHaveAttribute("data-label", "ARN");
    expect(screen.getByText("v1").closest("td")).toHaveAttribute("data-label", "Version");

    expect(listIamPoliciesPageMock).toHaveBeenCalledWith("acc-1", {
      marker: null,
      page_size: 25,
      search: "readonly",
      include_details: true,
    });
  });
});
