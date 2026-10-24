/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type {
  BucketMigrationListItem,
  BucketMigrationView,
} from "../../../api/managerMigrations";
import { useManagerI18n } from "../managerI18n";

export function MigrationStages({ current }: { current: number }) {
  const { text } = useManagerI18n();
  return (
    <ol
      aria-label={text("Migration stages")}
      className="flex flex-wrap gap-x-5 gap-y-2 ui-caption"
    >
      {[
        "Prepare",
        "Check",
        "Copy",
        "Cut over",
        "Result",
        "Optional cleanup",
      ].map((label, index) => (
        <li
          key={label}
          aria-current={index === current ? "step" : undefined}
          className={
            index === current
              ? "font-semibold text-primary"
              : "text-[var(--ui-text-muted)]"
          }
        >
          {index + 1}. {text(label)}
        </li>
      ))}
    </ol>
  );
}

type MigrationLabelState = Pick<
  BucketMigrationView | BucketMigrationListItem,
  "status" | "preparation_status" | "maintenance_status" | "precheck_checked_at"
>;

export function migrationLabel(migration: MigrationLabelState): string {
  if (
    migration.maintenance_status === "queued" ||
    migration.maintenance_status === "running"
  )
    return "Recovery in progress";
  if (
    migration.status === "draft" &&
    migration.preparation_status === "unverified" &&
    migration.precheck_checked_at
  )
    return "Active checks required";
  if (migration.status === "draft")
    return {
      unverified: "Not checked",
      checking: "Checking",
      blocked: "Needs attention",
      ready: "Ready to copy",
      stale: "Check again",
    }[migration.preparation_status];
  return {
    queued: "Copy queued",
    running: "Copying and verifying",
    pause_requested: "Pausing",
    paused: "Paused",
    awaiting_cutover: "Ready for cutover",
    cancel_requested: "Stopping",
    canceled: "Stopped",
    completed: "Copy verified",
    completed_with_errors: "Needs attention",
    failed: "Needs attention",
    rolled_back: "Incomplete copy removed",
  }[migration.status];
}

export function targetNameError(name: string): string | null {
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(name) ||
    /\.\.|\.-|-\./.test(name) ||
    /^\d+\.\d+\.\d+\.\d+$/.test(name) ||
    /^(xn--|sthree-|amzn-s3-demo-)/.test(name) ||
    /(-s3alias|--ol-s3|\.mrap|--x-s3|--table-s3)$/.test(name)
  ) {
    return "Use 3–63 lowercase letters, numbers, dots or hyphens; start and end with a letter or number.";
  }
  return null;
}
