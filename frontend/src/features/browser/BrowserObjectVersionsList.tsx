/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ListActionButton, ListBadge } from "../../components/list/ListControls";
import type { BrowserObjectVersion } from "../../api/browserContracts";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { formatBytes } from "../../utils/format";

import { formatDateTime } from "./browserUtils";

type BrowserObjectVersionsListProps = {
  title?: string;
  versions: BrowserObjectVersion[];
  loading: boolean;
  error: string | null;
  emptyLabel?: string;
  containerClassName?: string;
  titleClassName?: string;
  bodyClassName?: string;
  canLoadMore?: boolean;
  onLoadMore?: () => void;
  onRestoreVersion: (version: BrowserObjectVersion) => void;
  onDeleteVersion: (version: BrowserObjectVersion) => void;
  readOnly?: boolean;
};

export default function BrowserObjectVersionsList({
  title = "Versions",
  versions,
  loading,
  error,
  emptyLabel = "No versions found.",
  containerClassName = "space-y-2",
  titleClassName = "ui-caption font-semibold uppercase tracking-wide text-slate-400",
  bodyClassName = "space-y-2",
  canLoadMore = false,
  onLoadMore,
  onRestoreVersion,
  onDeleteVersion,
  readOnly = false,
}: BrowserObjectVersionsListProps) {
  return (
    <div className={containerClassName}>
      <div className="flex items-center justify-between">
        <p className={titleClassName}>{title}</p>
        {loading && <span className="ui-caption text-slate-500 dark:text-slate-400">Loading...</span>}
      </div>
      {error && <UiInlineMessage tone="error">{error}</UiInlineMessage>}
      <div className={bodyClassName}>
        {versions.length === 0 && !loading && (
          <span className="ui-caption text-slate-500 dark:text-slate-400">{emptyLabel}</span>
        )}
        {versions.map((ver) => (
          <div
            key={`${ver.key}-${ver.version_id ?? "none"}-${ver.is_delete_marker ? "marker" : "version"}`}
            className="rounded-lg border border-slate-200 px-3 py-2 ui-caption text-slate-600 dark:border-slate-700 dark:text-slate-300"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              {!readOnly && <div className="flex flex-wrap items-center gap-2">
                {ver.is_delete_marker && (
                  <ListBadge tone="warning">delete marker</ListBadge>
                )}
                {ver.is_latest && (
                  <ListBadge tone="success">latest</ListBadge>
                )}
              </div>}
              <div className="flex flex-wrap items-center gap-2">
                {!ver.is_delete_marker && !ver.is_latest && (
                  <ListActionButton type="button" onClick={() => onRestoreVersion(ver)}>
                    Restore
                  </ListActionButton>
                )}
                <ListActionButton variant="danger" type="button" onClick={() => onDeleteVersion(ver)}>
                  {ver.is_delete_marker ? "Delete marker" : "Delete version"}
                </ListActionButton>
              </div>
            </div>
            <div className="mt-2 space-y-1 ui-caption text-slate-500 dark:text-slate-400">
              {ver.version_id && <div>v: {ver.version_id}</div>}
              {ver.last_modified && <div>Modified: {formatDateTime(ver.last_modified)}</div>}
              {ver.size != null && <div>Size: {formatBytes(ver.size)}</div>}
              {ver.etag && <div>ETag: {ver.etag}</div>}
            </div>
          </div>
        ))}
      </div>
      {canLoadMore && onLoadMore && (
        <ListActionButton type="button" onClick={onLoadMore} disabled={loading}>
          Load more versions
        </ListActionButton>
      )}
    </div>
  );
}
