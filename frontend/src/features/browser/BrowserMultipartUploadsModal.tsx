/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ListActionButton } from "../../components/list/ListControls";
import type { MultipartUploadItem } from "../../api/browserMultipart";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import ListDialog from "../../components/list/ListDialog";

import { formatDateTime } from "./browserUtils";

type BrowserMultipartUploadsModalProps = {
  bucketName: string;
  uploads: MultipartUploadItem[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  canLoadMore: boolean;
  abortingUploadIds: Set<string>;
  onRefresh: () => void;
  onLoadMore: () => void;
  onAbort: (upload: MultipartUploadItem) => void;
  onClose: () => void;
};

const getUploadRowId = (upload: MultipartUploadItem) => `${upload.key}::${upload.upload_id}`;

export default function BrowserMultipartUploadsModal({
  bucketName,
  uploads,
  loading,
  loadingMore,
  error,
  canLoadMore,
  abortingUploadIds,
  onRefresh,
  onLoadMore,
  onAbort,
  onClose,
}: BrowserMultipartUploadsModalProps) {
  const uploadColumns: Array<DataTableColumn<MultipartUploadItem>> = [
    {
      id: "key",
      label: "Key",
      primary: true,
      cellClassName: "max-w-[280px] break-all whitespace-pre-wrap",
      render: (upload) => upload.key,
    },
    {
      id: "upload-id",
      label: "Upload ID",
      cellClassName: "max-w-[260px] break-all font-mono text-[11px]",
      render: (upload) => upload.upload_id,
    },
    {
      id: "initiated",
      label: "Initiated",
      render: (upload) => formatDateTime(upload.initiated),
    },
    {
      id: "storage-class",
      label: "Storage class",
      render: (upload) => upload.storage_class || "-",
    },
    {
      id: "owner",
      label: "Owner",
      render: (upload) => (
        <span className="block max-w-[200px] [overflow-wrap:anywhere]">
          {upload.owner || "-"}
        </span>
      ),
    },
    {
      id: "actions",
      label: "Actions",
      align: "right",
      mobileRole: "actions",
      render: (upload) => {
        const rowId = getUploadRowId(upload);
        const aborting = abortingUploadIds.has(rowId);
        return (
          <ListActionButton variant="danger"
            type="button"
            onClick={() => onAbort(upload)}
            disabled={aborting}
          >
            {aborting ? "Aborting..." : "Abort"}
          </ListActionButton>
        );
      },
    },
  ];

  return (
    <ListDialog title="Multipart uploads" onClose={onClose} maxWidthClass="max-w-5xl"
      description={`Bucket ${bucketName} · In-progress multipart uploads.`}
      rowCount={uploads.length} countLabel={`${uploads.length} loaded`}
      loading={loading || loadingMore} loadingMessage="Loading multipart uploads..." error={error}
      emptyMessage="No multipart uploads in progress." onRefresh={onRefresh}
      loadMore={{ available: canLoadMore, onClick: onLoadMore }}>
      <DataTableShell
          columns={uploadColumns}
          rows={uploads}
          rowKey={getUploadRowId}
          status="ready"
          loadingMessage="Loading multipart uploads..."
          errorMessage="Unable to load multipart uploads."
          emptyMessage="No multipart uploads in progress."
          containerClassName="rounded-lg border border-[var(--ui-border)]"
          tableClassName="ui-data-table"
          responsiveCards
      />
    </ListDialog>
  );
}
