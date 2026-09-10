/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ListActionButton, ListBadge } from "../../components/list/ListControls";
import Modal from "../../components/Modal";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import {
  formatDownloadTimestamp,
  triggerDownload,
  triggerJsonDownload,
} from "../../utils/download";
import { formatBytes } from "../../utils/format";

import { formatDateTime } from "./browserUtils";
import type { BrowserObjectVersion } from "../../api/browserContracts";

type BrowserPrefixVersionsModalProps = {
  bucketName: string;
  normalizedPrefix: string;
  prefixVersionsLoading: boolean;
  prefixVersionsError: string | null;
  prefixVersionRows: BrowserObjectVersion[];
  canLoadMore: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onRestoreVersion: (version: BrowserObjectVersion) => void;
  onDeleteVersion: (version: BrowserObjectVersion) => void;
};

export default function BrowserPrefixVersionsModal({
  bucketName,
  normalizedPrefix,
  prefixVersionsLoading,
  prefixVersionsError,
  prefixVersionRows,
  canLoadMore,
  onClose,
  onRefresh,
  onLoadMore,
  onRestoreVersion,
  onDeleteVersion,
}: BrowserPrefixVersionsModalProps) {
  const sanitizeFilename = (value: string) => {
    const cleaned = value.replace(/[^a-zA-Z0-9-_]+/g, "_").replace(/^_+|_+$/g, "");
    return cleaned || "prefix-versions";
  };

  const buildExportRows = () =>
    prefixVersionRows.map((ver) => ({
      key: ver.key,
      version_id: ver.version_id ?? "",
      is_delete_marker: ver.is_delete_marker,
      is_latest: ver.is_latest,
      last_modified: ver.last_modified ?? "",
      size: ver.size ?? "",
      etag: ver.etag ?? "",
      storage_class: ver.storage_class ?? "",
    }));

  const handleExportJson = () => {
    const exportedAt = new Date().toISOString();
    const timestamp = formatDownloadTimestamp(exportedAt);
    const baseName = sanitizeFilename(`prefix-versions-${bucketName}-${normalizedPrefix || "root"}`);
    const payload = {
      exportedAt,
      bucket: bucketName,
      prefix: normalizedPrefix || "",
      items: buildExportRows(),
    };
    triggerJsonDownload(`${baseName}-${timestamp}.json`, payload);
  };

  const handleExportCsv = () => {
    const exportedAt = new Date().toISOString();
    const timestamp = formatDownloadTimestamp(exportedAt);
    const baseName = sanitizeFilename(`prefix-versions-${bucketName}-${normalizedPrefix || "root"}`);
    const headers = [
      "key",
      "version_id",
      "is_delete_marker",
      "is_latest",
      "last_modified",
      "size",
      "etag",
      "storage_class",
    ];
    const escapeCsv = (value: string | number | boolean) => {
      const text = `${value ?? ""}`;
      const escaped = text.replace(/"/g, "\"\"");
      return `"${escaped}"`;
    };
    const rows = buildExportRows().map((entry) =>
      headers.map((header) => escapeCsv(entry[header as keyof typeof entry] ?? "")).join(",")
    );
    const csv = [headers.join(","), ...rows].join("\n");
    triggerDownload(`${baseName}-${timestamp}.csv`, csv, "text/csv;charset=utf-8");
  };

  return (
    <Modal
      title={`Prefix versions${normalizedPrefix ? ` · ${normalizedPrefix}` : ""}`}
      onClose={onClose}
      maxWidthClass="max-w-4xl"
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 ui-caption text-slate-600 dark:text-slate-300">
          <span className="font-semibold">
            Prefix {normalizedPrefix ? normalizedPrefix : "/"}
          </span>
          <div className="flex items-center gap-2 ui-caption text-slate-500 dark:text-slate-400">
            {prefixVersionsLoading && <span>Loading...</span>}
            <ListActionButton
              type="button"
              onClick={handleExportCsv}
              disabled={prefixVersionsLoading || prefixVersionRows.length === 0}
            >
              Export CSV
            </ListActionButton>
            <ListActionButton
              type="button"
              onClick={handleExportJson}
              disabled={prefixVersionsLoading || prefixVersionRows.length === 0}
            >
              Export JSON
            </ListActionButton>
            <ListActionButton
              type="button"
              onClick={onRefresh}
              disabled={!bucketName || prefixVersionsLoading}
            >
              Refresh
            </ListActionButton>
          </div>
        </div>
        {prefixVersionsError && <UiInlineMessage tone="error">{prefixVersionsError}</UiInlineMessage>}
        <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {prefixVersionRows.length === 0 && !prefixVersionsLoading && (
              <div className="px-3 py-3 ui-caption text-slate-500 dark:text-slate-300">No versions found.</div>
            )}
            {prefixVersionRows.map((ver) => (
              <div
                key={`${ver.key}-${ver.version_id ?? "none"}-${ver.is_delete_marker ? "marker" : "version"}`}
                className="flex flex-wrap items-start justify-between gap-3 px-3 py-2 ui-caption"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold text-slate-800 dark:text-slate-100">{ver.key}</span>
                    {ver.is_delete_marker && (
                      <ListBadge tone="warning">delete marker</ListBadge>
                    )}
                    {ver.is_latest && (
                      <ListBadge tone="success">latest</ListBadge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-3 ui-caption text-slate-500 dark:text-slate-300">
                    {ver.version_id && <span>v: {ver.version_id}</span>}
                    {ver.last_modified && <span>{formatDateTime(ver.last_modified)}</span>}
                    {ver.size != null && <span>{formatBytes(ver.size)}</span>}
                    {ver.etag && <span>ETag {ver.etag}</span>}
                    {ver.storage_class && <span>{ver.storage_class}</span>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {!ver.is_delete_marker && !ver.is_latest && (
                    <ListActionButton
                      type="button"
                      onClick={() => onRestoreVersion(ver)}
                    >
                      Restore
                    </ListActionButton>
                  )}
                  <ListActionButton variant="danger"
                    type="button"
                    onClick={() => onDeleteVersion(ver)}
                  >
                    {ver.is_delete_marker ? "Delete marker" : "Delete version"}
                  </ListActionButton>
                </div>
              </div>
            ))}
          </div>
        </div>
        {canLoadMore && (
          <div className="text-right">
            <ListActionButton
              type="button"
              onClick={onLoadMore}
              disabled={prefixVersionsLoading}
            >
              Load more versions
            </ListActionButton>
          </div>
        )}
      </div>
    </Modal>
  );
}
