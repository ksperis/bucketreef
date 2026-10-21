import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ManagerUsersPage from "./ManagerUsersPage";

const useExecutionContextMock = vi.fn();
const listIamUsersMock = vi.fn();
const listIamGroupsMock = vi.fn();
const listIamPoliciesMock = vi.fn();
const createIamUserMock = vi.fn();
const deleteIamUserMock = vi.fn();

vi.mock("./ExecutionContextProvider", () => ({
  useExecutionContext: () => useExecutionContextMock(),
}));

vi.mock("../../api/managerIamUsers", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamUsers")>("../../api/managerIamUsers");
  return {
    ...actual,
    listIamUsers: (...args: unknown[]) => listIamUsersMock(...args),
    createIamUser: (...args: unknown[]) => createIamUserMock(...args),
    deleteIamUser: (...args: unknown[]) => deleteIamUserMock(...args),
  };
});

vi.mock("../../api/managerIamGroups", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamGroups")>("../../api/managerIamGroups");
  return {
    ...actual,
    listIamGroups: (...args: unknown[]) => listIamGroupsMock(...args),
  };
});

vi.mock("../../api/managerIamPolicies", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamPolicies")>("../../api/managerIamPolicies");
  return {
    ...actual,
    listIamPolicies: (...args: unknown[]) => listIamPoliciesMock(...args),
  };
});

describe("ManagerUsersPage", () => {
  beforeEach(() => {
    useExecutionContextMock.mockReset();
    listIamUsersMock.mockReset();
    listIamGroupsMock.mockReset();
    listIamPoliciesMock.mockReset();
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
    listIamUsersMock.mockResolvedValue([]);
    listIamGroupsMock.mockResolvedValue([]);
    listIamPoliciesMock.mockResolvedValue([]);
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
      expect(listIamUsersMock).toHaveBeenCalledWith("s3u-1");
      expect(listIamGroupsMock).toHaveBeenCalledWith("s3u-1");
      expect(listIamPoliciesMock).toHaveBeenCalledWith("s3u-1");
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
    listIamUsersMock.mockResolvedValue([
      {
        name: "alice",
        arn: "arn:aws:iam::acc-1:user/alice",
        groups: ["operators"],
        policies: ["arn:aws:iam::aws:policy/ReadOnlyAccess"],
        inline_policies: [],
        has_keys: true,
      },
    ]);

    render(
      <MemoryRouter>
        <ManagerUsersPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("alice")).toBeInTheDocument();
    expect(screen.getByLabelText("Search")).toHaveAttribute("type", "search");
    expect(screen.getByLabelText("Search")).toHaveAttribute("placeholder", "Search by name or ARN");
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "missing" } });
    expect(screen.queryByText("alice")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "alice" } });
    expect(screen.getByText("alice")).toBeInTheDocument();
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
    listIamUsersMock.mockResolvedValue([]);
    listIamGroupsMock.mockResolvedValue([]);
    listIamPoliciesMock.mockResolvedValue([]);

    render(
      <MemoryRouter>
        <ManagerUsersPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(listIamUsersMock).toHaveBeenCalledWith("acc-1");
      expect(listIamGroupsMock).toHaveBeenCalledWith("acc-1");
      expect(listIamPoliciesMock).toHaveBeenCalledWith("acc-1");
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
      expect(listIamUsersMock).toHaveBeenCalledWith("acc-1");
      expect(listIamGroupsMock).toHaveBeenCalledWith("acc-1");
      expect(listIamPoliciesMock).toHaveBeenCalledWith("acc-1");
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
      expect(listIamUsersMock).toHaveBeenCalledWith("acc-1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Create user" }));
    const dialog = screen.getByRole("heading", { name: "Create IAM user" }).closest(".workflow-page");
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

    await waitFor(() => expect(listIamUsersMock).toHaveBeenCalledWith("acc-1"));
    fireEvent.click(screen.getByRole("button", { name: "Create my private access" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Connection name")).toHaveValue("Tenant account private access");
    expect(screen.queryByLabelText(/IAM user/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/secret/i)).not.toBeInTheDocument();
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
    listIamUsersMock.mockResolvedValue([
      {
        name: "bkr-private-u7-acc1",
        arn: "arn:aws:iam::acc-1:user/bkr-private-u7-acc1",
        groups: ["operators"],
        policies: [],
        inline_policies: [],
        has_keys: true,
        is_private_access_managed: true,
        managed_connection_id: 77,
      },
    ]);

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
