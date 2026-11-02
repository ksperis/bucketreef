import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ManagerUsersPage from "./ManagerUsersPage";

const useExecutionContextMock = vi.fn();
const listIamUsersPageMock = vi.fn();
const listIamGroupsPageMock = vi.fn();
const listIamPoliciesPageMock = vi.fn();
const createIamUserMock = vi.fn();
const deleteIamUserMock = vi.fn();

vi.mock("./ExecutionContextProvider", () => ({
  useExecutionContext: () => useExecutionContextMock(),
}));

vi.mock("../../api/managerIamUsers", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamUsers")>("../../api/managerIamUsers");
  return {
    ...actual,
    listIamUsersPage: (...args: unknown[]) => listIamUsersPageMock(...args),
    createIamUser: (...args: unknown[]) => createIamUserMock(...args),
    deleteIamUser: (...args: unknown[]) => deleteIamUserMock(...args),
  };
});

vi.mock("../../api/managerIamGroups", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamGroups")>("../../api/managerIamGroups");
  return {
    ...actual,
    listIamGroupsPage: (...args: unknown[]) => listIamGroupsPageMock(...args),
  };
});

vi.mock("../../api/managerIamPolicies", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamPolicies")>("../../api/managerIamPolicies");
  return {
    ...actual,
    listIamPoliciesPage: (...args: unknown[]) => listIamPoliciesPageMock(...args),
  };
});

describe("ManagerUsersPage", () => {
  beforeEach(() => {
    useExecutionContextMock.mockReset();
    listIamUsersPageMock.mockReset();
    listIamGroupsPageMock.mockReset();
    listIamPoliciesPageMock.mockReset();
    createIamUserMock.mockReset();
    deleteIamUserMock.mockReset();
    useExecutionContextMock.mockReturnValue({
      contexts: [
        {
          id: "s3u-1",
          kind: "s3_user",
          display_name: "S3 user",
          endpoint_name: "Default",
        },
      ],
      selectedContextId: "s3u-1",
      selectedContextKind: "s3_user",
      contextIdForApi: "s3u-1",
      requiresContextSelection: true,
      accessMode: "default",
      iamIdentity: null,
      sessionAccountName: null,
    });
    listIamUsersPageMock.mockResolvedValue({ items: [], next_marker: null });
    listIamGroupsPageMock.mockResolvedValue({ items: [], next_marker: null });
    listIamPoliciesPageMock.mockResolvedValue({ items: [], next_marker: null });
  });

  it("shows an empty state without a page-level context strip for managed S3 user contexts", async () => {
    render(
      <MemoryRouter>
        <ManagerUsersPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("IAM users are unavailable for managed S3 user contexts")).toBeInTheDocument();
    expect(screen.queryByText("Execution context")).not.toBeInTheDocument();
    expect(screen.queryByText("IAM is not available for standalone S3 users. Select an S3 Account (tenant) to continue.")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(listIamUsersPageMock).toHaveBeenCalledWith("s3u-1", { marker: null, page_size: 25, include_details: true });
      expect(listIamGroupsPageMock).toHaveBeenCalledWith("s3u-1", { marker: null, page_size: 25 });
      expect(listIamPoliciesPageMock).toHaveBeenCalledWith("s3u-1", { marker: null, page_size: 25 });
    });
  });

  it("renders IAM users with the shared responsive inventory table", async () => {
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
    const alice = {
      name: "alice",
      arn: "arn:aws:iam::acc-1:user/alice",
      groups: ["operators"],
      policies: ["arn:aws:iam::aws:policy/ReadOnlyAccess"],
      inline_policies: [],
      has_keys: true,
    };
    listIamUsersPageMock.mockImplementation(async (_contextId: unknown, query?: { search?: string }) => ({
      items: query?.search === "missing" ? [] : [alice],
      next_marker: null,
    }));

    render(
      <MemoryRouter>
        <ManagerUsersPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("alice")).toBeInTheDocument();
    expect(screen.getByLabelText("Search")).toHaveAttribute("type", "search");
    expect(screen.getByLabelText("Search")).toHaveAttribute("placeholder", "Search by name or ARN");
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "missing" } });
    await waitFor(() => expect(listIamUsersPageMock).toHaveBeenCalledWith("acc-1", {
      marker: null,
      page_size: 25,
      search: "missing",
      include_details: true,
    }));
    await waitFor(() => expect(screen.queryByText("alice")).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "alice" } });
    await waitFor(() => expect(listIamUsersPageMock).toHaveBeenCalledWith("acc-1", {
      marker: null,
      page_size: 25,
      search: "alice",
      include_details: true,
    }));
    expect(await screen.findByText("alice")).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveClass("responsive-data-table");
    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByText("alice").closest("td")).toHaveAttribute("data-mobile-primary", "true");
    expect(screen.getByText("arn:aws:iam::acc-1:user/alice").closest("td")).toHaveAttribute("data-label", "ARN");
    expect(screen.getByText("operators").closest("td")).toHaveAttribute("data-label", "Groups");
    expect(screen.getByText("ReadOnlyAccess").closest("td")).toHaveAttribute("data-label", "Policies");
    const editLink = screen.getByRole("link", { name: "Edit" });
    expect(editLink).toHaveAttribute("href", "/manager/users/alice");
    expect(editLink).toHaveAttribute("data-table-default-action", "true");
    expect(editLink.closest("td")).toHaveAttribute("data-mobile-actions", "true");
    expect(editLink.closest("td")).toHaveClass("w-44");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteIamUserMock).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Delete IAM user?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete user" }));
    await waitFor(() => expect(deleteIamUserMock).toHaveBeenCalledWith("acc-1", "alice"));
  });

  it("keeps saved inline policy drafts visible in the create user modal", async () => {
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
    listIamUsersPageMock.mockResolvedValue({ items: [], next_marker: null });
    listIamGroupsPageMock.mockResolvedValue({ items: [], next_marker: null });
    listIamPoliciesPageMock.mockResolvedValue({ items: [], next_marker: null });

    render(
      <MemoryRouter>
        <ManagerUsersPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(listIamUsersPageMock).toHaveBeenCalledWith("acc-1", { marker: null, page_size: 25, include_details: true });
      expect(listIamGroupsPageMock).toHaveBeenCalledWith("acc-1", { marker: null, page_size: 25 });
      expect(listIamPoliciesPageMock).toHaveBeenCalledWith("acc-1", { marker: null, page_size: 25 });
    });

    fireEvent.click(screen.getByRole("button", { name: "Create user" }));
    fireEvent.click(screen.getByRole("button", { name: "Show inline policies" }));
    fireEvent.change(screen.getByLabelText("Inline policy name"), { target: { value: "audit-inline" } });
    fireEvent.change(screen.getByLabelText("Inline policy document"), {
      target: { value: '{ "Version": "2012-10-17", "Statement": [] }' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    expect(screen.getByText("Saved inline policies")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /audit-inline/i })[0]).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create new inline policy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update draft" })).toBeInTheDocument();
  });

  it("renders a single attach policies section in the create user modal", async () => {
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

    render(
      <MemoryRouter>
        <ManagerUsersPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(listIamUsersPageMock).toHaveBeenCalledWith("acc-1", { marker: null, page_size: 25, include_details: true });
      expect(listIamGroupsPageMock).toHaveBeenCalledWith("acc-1", { marker: null, page_size: 25 });
      expect(listIamPoliciesPageMock).toHaveBeenCalledWith("acc-1", { marker: null, page_size: 25 });
    });

    fireEvent.click(screen.getByRole("button", { name: "Create user" }));

    expect(screen.getAllByText("Attach policies (optional)")).toHaveLength(1);
  });

  it("shows created access keys in the shared one-time secret panel", async () => {
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
    createIamUserMock.mockResolvedValue({
      name: "bob",
      access_key: {
        access_key_id: "AKIA-BOB",
        secret_access_key: "SECRET-BOB",
      },
    });

    render(
      <MemoryRouter>
        <ManagerUsersPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(listIamUsersPageMock).toHaveBeenCalledWith("acc-1", { marker: null, page_size: 25, include_details: true });
    });

    fireEvent.click(screen.getByRole("button", { name: "Create user" }));
    const dialog = screen.getByRole("heading", { name: "Create IAM user" }).closest<HTMLElement>(".workflow-page");
    if (!dialog) throw new Error("Create IAM user workflow page not found");
    fireEvent.change(within(dialog).getByPlaceholderText("User name"), { target: { value: "bob" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create user" }));

    expect(await screen.findByText("Key created for bob")).toBeInTheDocument();
    expect(screen.getByText("AKIA-BOB")).toHaveClass("font-mono");
    expect(screen.getByText("SECRET-BOB")).toHaveClass("font-mono");
    expect(screen.getAllByRole("button", { name: "Copy" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Add as S3 Connection" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage keys" })).toHaveAttribute("href", "/manager/users/bob/keys");
  });

  it("shows the managed private access action only when the backend enables it", async () => {
    listIamGroupsPageMock.mockResolvedValue({ items: [{ name: "readers" }], next_marker: null });
    listIamPoliciesPageMock.mockResolvedValue({
      items: [{ name: "ReadOnly", arn: "arn:policy:readonly" }],
      next_marker: null,
    });
    useExecutionContextMock.mockReturnValue({
      contexts: [{ id: "acc-1", kind: "account", display_name: "Tenant account", endpoint_name: "Default" }],
      selectedContextId: "acc-1",
      selectedContextName: "Tenant account",
      selectedContextKind: "account",
      contextIdForApi: "acc-1",
      requiresContextSelection: true,
      accessMode: "default",
      iamIdentity: null,
      sessionAccountName: null,
      managerPrivateAccessEnabled: true,
    });

    render(
      <MemoryRouter>
        <ManagerUsersPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(listIamUsersPageMock).toHaveBeenCalledWith("acc-1", { marker: null, page_size: 25, include_details: true }));
    fireEvent.click(screen.getByRole("button", { name: "Create my personal access" }));

    const dialog = screen.getByRole("dialog", { name: "Create my personal access" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Connection name")).toHaveValue("Tenant account private access");
    expect(within(dialog).queryByLabelText(/IAM user/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/secret/i)).not.toBeInTheDocument();
    expect(await within(dialog).findByText("readers")).toBeInTheDocument();
    expect(await within(dialog).findByText("ReadOnly")).toBeInTheDocument();
  });

  it("marks managed IAM identities and routes deletion through their private connection", async () => {
    useExecutionContextMock.mockReturnValue({
      contexts: [{ id: "acc-1", kind: "account", display_name: "Tenant account", endpoint_name: "Default" }],
      selectedContextId: "acc-1",
      selectedContextKind: "account",
      contextIdForApi: "acc-1",
      requiresContextSelection: true,
      accessMode: "default",
      iamIdentity: null,
      sessionAccountName: null,
    });
    listIamUsersPageMock.mockResolvedValue({
      items: [{
        name: "bkr-private-u7-acc1",
        arn: "arn:aws:iam::acc-1:user/bkr-private-u7-acc1",
        groups: ["operators"],
        policies: [],
        inline_policies: [],
        has_keys: true,
        is_private_access_managed: true,
        managed_connection_id: 77,
      }],
      next_marker: null,
    });

    render(
      <MemoryRouter>
        <ManagerUsersPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("Private access")).toHaveAttribute("title", "Managed private access identity");
    const deleteButton = screen.getByTitle("Delete the linked private connection instead") as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(true);
  });
});
