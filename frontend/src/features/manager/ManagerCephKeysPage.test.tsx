import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ManagerCephKeysPage from "./ManagerCephKeysPage";

const useS3AccountContextMock = vi.fn();
const listManagerCephAccessKeysMock = vi.fn();
const createManagerCephAccessKeyMock = vi.fn();
const updateManagerCephAccessKeyMetadataMock = vi.fn();
const updateManagerCephAccessKeyStatusMock = vi.fn();
const deleteManagerCephAccessKeyMock = vi.fn();

vi.mock("./S3AccountContext", () => ({
  useS3AccountContext: () => useS3AccountContextMock(),
}));

vi.mock("../../api/managerCephKeys", () => ({
  listManagerCephAccessKeys: (...args: unknown[]) => listManagerCephAccessKeysMock(...args),
  createManagerCephAccessKey: (...args: unknown[]) => createManagerCephAccessKeyMock(...args),
  updateManagerCephAccessKeyMetadata: (...args: unknown[]) => updateManagerCephAccessKeyMetadataMock(...args),
  updateManagerCephAccessKeyStatus: (...args: unknown[]) => updateManagerCephAccessKeyStatusMock(...args),
  deleteManagerCephAccessKey: (...args: unknown[]) => deleteManagerCephAccessKeyMock(...args),
}));

function buildContext(overrides?: Record<string, unknown>) {
  return {
    hasS3AccountContext: true,
    accountIdForApi: "s3u-11",
    selectedS3AccountName: "RGW user test",
    selectedS3AccountType: "s3_user",
    managerCephKeysEnabled: true,
    managerAccessKeyMetadataEnabled: false,
    managerAccessKeyExpirationEnabled: false,
    managerPrivateAccessEnabled: false,
    accessMode: "s3_user",
    ...overrides,
  };
}

describe("ManagerCephKeysPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useS3AccountContextMock.mockReturnValue(buildContext());
    listManagerCephAccessKeysMock.mockResolvedValue([
      {
        access_key_id: "AK-PORTAL",
        status: "enabled",
        created_at: "2026-01-01T00:00:00Z",
        is_ui_managed: true,
        is_active: true,
      },
      {
        access_key_id: "AK-SECONDARY",
        status: "enabled",
        created_at: "2026-01-02T00:00:00Z",
        is_ui_managed: false,
        is_active: false,
      },
      {
        access_key_id: "AK-PRIVATE",
        status: "enabled",
        created_at: "2026-01-03T00:00:00Z",
        is_ui_managed: false,
        is_private_access_managed: true,
        managed_connection_id: 42,
        is_active: true,
      },
    ]);
    createManagerCephAccessKeyMock.mockResolvedValue({
      access_key_id: "AK-NEW",
      secret_access_key: "SK-NEW",
    });
    updateManagerCephAccessKeyMetadataMock.mockResolvedValue({
      name: "updated-name",
      notes: "Updated notes",
    });
    updateManagerCephAccessKeyStatusMock.mockResolvedValue({
      access_key_id: "AK-SECONDARY",
      status: "enabled",
      is_ui_managed: false,
      is_active: true,
    });
    deleteManagerCephAccessKeyMock.mockResolvedValue(undefined);
  });

  it("renders keys and locks actions for the portal key", async () => {
    render(
      <MemoryRouter>
        <ManagerCephKeysPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("AK-PORTAL")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ceph access keys" })).toBeInTheDocument();
    expect(screen.getByText("Interface key")).toHaveAttribute("title", "BucketReef interface key (locked)");
    expect(screen.getByRole("table")).toHaveClass("responsive-data-table");
    expect(screen.getByText("AK-PORTAL").closest("td")).toHaveAttribute("data-mobile-primary", "true");

    const lockedButtons = screen.getAllByTitle("Interface key is locked");
    expect(lockedButtons).toHaveLength(2);
    expect(lockedButtons[0].closest("td")).toHaveAttribute("data-mobile-actions", "true");
    expect(lockedButtons.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect((lockedButtons[0] as HTMLButtonElement).className).toContain("ui-list-action");
    expect((lockedButtons[1] as HTMLButtonElement).className).toContain("ui-list-action");
    expect(screen.getByText("Private access")).toHaveAttribute("title", "Managed private access key");
    expect(screen.getAllByTitle("Update the linked private connection instead")).toHaveLength(1);
    expect(screen.getAllByTitle("Delete the linked private connection instead")).toHaveLength(1);
  });

  it("shows the server-managed provisioning action only when enabled by the context", async () => {
    const user = userEvent.setup();
    useS3AccountContextMock.mockReturnValue(buildContext({ managerPrivateAccessEnabled: true }));

    render(<ManagerCephKeysPage />);

    await screen.findByText("AK-SECONDARY");
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create my private access" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Connection name")).toHaveValue("RGW user test private access");
    expect(screen.queryByText("IAM groups")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/secret/i)).not.toBeInTheDocument();
  });

  it("allows managed provisioning without exposing the Ceph key inventory", async () => {
    const user = userEvent.setup();
    useS3AccountContextMock.mockReturnValue(
      buildContext({ managerCephKeysEnabled: false, managerPrivateAccessEnabled: true })
    );

    render(
      <MemoryRouter>
        <ManagerCephKeysPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("Ceph key inventory is unavailable for this context")).toBeInTheDocument();
    expect(screen.getByText(/Managed private access remains available/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New key" })).not.toBeInTheDocument();
    expect(listManagerCephAccessKeysMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Create my private access" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("supports create, enable and delete for non-locked keys", async () => {
    const user = userEvent.setup();
    render(<ManagerCephKeysPage />);

    await screen.findByText("AK-SECONDARY");

    await user.click(screen.getByRole("button", { name: "New key" }));
    await waitFor(() => {
      expect(createManagerCephAccessKeyMock).toHaveBeenCalledWith("s3u-11");
    });
    expect(await screen.findByText("AK-NEW")).toBeInTheDocument();
    expect(screen.getByText("SK-NEW")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Enable" }));
    await waitFor(() => {
      expect(updateManagerCephAccessKeyStatusMock).toHaveBeenCalledWith("s3u-11", "AK-SECONDARY", true);
    });

    const deleteButtons = screen.getAllByRole("button", { name: "Delete" }) as HTMLButtonElement[];
    const enabledDeleteButton = deleteButtons.find((button) => !button.disabled);
    expect(enabledDeleteButton).toBeDefined();
    if (!enabledDeleteButton) throw new Error("Expected an enabled delete button");

    await user.click(enabledDeleteButton);
    expect(screen.getByRole("heading", { name: "Delete Ceph access key?" })).toBeInTheDocument();
    expect(screen.getAllByText("AK-SECONDARY").length).toBeGreaterThan(1);
    expect(deleteManagerCephAccessKeyMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete key" }));
    await waitFor(() => {
      expect(deleteManagerCephAccessKeyMock).toHaveBeenCalledWith("s3u-11", "AK-SECONDARY");
    });
  });

  it("creates, displays and edits BucketReef metadata when enabled", async () => {
    const user = userEvent.setup();
    useS3AccountContextMock.mockReturnValue(
      buildContext({ managerAccessKeyMetadataEnabled: true })
    );
    listManagerCephAccessKeysMock.mockResolvedValue([
      {
        access_key_id: "AK-SECONDARY",
        status: "enabled",
        created_at: "2026-01-02T00:00:00Z",
        is_ui_managed: false,
        is_active: true,
        name: "sync-agent",
        notes: "Replication client",
      },
    ]);

    render(<ManagerCephKeysPage />);

    expect(await screen.findByText("sync-agent")).toBeInTheDocument();
    expect(screen.getByText("Replication client")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New key" }));
    await user.type(screen.getByLabelText("Name"), "video-uploader");
    await user.type(screen.getByLabelText("Notes"), "Uploads rendered videos");
    await user.click(screen.getByRole("button", { name: "Create key" }));

    await waitFor(() => {
      expect(createManagerCephAccessKeyMock).toHaveBeenCalledWith("s3u-11", {
        name: "video-uploader",
        notes: "Uploads rendered videos",
      });
    });

    await user.click(screen.getByRole("button", { name: "Edit details" }));
    expect(screen.getByLabelText("Name")).toHaveValue("sync-agent");
    expect(screen.getByLabelText("Notes")).toHaveValue("Replication client");
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "sync-primary");
    await user.clear(screen.getByLabelText("Notes"));
    await user.type(screen.getByLabelText("Notes"), "Primary replication client");
    await user.click(screen.getByRole("button", { name: "Save details" }));

    await waitFor(() => {
      expect(updateManagerCephAccessKeyMetadataMock).toHaveBeenCalledWith("s3u-11", "AK-SECONDARY", {
        name: "sync-primary",
        notes: "Primary replication client",
      });
    });
  });

  it("creates a key with expiration when expiration is the only optional key feature", async () => {
    const user = userEvent.setup();
    useS3AccountContextMock.mockReturnValue(
      buildContext({
        managerAccessKeyMetadataEnabled: false,
        managerAccessKeyExpirationEnabled: true,
      })
    );
    listManagerCephAccessKeysMock.mockResolvedValue([
      {
        access_key_id: "AK-EXPIRING",
        status: "enabled",
        created_at: "2026-01-02T00:00:00Z",
        is_ui_managed: false,
        is_active: true,
        expires_at: "2030-01-15T11:30:00Z",
        expiration_state: "scheduled",
      },
    ]);

    render(<ManagerCephKeysPage />);

    expect(await screen.findByText("AK-EXPIRING")).toBeInTheDocument();
    expect(screen.getByText("Scheduled")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New key" }));
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    const expiration = screen.getByLabelText("Expiration date and time");
    fireEvent.change(expiration, { target: { value: "2030-01-15T12:30" } });
    await user.click(screen.getByRole("button", { name: "Create key" }));

    await waitFor(() => {
      expect(createManagerCephAccessKeyMock).toHaveBeenCalledWith("s3u-11", {
        expires_at: new Date("2030-01-15T12:30").toISOString(),
      });
    });
  });
});
