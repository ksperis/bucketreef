import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StorageOpsDashboard from "./StorageOpsDashboard";
import { fetchStorageOpsSummary } from "../../api/storageOps";
import { CLIENT_STORAGE_KEYS } from "../../utils/clientStorage";
import { LanguageProvider } from "../../components/language";

vi.mock("../../api/storageOps", () => ({
  fetchStorageOpsSummary: vi.fn(),
}));

const mockFetchStorageOpsSummary = vi.mocked(fetchStorageOpsSummary);

function renderDashboard() {
  return render(
    <LanguageProvider>
      <MemoryRouter>
        <StorageOpsDashboard />
      </MemoryRouter>
    </LanguageProvider>
  );
}

describe("StorageOpsDashboard", () => {
  beforeEach(() => {
    mockFetchStorageOpsSummary.mockReset();
    window.localStorage.clear();
  });

  it("renders the managed context summary and bucket navigation", async () => {
    mockFetchStorageOpsSummary.mockResolvedValue({
      total_contexts: 4,
      total_accounts: 1,
      total_s3_users: 1,
      total_connections: 2,
      total_shared_connections: 1,
      total_private_connections: 1,
      total_endpoints: 2,
    });

    renderDashboard();

    const summaryLabel = await screen.findByText("Managed contexts");
    const summaryCard = summaryLabel.closest("section");
    expect(summaryCard).not.toBeNull();
    expect(within(summaryCard as HTMLElement).getByText("4")).toBeInTheDocument();
    expect(
      within(summaryCard as HTMLElement).getByText(
        "Accounts: 1 | S3 users: 1 | Connections: 2 | Shared: 1 | Private: 1 | Endpoints: 2"
      )
    ).toBeInTheDocument();
    const bucketLink = screen.getByRole("link", { name: "Open buckets" });
    expect(bucketLink).toHaveAttribute("href", "/storage-ops/buckets");
    expect(screen.queryByText("Navigation")).not.toBeInTheDocument();
  });

  it("keeps navigation visible when the summary fails", async () => {
    mockFetchStorageOpsSummary.mockRejectedValue(new Error("Summary down"));

    renderDashboard();

    await waitFor(() => expect(screen.getByText("Summary down")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Open buckets" })).toHaveAttribute("href", "/storage-ops/buckets");
  });

  it("localizes the dashboard summary in French", async () => {
    window.localStorage.setItem(CLIENT_STORAGE_KEYS.languagePreference, "fr");
    mockFetchStorageOpsSummary.mockResolvedValue({
      total_contexts: 4,
      total_accounts: 1,
      total_s3_users: 1,
      total_connections: 2,
      total_shared_connections: 1,
      total_private_connections: 1,
      total_endpoints: 2,
    });

    renderDashboard();

    expect(await screen.findByText("Contextes gérés")).toBeInTheDocument();
    expect(screen.getByText("Comptes: 1 | Utilisateurs S3: 1 | Connexions: 2 | Partagées: 1 | Privées: 1 | Endpoints: 2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ouvrir les Buckets" })).toHaveAttribute("href", "/storage-ops/buckets");
    expect(screen.getByText("Tableau de bord")).toBeInTheDocument();
  });
});
