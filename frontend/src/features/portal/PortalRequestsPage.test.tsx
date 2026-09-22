import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import PortalRequestsPage from "./PortalRequestsPage";
import type { PortalAdminRequest } from "../../api/portalRequests";

const mocks = vi.hoisted(() => ({
  listPortalRequests: vi.fn(),
  createPortalRequest: vi.fn(),
  fetchPortalUsage: vi.fn(),
  fetchPortalState: vi.fn(),
  fetchPortalProjectSettings: vi.fn(),
  fetchPortalCollaborators: vi.fn(),
  usePortalAccountContext: vi.fn(),
}));

vi.mock("./PortalAccountContext", () => ({
  usePortalAccountContext: mocks.usePortalAccountContext,
}));

vi.mock("../../api/portalRequests", () => ({
  listPortalRequests: mocks.listPortalRequests,
  createPortalRequest: mocks.createPortalRequest,
}));

vi.mock("../../api/portalAccounts", () => ({
  fetchPortalState: mocks.fetchPortalState,
  fetchPortalProjectSettings: mocks.fetchPortalProjectSettings,
}));

vi.mock("../../api/portalCollaborators", () => ({
  fetchPortalCollaborators: mocks.fetchPortalCollaborators,
}));

vi.mock("../../api/portalUsage", () => ({
  fetchPortalUsage: mocks.fetchPortalUsage,
}));

const pendingRequest: PortalAdminRequest = {
  id: 7,
  account_id: 101,
  account_name: "Research Account",
  request_type: "account_quota_change",
  status: "pending",
  payload: {
    direction: "increase",
    target_quota_value: 20,
    target_quota_unit: "GiB",
    reason: "New project",
  },
  requester_user_id: 1,
  requester_email: "requester@example.org",
  created_at: "2026-07-08T10:00:00Z",
  updated_at: "2026-07-08T10:00:00Z",
  messages: [],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/portal/requests"]}>
      <PortalRequestsPage />
    </MemoryRouter>,
  );
}

describe("PortalRequestsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.usePortalAccountContext.mockReturnValue({
      accountIdForApi: "101",
      hasAccountContext: true,
      selectedAccount: {
        id: "101",
        name: "Research Account",
        tags: [],
        portal_role: "portal_manager",
      },
      loading: false,
      error: null,
    });
    mocks.listPortalRequests.mockResolvedValue([pendingRequest]);
    mocks.createPortalRequest.mockResolvedValue({ ...pendingRequest, id: 8 });
    mocks.fetchPortalState.mockResolvedValue({
      portal_role: "portal_manager",
      can_manage_portal_users: true,
    });
    mocks.fetchPortalProjectSettings.mockResolvedValue({
      effective: {
        browser_access_enabled: true,
        allow_private_storage_space_create: true,
        allow_portal_named_bucket_create: false,
        allow_portal_user_access_key_create: true,
        allow_portal_user_external_sharing: false,
        server_access_logging_enabled: false,
        server_access_log_retention_days: 30,
        storage_space_version_cleanup_enabled: true,
        max_portal_user_access_keys: 2,
        bucket_defaults: {
          versioning: true,
          enable_cors: false,
          enable_lifecycle: true,
          noncurrent_version_expiration_days: 30,
          cors_allowed_origins: [],
        },
      },
      project_override: {},
      delegated_to_portal_managers: false,
      can_update: false,
    });
    mocks.fetchPortalUsage.mockResolvedValue({
      used_bytes: 16 * 1024 ** 3,
      used_objects: 42,
      quota_max_size_bytes: 20 * 1024 ** 3,
      quota_max_objects: 123,
      storage_spaces: [],
    });
    mocks.fetchPortalCollaborators.mockResolvedValue({
      summary: {
        collaborator_count: 1,
        external_access_key_count: 0,
        trend: null,
      },
      collaborators: [
        {
          user_id: 22,
          email: "old@example.org",
          display_name: "Old User",
          portal_role: "portal_user",
          access_source: "direct",
          member_since: "2026-07-01T10:00:00Z",
        },
      ],
    });
  });

  it("separates manager request options from history and submits a collaborator access request from the shared modal", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Help requests" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Request help" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add or remove a collaborator" })).toBeInTheDocument();
    expect(screen.queryByText("Raise to 20 GiB")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "History (1)" }));
    expect(await screen.findByText("Raise to 20 GiB")).toBeInTheDocument();
    expect(screen.getByText("New project")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Request help" }));
    expect(
      screen.queryByRole("heading", { name: "Update project membership" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Manage membership" }));
    const dialog = screen.getByRole("dialog", {
      name: "Update project membership",
    });
    await user.type(within(dialog).getByLabelText("Email"), "jane@example.org");
    await user.type(within(dialog).getByLabelText("Name"), "Jane Viewer");
    await user.click(
      within(dialog).getByRole("button", { name: "Send request" }),
    );

    await waitFor(() => {
      expect(mocks.createPortalRequest).toHaveBeenCalledWith("101", {
        request_type: "portal_user_access",
        target_name: "Jane Viewer",
        target_email: "jane@example.org",
        reason: null,
      });
    });
    expect(await screen.findByText("Raise to 20 GiB")).toBeInTheDocument();
  });

  it("submits a Portal user removal request with the selected collaborator name prefilled", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Help requests" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Manage membership" }));

    const dialog = screen.getByRole("dialog", {
      name: "Update project membership",
    });
    await user.selectOptions(within(dialog).getByLabelText("Action"), "remove");
    await user.selectOptions(within(dialog).getByLabelText("Email"), "old@example.org");
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Old User");
    await user.type(
      within(dialog).getByLabelText("Reason (optional)"),
      "Left the project",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Send removal request" }),
    );

    await waitFor(() => {
      expect(mocks.createPortalRequest).toHaveBeenCalledWith("101", {
        request_type: "portal_user_removal",
        target_name: "Old User",
        target_email: "old@example.org",
        reason: "Left the project",
      });
    });
  });

  it("submits a storage limit change request", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Help requests" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Change limit" }),
    );

    const dialog = screen.getByRole("dialog", {
      name: "Change project storage limit",
    });
    expect(await within(dialog).findByText("Used now")).toBeInTheDocument();
    expect(within(dialog).getByText("Current limit")).toBeInTheDocument();
    await user.selectOptions(
      within(dialog).getByLabelText("Change"),
      "decrease",
    );
    await user.type(within(dialog).getByLabelText("New limit"), "18");
    await user.click(
      within(dialog).getByRole("button", { name: "Send request" }),
    );

    await waitFor(() => {
      expect(mocks.createPortalRequest).toHaveBeenCalledWith("101", {
        request_type: "account_quota_change",
        direction: "decrease",
        target_quota_value: 18,
        target_quota_unit: "GiB",
        reason: null,
      });
    });
  });

  it("submits a project-setting change request when settings are not delegated", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Change a project setting" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Request change" }));

    const dialog = screen.getByRole("dialog", {
      name: "Request project setting change",
    });
    const currentValue = within(dialog).getByText("Currently applied").parentElement;
    expect(currentValue).not.toBeNull();
    expect(within(currentValue as HTMLElement).getByText("Enabled")).toBeInTheDocument();
    expect(within(currentValue as HTMLElement).getByText(/Source: Platform/)).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText("Requested value"), "disabled");
    await user.type(within(dialog).getByLabelText("Reason (optional)"), "Keep access restricted");
    await user.click(within(dialog).getByRole("button", { name: "Send request" }));

    await waitFor(() => {
      expect(mocks.createPortalRequest).toHaveBeenCalledWith("101", {
        request_type: "portal_setting_change",
        setting: "browser_access_enabled",
        mode: "override",
        value: false,
        reason: "Keep access restricted",
      });
    });
  });

  it("does not offer setting-change requests when settings are delegated", async () => {
    mocks.fetchPortalProjectSettings.mockResolvedValue({
      effective: {
        browser_access_enabled: true,
        allow_private_storage_space_create: true,
        allow_portal_named_bucket_create: false,
        allow_portal_user_access_key_create: true,
        allow_portal_user_external_sharing: false,
        server_access_logging_enabled: false,
        server_access_log_retention_days: 30,
        storage_space_version_cleanup_enabled: true,
        max_portal_user_access_keys: 2,
        bucket_defaults: {
          versioning: true,
          enable_cors: false,
          enable_lifecycle: true,
          noncurrent_version_expiration_days: 30,
          cors_allowed_origins: [],
        },
      },
      project_override: {},
      delegated_to_portal_managers: true,
      can_update: true,
    });

    renderPage();

    expect(await screen.findByRole("heading", { name: "Help requests" })).toBeInTheDocument();
    await waitFor(() => expect(mocks.fetchPortalProjectSettings).toHaveBeenCalledWith("101"));
    expect(screen.queryByRole("heading", { name: "Change a project setting" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request change" })).not.toBeInTheDocument();
  });

  it("keeps a failed request inside the dialog, retries the same draft and resets after discard", async () => {
    const user = userEvent.setup();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createPortalRequest.mockRejectedValueOnce(new Error("Request service unavailable"));
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Manage membership" }));
    const dialog = screen.getByRole("dialog", { name: "Update project membership" });
    await user.type(within(dialog).getByLabelText("Name"), "Jane Viewer");
    await user.type(within(dialog).getByLabelText("Email"), "jane@example.org");
    await user.click(within(dialog).getByRole("button", { name: "Send request" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Request service unavailable");
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Jane Viewer");
    await user.click(within(dialog).getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(mocks.createPortalRequest).toHaveBeenCalledTimes(2);
    expect(mocks.createPortalRequest.mock.calls[0]).toEqual(mocks.createPortalRequest.mock.calls[1]);
    await user.click(screen.getByRole("tab", { name: "Request help" }));
    await user.click(screen.getByRole("button", { name: "Manage membership" }));
    expect(screen.getByLabelText("Name")).toHaveValue("");
    await user.type(screen.getByLabelText("Name"), "Unsaved person");
    await user.click(screen.getByRole("button", { name: "Cancel", exact: true }));
    await user.click(screen.getByRole("button", { name: "Discard changes", exact: true }));
    await user.click(screen.getByRole("button", { name: "Change limit" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("New limit")).toHaveValue(null);
    errorLog.mockRestore();
  });

  it("blocks storage-limit requests below current usage", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Help requests" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Change limit" }),
    );

    const dialog = screen.getByRole("dialog", {
      name: "Change project storage limit",
    });
    await user.selectOptions(
      within(dialog).getByLabelText("Change"),
      "decrease",
    );
    await user.type(within(dialog).getByLabelText("New limit"), "10");

    expect(
      await within(dialog).findByText(
        "The new limit must stay above the space already used.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Send request" }),
    ).toBeDisabled();
  });

  it("keeps managed request actions unavailable for non-manager Portal users", async () => {
    mocks.fetchPortalState.mockResolvedValue({
      portal_role: "portal_user",
      can_manage_portal_users: false,
    });
    mocks.usePortalAccountContext.mockReturnValue({
      accountIdForApi: "101",
      hasAccountContext: true,
      selectedAccount: {
        id: "101",
        name: "Research Account",
        tags: [],
        portal_role: "portal_user",
      },
      loading: false,
      error: null,
    });

    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Help requests" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request help" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Add or remove a collaborator" })).not.toBeInTheDocument();
    expect(screen.getByText("Only Portal managers can submit managed project requests.")).toBeInTheDocument();
    expect(mocks.fetchPortalCollaborators).not.toHaveBeenCalled();
    expect(mocks.fetchPortalProjectSettings).not.toHaveBeenCalled();
  });

  it("uses the authoritative Portal capability when the account summary omits the manager role", async () => {
    mocks.usePortalAccountContext.mockReturnValue({
      accountIdForApi: "101",
      hasAccountContext: true,
      selectedAccount: {
        id: "101",
        name: "Research Account",
        tags: [],
      },
      loading: false,
      error: null,
    });

    renderPage();

    expect(
      await screen.findByRole("tab", { name: "Request help" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Manage membership" }),
    ).toBeEnabled();
  });
});
