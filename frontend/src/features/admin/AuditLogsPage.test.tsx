import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AuditLogsPage from "./AuditLogsPage";

const listAuditLogsMock = vi.fn();

vi.mock("../../api/audit", async () => {
  const actual = await vi.importActual<typeof import("../../api/audit")>("../../api/audit");
  return {
    ...actual,
    listAuditLogs: (...args: unknown[]) => listAuditLogsMock(...args),
  };
});

describe("AuditLogsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listAuditLogsMock.mockResolvedValue({
      logs: [
        {
          id: 1,
          created_at: "2026-03-22T10:00:00Z",
          user_email: "admin@example.com",
          user_role: "ui_admin",
          scope: "admin",
          action: "users.update",
          status: "success",
          entity_type: "user",
          entity_id: "12",
          account_name: null,
          account_id: null,
          metadata: { changed: true },
        },
      ],
      next_cursor: null,
    });
  });

  it("keeps audit filters, count and refresh in the list toolbar", async () => {
    render(
      <MemoryRouter>
        <AuditLogsPage />
      </MemoryRouter>
    );

    expect(screen.queryByText("Audit scope")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("1 of 1 loaded entries")).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "Audit trail" })).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(table).toHaveClass("responsive-data-table");
    expect(within(table).getByText("users.update").closest("td")).toHaveAttribute("data-mobile-primary", "true");
    expect(within(table).getByText("admin@example.com").closest("td")).toHaveAttribute("data-label", "Actor");
    expect(within(table).getByText("Success").closest("td")).toHaveAttribute("data-label", "Status");
    expect(screen.getByRole("searchbox", { name: "Search audit logs" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filter by action" })).toHaveValue("all");
    expect(screen.getByRole("combobox", { name: "Filter by status" })).toHaveValue("all");
    expect(screen.getByRole("combobox", { name: "Filter by actor role" })).toHaveValue("all");
    expect(screen.getByRole("combobox", { name: "Filter by workspace scope" })).toHaveValue("all");
    const toolbar = screen.getByRole("region", { name: "Audit trail" });
    expect(within(toolbar).getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Refresh" })).toHaveLength(1);
    expect(within(toolbar).getByText(/Action and status filters apply to loaded entries/)).toBeInTheDocument();
  });

  it("filters loaded entries locally while searching and workspace selection query the server", async () => {
    const first = await listAuditLogsMock();
    listAuditLogsMock.mockClear();
    const page = { logs: [{ ...first.logs[0], id: 4 }, { ...first.logs[0], id: 3, status: "error", action: "users.create" }], next_cursor: 3 };
    listAuditLogsMock.mockResolvedValue(page).mockResolvedValueOnce(page).mockResolvedValueOnce({
      logs: page.logs.map((entry) => ({ ...entry, id: entry.id - 2 })), next_cursor: null,
    });
    render(<MemoryRouter><AuditLogsPage /></MemoryRouter>);
    await screen.findByText("2 of 2 loaded entries");
    fireEvent.change(screen.getByLabelText("Filter by status"), { target: { value: "error" } });
    expect(screen.getByText("1 of 2 loaded entries")).toBeInTheDocument();
    expect(listAuditLogsMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Load older" }));
    await waitFor(() => expect(listAuditLogsMock).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 3 })));
    await screen.findByText("2 of 4 loaded entries");
    fireEvent.change(screen.getByLabelText("Search audit logs"), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText("Filter by workspace scope"), { target: { value: "admin" } });
    await waitFor(() => expect(listAuditLogsMock).toHaveBeenLastCalledWith(expect.objectContaining({ search: "alice", scope: "admin", cursor: undefined })));
  });
});
