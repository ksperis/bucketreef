import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  BucketMigrationDetail,
  BucketMigrationPrecheckReport,
} from "../../../api/managerMigrations";
import ManagerMigrationDetailPage from "./ManagerMigrationDetailPage";

const mockUseManagerContexts = vi.fn();
const mockUseManagerMigrationDetail = vi.fn();
const mockDeleteManagerMigration = vi.fn();
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

function buildPrecheckReport(
  overrides: Partial<BucketMigrationPrecheckReport> = {},
): BucketMigrationPrecheckReport {
  return {
    checks: [],
    items: [],
    errors: 0,
    warnings: 0,
    ...overrides,
  };
}

function buildDetail(): BucketMigrationDetail {
  return {
    id: 11,
    source_context_id: "src-ctx",
    target_context_id: "tgt-ctx",
    mode: "one_shot",
    copy_bucket_settings: true,
    lock_target_writes: true,
    use_same_endpoint_copy: true,
    auto_grant_source_read_for_copy: true,
    status: "running",
    precheck_status: "passed",
    precheck_report: buildPrecheckReport({
      errors: 1,
      warnings: 1,
      items: [
        {
          item_id: 101,
          source_bucket: "bucket-running",
          strategy: "skip_existing",
          state: "warning",
          blocking: false,
          warnings: 1,
          source_object_count: 25,
          settings_copied: ["versioning"],
          settings_omitted: ["object_lock"],
          checks: [
            {
              code: "target_exists",
              severity: "warning",
              blocking: false,
              scope: "target_bucket",
              message:
                "Target bucket already exists; this item will be skipped.",
              details: null,
              remediation: null,
              impact: null,
              permission: null,
              context_id: null,
              bucket: null,
            },
          ],
        },
        {
          item_id: 103,
          source_bucket: "bucket-failed",
          strategy: "current_only",
          state: "blocked",
          blocking: true,
          warnings: 0,
          source_object_count: 20,
          settings_copied: [],
          settings_omitted: ["versioning"],
          checks: [
            {
              code: "source_access_failed",
              severity: "error",
              blocking: true,
              scope: "source_bucket",
              message: "Source bucket read/list check failed: access denied.",
              details: null,
              remediation: null,
              impact: null,
              permission: null,
              context_id: null,
              bucket: null,
            },
          ],
        },
      ],
    }),
    precheck_checked_at: null,
    configuration_revision: 1,
    preparation_status: "ready",
    preparation_active_checks: false,
    preparation_completed_items: 3,
    maintenance_operation: null,
    maintenance_status: "idle",
    maintenance_error: null,
    available_actions: {},
    total_items: 3,
    completed_items: 1,
    failed_items: 1,
    skipped_items: 0,
    awaiting_items: 0,
    error_message: null,
    updated_at: "2026-03-05T10:00:05Z",
    items: [
      {
        id: 101,
        source_bucket: "bucket-running",
        target_bucket: "bucket-running-copy",
        status: "running",
        step: "sync",
        read_only_applied: true,
        target_lock_applied: true,
        target_created_by_migration: false,
        recovery_required: false,
        source_deleted: false,
        cleanup_error: null,
        objects_copied: 25,
        different_count: 5,
        only_source_count: 75,
        only_target_count: 0,
        diff_sample: null,
        error_message: null,
      },
      {
        id: 102,
        source_bucket: "bucket-unknown",
        target_bucket: "bucket-unknown-copy",
        status: "pending",
        step: "sync",
        read_only_applied: false,
        target_lock_applied: true,
        target_created_by_migration: false,
        recovery_required: false,
        source_deleted: false,
        cleanup_error: null,
        objects_copied: 3,
        different_count: null,
        only_source_count: null,
        only_target_count: null,
        diff_sample: null,
        error_message: null,
      },
      {
        id: 103,
        source_bucket: "bucket-failed",
        target_bucket: "bucket-failed-copy",
        status: "failed",
        step: "verify",
        read_only_applied: true,
        target_lock_applied: true,
        target_created_by_migration: false,
        recovery_required: false,
        source_deleted: false,
        cleanup_error: null,
        objects_copied: 20,
        different_count: 2,
        only_source_count: 0,
        only_target_count: 0,
        diff_sample: null,
        error_message: "Final diff is not clean",
      },
      {
        id: 104,
        source_bucket: "bucket-completed",
        target_bucket: "bucket-completed-copy",
        status: "completed",
        step: "completed",
        read_only_applied: true,
        target_lock_applied: true,
        target_created_by_migration: false,
        recovery_required: false,
        source_deleted: false,
        cleanup_error: null,
        objects_copied: 10,
        different_count: 0,
        only_source_count: 0,
        only_target_count: 0,
        diff_sample: null,
        error_message: null,
      },
    ],
    recent_events: [],
  };
}

function show(overrides: Partial<BucketMigrationDetail> = {}) {
  const detail: BucketMigrationDetail = { ...buildDetail(), ...overrides };
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
      precheck_report: buildPrecheckReport({
        errors: 1,
        items: [
          {
            item_id: 103,
            blocking: true,
            checks: [
              {
                code: "source_tags",
                severity: "error",
                blocking: true,
                scope: "source_bucket",
                message: "Cannot read source tags",
                details: null,
                remediation: "Grant s3:GetObjectTagging.",
                impact: null,
                permission: null,
                context_id: null,
                bucket: null,
              },
            ],
          },
        ],
      }),
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
      precheck_report: buildPrecheckReport(),
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
      precheck_report: buildPrecheckReport({ status: "failed", errors: 1 }),
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
