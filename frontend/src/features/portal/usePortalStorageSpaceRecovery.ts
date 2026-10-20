/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useState } from "react";
import type { S3AccountSelector } from "../../api/accountParams";
import { restorePortalStorageSpaceObject } from "../../api/portal";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { formatBytes } from "../../utils/format";
import type {
  BrowserDeletedObjectTarget,
  BrowserObjectDetailsRouteTarget,
} from "../browser/browserPageContract";
import type { PortalWorkspaceSpace } from "./portalWorkspaceModel";

type UsePortalStorageSpaceRecoveryOptions = {
  accountId: S3AccountSelector;
  space: PortalWorkspaceSpace | null;
  historyCleanupEnabled: boolean;
  refreshWorkspaceData: () => void;
  onMessage: (message: string | null) => void;
};

export function usePortalStorageSpaceRecovery({
  accountId,
  space,
  historyCleanupEnabled,
  refreshWorkspaceData,
  onMessage,
}: UsePortalStorageSpaceRecoveryOptions) {
  const { t } = useI18n();
  const [trashRestoreTarget, setTrashRestoreTarget] =
    useState<BrowserDeletedObjectTarget | null>(null);
  const [restoringTrashKey, setRestoringTrashKey] = useState<string | null>(null);
  const [browserRefreshToken, setBrowserRefreshToken] = useState(0);
  const [deletedPrefixRestoreTarget, setDeletedPrefixRestoreTarget] =
    useState<BrowserObjectDetailsRouteTarget | null>(null);
  const [historyCleanupConfirmOpen, setHistoryCleanupConfirmOpen] = useState(false);
  const [historyCleanupDialogOpen, setHistoryCleanupDialogOpen] = useState(false);

  const canCleanHistory = Boolean(
    historyCleanupEnabled &&
      space &&
      space.status !== "Archived" &&
      (space.role === "Owner" || space.role === "Manager"),
  );

  const confirmTrashRestore = async (item: BrowserDeletedObjectTarget) => {
    if (!space || !accountId || restoringTrashKey) return;
    setRestoringTrashKey(item.key);
    onMessage(null);
    try {
      await restorePortalStorageSpaceObject(accountId, space.id, item.key);
      setTrashRestoreTarget(null);
      setBrowserRefreshToken((current) => current + 1);
      refreshWorkspaceData();
      onMessage(
        t({
          en: `${item.name} restored to its original location.`,
          fr: `${item.name} restauré à son emplacement d'origine.`,
          de: `${item.name} wurde am ursprünglichen Ort wiederhergestellt.`,
          zh: `已将 ${item.name} 恢复到原始位置。`,
        }),
      );
    } catch (err) {
      console.error(err);
      onMessage(
        extractApiError(
          err,
          t({
            en: "Unable to restore this file.",
            fr: "Impossible de restaurer ce fichier.",
            de: "Diese Datei kann nicht wiederhergestellt werden.",
            zh: "无法恢复此文件。",
          }),
        ),
      );
      setTrashRestoreTarget(null);
    } finally {
      setRestoringTrashKey(null);
    }
  };

  const requestHistoryCleanup = () => {
    if (!canCleanHistory) return;
    setHistoryCleanupConfirmOpen(true);
  };

  const confirmHistoryCleanup = () => {
    if (!canCleanHistory) return;
    setHistoryCleanupConfirmOpen(false);
    setHistoryCleanupDialogOpen(true);
  };

  const refreshBrowser = () => {
    setBrowserRefreshToken((current) => current + 1);
  };

  const completeHistoryCleanup = (bytesFreed: number) => {
    onMessage(
      t({
        en: `History cleanup completed. Estimated space gained: ${formatBytes(bytesFreed)}.`,
        fr: `Nettoyage de l'historique terminé. Espace estimé gagné : ${formatBytes(bytesFreed)}.`,
        de: `Historienbereinigung abgeschlossen. Geschätzter frei gewordener Speicher: ${formatBytes(bytesFreed)}.`,
        zh: `历史记录清理完成。预计释放空间：${formatBytes(bytesFreed)}。`,
      }),
    );
  };

  return {
    canCleanHistory,
    trashRestoreTarget,
    restoringTrashKey,
    requestTrashRestore: setTrashRestoreTarget,
    cancelTrashRestore: () => setTrashRestoreTarget(null),
    confirmTrashRestore,
    browserRefreshToken,
    refreshBrowser,
    deletedPrefixRestoreTarget,
    requestDeletedPrefixRestore: setDeletedPrefixRestoreTarget,
    cancelDeletedPrefixRestore: () => setDeletedPrefixRestoreTarget(null),
    historyCleanupConfirmOpen,
    historyCleanupDialogOpen,
    requestHistoryCleanup,
    cancelHistoryCleanup: () => setHistoryCleanupConfirmOpen(false),
    confirmHistoryCleanup,
    closeHistoryCleanup: () => setHistoryCleanupDialogOpen(false),
    startHistoryCleanup: () => onMessage(null),
    completeHistoryCleanup,
  };
}
