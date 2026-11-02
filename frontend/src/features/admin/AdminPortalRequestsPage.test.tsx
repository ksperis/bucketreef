import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import AdminPortalRequestsPage from "./AdminPortalRequestsPage";
import type { PortalAdminRequest } from "../../api/portalRequests";

const mocks = vi.hoisted(() => ({
  listS3Accounts: vi.fn(),
  listUserOptions: vi.fn(),
  listAdminPortalRequests: vi.fn(),
  approveAdminPortalRequest: vi.fn(),
  rejectAdminPortalRequest: vi.fn(),
  addAdminPortalRequestMessage: vi.fn(),
}));

vi.mock("../../api/accounts", () => ({
  listS3Accounts: mocks.listS3Accounts,
}));

vi.mock("../../api/users", () => ({
  listUserOptions: mocks.listUserOptions,
}));

vi.mock("../../api/portalRequests", () => ({
  listAdminPortalRequests: mocks.listAdminPortalRequests,
  approveAdminPortalRequest: mocks.approveAdminPortalRequest,
  rejectAdminPortalRequest: mocks.rejectAdminPortalRequest,
  addAdminPortalRequestMessage: mocks.addAdminPortalRequestMessage,
}));

const pendingRequest: PortalAdminRequest = {
  id: 7,
  account_id: 101,
  account_name: "Research Account",
  request_type: "portal_user_access",
  status: "pending",
  payload: {
    intent: "add",
    target_name: "Jane Viewer",
    target_email: "jane@example.org",
    portal_role: "portal_manager",
  },
  result: null,
  error_message: null,
  requester_user_id: 1,
  requester_email: "requester@example.org",
  decided_by_user_id: null,
  decided_by_email: null,
  decided_at: null,
  created_at: "2026-07-08T10:00:00Z",
  updated_at: "2026-07-08T10:00:00Z",
  messages: [],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/portal-requests"]}>
      <AdminPortalRequestsPage />
    </MemoryRouter>
  );
}

describe("AdminPortalRequestsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listS3Accounts.mockResolvedValue({
      items: [{ id: 101, name: "Research Account", rgw_account_id: "RGW-RESEARCH", tags: [] }],
      total: 1,
      page: 1,
      page_size: 25,
    });
    mocks.listUserOptions.mockImplementation(({ page = 1 }: { page?: number }) => Promise.resolve(
      page === 1
        ? {
            items: [{
              id: 2,
              email: "other@example.org",
              full_name: "Other User",
              role: "ui_user",
              avatar: { preference: "initials", source: "initials", initials: "OU" },
            }],
            total: 2,
            page: 1,
            page_size: 100,
            has_next: true,
          }
        : {
            items: [{
              id: 1,
              email: "requester@example.org",
              full_name: "Request Owner",
              role: "ui_user",
              avatar: { preference: "initials", source: "initials", initials: "RO" },
            }],
            total: 2,
            page: 2,
            page_size: 100,
            has_next: false,
          },
    ));
    mocks.listAdminPortalRequests.mockResolvedValue([pendingRequest]);
    mocks.approveAdminPortalRequest.mockResolvedValue({
      ...pendingRequest,
      status: "approved",
      messages: [
        {
          id: 1,
          author_email: "admin@example.org",
          author_role: "ui_admin",
          message: "Approved",
          created_at: "2026-07-08T10:10:00Z",
        },
      ],
    });
    mocks.rejectAdminPortalRequest.mockResolvedValue({ ...pendingRequest, status: "rejected" });
    mocks.addAdminPortalRequestMessage.mockResolvedValue({
      ...pendingRequest,
      messages: [
        {
          id: 2,
          author_email: "admin@example.org",
          author_role: "ui_admin",
          message: "Need more context",
          created_at: "2026-07-08T10:05:00Z",
        },
      ],
    });
  });

  it("loads pending requests and approves with a message", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole("heading", { name: "Portal requests" })).toBeInTheDocument();
    expect(await screen.findByText("Jane Viewer <jane@example.org> · Portal manager")).toBeInTheDocument();
    const requesterBadge = await screen.findByRole("link", { name: "Edit UI user Request Owner" });
    expect(mocks.listUserOptions).toHaveBeenCalledWith({ page: 1, page_size: 100 });
    expect(mocks.listUserOptions).toHaveBeenCalledWith({ page: 2, page_size: 100 });
    expect(requesterBadge).toHaveAttribute(
      "href",
      "/admin/users?edit=1&search=requester%40example.org",
    );
    expect(screen.getByLabelText("requester@example.org, role User")).toHaveAccessibleDescription(
      "Requester (1)\nRequest Owner · requester@example.org — Roles: User",
    );
    expect(mocks.listAdminPortalRequests).toHaveBeenCalledWith({
      status: "pending",
      request_type: "all",
      account_id: "all",
      search: "",
      limit: 200,
    });

    await user.click(screen.getByRole("button", { name: "Details" }));
    await user.type(screen.getByLabelText("Message"), "Approved");
    await user.click(screen.getAllByRole("button", { name: "Approve" }).at(-1) as HTMLElement);

    await waitFor(() => {
      expect(mocks.approveAdminPortalRequest).toHaveBeenCalledWith(7, { message: "Approved" });
    });
    expect(await screen.findByText("Request updated.")).toBeInTheDocument();
  });

  it("sends an admin message from the detail panel", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Jane Viewer <jane@example.org> · Portal manager");
    await user.click(screen.getByRole("button", { name: "Details" }));
    await user.type(screen.getByLabelText("Message"), "Need more context");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(mocks.addAdminPortalRequestMessage).toHaveBeenCalledWith(7, { message: "Need more context" });
    });
  });

  it("offers project-setting requests in the type filter", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Jane Viewer <jane@example.org> · Portal manager");
    expect(screen.queryByRole("option", { name: "Change Portal role" })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Filter by type"), "portal_setting_change");

    await waitFor(() => {
      expect(mocks.listAdminPortalRequests).toHaveBeenLastCalledWith({
        status: "pending",
        request_type: "portal_setting_change",
        account_id: "all",
        search: "",
        limit: 200,
      });
    });
  });

  it("searches and pages account filter options server-side", async () => {
    mocks.listS3Accounts.mockImplementation(async (params: { page?: number; search?: string }) => {
      const page = params.page ?? 1;
      return {
        items: [{ id: page, name: page === 1 ? "Account One" : "Account Two", tags: [] }],
        total: 30,
        page,
        page_size: 25,
      };
    });
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole("option", { name: "Account One" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("option", { name: "Account Two" })).toBeInTheDocument();
    expect(mocks.listS3Accounts).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, page_size: 25 }));

    await user.type(screen.getByRole("searchbox", { name: "Search accounts" }), "research");
    await waitFor(() => {
      expect(mocks.listS3Accounts).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, page_size: 25, search: "research" }),
      );
    });
  });
});
