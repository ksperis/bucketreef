import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AccessAuditPage from "./AccessAuditPage";

const listAccessAuditMock = vi.fn();
const downloadAccessAuditCsvMock = vi.fn();
const triggerBlobDownloadMock = vi.fn();

vi.mock("../../api/accessAudit", async () => {
  const actual = await vi.importActual<typeof import("../../api/accessAudit")>("../../api/accessAudit");
  return {
    ...actual,
    listAccessAudit: (params: unknown) => listAccessAuditMock(params),
    downloadAccessAuditCsv: (params: unknown) => downloadAccessAuditCsvMock(params),
  };
});

vi.mock("../../utils/download", () => ({
  triggerBlobDownload: (...args: unknown[]) => triggerBlobDownloadMock(...args),
}));

const row = {
  key: "12:rgw_account:3",
  principal: {
    id: 12,
    email: "user@example.com",
    full_name: "Example User",
    role: "ui_user",
    is_active: true,
  },
  scope: "rgw_account" as const,
  target: { id: 3, name: "Research", identifier: "RGW-0003" },
  rights: [{
    code: "account_administrator" as const,
    label: "Account administrator",
    sources: [{ kind: "group" as const, group_id: 8, group_name: "Storage admins" }],
  }],
};

describe("AccessAuditPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listAccessAuditMock.mockResolvedValue({ items: [row], total: 1, page: 1, page_size: 25, has_next: false });
    downloadAccessAuditCsvMock.mockResolvedValue(new Blob(["csv"]));
  });

  it("loads URL filters, renders provenance, and exports the same filtered view", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/access-audit?scope=rgw_account&source=group"]}>
        <AccessAuditPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Example User")).toBeInTheDocument();
    expect(screen.getByText("Storage admins")).toBeInTheDocument();
    await waitFor(() => expect(listAccessAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      scope: "rgw_account",
      source: "group",
      page: 1,
      page_size: 25,
    })));

    fireEvent.change(screen.getByLabelText("Filter by right"), { target: { value: "account_administrator" } });
    await waitFor(() => expect(listAccessAuditMock).toHaveBeenLastCalledWith(expect.objectContaining({
      scope: "rgw_account",
      source: "group",
      right: "account_administrator",
      page: 1,
    })));

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() => expect(downloadAccessAuditCsvMock).toHaveBeenCalledWith(expect.objectContaining({
      scope: "rgw_account",
      source: "group",
      right: "account_administrator",
    })));
    expect(triggerBlobDownloadMock).toHaveBeenCalledWith("access-audit.csv", expect.any(Blob));
  });
});
