/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { ComponentProps, ReactNode } from "react";
import ListToolbar from "../ListToolbar";
import { SettingsDialog } from "../settings/SettingsControls";
import UiInlineMessage from "../ui/UiInlineMessage";
import { ListActionButton } from "./ListControls";
import { resolveListTableStatus } from "./listTableStatus";
import "./listDialog.css";

type ListDialogProps = ComponentProps<typeof SettingsDialog> & {
  description?: ReactNode;
  filters?: ReactNode;
  actions?: ReactNode;
  countLabel: ReactNode;
  rowCount: number;
  loading?: boolean;
  loadingMessage?: string;
  error?: string | null;
  emptyMessage: string;
  onRefresh?: () => void;
  refreshDisabled?: boolean;
  loadMore?: { available: boolean; onClick: () => void; label?: string };
};

/** Read-only collection chrome; callers retain requests, row actions and confirmations. */
export default function ListDialog({
  description, filters, actions, countLabel, rowCount, loading = false,
  loadingMessage = "Loading...", error, emptyMessage, onRefresh, refreshDisabled,
  loadMore, children, title, className = "", ...dialogProps
}: ListDialogProps) {
  const status = resolveListTableStatus({ loading, error, rowCount });
  return (
    <SettingsDialog {...dialogProps} title={title} className={`ui-list-dialog ${className}`}>
      <div className="settings-stack">
        {description && <p className="settings-description whitespace-pre-wrap [overflow-wrap:anywhere]">{description}</p>}
        <ListToolbar variant="page" title={`${title} controls`} filters={filters} countLabel={countLabel}
          actions={<>{actions}{onRefresh && <ListActionButton disabled={loading || refreshDisabled} onClick={onRefresh}>Refresh</ListActionButton>}</>} />
        {error && <UiInlineMessage tone="error" role="alert">{error}</UiInlineMessage>}
        {loading && <p role="status" className="settings-description">{loadingMessage}</p>}
        {(status === "empty" || status === "ready") && <div className="min-w-0" aria-busy={loading}>
          {status === "empty" && <p role="status" className="settings-description">{emptyMessage}</p>}
          {status === "ready" && children}
        </div>}
        {loadMore?.available && <div className="flex justify-end">
          <ListActionButton disabled={loading} onClick={loadMore.onClick}>
            {loadMore.label ?? "Load more"}
          </ListActionButton>
        </div>}
      </div>
    </SettingsDialog>
  );
}
