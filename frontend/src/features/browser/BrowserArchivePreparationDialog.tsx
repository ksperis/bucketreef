/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { formatBytes } from "../../utils/format";
import { useBrowserI18n } from "./browserI18n";
import type { BrowserArchivePreparation } from "./useBrowserDownloads";

type BrowserArchivePreparationDialogProps = {
  preparation: BrowserArchivePreparation;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function BrowserArchivePreparationDialog({
  preparation,
  onCancel,
  onConfirm,
}: BrowserArchivePreparationDialogProps) {
  const { text, intlLocale } = useBrowserI18n();
  const inventorying = preparation.phase === "inventorying";

  return (
    <ConfirmActionDialog
      title={
        inventorying
          ? text("Preparing ZIP archive")
          : text("Save large ZIP archive")
      }
      description={
        inventorying
          ? preparation.totalFolders > 0
            ? text(
                "Checking folders and archive paths ({completed}/{total}). No object content is downloaded during this step.",
                {
                  completed: preparation.completedFolders,
                  total: preparation.totalFolders,
                },
              )
            : text(
                "Checking files and archive paths. No object content is downloaded during this step.",
              )
          : text(
              "The inventory is complete. Choose the destination file to start downloading object content.",
            )
      }
      details={
        preparation.phase === "ready"
          ? [
              { label: text("Files"), value: preparation.fileCount },
              {
                label: text("Volume"),
                value: formatBytes(preparation.totalBytes, intlLocale),
              },
              { label: text("Excluded"), value: preparation.excludedCount },
            ]
          : []
      }
      confirmLabel={text("Choose file and download")}
      confirmDisabled={inventorying || !preparation.canDownload}
      cancelLabel={inventorying ? text("Cancel preparation") : text("Close")}
      tone="primary"
      error={preparation.phase === "ready" ? preparation.error : undefined}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
