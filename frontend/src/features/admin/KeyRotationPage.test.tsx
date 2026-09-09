import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import KeyRotationPage from "./KeyRotationPage";

const mocks = vi.hoisted(() => ({
  listStorageEndpoints: vi.fn(),
  rotateS3Keys: vi.fn(),
}));

vi.mock("../../api/storageEndpoints", () => ({
  listStorageEndpoints: () => mocks.listStorageEndpoints(),
}));

vi.mock("../../api/keyRotation", () => ({
  rotateS3Keys: (...args: unknown[]) => mocks.rotateS3Keys(...args),
}));

function renderPage() {
  render(
    <MemoryRouter>
      <KeyRotationPage />
    </MemoryRouter>
  );
}

describe("KeyRotationPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listStorageEndpoints.mockResolvedValue([
      {
        id: 7,
        name: "Ceph main",
        endpoint_url: "https://rgw.example.test",
        provider: "ceph",
        capabilities: { admin: true },
        is_editable: true,
      },
      {
        id: 8,
        name: "Archive S3",
        endpoint_url: "https://archive.example.test",
        provider: "aws",
        capabilities: { admin: false },
        is_editable: true,
      },
    ]);
    mocks.rotateS3Keys.mockResolvedValue({
      mode: "delete_old_keys",
      summary: {
        total: 1,
        rotated: 1,
        failed: 0,
        skipped: 0,
        deleted_old_keys: 1,
        disabled_old_keys: 0,
      },
      results: [
        {
          endpoint_id: 7,
          endpoint_name: "Ceph main",
          key_type: "account",
          target_type: "account",
          target_id: "tenant-a",
          target_label: "Tenant A",
          status: "rotated",
          message: "Rotated active account key.",
          old_access_key: "OLD123",
          new_access_key: "NEW456",
        },
      ],
    });
  });

  it("runs rotation and renders responsive execution results", async () => {
    renderPage();

    expect(await screen.findByText("Ceph main")).toBeInTheDocument();
    expect(screen.getByText("Archive S3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Run rotation" }));
    expect(mocks.rotateS3Keys).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm rotation" }));

    await waitFor(() =>
      expect(mocks.rotateS3Keys).toHaveBeenCalledWith({
        endpoint_ids: [7],
        key_types: ["endpoint_admin", "endpoint_supervision", "account", "s3_user", "ceph_admin"],
        deactivate_only: false,
      })
    );

    expect(await screen.findByText("Rotation completed successfully.")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(table).toHaveClass("responsive-data-table");
    expect(within(table).getByText("Ceph main").closest("td")).toHaveAttribute("data-mobile-primary", "true");
    expect(within(table).getByText("Account").closest("td")).toHaveAttribute("data-label", "Type");
    expect(within(table).getByText("Tenant A").closest("td")).toHaveAttribute("data-label", "Target");
    expect(within(table).getByText("rotated").closest("td")).toHaveAttribute("data-label", "Status");
    expect(within(table).getByText(/OLD123 → NEW456/).closest("td")).toHaveAttribute("data-label", "Details");
  });

  it("warns that environment-managed endpoint keys will be skipped", async () => {
    mocks.listStorageEndpoints.mockResolvedValue([
      {
        id: 7,
        name: "Ceph env",
        endpoint_url: "https://rgw-env.example.test",
        provider: "ceph",
        capabilities: { admin: true },
        is_editable: false,
      },
    ]);
    mocks.rotateS3Keys.mockResolvedValue({
      mode: "delete_old_keys",
      summary: {
        total: 3,
        rotated: 0,
        failed: 0,
        skipped: 3,
        deleted_old_keys: 0,
        disabled_old_keys: 0,
      },
      results: [
        {
          endpoint_id: 7,
          endpoint_name: "Ceph env",
          key_type: "endpoint_admin",
          target_type: "endpoint",
          target_id: "7",
          target_label: "Ceph env",
          status: "skipped",
          message: "Endpoint credentials are managed by ENV_STORAGE_ENDPOINTS.",
        },
      ],
    });

    renderPage();

    expect(await screen.findByText("Ceph env")).toBeInTheDocument();
    expect(
      screen.getByText(/Endpoint admin, supervision, and Ceph-admin keys managed by ENV_STORAGE_ENDPOINTS/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Endpoint credentials are managed by ENV_STORAGE_ENDPOINTS/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Run rotation" }));
    expect(mocks.rotateS3Keys).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm rotation" }));

    await waitFor(() =>
      expect(mocks.rotateS3Keys).toHaveBeenCalledWith({
        endpoint_ids: [7],
        key_types: ["endpoint_admin", "endpoint_supervision", "account", "s3_user", "ceph_admin"],
        deactivate_only: false,
      })
    );
    expect(await screen.findByText("Rotation completed with skipped items. Review details below.")).toBeInTheDocument();
    expect(screen.getByText("Skipped: 3")).toBeInTheDocument();
  });
  it("requires selections and cancellation never launches a rotation", async () => {
    renderPage(); await screen.findByText("Ceph main");
    fireEvent.click(screen.getByRole("button", { name: "Run rotation" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Permanently delete after replacement");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.rotateS3Keys).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Clear endpoints" }));
    expect(screen.getByRole("button", { name: "Run rotation" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Select all endpoints" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear categories" }));
    expect(screen.getByRole("button", { name: "Run rotation" })).toBeDisabled();
  });
  it("prevents duplicate launches and freezes selections while running", async () => {
    mocks.rotateS3Keys.mockImplementationOnce(() => new Promise(() => {}));
    renderPage(); await screen.findByText("Ceph main");
    fireEvent.click(screen.getByRole("switch", { name: "Disable old keys only" }));
    fireEvent.click(screen.getByRole("button", { name: "Run rotation" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Disable after replacement");
    const confirm = screen.getByRole("button", { name: "Confirm rotation" });
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(mocks.rotateS3Keys).toHaveBeenCalledOnce();
    expect(mocks.rotateS3Keys.mock.calls[0][0].deactivate_only).toBe(true);
    expect(screen.getByRole("button", { name: "Rotating..." })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Disable old keys only" })).toBeDisabled();
  });
  it("retains previous results after an ambiguous failure without retrying", async () => {
    renderPage(); await screen.findByText("Ceph main");
    fireEvent.click(screen.getByRole("button", { name: "Run rotation" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm rotation" }));
    await screen.findByText("Rotation completed successfully.");
    mocks.rotateS3Keys.mockRejectedValueOnce(new Error("Timeout"));
    fireEvent.click(screen.getByRole("button", { name: "Run rotation" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm rotation" }));
    expect(await screen.findByText(/The outcome may be incomplete/)).toBeInTheDocument();
    expect(screen.getByText("Previous execution summary")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(mocks.rotateS3Keys).toHaveBeenCalledTimes(2);
  });

});
