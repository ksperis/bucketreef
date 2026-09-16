/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback } from "react";
import type {
  PresignRequest,
  PresignedUrl,
} from "../../api/browserTransfers";
import type { BrowserCopyDialogState } from "./useBrowserCopyDialog";
import type { BrowserItem } from "./browserTypes";

type UseBrowserCopyActionsOptions = {
  bucketName: string;
  enabled: boolean;
  onFallback: (dialog: BrowserCopyDialogState) => void;
  onStatus: (message: string) => void;
  onWarning: (message: string | null) => void;
  presignObject: (
    bucket: string,
    payload: PresignRequest,
  ) => Promise<PresignedUrl>;
  sseActive: boolean;
};

export function useBrowserCopyActions({
  bucketName,
  enabled,
  onFallback,
  onStatus,
  onWarning,
  presignObject,
  sseActive,
}: UseBrowserCopyActionsOptions) {
  const copyValue = useCallback(async (dialog: BrowserCopyDialogState) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(dialog.value);
        if (dialog.successMessage) onStatus(dialog.successMessage);
        return;
      }
    } catch {
      // Permission denial uses the same manual handoff as a missing clipboard API.
    }
    onFallback(dialog);
  }, [onFallback, onStatus]);

  const copyUrl = useCallback(
    async (item: BrowserItem | null) => {
      if (
        !bucketName ||
        !enabled ||
        !item ||
        item.type !== "file" ||
        item.isDeleted
      ) {
        if (item?.isDeleted) {
          onWarning("Deleted objects do not have a direct download URL.");
        }
        return;
      }
      if (sseActive) {
        onWarning(
          "Copy URL is disabled in SSE-C mode: required encryption headers are missing.",
        );
        return;
      }
      try {
        const presign = await presignObject(bucketName, {
          key: item.key,
          operation: "get_object",
          expires_in: 900,
        });
        await copyValue({
          title: "Copy URL",
          label: "Object URL",
          value: presign.url,
          successMessage: "URL copied to clipboard.",
        });
      } catch {
        onStatus("Unable to copy URL.");
      }
    },
    [
      bucketName,
      enabled,
      copyValue,
      onStatus,
      onWarning,
      presignObject,
      sseActive,
    ],
  );

  const copyPath = useCallback(
    async (path: string) => {
      if (!path) return;
      await copyValue({
        title: "Copy path",
        label: "Object path",
        value: path,
        successMessage: "Path copied to clipboard.",
      });
    },
    [copyValue],
  );

  return { copyPath, copyUrl };
}
