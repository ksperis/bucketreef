/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { S3AccountSelector } from "../../api/accountParams";
import {
  updatePortalStorageSpace,
  type PortalStorageSpaceAccountMemberRole,
  type PortalStorageSpaceGrantRole,
} from "../../api/portal";
import {
  fetchPortalStorageSpaceAccessSummary,
  revokePortalStorageSpaceShare,
  updatePortalStorageSpaceShare,
  type PortalStorageSpaceAccessSummary,
  type PortalStorageSpaceShare,
} from "../../api/portalSharing";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import {
  portalAccessModeFromParts,
  portalAccessPayloadFromMode,
  type PortalAccessMode,
} from "./PortalAccessControls";
import type {
  PendingAccessChange,
  PendingAccessRoleChange,
} from "./PortalStorageSpaceAccessDialogs";
import { portalRoleLabel } from "./portalI18n";
import type { PortalWorkspaceSpace } from "./portalWorkspaceModel";
import type { PortalStorageSpaceDetailTab } from "./usePortalStorageSpaceNavigation";

type UsePortalStorageSpaceAccessOptions = {
  accountId: S3AccountSelector;
  activeTab: PortalStorageSpaceDetailTab;
  browserEnabled: boolean;
  browserPortalEnabled: boolean;
  space: PortalWorkspaceSpace | null;
  refreshWorkspaceData: () => void;
  onMessage: (message: string | null) => void;
};

export function usePortalStorageSpaceAccess({
  accountId,
  activeTab,
  browserEnabled,
  browserPortalEnabled,
  space,
  refreshWorkspaceData,
  onMessage,
}: UsePortalStorageSpaceAccessOptions) {
  const { t } = useI18n();
  const [accessSummary, setAccessSummary] =
    useState<PortalStorageSpaceAccessSummary | null>(null);
  const [accessSummaryLoading, setAccessSummaryLoading] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessMode, setAccessMode] = useState<PortalAccessMode>("private");
  const [accessAccountMemberRole, setAccessAccountMemberRole] =
    useState<PortalStorageSpaceAccountMemberRole>("Editor");
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessPeopleDialogOpen, setAccessPeopleDialogOpen] = useState(false);
  const [pendingAccessChange, setPendingAccessChange] =
    useState<PendingAccessChange | null>(null);
  const [pendingAccessRoleChange, setPendingAccessRoleChange] =
    useState<PendingAccessRoleChange | null>(null);
  const [pendingAccessRevoke, setPendingAccessRevoke] =
    useState<PortalStorageSpaceShare | null>(null);

  const spaceAccessMode: PortalAccessMode = space
    ? portalAccessModeFromParts(space.visibility, space.shareScope)
    : "private";
  const savedAccessMode: PortalAccessMode = accessSummary
    ? accessSummary.mode === "all"
      ? "account"
      : accessSummary.mode
    : spaceAccessMode;
  const savedAccountMemberRole =
    accessSummary?.default_account_member_role ?? space?.accountMemberRole ?? "Editor";
  const accessChanged =
    accessMode !== savedAccessMode ||
    (accessMode === "account" && accessAccountMemberRole !== savedAccountMemberRole);
  const existingAccessRolesByUserId = useMemo(
    () =>
      Object.fromEntries(
        (accessSummary?.explicit_shares ?? [])
          .filter((share) => share.user_id != null)
          .map((share) => [share.user_id as number, share.role]),
      ) as Record<number, PortalStorageSpaceGrantRole>,
    [accessSummary?.explicit_shares],
  );

  useEffect(() => {
    if (!space) return;
    setAccessMode(spaceAccessMode);
    setAccessAccountMemberRole(space.accountMemberRole ?? "Editor");
  }, [space, spaceAccessMode]);

  const shouldLoadAccessSummary = Boolean(
    space &&
      accountId &&
      (activeTab === "collaborators" ||
        (activeTab === "files" &&
          (space.shareCount == null ||
            (browserEnabled &&
              browserPortalEnabled &&
              space.status !== "Archived" &&
              space.canBrowse &&
              space.role === "Manager" &&
              space.visibility === "shared")))),
  );

  const loadAccessSummary = useCallback(async () => {
    if (!space || !accountId || !shouldLoadAccessSummary) {
      setAccessSummary(null);
      return;
    }
    setAccessSummaryLoading(true);
    setAccessError(null);
    try {
      const summary = await fetchPortalStorageSpaceAccessSummary(accountId, space.id);
      setAccessSummary(summary);
      setAccessMode(summary.mode === "all" ? "account" : summary.mode);
      setAccessAccountMemberRole(
        summary.default_account_member_role ?? space.accountMemberRole ?? "Editor",
      );
    } catch (err) {
      console.error(err);
      setAccessSummary(null);
      setAccessError(
        extractApiError(
          err,
          t({
            en: "Unable to load access details.",
            fr: "Impossible de charger les détails d'accès.",
            de: "Zugriffsdetails können nicht geladen werden.",
            zh: "无法加载访问详情。",
          }),
        ),
      );
    } finally {
      setAccessSummaryLoading(false);
    }
  }, [accountId, shouldLoadAccessSummary, space, t]);

  useEffect(() => {
    void loadAccessSummary();
  }, [loadAccessSummary]);

  const requestSaveAccess = () => {
    if (!space || !accountId || !accessChanged) return;
    setPendingAccessChange({
      mode: accessMode,
      accountMemberRole: accessAccountMemberRole,
    });
  };

  const confirmAccessChange = async (change: PendingAccessChange) => {
    if (!space || !accountId) return;
    setAccessBusy(true);
    onMessage(null);
    try {
      await updatePortalStorageSpace(accountId, space.id, {
        ...portalAccessPayloadFromMode(change.mode, change.accountMemberRole),
      });
      setPendingAccessChange(null);
      refreshWorkspaceData();
      await loadAccessSummary();
      onMessage(
        t({
          en: "Access updated.",
          fr: "Accès mis à jour.",
          de: "Zugriff aktualisiert.",
          zh: "访问权限已更新。",
        }),
      );
    } catch (err) {
      console.error(err);
      onMessage(
        extractApiError(
          err,
          t({
            en: "Unable to update access.",
            fr: "Impossible de mettre à jour l'accès.",
            de: "Zugriff kann nicht aktualisiert werden.",
            zh: "无法更新访问权限。",
          }),
        ),
      );
      setPendingAccessChange(null);
    } finally {
      setAccessBusy(false);
    }
  };

  const requestAccessRoleChange = (
    share: PortalStorageSpaceShare,
    role: PortalStorageSpaceGrantRole,
  ) => {
    if (role === share.role) return;
    setPendingAccessRoleChange({ share, role });
  };

  const confirmAccessRoleChange = async ({ share, role }: PendingAccessRoleChange) => {
    if (!space || !accountId || share.user_id == null) return;
    setAccessBusy(true);
    onMessage(null);
    try {
      await updatePortalStorageSpaceShare(accountId, space.id, share.user_id, role);
      await loadAccessSummary();
      setPendingAccessRoleChange(null);
      onMessage(
        t({
          en: `${share.email} now has ${portalRoleLabel(role, t)} access to ${space.name}.`,
          fr: `${share.email} dispose maintenant de l'accès ${portalRoleLabel(role, t)} à ${space.name}.`,
          de: `${share.email} hat jetzt ${portalRoleLabel(role, t)}-Zugriff auf ${space.name}.`,
          zh: `${share.email} 现在对 ${space.name} 拥有${portalRoleLabel(role, t)}权限。`,
        }),
      );
    } catch (err) {
      console.error(err);
      onMessage(
        extractApiError(
          err,
          t({
            en: "Unable to update this person.",
            fr: "Impossible de mettre à jour cette personne.",
            de: "Diese Person kann nicht aktualisiert werden.",
            zh: "无法更新此人员。",
          }),
        ),
      );
      setPendingAccessRoleChange(null);
    } finally {
      setAccessBusy(false);
    }
  };

  const confirmAccessRevoke = async (share: PortalStorageSpaceShare) => {
    if (!space || !accountId || share.user_id == null) return;
    setAccessBusy(true);
    onMessage(null);
    try {
      await revokePortalStorageSpaceShare(accountId, space.id, share.user_id);
      setPendingAccessRevoke(null);
      await loadAccessSummary();
      onMessage(
        t({
          en: "Access revoked.",
          fr: "Accès révoqué.",
          de: "Zugriff widerrufen.",
          zh: "访问权限已撤销。",
        }),
      );
    } catch (err) {
      console.error(err);
      onMessage(
        extractApiError(
          err,
          t({
            en: "Unable to revoke access.",
            fr: "Impossible de révoquer l'accès.",
            de: "Zugriff kann nicht widerrufen werden.",
            zh: "无法撤销访问权限。",
          }),
        ),
      );
      setPendingAccessRevoke(null);
    } finally {
      setAccessBusy(false);
    }
  };

  return {
    accessSummary,
    accessSummaryLoading,
    accessError,
    accessMode,
    setAccessMode,
    accessAccountMemberRole,
    setAccessAccountMemberRole,
    accessBusy,
    accessChanged,
    savedAccessMode,
    existingAccessRolesByUserId,
    accessPeopleDialogOpen,
    setAccessPeopleDialogOpen,
    pendingAccessChange,
    setPendingAccessChange,
    pendingAccessRoleChange,
    setPendingAccessRoleChange,
    pendingAccessRevoke,
    setPendingAccessRevoke,
    loadAccessSummary,
    requestSaveAccess,
    requestAccessRoleChange,
    confirmAccessChange,
    confirmAccessRoleChange,
    confirmAccessRevoke,
  };
}
