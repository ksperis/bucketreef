import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AccountsPage from "./AccountsPage";
import { setSessionUserCache } from "../../utils/workspaces";

const listS3AccountsMock = vi.fn();
const getS3AccountMock = vi.fn();
const updateS3AccountMock = vi.fn();
const createS3AccountMock = vi.fn();
const deleteS3AccountMock = vi.fn();
const importS3AccountsMock = vi.fn();
const fetchAccountPortalSettingsMock = vi.fn();
const updateAccountPortalSettingsMock = vi.fn();

const listStorageEndpointsMock = vi.fn();
const getStorageEndpointMock = vi.fn();

const listMinimalUsersMock = vi.fn();
const listMinimalGroupsMock = vi.fn();
const listAdminTagDefinitionsMock = vi.fn();
let portalEnabled = false;

const makeTag = (id: number, label: string, color_key = "neutral", scope = "standard") => ({
  id,
  label,
  color_key,
  scope,
});

const makePortalAccountSettings = (overrides?: Record<string, unknown>) => ({
  effective: {
    browser_access_enabled: false,
    allow_private_storage_space_create: true,
    allow_portal_named_bucket_create: false,
    allow_portal_user_access_key_create: true,
    server_access_logging_enabled: true,
    server_access_log_retention_days: 30,
    storage_space_version_cleanup_enabled: true,
    max_portal_user_access_keys: 2,
    bucket_defaults: {
      versioning: false,
      enable_cors: false,
      enable_lifecycle: false,
      noncurrent_version_expiration_days: 90,
      cors_allowed_origins: ["https://portal.example.test"],
    },
  },
  admin_override: {},
  delegated_to_portal_managers: false,
  ...overrides,
});

vi.mock("./useAdminAccountStats", () => ({
  useAdminAccountStats: () => ({
    stats: null,
    loading: false,
    error: null,
  }),
}));

vi.mock("../../api/accounts", () => ({
  listS3Accounts: (params?: unknown) => listS3AccountsMock(params),
  getS3Account: (accountId: number, options?: unknown) => getS3AccountMock(accountId, options),
  updateS3Account: (accountId: number, payload: unknown) => updateS3AccountMock(accountId, payload),
  createS3Account: (payload: unknown) => createS3AccountMock(payload),
  deleteS3Account: (accountId: number, options?: unknown) => deleteS3AccountMock(accountId, options),
  importS3Accounts: (payload: unknown) => importS3AccountsMock(payload),
  fetchAccountPortalSettings: (accountId: number) => fetchAccountPortalSettingsMock(accountId),
  updateAccountPortalSettings: (accountId: number, payload: unknown) =>
    updateAccountPortalSettingsMock(accountId, payload),
}));

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    generalSettings: { portal_enabled: portalEnabled },
    loading: false,
    refresh: vi.fn(),
    setGeneralSettings: vi.fn(),
  }),
}));

vi.mock("../../api/storageEndpoints", () => ({
  listStorageEndpoints: () => listStorageEndpointsMock(),
  getStorageEndpoint: (endpointId: number, options?: unknown) => getStorageEndpointMock(endpointId, options),
}));

vi.mock("../../api/users", () => ({
  listMinimalUsers: () => listMinimalUsersMock(),
}));

vi.mock("../../api/groups", () => ({
  listMinimalGroups: () => listMinimalGroupsMock(),
}));

vi.mock("../../api/tags", () => ({
  listAdminTagDefinitions: (domain: unknown) => listAdminTagDefinitionsMock(domain),
  listPrivateConnectionTagDefinitions: vi.fn(),
}));

describe("AccountsPage modal tabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    portalEnabled = false;
    setSessionUserCache({ id: 1, role: "ui_superadmin" });
    listS3AccountsMock.mockResolvedValue({
      items: [
        {
          id: 1,
          name: "acc-1",
          tags: [makeTag(501, "gold", "amber")],
          rgw_account_id: "RGW000000000000001",
          storage_endpoint_id: 10,
          storage_endpoint_name: "ceph-main",
          storage_endpoint_url: "https://ceph.example.test",
          user_links: [],
          group_links: [],
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    listStorageEndpointsMock.mockResolvedValue([
      {
        id: 10,
        name: "ceph-main",
        provider: "ceph",
        is_default: true,
        capabilities: {
          account: true,
          admin: true,
          usage: true,
        },
      },
    ]);

    getStorageEndpointMock.mockResolvedValue({
      id: 10,
      name: "ceph-main",
      provider: "ceph",
      is_default: true,
      capabilities: {
        account: true,
        admin: true,
        usage: true,
      },
      admin_ops_permissions: {
        buckets_write: true,
        accounts_write: true,
      },
    });

    listMinimalUsersMock.mockResolvedValue([
      { id: 7, email: "ui7@example.com" },
      { id: 8, email: "ui8@example.com" },
    ]);
    listMinimalGroupsMock.mockResolvedValue([
      { id: 31, name: "Research Group" },
      { id: 32, name: "Archive Group" },
    ]);
    listAdminTagDefinitionsMock.mockResolvedValue([makeTag(501, "gold", "amber"), makeTag(502, "prod")]);

    getS3AccountMock.mockResolvedValue({
      id: 1,
      name: "acc-1",
      tags: [makeTag(501, "gold", "amber")],
      rgw_account_id: "RGW000000000000001",
      storage_endpoint_id: 10,
      storage_endpoint_name: "ceph-main",
      storage_endpoint_url: "https://ceph.example.test",
      storage_endpoint_capabilities: {
        account: true,
        admin: true,
        usage: true,
      },
      quota_max_size_gb: null,
      quota_max_objects: null,
      user_links: [],
      group_links: [],
    });

    updateS3AccountMock.mockResolvedValue(undefined);
    createS3AccountMock.mockResolvedValue(undefined);
    deleteS3AccountMock.mockResolvedValue(undefined);
    importS3AccountsMock.mockResolvedValue([]);
    fetchAccountPortalSettingsMock.mockResolvedValue(makePortalAccountSettings());
    updateAccountPortalSettingsMock.mockResolvedValue(makePortalAccountSettings());
  });

  it("shows the compact empty state when no RGW accounts exist", async () => {
    listS3AccountsMock.mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<AccountsPage />);

    expect(await screen.findByText("No accounts.")).toBeInTheDocument();
    expect(screen.queryByText("No accounts yet.")).not.toBeInTheDocument();
  });

  it("presents account identity and quotas in consistent General sections", async () => {
    render(<AccountsPage />);

    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);

    const generalPanel = await screen.findByRole("tabpanel", { name: "General" });
    expect(
      screen.getByText("Manage quotas, usage, UI associations, privileged access, and Portal overrides for this account.")
    ).toBeInTheDocument();
    expect(within(generalPanel).getByRole("heading", { name: "Account details" })).toBeInTheDocument();
    expect(within(generalPanel).getByRole("heading", { name: "Quotas" })).toBeInTheDocument();
    expect(within(generalPanel).getByLabelText("Storage quota")).toHaveClass("ui-control");
    expect(within(generalPanel).getByLabelText("Storage quota unit")).toHaveClass("ui-control");
    expect(within(generalPanel).getByLabelText("Object quota")).toHaveClass("ui-control");
    expect(within(generalPanel).queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.getAllByText("RGW ID").some((node) => node.tagName === "DT")).toBe(true);
  });

  it("renders direct UI users and UI groups in the combined listing column", async () => {
    portalEnabled = true;
    listS3AccountsMock.mockResolvedValueOnce({
      items: [
        {
          id: 1,
          name: "acc-1",
          tags: [],
          rgw_account_id: "RGW000000000000001",
          storage_endpoint_id: 10,
          storage_endpoint_name: "ceph-main",
          storage_endpoint_url: "https://ceph.example.test",
          user_links: [
            {
              user_id: 7,
              user_email: "ui7@example.com",
              manager_role: null,
              portal_role: "portal_user",
            },
          ],
          group_links: [
            {
              group_id: 31,
              group_name: "Research Group",
              manager_role: "account_administrator",
              portal_role: null,
            },
          ],
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<AccountsPage />);

    expect(await screen.findByRole("columnheader", { name: "UI Users / Groups" })).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(table).toHaveClass("responsive-data-table");
    const accountName = await within(table).findByText("acc-1");
    expect(accountName.closest("td")).toHaveAttribute("data-mobile-primary", "true");
    expect(within(table).queryByRole("button", { name: "acc-1" })).not.toBeInTheDocument();
    expect(within(table).getByText("RGW000000000000001").closest("td")).toHaveAttribute("data-label", "RGW ID");
    expect(within(table).getByText("ceph-main").closest("td")).toHaveAttribute("data-label", "Endpoint");
    const associations = screen.getByLabelText("2 linked principals");
    expect(associations).toHaveAccessibleDescription(
      "Linked principals (2)\nUI user: ui7@example.com — Roles: Portal user\nUI group: Research Group — Roles: Account administrator",
    );
    expect(associations).toBeInTheDocument();
    expect(associations.querySelector(".rounded-lg")).toBeInTheDocument();
    expect(associations.closest("td")).toHaveAttribute("data-label", "UI Users / Groups");
    expect(within(table).getByRole("button", { name: "Edit" }).closest("td")).toHaveAttribute("data-mobile-actions", "true");
    expect(screen.queryByText("Portal user")).not.toBeInTheDocument();
    expect(screen.queryByText("Portal manager")).not.toBeInTheDocument();
  });

  it("shows General/Linked UI users tabs and submits updated user_links", async () => {
    render(<AccountsPage />);

    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);

    const generalTab = await screen.findByRole("tab", { name: "General" });
    const usersTab = screen.getByRole("tab", { name: "Linked UI users" });

    const tabLabels = Array.from(generalTab.parentElement?.querySelectorAll("button") ?? []).map((button) =>
      button.textContent?.trim()
    );
    expect(tabLabels.slice(0, 2)).toEqual(["General", "Linked UI users"]);
    expect(screen.queryByRole("button", { name: "Tags" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Add a tag for this account" })).toBeInTheDocument();

    fireEvent.click(usersTab);

    fireEvent.click(await screen.findByRole("button", { name: "Add UI users" }));
    expect(screen.getByRole("searchbox", { name: "Search UI users" })).toHaveClass("ui-list-control");
    const managerRoleSelect = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Manager role for ui7@example.com",
    });
    const portalRoleSelect = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Portal role for ui7@example.com",
    });
    expect(managerRoleSelect).toHaveValue("account_administrator");
    expect(Array.from(managerRoleSelect.options).map((option) => option.value)).toEqual([
      "",
      "account_administrator",
    ]);
    expect(portalRoleSelect).toHaveValue("");
    expect(portalRoleSelect).toBeDisabled();
    fireEvent.click(await screen.findByRole("checkbox", { name: "ui7@example.com" }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(updateS3AccountMock).toHaveBeenCalled();
    });

    const lastCall = updateS3AccountMock.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe(1);
    expect(lastCall?.[1]).toEqual(
      expect.objectContaining({
        tags: [expect.objectContaining({ label: "gold", color_key: "amber" })],
        user_links: expect.arrayContaining([
          expect.objectContaining({
            user_id: 7,
            manager_role: "account_administrator",
            portal_role: null,
          }),
        ]),
      })
    );
  });

  it("submits direct UI group links from the account edit tab", async () => {
    render(<AccountsPage />);

    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);

    fireEvent.click(await screen.findByRole("tab", { name: "Linked UI groups" }));

    expect(screen.getByText("No linked groups yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add UI groups" }));
    expect(screen.getByRole("searchbox", { name: "Search UI groups" })).toHaveClass("ui-list-control");
    const managerRoleSelect = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Manager role for Research Group",
    });
    const portalRoleSelect = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Portal role for Research Group",
    });
    expect(Array.from(managerRoleSelect.options).map((option) => option.value)).toEqual([
      "",
      "account_administrator",
    ]);
    expect(portalRoleSelect).toBeDisabled();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Research Group" }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    expect(screen.getByText("Research Group")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(updateS3AccountMock).toHaveBeenCalled();
    });

    const lastCall = updateS3AccountMock.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe(1);
    expect(lastCall?.[1]).toEqual(
      expect.objectContaining({
        group_links: [
          expect.objectContaining({
            group_id: 31,
            group_name: "Research Group",
            manager_role: "account_administrator",
            portal_role: null,
          }),
        ],
      })
    );
  });

  it("assigns portal roles while linking UI users and groups when Portal is enabled", async () => {
    portalEnabled = true;
    render(<AccountsPage />);

    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);

    fireEvent.click(await screen.findByRole("tab", { name: "Linked UI users" }));
    expect(screen.getByRole("columnheader", { name: "Manager role" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Portal role" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Access roles" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Add UI users" }));
    fireEvent.change(await screen.findByRole("combobox", { name: "Portal role for ui7@example.com" }), {
      target: { value: "portal_manager" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "ui7@example.com" }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    fireEvent.click(screen.getByRole("tab", { name: "Linked UI groups" }));
    fireEvent.click(screen.getByRole("button", { name: "Add UI groups" }));
    expect(await screen.findByRole("combobox", { name: "Portal role for Research Group" })).toHaveValue(
      "portal_user",
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Manager role for Research Group" }), {
      target: { value: "account_administrator" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Portal role for Research Group" }), {
      target: { value: "portal_user" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Research Group" }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(updateS3AccountMock).toHaveBeenCalled();
    });

    const lastCall = updateS3AccountMock.mock.calls.at(-1);
    expect(lastCall?.[1]).toEqual(
      expect.objectContaining({
        user_links: [
          {
            user_id: 7,
            user_email: "ui7@example.com",
            manager_role: null,
            portal_role: "portal_manager",
            allow_manager_browser_data_access: false,
          },
        ],
        group_links: [
          {
            group_id: 31,
            group_name: "Research Group",
            manager_role: "account_administrator",
            portal_role: "portal_user",
            allow_manager_browser_data_access: false,
          },
        ],
      })
    );
  });

  it("preserves an existing portal role while hiding its column when Portal is disabled", async () => {
    listS3AccountsMock.mockResolvedValueOnce({
      items: [
        {
          id: 1,
          name: "acc-1",
          tags: [makeTag(501, "gold", "amber")],
          rgw_account_id: "RGW000000000000001",
          storage_endpoint_id: 10,
          storage_endpoint_name: "ceph-main",
          storage_endpoint_url: "https://ceph.example.test",
          user_links: [{
            user_id: 7,
            user_email: "ui7@example.com",
            manager_role: null,
            portal_role: "portal_manager",
          }],
          group_links: [],
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });
    getS3AccountMock.mockResolvedValueOnce({
      id: 1,
      name: "acc-1",
      tags: [makeTag(501, "gold", "amber")],
      rgw_account_id: "RGW000000000000001",
      storage_endpoint_id: 10,
      storage_endpoint_name: "ceph-main",
      storage_endpoint_url: "https://ceph.example.test",
      storage_endpoint_capabilities: {
        account: true,
        admin: true,
        usage: true,
      },
      quota_max_size_gb: null,
      quota_max_objects: null,
      user_links: [{
        user_id: 7,
        user_email: "ui7@example.com",
        manager_role: null,
        portal_role: "portal_manager",
      }],
      group_links: [],
    });

    render(<AccountsPage />);

    expect(await screen.findByLabelText("1 linked principal")).toHaveAccessibleDescription(
      "Linked principals (1)\nUI user: ui7@example.com — Roles: Portal manager",
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Linked UI users" }));

    expect(screen.getByRole("columnheader", { name: "Manager role" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /Portal role/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Access roles" })).not.toBeInTheDocument();

    const managerRoleSelect = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Manager role for ui7@example.com",
    });
    expect(managerRoleSelect).toHaveValue("");
    expect(managerRoleSelect).toBeEnabled();
    expect(
      screen.queryByRole("combobox", { name: "Portal role for ui7@example.com" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(updateS3AccountMock).toHaveBeenCalled();
    });

    const lastCall = updateS3AccountMock.mock.calls.at(-1);
    expect(lastCall?.[1]).toEqual(
      expect.objectContaining({
        user_links: [
          expect.objectContaining({
            user_id: 7,
            manager_role: null,
            portal_role: "portal_manager",
          }),
        ],
      })
    );
  });

  it("keeps the required account-principal Manager role while Portal is off", async () => {
    const accountWithManagerLink = {
      id: 1,
      name: "acc-1",
      tags: [makeTag(501, "gold", "amber")],
      rgw_account_id: "RGW000000000000001",
      storage_endpoint_id: 10,
      storage_endpoint_name: "ceph-main",
      storage_endpoint_url: "https://ceph.example.test",
      quota_max_size_gb: null,
      quota_max_objects: null,
      user_links: [
        {
          user_id: 7,
          user_email: "ui7@example.com",
          manager_role: "account_administrator" as const,
          portal_role: null,
        },
      ],
      group_links: [],
    };
    listS3AccountsMock.mockResolvedValueOnce({
      items: [accountWithManagerLink],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });
    getS3AccountMock.mockResolvedValueOnce({
      ...accountWithManagerLink,
      storage_endpoint_capabilities: {
        account: true,
        admin: true,
        usage: true,
      },
    });

    render(<AccountsPage />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Edit" }))[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Linked UI users" }));
    expect(screen.getByRole("columnheader", { name: "Manager role" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /Portal role/ })).not.toBeInTheDocument();
    const managerRoleSelect = screen.getByRole("combobox", {
      name: "Manager role for ui7@example.com",
    });
    expect(managerRoleSelect).toHaveValue("account_administrator");
    expect(
      within(managerRoleSelect).getByRole("option", { name: "No Manager access" }),
    ).toBeDisabled();
  });

  it("submits privileged access grants from the account edit tab", async () => {
    render(<AccountsPage />);

    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Privileged access" }));

    expect(screen.getByText("Privileged Ceph access")).toBeInTheDocument();
    expect(
      screen.getByText("Ceph admin-API actions granted directly to this account outside the Ceph Admin workspace.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Allow Ceph bucket quota updates for this S3 Account in Manager.")
    ).toBeInTheDocument();
    const quotaCheckbox = screen.getByRole("switch", { name: /Bucket quota management/ });
    expect(quotaCheckbox).not.toBeChecked();
    fireEvent.click(quotaCheckbox);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(updateS3AccountMock).toHaveBeenCalled();
    });

    const lastCall = updateS3AccountMock.mock.calls.at(-1);
    expect(lastCall?.[1]).toEqual(
      expect.objectContaining({
        allow_bucket_quota_management: true,
      })
    );
  });

  it("lets ui_admin submit privileged access grants from account edits", async () => {
    setSessionUserCache({ id: 2, role: "ui_admin" });

    render(<AccountsPage />);

    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Privileged access" }));

    const quotaCheckbox = screen.getByRole("switch", { name: /Bucket quota management/ });
    expect(quotaCheckbox).not.toBeChecked();
    fireEvent.click(quotaCheckbox);

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(updateS3AccountMock).toHaveBeenCalled();
    });

    const lastCall = updateS3AccountMock.mock.calls.at(-1);
    expect(lastCall?.[1]).toEqual(
      expect.objectContaining({
        allow_bucket_quota_management: true,
      })
    );
  });

  it("requires the Admin Ops buckets write capability before enabling bucket quota management", async () => {
    getStorageEndpointMock.mockResolvedValueOnce({
      id: 10,
      name: "ceph-main",
      provider: "ceph",
      is_default: true,
      capabilities: { account: true, admin: true },
      admin_ops_permissions: { accounts_write: true, buckets_write: false },
    });

    render(<AccountsPage />);

    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Privileged access" }));

    expect(
      await screen.findByText("Requires buckets=write on the endpoint Admin Ops identity before this grant can be enabled.")
    ).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /Bucket quota management/ })).toBeDisabled();
  });

  it("shows portal overrides tab when the portal feature is enabled", async () => {
    portalEnabled = true;
    fetchAccountPortalSettingsMock.mockResolvedValueOnce(makePortalAccountSettings());

    render(<AccountsPage />);

    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Portal settings" }));

    expect(fetchAccountPortalSettingsMock).toHaveBeenCalledWith(1);
    expect(await screen.findByText("Private Storage Space creation")).toBeInTheDocument();
    expect(screen.getByText("Server access logging")).toBeInTheDocument();
    expect(screen.getByText("Storage Space history cleanup")).toBeInTheDocument();
    expect(screen.queryByText("Portal manager overrides are active for this account.")).not.toBeInTheDocument();
    expect(screen.queryByText("Bucket management")).not.toBeInTheDocument();
  });

  it("hides portal overrides tab when the portal feature is disabled", async () => {
    render(<AccountsPage />);

    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);

    await screen.findByRole("tabpanel", { name: "General" });
    expect(screen.queryByRole("tab", { name: "Portal settings" })).not.toBeInTheDocument();
    expect(fetchAccountPortalSettingsMock).not.toHaveBeenCalled();
  });

  it("saves account portal overrides from the portal tab", async () => {
    portalEnabled = true;
    updateAccountPortalSettingsMock.mockResolvedValueOnce(
      makePortalAccountSettings({
        admin_override: { allow_private_storage_space_create: false },
      })
    );

    render(<AccountsPage />);

    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Portal settings" }));
    await screen.findByText("Private Storage Space creation");

    fireEvent.change(screen.getByLabelText("Browser workspace access"), {
      target: { value: "enabled" },
    });
    fireEvent.click(screen.getByLabelText("Delegate Portal overrides to Portal managers"));
    fireEvent.change(screen.getByLabelText("Private Storage Space creation"), { target: { value: "disabled" } });
    fireEvent.change(screen.getByLabelText("Named bucket creation"), { target: { value: "enabled" } });
    fireEvent.change(screen.getByLabelText("Storage Space history cleanup"), { target: { value: "disabled" } });
    fireEvent.click(screen.getByLabelText("Customize — Version history retention"));
    fireEvent.change(screen.getByLabelText("Version history retention"), {
      target: { value: "45" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(updateAccountPortalSettingsMock).toHaveBeenCalledWith(1, {
        delegated_to_portal_managers: true,
        browser_access_enabled: true,
        allow_private_storage_space_create: false,
        allow_portal_named_bucket_create: true,
        storage_space_version_cleanup_enabled: false,
        bucket_defaults: { noncurrent_version_expiration_days: 45 },
      });
    });
  });

  it("rejects a non-positive account lifecycle expiration override", async () => {
    portalEnabled = true;

    render(<AccountsPage />);

    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Portal settings" }));
    await screen.findByText("Version history retention");

    fireEvent.click(screen.getByLabelText("Customize — Version history retention"));
    fireEvent.change(screen.getByLabelText("Version history retention"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Enter a positive whole number.")).toBeInTheDocument();
    expect(updateAccountPortalSettingsMock).not.toHaveBeenCalled();
  });

  it("resets account portal overrides from the portal tab", async () => {
    portalEnabled = true;

    render(<AccountsPage />);

    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Portal settings" }));
    await screen.findByText("Private Storage Space creation");

    fireEvent.change(screen.getByLabelText("Browser workspace access"), { target: { value: "disabled" } });
    fireEvent.click(screen.getByRole("button", { name: "Restore platform values" }));
    expect(updateAccountPortalSettingsMock).not.toHaveBeenCalled();
    const resetDialog = screen.getByRole("dialog", { name: "Restore platform values?" });
    fireEvent.click(within(resetDialog).getByRole("button", { name: "Apply" }));
    expect(updateAccountPortalSettingsMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Browser workspace access")).toHaveValue("inherit");
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  it("edits tags inline from the general tab", async () => {
    render(<AccountsPage />);

    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);

    const input = await screen.findByRole("textbox", { name: "Add a tag for this account" });
    fireEvent.focus(input);
    fireEvent.change(input, {
      target: { value: "prod" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add tag prod" }));
    expect(screen.getAllByText("prod").length).toBeGreaterThan(0);

    fireEvent.change(input, {
      target: { value: "finance" },
    });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    expect(screen.getAllByText("finance").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Edit tag gold" }));
    expect(screen.getByRole("group", { name: "Tag settings for gold" })).toBeInTheDocument();
  });

  it("defaults a new link to account administrator when Portal is unavailable", async () => {
    render(<AccountsPage />);

    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Linked UI users" }));

    fireEvent.click(await screen.findByRole("button", { name: "Add UI users" }));
    const userCheckbox = await screen.findByRole("checkbox", { name: "ui7@example.com" });
    fireEvent.click(userCheckbox);
    const userRow = userCheckbox.closest("div");
    if (!userRow) {
      throw new Error("User row not found");
    }
    expect(within(userRow).getByRole("combobox", { name: "Manager role for ui7@example.com" })).toHaveValue(
      "account_administrator",
    );
    expect(within(userRow).getByRole("combobox", { name: "Portal role for ui7@example.com" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(updateS3AccountMock).toHaveBeenCalled();
    });

    const lastCall = updateS3AccountMock.mock.calls.at(-1);
    expect(lastCall?.[1]).toEqual(
      expect.objectContaining({
        tags: [expect.objectContaining({ label: "gold", color_key: "amber" })],
        user_links: expect.arrayContaining([
          expect.objectContaining({
            user_id: 7,
            manager_role: "account_administrator",
            portal_role: null,
          }),
        ]),
      })
    );
  });

  it("creates an account with normalized tags", async () => {
    render(<AccountsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create account" }));
    const dialog = screen.getByRole("dialog");
    const nameInput = dialog.querySelector("input[required]") as HTMLInputElement | null;
    if (!nameInput) {
      throw new Error("Account name input not found");
    }
    expect(nameInput).toHaveClass("ui-control");
    expect(within(dialog).getByLabelText("Email contact")).toHaveClass("ui-control");
    expect(within(dialog).getByLabelText("Storage endpoint (Ceph) *")).toHaveClass("ui-control");
    expect(within(dialog).getByLabelText("Storage quota")).toHaveClass("ui-control");
    expect(within(dialog).getByLabelText("Storage quota unit")).toHaveClass("ui-control");
    expect(within(dialog).getByLabelText("Object quota")).toHaveClass("ui-control");

    fireEvent.change(nameInput, { target: { value: "account-with-tags" } });
    fireEvent.change(within(dialog).getByLabelText("Storage quota"), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText("Storage quota unit"), { target: { value: "TiB" } });
    fireEvent.change(within(dialog).getByLabelText("Object quota"), { target: { value: "1000" } });
    const tagInput = within(dialog).getByRole("textbox", { name: "Add a tag for this account" });
    fireEvent.change(tagInput, {
      target: { value: "finance" },
    });
    fireEvent.keyDown(tagInput, { key: "Enter", code: "Enter" });
    await waitFor(() => {
      expect(within(dialog).getByRole("button", { name: "Create account" })).toBeEnabled();
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(createS3AccountMock).toHaveBeenCalled();
    });
    expect(createS3AccountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "account-with-tags",
        quota_max_size_gb: 2,
        quota_max_size_unit: "TiB",
        quota_max_objects: 1000,
        tags: [expect.objectContaining({ label: "finance", color_key: "neutral" })],
      })
    );
  });

  it("uses guarded create and import modals without treating endpoint defaults as edits", async () => {
    render(<AccountsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create account" }));
    const createDialog = screen.getByRole("dialog", { name: "Create an account" });
    const createEndpoint = await within(createDialog).findByLabelText("Storage endpoint (Ceph) *");
    await waitFor(() => expect(createEndpoint).toHaveValue("10"));
    expect(within(createDialog).getByLabelText("Account name *")).toBeInTheDocument();
    fireEvent.click(within(createDialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Discard changes?" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Create an account" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    const importDialog = screen.getByRole("dialog", { name: "Import RGW accounts" });
    const importEndpoint = await within(importDialog).findByLabelText("Ceph endpoint");
    await waitFor(() => expect(importEndpoint).toHaveValue("10"));
    fireEvent.click(within(importDialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Discard changes?" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Import RGW accounts" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    const editedImportDialog = screen.getByRole("dialog", { name: "Import RGW accounts" });
    fireEvent.change(within(editedImportDialog).getByRole("textbox"), { target: { value: "RGW00000000000000001" } });
    fireEvent.click(within(editedImportDialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
  });

  it("keeps tagged accounts visible with exact quick filter mode", async () => {
    listS3AccountsMock.mockImplementation((params?: { search?: string }) => {
      const taggedAccount = {
        id: 1,
        name: "acc-1",
        tags: [makeTag(501, "gold", "amber")],
        rgw_account_id: "RGW000000000000001",
        storage_endpoint_id: 10,
        storage_endpoint_name: "ceph-main",
        storage_endpoint_url: "https://ceph.example.test",
        user_links: [],
        group_links: [],
      };
      const plainAccount = {
        id: 2,
        name: "acc-2",
        tags: [],
        rgw_account_id: "RGW000000000000002",
        storage_endpoint_id: 10,
        storage_endpoint_name: "ceph-main",
        storage_endpoint_url: "https://ceph.example.test",
        user_links: [],
        group_links: [],
      };
      const items = params?.search === "gold" ? [taggedAccount] : [taggedAccount, plainAccount];
      return Promise.resolve({
        items,
        total: items.length,
        page: 1,
        page_size: 25,
        has_next: false,
      });
    });

    render(<AccountsPage />);

    await screen.findByText("acc-1");
    await screen.findByText("acc-2");

    const searchInput = screen.getByLabelText("Search");
    expect(searchInput).toHaveAttribute("type", "search");
    expect(searchInput).toHaveAttribute("placeholder", "Search by name, RGW ID, user email, group, or tag");

    fireEvent.click(screen.getByLabelText("Toggle filter match mode"));
    fireEvent.change(searchInput, {
      target: { value: "gold" },
    });

    await waitFor(() => {
      expect(listS3AccountsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          search: "gold",
        })
      );
    });
    expect(screen.getByText("acc-1")).toBeInTheDocument();
    expect(screen.queryByText("acc-2")).not.toBeInTheDocument();
    expect(screen.getByText("gold").parentElement?.className).toContain("text-[10px]");
  });
  it("restores inherited values only on Save and preserves delegation", async () => {
    portalEnabled = true;
    fetchAccountPortalSettingsMock.mockResolvedValue(makePortalAccountSettings({ admin_override: { browser_access_enabled: true }, delegated_to_portal_managers: true }));
    render(<AccountsPage />);
    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Portal settings" }));
    await screen.findByLabelText("Browser workspace access");
    fireEvent.click(screen.getByRole("button", { name: "Restore platform values" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Apply" }));
    expect(updateAccountPortalSettingsMock).not.toHaveBeenCalled();
    expect(screen.getByRole("switch", { name: "Delegate Portal overrides to Portal managers" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateAccountPortalSettingsMock).toHaveBeenCalledWith(1, { delegated_to_portal_managers: true, bucket_defaults: null }));
    expect(updateS3AccountMock).not.toHaveBeenCalled();
  });

  it("keeps Portal drafts across account tabs and preserves unrelated server edits", async () => {
    portalEnabled = true;
    render(<AccountsPage />);
    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Portal settings" }));
    fireEvent.change(await screen.findByLabelText("Browser workspace access"), { target: { value: "enabled" } });
    fireEvent.click(screen.getByRole("tab", { name: "General" }));
    fireEvent.click(screen.getByRole("tab", { name: "Portal settings" }));
    expect(screen.getByLabelText("Browser workspace access")).toHaveValue("enabled");
    fetchAccountPortalSettingsMock.mockResolvedValue(makePortalAccountSettings({ admin_override: { allow_private_storage_space_create: false }, delegated_to_portal_managers: true }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateAccountPortalSettingsMock).toHaveBeenCalledWith(1, {
      browser_access_enabled: true, allow_private_storage_space_create: false, delegated_to_portal_managers: true,
    }));
    expect(updateS3AccountMock).not.toHaveBeenCalled();
  });

  it("identifies a conflicting Portal field and keeps the draft after failure", async () => {
    portalEnabled = true;
    render(<AccountsPage />);
    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Portal settings" }));
    fireEvent.change(await screen.findByLabelText("Browser workspace access"), { target: { value: "enabled" } });
    fetchAccountPortalSettingsMock.mockResolvedValue(makePortalAccountSettings({ admin_override: { browser_access_enabled: false } }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText(/A setting you edited has changed on the server/)).toBeInTheDocument();
    expect(updateAccountPortalSettingsMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Browser workspace access")).toHaveValue("enabled");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByLabelText("Browser workspace access")).toHaveValue("disabled");
    fireEvent.change(screen.getByLabelText("Browser workspace access"), { target: { value: "inherit" } });
    updateAccountPortalSettingsMock.mockRejectedValueOnce(new Error("Unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText(/Unable to save project settings/)).toBeInTheDocument();
    expect(screen.getByLabelText("Browser workspace access")).toHaveValue("inherit");
  });

  it("keeps CORS edits inside the dialog until Apply and protects editor closure", async () => {
    portalEnabled = true;
    render(<AccountsPage />);
    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Portal settings" }));
    fireEvent.click(await screen.findByRole("switch", { name: "Customize — CORS origins" }));
    fireEvent.click(screen.getByRole("button", { name: "Configure" }));
    fireEvent.change(screen.getByRole("textbox", { name: "CORS origins" }), { target: { value: "https://draft.example" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Configure" }));
    expect(screen.getByRole("textbox", { name: "CORS origins" })).toHaveValue("https://portal.example.test");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to accounts" }));
    expect(screen.getAllByRole("dialog", { name: "Discard changes?" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(updateAccountPortalSettingsMock).not.toHaveBeenCalled();
  });

  it("does not discard an unrelated account draft after saving Portal settings", async () => {
    portalEnabled = true;
    render(<AccountsPage />);
    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Privileged access" }));
    fireEvent.click(screen.getByRole("switch", { name: "Bucket quota management" }));
    fireEvent.click(screen.getByRole("tab", { name: "Portal settings" }));
    fireEvent.change(await screen.findByLabelText("Browser workspace access"), { target: { value: "enabled" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Project settings saved.");
    fireEvent.click(screen.getByRole("tab", { name: "Privileged access" }));
    expect(screen.getByRole("switch", { name: "Bucket quota management" })).toBeChecked();
    expect(updateS3AccountMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Back to accounts" }));
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
  });

  it("keeps Portal edits made while the account save is pending", async () => {
    portalEnabled = true;
    let finishSave!: () => void;
    updateS3AccountMock.mockReturnValueOnce(new Promise<void>((resolve) => { finishSave = resolve; }));
    render(<AccountsPage />);
    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Privileged access" }));
    fireEvent.click(screen.getByRole("switch", { name: "Bucket quota management" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    fireEvent.click(screen.getByRole("tab", { name: "Portal settings" }));
    fireEvent.change(await screen.findByLabelText("Browser workspace access"), { target: { value: "enabled" } });
    await act(async () => { finishSave(); });
    expect(screen.getByLabelText("Browser workspace access")).toHaveValue("enabled");
    expect(updateAccountPortalSettingsMock).not.toHaveBeenCalled();
  });

  it("ignores an account save response after closing and opening another editor", async () => {
    portalEnabled = true;
    let finishSave!: () => void;
    updateS3AccountMock.mockReturnValueOnce(new Promise<void>((resolve) => { finishSave = resolve; }));
    render(<AccountsPage />);
    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Privileged access" }));
    fireEvent.click(screen.getByRole("switch", { name: "Bucket quota management" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to accounts" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Portal settings" }));
    fireEvent.change(await screen.findByLabelText("Browser workspace access"), { target: { value: "enabled" } });
    await act(async () => { finishSave(); });
    expect(screen.getByLabelText("Browser workspace access")).toHaveValue("enabled");
    expect(screen.queryByText("S3Account updated")).not.toBeInTheDocument();
  });

  it.each([
    { bucket_count: null, rgw_user_count: 0, rgw_topic_count: 0 },
    { bucket_count: 0, rgw_user_count: 1, rgw_topic_count: 1 },
  ])("keeps RGW deletion unavailable for unverified or attached resources: %j", async (counts) => {
    getS3AccountMock.mockResolvedValueOnce({ id: 1, name: "acc-1", rgw_account_id: "RGW001", ...counts,
      rgw_user_uids: ["tenant$user"], rgw_topics: ["notification-topic"] });
    render(<AccountsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete", exact: true }));
    const dialog = within(await screen.findByRole("dialog", { name: "Delete acc-1" }));
    expect(dialog.getByRole("checkbox", { name: "Also delete RGW tenant RGW001" })).toBeDisabled();
    expect(dialog.getByText("tenant$user")).toBeInTheDocument();
    expect(dialog.getByText("notification-topic")).toBeInTheDocument();
    if (counts.bucket_count === null) expect(dialog.getByText(/Unable to verify linked RGW resources/)).toBeInTheDocument();
    expect(deleteS3AccountMock).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole("button", { name: "Delete account" }));
    await waitFor(() => expect(deleteS3AccountMock).toHaveBeenCalledWith(1, { deleteRgw: false }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("retains the explicit RGW choice after failure and locks the confirmation during retry", async () => {
    getS3AccountMock.mockResolvedValueOnce({ id: 1, name: "acc-1", rgw_account_id: "RGW001", bucket_count: 0, rgw_user_count: 0, rgw_topic_count: 0 });
    deleteS3AccountMock.mockRejectedValueOnce(new Error("RGW refused deletion"));
    render(<AccountsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete", exact: true }));
    const dialog = within(await screen.findByRole("dialog", { name: "Delete acc-1" }));
    const choice = dialog.getByRole("checkbox", { name: "Also delete RGW tenant RGW001" });
    expect(choice).not.toBeChecked();
    fireEvent.click(choice);
    fireEvent.click(dialog.getByRole("button", { name: "Delete account" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("RGW refused deletion");
    expect(choice).toBeChecked();
    let resolve!: () => void;
    deleteS3AccountMock.mockReturnValueOnce(new Promise<void>(done => { resolve = done; }));
    const confirm = dialog.getByRole("button", { name: "Delete account" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(choice).toBeDisabled();
    expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(dialog.getByRole("button", { name: "Close modal" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(deleteS3AccountMock).toHaveBeenCalledTimes(2);
    expect(deleteS3AccountMock).toHaveBeenLastCalledWith(1, { deleteRgw: true });
    await act(async () => resolve());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

});
