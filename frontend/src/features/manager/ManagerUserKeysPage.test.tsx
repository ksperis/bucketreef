import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ManagerUserKeysPage from "./ManagerUserKeysPage";

const listKeysMock = vi.fn();
const createKeyMock = vi.fn();
const updateMetadataMock = vi.fn();
const useS3AccountContextMock = vi.fn();

vi.mock("./S3AccountContext", () => ({
  useS3AccountContext: () => useS3AccountContextMock(),
}));

vi.mock("../../api/managerIamUsers", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamUsers")>("../../api/managerIamUsers");
  return {
    ...actual,
    listIamAccessKeys: (...args: unknown[]) => listKeysMock(...args),
    createIamAccessKey: (...args: unknown[]) => createKeyMock(...args),
    updateIamAccessKeyMetadata: (...args: unknown[]) => updateMetadataMock(...args),
    updateIamAccessKeyStatus: vi.fn(),
    deleteIamAccessKey: vi.fn(),
  };
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/manager/users/alice/keys"]}>
      <Routes>
        <Route path="/manager/users/:userName/keys" element={<ManagerUserKeysPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ManagerUserKeysPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useS3AccountContextMock.mockReturnValue({
      selectedS3AccountType: "tenant",
      accountIdForApi: "acc-2",
      requiresS3AccountSelection: true,
      accessMode: "admin",
      managerAccessKeyMetadataEnabled: false,
    });
    listKeysMock.mockResolvedValue([
      {
        access_key_id: "AK-MANAGED",
        status: "Active",
        is_private_access_managed: true,
        managed_connection_id: 81,
      },
    ]);
    createKeyMock.mockResolvedValue({
      access_key_id: "AK-MANUAL",
      secret_access_key: "SECRET-MANUAL",
      status: "Active",
    });
    updateMetadataMock.mockResolvedValue({ name: "updated-name", notes: "Updated notes" });
  });

  it("marks managed keys and prevents direct lifecycle actions", async () => {
    renderPage();

    expect(await screen.findByText("AK-MANAGED")).toBeInTheDocument();
    expect(screen.getByText("Private access")).toBeInTheDocument();
    const updateButton = screen.getByTitle("Update the linked private connection instead") as HTMLButtonElement;
    const deleteButton = screen.getByTitle("Delete the linked private connection instead") as HTMLButtonElement;
    expect(updateButton.disabled).toBe(true);
    expect(deleteButton.disabled).toBe(true);
  });

  it("keeps one-time secrets for manual keys but removes Add as S3 Connection", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("AK-MANAGED");
    await user.click(screen.getByRole("button", { name: "New key" }));

    await waitFor(() => expect(createKeyMock).toHaveBeenCalledWith("acc-2", "alice"));
    expect(await screen.findByText("AK-MANUAL")).toBeInTheDocument();
    expect(screen.getByText("SECRET-MANUAL")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add as S3 Connection" })).not.toBeInTheDocument();
  });

  it("creates and edits BucketReef metadata when enabled for the account", async () => {
    const user = userEvent.setup();
    useS3AccountContextMock.mockReturnValue({
      selectedS3AccountType: "tenant",
      accountIdForApi: "acc-2",
      requiresS3AccountSelection: true,
      accessMode: "admin",
      managerAccessKeyMetadataEnabled: true,
    });
    listKeysMock.mockResolvedValue([
      {
        access_key_id: "AK-APP",
        status: "Active",
        name: "backup-service",
        notes: "Nightly backup client",
      },
    ]);

    renderPage();

    expect(await screen.findByText("backup-service")).toBeInTheDocument();
    expect(screen.getByText("Nightly backup client")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New key" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/stored only in BucketReef/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Name"), "video-uploader");
    await user.type(screen.getByLabelText("Notes"), "Uploads rendered videos");
    await user.click(screen.getByRole("button", { name: "Create key" }));

    await waitFor(() => {
      expect(createKeyMock).toHaveBeenCalledWith("acc-2", "alice", {
        name: "video-uploader",
        notes: "Uploads rendered videos",
      });
    });

    await user.click(screen.getByRole("button", { name: "Edit details" }));
    expect(screen.getByLabelText("Name")).toHaveValue("backup-service");
    expect(screen.getByLabelText("Notes")).toHaveValue("Nightly backup client");
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "backup-primary");
    await user.clear(screen.getByLabelText("Notes"));
    await user.type(screen.getByLabelText("Notes"), "Primary nightly backup client");
    await user.click(screen.getByRole("button", { name: "Save details" }));

    await waitFor(() => {
      expect(updateMetadataMock).toHaveBeenCalledWith("acc-2", "alice", "AK-APP", {
        name: "backup-primary",
        notes: "Primary nightly backup client",
      });
    });
  });
});
