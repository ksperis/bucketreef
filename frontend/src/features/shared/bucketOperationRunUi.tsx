/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import UiProgressBar from "../../components/ui/UiProgressBar";
import { cx, uiDividerClass, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import "./bucketOperationRun.css";

export const bucketOperationTableContainerClass =
  "max-h-96 overflow-auto rounded-md border border-[color:var(--ui-border-soft)]";

type BucketOperationSummaryStatProps = {
  label: ReactNode;
  value: ReactNode;
};

export function BucketOperationSummaryStat({ label, value }: BucketOperationSummaryStatProps) {
  return (
    <div className={cx("border-b pb-2", uiDividerClass)}>
      <p className={cx("ui-caption", uiMutedTextClass)}>{label}</p>
      <p className={cx("ui-subtitle", uiTitleTextClass)}>{value}</p>
    </div>
  );
}

/** Shared setup density; execution state and confirmations stay with each workflow. */
export function BucketOperationSetup({
  targetLabel, contextLabel, actions, children,
}: {
  targetLabel: ReactNode;
  contextLabel: ReactNode;
  actions: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="bucket-operation-setup space-y-3">
      <header className={cx("flex min-w-0 flex-wrap items-end justify-between gap-3 border-b pb-3", uiDividerClass)}>
        <div className="min-w-0 break-words">
          <p className={cx("ui-body", uiTitleTextClass)}>{targetLabel}</p>
          <p className={cx("ui-caption", uiMutedTextClass)}>{contextLabel}</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-end gap-2">{actions}</div>
      </header>
      {children}
    </div>
  );
}

export function BucketOperationProgress({
  label, value, stage, metrics, children, destructive = false,
}: {
  label: string;
  value: number | null;
  stage: ReactNode;
  metrics: ReactNode;
  children: ReactNode;
  destructive?: boolean;
}) {
  return (
    <section aria-label={label} className={cx("min-w-0 space-y-2 border-y py-3", uiDividerClass)}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className={cx("min-w-0 break-all ui-caption", uiTitleTextClass)}>{stage}</p>
        <p className={cx("ui-caption", uiMutedTextClass)}>{metrics}</p>
      </div>
      <UiProgressBar
        value={value}
        label={label}
        className="!bg-[var(--ui-surface-muted)]"
        barClassName={cx(
          "transition-[width] duration-150 ease-out motion-reduce:transition-none",
          destructive ? "bg-[var(--ui-danger)]" : "bg-primary",
        )}
      />
      <p className={cx("ui-caption", uiMutedTextClass)}>{children}</p>
    </section>
  );
}
