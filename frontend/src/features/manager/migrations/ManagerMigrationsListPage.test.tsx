import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  BucketMigrationListItem,
  BucketMigrationStatus,
} from "../../../api/managerMigrations";
import ManagerMigrationsListPage from "./ManagerMigrationsListPage";

const mockUseManagerContexts = vi.fn();
const mockUseManagerMigrationsList = vi.fn();

vi.mock("./hooks", () => ({
  useManagerMigrationsList: (sourceContextId: string) => mockUseManagerMigrationsList(sourceContextId),
}));

vi.mock("../useManagerContexts", () => ({
  useManagerContexts: () => mockUseManagerContexts(),
}));

vi.mock("../ExecutionContextProvider", () => ({
  useExecutionContext: () => ({
    selectedContextId: "src-ctx",
    requiresContextSelection: true,
  }),
}));

function buildMigration(id: number, status: BucketMigrationStatus): BucketMigrationListItem {
  return {
    id,
    source_context_id: "src-ctx",
    target_context_id: "tgt-ctx",
    status,
    precheck_checked_at: null,
    preparation_status: status === "draft" ? "ready" : "unverified",
    preparation_completed_items: 2,
    maintenance_status: "idle",
    total_items: 2,
    completed_items: 1,
    failed_items: 0,
    skipped_items: 0,
    awaiting_items: 0,
    updated_at: "2026-03-05T10:00:01Z",
  };
}

describe("ManagerMigrationsListPage", () => {
  beforeEach(() => {
    mockUseManagerContexts.mockReturnValue({
      contextLabelById: new Map([
        ["src-ctx", "Source"],
        ["tgt-ctx", "Target"],
      ]),
      contextsLoading: false,
      contextsError: null,
    });
    mockUseManagerMigrationsList.mockReturnValue({
      migrations: [buildMigration(11, "cancel_requested"), buildMigration(12, "completed")],
      migrationsLoading: false,
      migrationsError: null,
    });
  });

  it("does not render summary filter header", () => {
    render(
      <MemoryRouter>
        <ManagerMigrationsListPage />
      </MemoryRouter>
    );

    expect(screen.queryByText("Total")).not.toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();
  });

  it("prioritizes cancel_requested over draft in list ordering", () => {
    mockUseManagerMigrationsList.mockReturnValue({
      migrations: [buildMigration(30, "draft"), buildMigration(31, "cancel_requested"), buildMigration(32, "completed")],
      migrationsLoading: false,
      migrationsError: null,
    });

    render(
      <MemoryRouter>
        <ManagerMigrationsListPage />
      </MemoryRouter>
    );

    const titles = screen.getAllByText(/Migration #/i).map((node) => node.textContent);
    expect(titles[0]).toBe("Migration #31");
    expect(screen.getByText("Migration #30")).toBeInTheDocument();
    expect(screen.getByText("Migration #32")).toBeInTheDocument();
  });
});
