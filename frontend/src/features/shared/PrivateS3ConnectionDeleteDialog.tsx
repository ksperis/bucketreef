/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import type { S3Connection } from "../../api/connections";
import { useSharedI18n } from "./sharedI18n";

export type PendingPrivateConnectionDelete = {
  scope: "single" | "bulk";
  connections: S3Connection[];
};

type PrivateS3ConnectionDeleteDialogProps = {
  pendingDelete: PendingPrivateConnectionDelete;
  bulkDeleting: boolean;
  deletingConnectionBusyId: number | null;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

export default function PrivateS3ConnectionDeleteDialog({
  pendingDelete,
  bulkDeleting,
  deletingConnectionBusyId,
  onCancel,
  onConfirm,
}: PrivateS3ConnectionDeleteDialogProps) {
  const { text: surfaceText } = useSharedI18n();
  const singleConnection = pendingDelete.connections[0];
  const isSingle = pendingDelete.scope === "single";

  return (
    <ConfirmActionDialog
      title={surfaceText(
        isSingle ? "Delete private S3 connection?" : "Delete selected private S3 connections?",
      )}
      description={
        isSingle
          ? surfaceText("Remove this private connection from your profile.")
          : surfaceText("Remove all selected private connections from your profile.")
      }
      confirmLabel={surfaceText(isSingle ? "Delete connection" : "Delete selected connections")}
      details={
        isSingle
          ? [
              {
                label: surfaceText("Connection"),
                value: singleConnection?.name || `#${singleConnection?.id}`,
              },
              {
                label: surfaceText("Endpoint"),
                value: singleConnection?.endpoint_url || surfaceText("Managed endpoint"),
                mono: true,
              },
            ]
          : [{ label: surfaceText("Connections"), value: pendingDelete.connections.length }]
      }
      impacts={[
        surfaceText("Access through the selected connection will be removed from Manager and Browser."),
        surfaceText("Remote buckets and their objects will not be deleted."),
      ]}
      loading={isSingle ? deletingConnectionBusyId === singleConnection?.id : bulkDeleting}
      onCancel={onCancel}
      onConfirm={() => void onConfirm()}
    />
  );
}
