import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  key: "12:platform",
  principal: {
    id: 12,
    email: "user@example.com",
    full_name: "Example User",
    role: "ui_user",
    is_active: true,
  },
  scope: "platform" as const,
  target: { id: null, name: "Platform", identifier: null },
  rights: [
    {
      code: "ceph_admin" as const,
      label: "Ceph Admin",
      sources: [{ kind: "direct" as const, group_id: null, group_name: null }],
    },
    {
      code: "storage_ops" as const,
      label: "Storage Ops",
      sources: [{ kind: "group" as const, group_id: 8, group_name: "Storage admins" }],
    },
    {
      code: "manager_bucket_compare" as const,
      label: "Manager · Bucket compare",
      sources: [
        { kind: "direct" as const, group_id: null, group_name: null },
        { kind: "group" as const, group_id: 8, group_name: "Storage admins" },
      ],
    },
    {
      code: "manager_bucket_migration" as const,
      label: "Manager · Bucket migration",
      sources: [{ kind: "group" as const, group_id: 9, group_name: "Migration team" }],
    },
  ],
};

describe("AccessAuditPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listAccessAuditMock.mockResolvedValue({ items: [row], total: 1, page: 1, page_size: 25, has_next: false });
    downloadAccessAuditCsvMock.mockResolvedValue(new Blob(["csv"]));
  });

  it("loads URL filters, renders provenance in the rights tooltip, and exports the same filtered view", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/access-audit?scope=platform&source=group"]}>
        <AccessAuditPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Example User")).toBeInTheDocument();
    expect(screen.queryByText("Granted via")).not.toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    const rights = screen.getByLabelText("4 effective rights");
    expect(rights).toHaveAccessibleDescription(
      "Effective rights (4)\nCeph Admin — Sources: Direct\nStorage Ops — Sources: UI Group: Storage admins\nManager · Bucket compare — Sources: Direct, UI Group: Storage admins\nManager · Bucket migration — Sources: UI Group: Migration team",
    );
    fireEvent.mouseEnter(rights);
    const tooltip = screen.getByRole("tooltip", { name: "Effective rights details" });
    expect(tooltip.parentElement).toHaveClass("w-[32rem]");
    expect(within(tooltip).getByText("Manager · Bucket migration")).toBeInTheDocument();
    expect(within(tooltip).getAllByText("UI Group: Storage admins")).toHaveLength(2);
    expect(within(tooltip).getByText("UI Group: Migration team")).toBeInTheDocument();
    await waitFor(() => expect(listAccessAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      scope: "platform",
      source: "group",
      page: 1,
      page_size: 25,
    })));

    fireEvent.change(screen.getByLabelText("Filter by right"), { target: { value: "manager_bucket_compare" } });
    await waitFor(() => expect(listAccessAuditMock).toHaveBeenLastCalledWith(expect.objectContaining({
      scope: "platform",
      source: "group",
      right: "manager_bucket_compare",
      page: 1,
    })));

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() => expect(downloadAccessAuditCsvMock).toHaveBeenCalledWith(expect.objectContaining({
      scope: "platform",
      source: "group",
      right: "manager_bucket_compare",
    })));
    expect(triggerBlobDownloadMock).toHaveBeenCalledWith("access-audit.csv", expect.any(Blob));
  });
});
