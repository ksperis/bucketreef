import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import S3UserKeysPage from "./S3UserKeysPage";

const mocks = vi.hoisted(() => ({
  createS3UserKey: vi.fn(),
  deleteS3UserKey: vi.fn(),
  getS3User: vi.fn(),
  listS3UserKeys: vi.fn(),
  rotateS3UserKeys: vi.fn(),
  updateS3UserKeyStatus: vi.fn(),
}));

vi.mock("../../api/s3Users", () => ({
  createS3UserKey: (...args: unknown[]) => mocks.createS3UserKey(...args),
  deleteS3UserKey: (...args: unknown[]) => mocks.deleteS3UserKey(...args),
  getS3User: (...args: unknown[]) => mocks.getS3User(...args),
  listS3UserKeys: (...args: unknown[]) => mocks.listS3UserKeys(...args),
  rotateS3UserKeys: (...args: unknown[]) => mocks.rotateS3UserKeys(...args),
  updateS3UserKeyStatus: (...args: unknown[]) => mocks.updateS3UserKeyStatus(...args),
}));

function renderPage(userId: string) {
  render(
    <MemoryRouter initialEntries={[`/admin/s3-users/${userId}/keys`]}>
      <Routes>
        <Route path="/admin/s3-users/:userId/keys" element={<S3UserKeysPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("S3UserKeysPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getS3User.mockResolvedValue({ id: 7, name: "RGW user" });
    mocks.listS3UserKeys.mockResolvedValue([
      {
        access_key_id: "AKIAEXAMPLE",
        status: "Active",
        created_at: "2026-10-01T12:00:00Z",
        is_ui_managed: false,
        is_active: true,
        is_private_access_managed: false,
        managed_connection_id: null,
      },
    ]);
  });

  it("loads the selected user and access keys", async () => {
    renderPage("7");

    expect(await screen.findByText("AKIAEXAMPLE")).toBeInTheDocument();
    expect(screen.getAllByText("RGW user")).toHaveLength(2);
    expect(mocks.getS3User).toHaveBeenCalledWith(7);
    expect(mocks.listS3UserKeys).toHaveBeenCalledWith(7);
  });

  it("rejects non-finite user ids without loading resources", async () => {
    renderPage("Infinity");

    expect(screen.getByText("Invalid user id provided.")).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.getS3User).not.toHaveBeenCalled();
      expect(mocks.listS3UserKeys).not.toHaveBeenCalled();
    });
  });
});
