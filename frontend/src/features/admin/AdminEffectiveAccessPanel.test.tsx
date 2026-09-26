import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminEffectiveAccessPanel from "./AdminEffectiveAccessPanel";

const listAccessAuditMock = vi.fn();

vi.mock("../../api/accessAudit", async () => {
  const actual = await vi.importActual<typeof import("../../api/accessAudit")>("../../api/accessAudit");
  return {
    ...actual,
    listAccessAudit: (params: unknown) => listAccessAuditMock(params),
  };
});

describe("AdminEffectiveAccessPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listAccessAuditMock.mockResolvedValue({
      items: [{
        key: "7:rgw_user:42",
        principal: { id: 7, email: "user@example.com", full_name: null, role: "ui_user", is_active: true },
        scope: "rgw_user",
        target: { id: 42, name: "pipeline", identifier: "pipeline-id" },
        rights: [{
          code: "rgw_user_access",
          label: "RGW user access",
          sources: [{ kind: "direct", group_id: null, group_name: null }],
        }],
      }],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });
  });

  it("loads only the requested target and links to the same filtered audit", async () => {
    render(
      <MemoryRouter>
        <AdminEffectiveAccessPanel scope="rgw_user" targetId={42} contextLabel="pipeline" />
      </MemoryRouter>,
    );

    await waitFor(() => expect(listAccessAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      scope: "rgw_user",
      target_id: 42,
      page: 1,
      page_size: 25,
    })));
    expect(await screen.findByText("RGW user access")).toBeInTheDocument();
    const rights = screen.getByLabelText("1 effective right");
    fireEvent.focus(rights);
    expect(within(screen.getByRole("tooltip", { name: "Effective rights details" })).getByText("Direct")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View in Access audit" })).toHaveAttribute(
      "href",
      "/admin/access-audit?scope=rgw_user&target_id=42",
    );
  });
});
