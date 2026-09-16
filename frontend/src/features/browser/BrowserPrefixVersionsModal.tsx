/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ListActionButton, ListActions, ListBadge } from "../../components/list/ListControls";
import ListDialog from "../../components/list/ListDialog";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
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

  const columns: Array<DataTableColumn<BrowserObjectVersion>> = [
    {
      id: "key", label: "Object", primary: true,
      cellClassName: "max-w-[260px] whitespace-pre-wrap [overflow-wrap:anywhere]",
      render: (version) => <>
        <span>{version.key}</span>
        <div className="flex flex-wrap gap-1">
          {version.is_delete_marker && <ListBadge tone="warning">delete marker</ListBadge>}
          {version.is_latest && <ListBadge tone="success">latest</ListBadge>}
        </div>
      </>,
    },
    {
      id: "version", label: "Version", cellClassName: "max-w-[240px] [overflow-wrap:anywhere]",
      render: (version) => <div>
        <p>{version.version_id ?? "-"}</p>
        {version.etag && <p>ETag {version.etag}</p>}
      </div>,
    },
    {
      id: "details", label: "Details",
      render: (version) => <div>
        {version.last_modified && <p>{formatDateTime(version.last_modified)}</p>}
        {version.size != null && <p>{formatBytes(version.size)}</p>}
        {version.storage_class && <p>{version.storage_class}</p>}
      </div>,
    },
    {
      id: "actions", label: "Actions", align: "right", mobileRole: "actions",
      render: (version) => <ListActions>
        {!version.is_delete_marker && !version.is_latest && (
          <ListActionButton onClick={() => onRestoreVersion(version)}>Restore</ListActionButton>
        )}
        <ListActionButton variant="danger" onClick={() => onDeleteVersion(version)}>
          {version.is_delete_marker ? "Delete marker" : "Delete version"}
        </ListActionButton>
      </ListActions>,
    },
  ];

  return (
    <ListDialog title="Prefix versions" onClose={onClose} maxWidthClass="max-w-4xl"
      description={`Bucket ${bucketName} · Prefix ${normalizedPrefix || "(bucket root)"}`}
      rowCount={prefixVersionRows.length} countLabel={`${prefixVersionRows.length} loaded`}
      loading={prefixVersionsLoading} loadingMessage="Loading prefix versions..." error={prefixVersionsError}
      emptyMessage="No versions found." onRefresh={onRefresh} refreshDisabled={!bucketName}
      actions={<>
        <ListActionButton onClick={handleExportCsv} disabled={prefixVersionsLoading || !prefixVersionRows.length}>Export CSV</ListActionButton>
        <ListActionButton onClick={handleExportJson} disabled={prefixVersionsLoading || !prefixVersionRows.length}>Export JSON</ListActionButton>
      </>}
      loadMore={{ available: canLoadMore, onClick: onLoadMore, label: "Load more versions" }}>
      <DataTableShell columns={columns} rows={prefixVersionRows}
        rowKey={(version) => `${version.key}-${version.version_id ?? "none"}-${version.is_delete_marker ? "marker" : "version"}`}
        status="ready" loadingMessage="Loading prefix versions..." errorMessage="Unable to load prefix versions."
        emptyMessage="No versions found." responsiveCards
        containerClassName="rounded-lg border border-[var(--ui-border)]" />
    </ListDialog>
  );
}
