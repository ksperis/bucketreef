/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";

import SettingsJsonEditor from "../../../components/settings/SettingsJsonEditor";
import { cx } from "../../../components/ui/styles";

export function BucketFeatureEditorToolbar({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--ui-border-soft)] pb-2">
      <div className="min-w-0 flex-1 settings-description">{children}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function BucketFeatureEditorList({ children }: { children: ReactNode }) {
  return <div className="space-y-2.5">{children}</div>;
}

export function BucketFeatureEditorItem({
  children,
  className,
  testId,
  ruleId,
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
  ruleId?: string;
}) {
  return (
    <div
      className={cx(
        "space-y-3 rounded-md border border-[color:var(--ui-border-soft)] bg-[var(--ui-surface-muted)] px-3 py-3",
        className,
      )}
      data-testid={testId}
      data-rule-id={ruleId}
    >
      {children}
    </div>
  );
}

export function BucketFeatureEditorGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("space-y-2 border-t border-[color:var(--ui-border-soft)] pt-3", className)}>
      {children}
    </div>
  );
}

export function BucketFeatureEditorEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="py-4 text-center settings-description text-[var(--ui-text-muted)]">
      {children}
    </div>
  );
}

export function BucketFeatureJsonPane({
  description,
  label,
  value,
  onChange,
  rows = 16,
  disabled = false,
  children,
}: {
  description: ReactNode;
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <p className="settings-description">{description}</p>
      <SettingsJsonEditor
        label={label}
        value={value}
        onChange={onChange}
        rows={rows}
        disabled={disabled}
      />
      {children}
    </div>
  );
}
