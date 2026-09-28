import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ManagerMigrationDetailPage from "./ManagerMigrationDetailPage";

const mockUseManagerContexts = vi.fn();
const mockUseManagerMigrationDetail = vi.fn();
const mockDeleteManagerMigration = vi.fn();
const mockRollbackFailedManagerMigrationItems = vi.fn();
const mockRollbackManagerMigration = vi.fn();
const mockRollbackManagerMigrationItem = vi.fn();
const mockStopManagerMigration = vi.fn();
const mockPrecheck = vi.fn();
const mockStart = vi.fn();
const mockContinue = vi.fn();
const mockMaintenance = vi.fn();

vi.mock("../../../api/managerMigrations", async () => {
  const actual = await vi.importActual<
    typeof import("../../../api/managerMigrations")
  >("../../../api/managerMigrations");
  return {
    ...actual,
    runManagerMigrationPrecheck: (...args: unknown[]) => mockPrecheck(...args),
    startManagerMigration: (...args: unknown[]) => mockStart(...args),
    continueManagerMigration: (...args: unknown[]) => mockContinue(...args),
    runManagerMigrationMaintenance: (...args: unknown[]) =>
      mockMaintenance(...args),
    deleteManagerMigration: (...args: unknown[]) =>
      mockDeleteManagerMigration(...args),
    rollbackFailedManagerMigrationItems: (...args: unknown[]) =>
      mockRollbackFailedManagerMigrationItems(...args),
    rollbackManagerMigration: (...args: unknown[]) =>
      mockRollbackManagerMigration(...args),
    rollbackManagerMigrationItem: (...args: unknown[]) =>
      mockRollbackManagerMigrationItem(...args),
    stopManagerMigration: (...args: unknown[]) =>
      mockStopManagerMigration(...args),
  };
});

vi.mock("./hooks", () => ({
  useManagerMigrationDetail: (migrationId: number | null) =>
    mockUseManagerMigrationDetail(migrationId),
}));

vi.mock("../useManagerContexts", () => ({
  useManagerContexts: () => mockUseManagerContexts(),
}));

function buildDetail() {
  return {
    id: 11,
    created_by_user_id: 1,
    source_context_id: "src-ctx",
    target_context_id: "tgt-ctx",
    mode: "one_shot",
    copy_bucket_settings: true,
    delete_source: false,
    strong_integrity_check: false,
    lock_target_writes: true,
    use_same_endpoint_copy: true,
    auto_grant_source_read_for_copy: true,
    mapping_prefix: "",
    status: "running",
    pause_requested: false,
    cancel_requested: false,
    precheck_status: "passed",
    precheck_report: {
      report_version: 2,
      status: "failed",
      errors: 1,
      warnings: 1,
      summary: {
        blocking_errors: 1,
        warnings: 1,
        infos: 2,
      },
      items: [
        {
          item_id: 101,
          errors: 0,
          warnings: 1,
          strategy: "skip_existing",
          blocking: false,
          delete_source_safe: true,
          rollback_safe: true,
          same_endpoint_copy_safe: true,
          messages: [
            {
              code: "target_exists",
              level: "warning",
              blocking: false,
              message:
                "Target bucket already exists; this item will be skipped.",
            },
          ],
        },
        {
          item_id: 103,
          errors: 1,
          warnings: 0,
          strategy: "current_only",
          blocking: true,
          delete_source_safe: false,
          rollback_safe: false,
          same_endpoint_copy_safe: true,
          messages: [
            {
              code: "source_access_failed",
              level: "error",
              blocking: true,
              message: "Source bucket read/list check failed: access denied.",
            },
          ],
        },
      ],
    },
    precheck_checked_at: null,
    parallelism_max: 8,
    total_items: 3,
    completed_items: 1,
    failed_items: 1,
    skipped_items: 0,
    awaiting_items: 0,
    error_message: null,
    started_at: "2026-03-05T10:00:00Z",
    finished_at: null,
    last_heartbeat_at: "2026-03-05T10:00:05Z",
    created_at: "2026-03-05T10:00:00Z",
    updated_at: "2026-03-05T10:00:05Z",
    items: [
      {
        id: 101,
        source_bucket: "bucket-running",
        target_bucket: "bucket-running-copy",
        status: "running",
        step: "sync",
        pre_sync_done: false,
        read_only_applied: true,
        target_lock_applied: true,
        target_bucket_exists: false,
        objects_copied: 25,
        objects_deleted: 0,
        source_count: 100,
        target_count: 20,
        matched_count: 20,
        different_count: 5,
        only_source_count: 75,
        only_target_count: 0,
        diff_sample: null,
        error_message: null,
        started_at: "2026-03-05T10:00:01Z",
        finished_at: null,
        created_at: "2026-03-05T10:00:01Z",
        updated_at: "2026-03-05T10:00:05Z",
      },
      {
        id: 102,
        source_bucket: "bucket-unknown",
        target_bucket: "bucket-unknown-copy",
        status: "pending",
        step: "sync",
        pre_sync_done: false,
        read_only_applied: false,
        target_lock_applied: true,
        target_bucket_exists: false,
        objects_copied: 3,
        objects_deleted: 0,
        source_count: null,
        target_count: null,
        matched_count: null,
        different_count: null,
        only_source_count: null,
        only_target_count: null,
        diff_sample: null,
        error_message: null,
        started_at: null,
        finished_at: null,
        created_at: "2026-03-05T10:00:01Z",
        updated_at: "2026-03-05T10:00:05Z",
      },
      {
        id: 103,
        source_bucket: "bucket-failed",
        target_bucket: "bucket-failed-copy",
        status: "failed",
        step: "verify",
        pre_sync_done: false,
        read_only_applied: true,
        target_lock_applied: true,
        target_bucket_exists: false,
        objects_copied: 20,
        objects_deleted: 0,
        source_count: 20,
        target_count: 20,
        matched_count: 18,
        different_count: 2,
        only_source_count: 0,
        only_target_count: 0,
        diff_sample: null,
        error_message: "Final diff is not clean",
        started_at: "2026-03-05T10:00:01Z",
        finished_at: "2026-03-05T10:02:00Z",
        created_at: "2026-03-05T10:00:01Z",
        updated_at: "2026-03-05T10:02:00Z",
      },
      {
        id: 104,
        source_bucket: "bucket-completed",
        target_bucket: "bucket-completed-copy",
        status: "completed",
        step: "completed",
        pre_sync_done: false,
        read_only_applied: true,
        target_lock_applied: true,
        target_bucket_exists: false,
        objects_copied: 10,
        objects_deleted: 0,
        source_count: 10,
        target_count: 10,
        matched_count: 10,
        different_count: 0,
        only_source_count: 0,
        only_target_count: 0,
        diff_sample: null,
        error_message: null,
        started_at: "2026-03-05T10:00:01Z",
        finished_at: "2026-03-05T10:01:00Z",
        created_at: "2026-03-05T10:00:01Z",
        updated_at: "2026-03-05T10:01:00Z",
      },
    ],
    recent_events: [],
  } as const;
}

function show(overrides: Record<string, unknown> = {}) {
  const detail = { ...buildDetail(), ...overrides };
  mockUseManagerMigrationDetail.mockReturnValue({
    migrationDetail: detail,
    detailLoading: false,
    detailError: null,
    refresh: vi.fn(),
  });
  return render(
    <MemoryRouter initialEntries={["/manager/migrations/11"]}>
      <Routes>
        <Route
          path="/manager/migrations/:migrationId"
          element={<ManagerMigrationDetailPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}
const enabled = { enabled: true, reason: null };

describe("ManagerMigrationDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseManagerContexts.mockReturnValue({
      contextLabelById: new Map([
        ["src-ctx", "Source"],
        ["tgt-ctx", "Target"],
      ]),
    });
  });

  it("shows failed and successful buckets together without a misleading percentage", () => {
    show({ available_actions: { pause: enabled } });
    expect(
      screen.getByText(
        "1 buckets verified, 1 failed, 0 awaiting cutover, 0 not copied.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("25 objects transferred")).toBeInTheDocument();
    expect(screen.getByText("bucket-completed")).toBeInTheDocument();
    expect(screen.getByText("Final diff is not clean")).toBeInTheDocument();
    expect(screen.queryByText(/100%/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Pause copy" })).toHaveLength(
      1,
    );
  });

  it("keeps blocked checks in preparation with visible diagnostics and no transfer progress", () => {
    show({
      status: "draft",
      preparation_status: "blocked",
      available_actions: { edit: enabled, precheck: enabled },
      precheck_report: {
        errors: 1,
        items: [
          {
            item_id: 103,
            blocking: true,
            checks: [
              {
                code: "source_tags",
                blocking: true,
                message: "Cannot read source tags",
                remediation: "Grant s3:GetObjectTagging.",
              },
            ],
          },
        ],
      },
    });
    expect(screen.getByText("Cannot read source tags")).toBeInTheDocument();
    expect(
      screen.getByText("Next: Grant s3:GetObjectTagging."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Correct configuration" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Transfer result" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Start copy" }),
    ).not.toBeInTheDocument();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("has no a11y violations in preparation and active-check confirmation", async () => {
    const user = userEvent.setup();
    const { container } = show({
      status: "draft",
      preparation_status: "unverified",
      available_actions: { precheck: enabled },
      precheck_report: { errors: 0, items: [] },
    });
    expect((await axe(container)).violations).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Run active checks" }));
    expect((await axe(screen.getByRole("dialog"))).violations).toEqual([]);
  });

  it("requires effect confirmation before active checks", async () => {
    const user = userEvent.setup();
    show({
      status: "draft",
      preparation_status: "blocked",
      preparation_active_checks: false,
      available_actions: { precheck: enabled },
      precheck_report: { errors: 1, items: [] },
    });
    await user.click(screen.getByRole("button", { name: "Run active checks" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Source writes are temporarily blocked");
    expect(mockPrecheck).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByRole("button", { name: "Run active checks" }),
    );
    await waitFor(() => expect(mockPrecheck).toHaveBeenCalledWith(11, true));
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("starts only a backend-approved revision after a separate confirmation", async () => {
    const user = userEvent.setup();
    show({
      status: "draft",
      preparation_status: "ready",
      configuration_revision: 4,
      available_actions: { start: enabled },
    });
    await user.click(screen.getByRole("button", { name: "Start copy" }));
    expect(mockStart).not.toHaveBeenCalled();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Start copy",
      }),
    );
    await waitFor(() => expect(mockStart).toHaveBeenCalledWith(11, 4, true));
  });

  it("waits for explicit cutover and explains client reconfiguration", async () => {
    const user = userEvent.setup();
    show({
      status: "awaiting_cutover",
      mode: "pre_sync",
      available_actions: { cutover: enabled },
    });
    expect(mockContinue).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Start cutover" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Update client applications");
    await user.click(
      within(dialog).getByRole("button", { name: "Start cutover" }),
    );
    await waitFor(() => expect(mockContinue).toHaveBeenCalledWith(11, true));
  });

  it("keeps source deletion in its own confirmed operation", async () => {
    const user = userEvent.setup();
    show({
      status: "completed",
      available_actions: { cleanup_source: enabled },
    });
    await user.click(screen.getByRole("button", { name: "Migration actions" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Delete source buckets" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("SHA-256");
    expect(mockMaintenance).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByRole("button", { name: "Delete source buckets" }),
    );
    await waitFor(() =>
      expect(mockMaintenance).toHaveBeenCalledWith(11, "cleanup_source"),
    );
  });

  it("retains the copy result when cleanup fails", () => {
    show({
      status: "completed",
      maintenance_status: "failed",
      maintenance_error: "Source deletion denied",
      available_actions: { restore_access: enabled },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The transfer result is retained",
    );
    expect(screen.getByText("bucket-completed")).toBeInTheDocument();
  });

  it("hides an empty difference report while awaiting cutover", () => {
    const item = buildDetail().items[3];
    show({
      status: "awaiting_cutover",
      items: [
        {
          ...item,
          status: "awaiting_cutover",
          step: "awaiting_cutover",
          diff_sample: {
            only_source_sample: [],
            only_target_sample: [],
            different_sample: [],
          },
        },
      ],
    });
    expect(screen.queryByText("Differences found")).not.toBeInTheDocument();
  });

  it("shows counters when a completed comparison reports differences", async () => {
    const user = userEvent.setup();
    const item = buildDetail().items[3];
    show({
      status: "completed",
      items: [
        {
          ...item,
          different_count: 2,
          diff_sample: {
            only_source_sample: [],
            only_target_sample: [],
            different_sample: [],
          },
        },
      ],
    });
    await user.click(screen.getByText("Differences found"));
    expect(screen.getByText("Content differences").nextSibling).toHaveTextContent(
      "2",
    );
    expect(screen.getByText("Source only").nextSibling).toHaveTextContent("0");
    expect(screen.queryByText("different_sample")).not.toBeInTheDocument();
  });

  it("shows only populated samples even when comparison counters are zero", async () => {
    const user = userEvent.setup();
    const item = buildDetail().items[3];
    show({
      status: "completed",
      items: [
        {
          ...item,
          diff_sample: {
            only_source_sample: ["missing-object.txt"],
            only_target_sample: [],
            different_sample: [],
          },
        },
      ],
    });
    await user.click(screen.getByText("Differences found"));
    expect(screen.getByText(/missing-object\.txt/)).toBeInTheDocument();
    expect(screen.queryByText(/only_target_sample/)).not.toBeInTheDocument();
    expect(screen.queryByText(/different_sample/)).not.toBeInTheDocument();
  });

  it("hides the difference report when no comparison was recorded", () => {
    const item = buildDetail().items[1];
    show({ status: "completed", items: [item] });
    expect(screen.queryByText("Differences found")).not.toBeInTheDocument();
  });

  it("keeps confirmation open when the network request fails", async () => {
    const user = userEvent.setup();
    mockStart.mockRejectedValueOnce(new Error("Network unavailable"));
    show({
      status: "draft",
      preparation_status: "ready",
      configuration_revision: 1,
      available_actions: { start: enabled },
    });
    await user.click(screen.getByRole("button", { name: "Start copy" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Start copy",
      }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole("dialog")).getByRole("alert"),
      ).toHaveTextContent("Network unavailable"),
    );
  });
});
