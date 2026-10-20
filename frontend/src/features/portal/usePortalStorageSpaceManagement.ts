/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { S3AccountSelector } from "../../api/accountParams";
import {
  deletePortalStorageSpace,
  takePortalStorageSpaceOwnership,
  updatePortalStorageSpace,
} from "../../api/portal";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import type { PortalWorkspaceSpace } from "./portalWorkspaceModel";

type UsePortalStorageSpaceManagementOptions = {
  accountId: S3AccountSelector;
  space: PortalWorkspaceSpace | null;
  refreshWorkspaceData: () => void;
  refreshAccessSummary: () => Promise<void>;
  onMessage: (message: string | null) => void;
};

export function usePortalStorageSpaceManagement({
  accountId,
  space,
  refreshWorkspaceData,
  refreshAccessSummary,
  onMessage,
}: UsePortalStorageSpaceManagementOptions) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [metadataBusy, setMetadataBusy] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [takeOwnershipDialogOpen, setTakeOwnershipDialogOpen] = useState(false);
  const [takeOwnershipBusy, setTakeOwnershipBusy] = useState(false);

  const openArchiveDialog = () => {
    if (!space || !accountId) return;
    setArchiveDialogOpen(true);
  };

  const confirmArchive = async () => {
    if (!space || !accountId) return;
    setMetadataBusy(true);
    onMessage(null);
    try {
      await updatePortalStorageSpace(accountId, space.id, { archived: true });
      setArchiveDialogOpen(false);
      navigate("/portal/storage-spaces");
    } catch (err) {
      console.error(err);
      onMessage(
        extractApiError(
          err,
          t({
            en: "Unable to archive this space.",
            fr: "Impossible d'archiver cet espace.",
            de: "Dieser Bereich kann nicht archiviert werden.",
            zh: "无法归档此空间。",
          }),
        ),
      );
      setMetadataBusy(false);
    }
  };

  const restoreSpace = async () => {
    if (!space || !accountId) return;
    setMetadataBusy(true);
    onMessage(null);
    try {
      await updatePortalStorageSpace(accountId, space.id, { archived: false });
      refreshWorkspaceData();
      onMessage(
        t({
          en: "Space restored.",
          fr: "Espace restauré.",
          de: "Bereich wiederhergestellt.",
          zh: "空间已恢复。",
        }),
      );
    } catch (err) {
      console.error(err);
      onMessage(
        extractApiError(
          err,
          t({
            en: "Unable to restore this space.",
            fr: "Impossible de restaurer cet espace.",
            de: "Dieser Bereich kann nicht wiederhergestellt werden.",
            zh: "无法恢复此空间。",
          }),
        ),
      );
    } finally {
      setMetadataBusy(false);
    }
  };

  const openDeleteDialog = () => {
    setDeleteError(null);
    setDeleteDialogOpen(true);
  };

  const closeDeleteDialog = () => {
    if (deleteBusy) return;
    setDeleteDialogOpen(false);
    setDeleteError(null);
  };

  const confirmDelete = async () => {
    if (!space || !accountId || !space.canDelete) return;
    setDeleteBusy(true);
    setDeleteError(null);
    onMessage(null);
    try {
      await deletePortalStorageSpace(accountId, space.id);
      setDeleteDialogOpen(false);
      refreshWorkspaceData();
      navigate("/portal/storage-spaces", { replace: true });
    } catch (err) {
      console.error(err);
      setDeleteError(
        extractApiError(
          err,
          t({
            en: "Unable to delete this space.",
            fr: "Impossible de supprimer cet espace.",
            de: "Dieser Bereich kann nicht gelöscht werden.",
            zh: "无法删除此空间。",
          }),
        ),
      );
    } finally {
      setDeleteBusy(false);
    }
  };

  const confirmTakeOwnership = async () => {
    if (!space || !accountId || !space.canTakeOwnership) return;
    setTakeOwnershipBusy(true);
    onMessage(null);
    try {
      await takePortalStorageSpaceOwnership(accountId, space.id);
      setTakeOwnershipDialogOpen(false);
      refreshWorkspaceData();
      await refreshAccessSummary();
      onMessage(
        t({
          en: "You now own this private space.",
          fr: "Vous êtes désormais propriétaire de cet espace privé.",
          de: "Sie besitzen nun diesen privaten Bereich.",
          zh: "你现在拥有此私有空间。",
        }),
      );
    } catch (err) {
      console.error(err);
      onMessage(
        extractApiError(
          err,
          t({
            en: "Unable to take ownership.",
            fr: "Impossible de reprendre la propriété.",
            de: "Eigentümerschaft kann nicht übernommen werden.",
            zh: "无法接管所有权。",
          }),
        ),
      );
    } finally {
      setTakeOwnershipBusy(false);
    }
  };

  return {
    metadataBusy,
    archiveDialogOpen,
    openArchiveDialog,
    closeArchiveDialog: () => setArchiveDialogOpen(false),
    confirmArchive,
    restoreSpace,
    deleteDialogOpen,
    deleteBusy,
    deleteError,
    openDeleteDialog,
    closeDeleteDialog,
    confirmDelete,
    takeOwnershipDialogOpen,
    takeOwnershipBusy,
    openTakeOwnershipDialog: () => setTakeOwnershipDialogOpen(true),
    closeTakeOwnershipDialog: () => setTakeOwnershipDialogOpen(false),
    confirmTakeOwnership,
  };
}
