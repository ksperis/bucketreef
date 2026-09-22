/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import PortalAddPeopleWorkflow from "./PortalAddPeopleWorkflow";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  deletePortalStorageSpace,
  restorePortalStorageSpaceObject,
  takePortalStorageSpaceOwnership,
  updatePortalStorageSpace,
  type PortalStorageSpaceAccountMemberRole,
  type PortalStorageSpaceGrantRole,
} from "../../api/portal";
import {
  fetchPortalStorageSpaceAccessSummary,
  listPortalStorageSpacePublicLinks,
  revokePortalStorageSpaceShare,
  updatePortalStorageSpaceShare,
  type PortalPublicLink,
  type PortalStorageSpaceAccessSummary,
  type PortalStorageSpaceShare,
} from "../../api/portalSharing";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { workflowPageHostClass } from "../../components/WorkflowPage";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import UiSelect from "../../components/ui/UiSelect";
import {
  cx,
  uiButtonBaseClass,
  uiButtonVariants,
  uiMutedTextClass,
  uiPanelMutedClass,
  uiTitleTextClass,
} from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import {
  readClientStorageKey,
  writeClientStorageKey,
} from "../../utils/clientStorage";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import BrowserEmbed from "../browser/BrowserEmbed";
import StorageSpaceObjectDetailsDrawer from "../shared/StorageSpaceObjectDetailsDrawer";
import {
  resolveStorageSpaceObjectDetailsView,
  type StorageSpaceObjectDetailsView,
} from "../shared/objectDetailsContract";
import type {
  BrowserDeletedObjectTarget,
  BrowserObjectDetailsRouteTarget,
} from "../browser/browserPageContract";
import {
  PortalAccessModeFields,
  PortalRoleBadge,
  portalAccessModeFromParts,
  portalAccessPayloadFromMode,
  portalAccessModeDescription,
  portalAccessModeSummary,
  type PortalAccessMode,
} from "./PortalAccessControls";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import PortalPageTabs, { PortalTabPanel } from "./PortalPageTabs";
import PortalDeletedPrefixRestoreWorkflow from "./PortalDeletedPrefixRestoreWorkflow";
import PortalPublicLinkRevokeDialog from "./PortalPublicLinkRevokeDialog";
import PortalPublicLinksTable from "./PortalPublicLinksTable";
import {
  decodePortalRouteValue,
  storageSpacePath,
} from "./portalWorkspaceModel";
import PortalStorageSpaceStatistics from "./PortalStorageSpaceStatistics";
import PortalStorageSpaceHistoryCleanupWorkflow from "./PortalStorageSpaceHistoryCleanupWorkflow";
import {
  PortalPageState,
  portalStorageSpaceStatusTone,
  resolvePortalWorkspacePageState,
} from "./portalUi";
import {
  portalDateTimeLabel,
  portalRoleLabel,
  portalShareScopeLabel,
  portalStatusLabel,
} from "./portalI18n";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";
import { usePortalPublicLinkActions } from "./usePortalPublicLinkActions";

import { usePortalAccountContext } from "./PortalAccountContext";
import PortalStorageSpaceSettings from "./PortalStorageSpaceSettings";
import SettingsNavigationGuard from "../../components/settings/SettingsNavigationGuard";
import { SettingsButton } from "../../components/settings/SettingsControls";
import { settingsLabels } from "../../components/settings/settingsLabels";

type PendingAccessChange = {
  mode: PortalAccessMode;
  accountMemberRole: PortalStorageSpaceAccountMemberRole;
};

type PendingAccessRoleChange = {
  share: PortalStorageSpaceShare;
  role: PortalStorageSpaceGrantRole;
};

type SpaceDetailTab =
  | "files"
  | "collaborators"
  | "external-links"
  | "statistics"
  | "settings";

export default function PortalStorageSpaceDetailPage() {
  const { selectedAccountId } = usePortalAccountContext();
  const { spaceId } = useParams();
  return <StorageSpaceDetail key={`${selectedAccountId}:${spaceId}`} />;
}

function StorageSpaceDetail() {
  const { locale, t } = useI18n();
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { generalSettings } = useGeneralSettings();
  const [message, setMessage] = useState<string | null>(null);
  const requested = new URLSearchParams(location.search).get("tab");
  const activeTab: SpaceDetailTab = requested === "collaborators" || requested === "external-links" || requested === "statistics" || requested === "settings" ? requested : "files";
  const [settingsDirty, setSettingsDirty] = useState(false);
  const draftLabels = settingsLabels(t);
  const [trashRestoreTarget, setTrashRestoreTarget] =
    useState<BrowserDeletedObjectTarget | null>(null);
  const [restoringTrashKey, setRestoringTrashKey] = useState<string | null>(null);
  const [browserRefreshToken, setBrowserRefreshToken] = useState(0);
  const [deletedPrefixRestoreTarget, setDeletedPrefixRestoreTarget] =
    useState<BrowserObjectDetailsRouteTarget | null>(null);
  const [metadataBusy, setMetadataBusy] = useState(false);
  const [historyCleanupConfirmOpen, setHistoryCleanupConfirmOpen] = useState(false);
  const [historyCleanupDialogOpen, setHistoryCleanupDialogOpen] = useState(false);
  const [accessSummary, setAccessSummary] = useState<PortalStorageSpaceAccessSummary | null>(null);
  const [accessSummaryLoading, setAccessSummaryLoading] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessMode, setAccessMode] = useState<PortalAccessMode>("private");
  const [accessAccountMemberRole, setAccessAccountMemberRole] = useState<PortalStorageSpaceAccountMemberRole>("Editor");
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessPeopleDialogOpen, setAccessPeopleDialogOpen] = useState(false);
  const [pendingAccessChange, setPendingAccessChange] = useState<PendingAccessChange | null>(null);
  const [pendingAccessRoleChange, setPendingAccessRoleChange] = useState<PendingAccessRoleChange | null>(null);
  const [pendingAccessRevoke, setPendingAccessRevoke] = useState<PortalStorageSpaceShare | null>(null);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [takeOwnershipDialogOpen, setTakeOwnershipDialogOpen] = useState(false);
  const [takeOwnershipBusy, setTakeOwnershipBusy] = useState(false);
  const [objectCreateLinkRequestToken, setObjectCreateLinkRequestToken] =
    useState(0);
  const [externalLinks, setExternalLinks] = useState<PortalPublicLink[]>([]);
  const [externalLinksLoading, setExternalLinksLoading] = useState(false);
  const [externalLinksError, setExternalLinksError] = useState<string | null>(null);
  const [pendingExternalLinkRevoke, setPendingExternalLinkRevoke] = useState<PortalPublicLink | null>(null);
  const {
    workspace,
    state,
    loading,
    error,
    hasAccountContext,
    accountError,
    accountLoading,
    accountIdForApi,
    selectedAccount,
    refreshWorkspaceData = () => undefined,
  } = usePortalWorkspaceData({
    includeArchived: true,
    preserveSpaceDataOnRefresh: true,
    includeUsage: activeTab === "statistics",
  });
  const decodedSpaceId = decodePortalRouteValue(spaceId);
  const space = workspace.spaces.find((item) => item.id === decodedSpaceId) ?? null;
  const {
    busyLinkId: busyExternalLinkId,
    copyLink: copyExternalLink,
    revokeLink: revokeExternalLink,
  } = usePortalPublicLinkActions({
    accountId: accountIdForApi,
    onLinksUpdated: (links) => setExternalLinks(links),
    onMessage: setMessage,
    onError: setExternalLinksError,
  });
  const startGuideStorageKey = space
    ? `portal.storage-space-detail.start-guide.dismissed.${accountIdForApi ?? "default"}.${space.id}`
    : null;
  const [startGuideDismissed, setStartGuideDismissed] = useState(false);
  const spaceAccessMode: PortalAccessMode = space ? portalAccessModeFromParts(space.visibility, space.shareScope) : "private";
  const savedAccessMode: PortalAccessMode = accessSummary
    ? accessSummary.mode === "all"
      ? "account"
      : accessSummary.mode
    : spaceAccessMode;
  const savedAccountMemberRole = accessSummary?.default_account_member_role ?? space?.accountMemberRole ?? "Editor";
  const accessChanged = accessMode !== savedAccessMode || (accessMode === "account" && accessAccountMemberRole !== savedAccountMemberRole);
  const existingAccessRolesByUserId = useMemo(
    () =>
      Object.fromEntries(
        (accessSummary?.explicit_shares ?? [])
          .filter((share) => share.user_id != null)
          .map((share) => [share.user_id as number, share.role]),
      ) as Record<number, PortalStorageSpaceGrantRole>,
    [accessSummary?.explicit_shares],
  );
  const onboardingState = (location.state as { portalSpaceCreated?: boolean; portalSpaceImported?: boolean } | null) ?? null;
  const showSpaceReadyBanner = Boolean(onboardingState?.portalSpaceCreated || onboardingState?.portalSpaceImported);
  const showDeletedFiles = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("show_deleted") === "1";
  }, [location.search]);
  const objectDrawerState = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const objectKey = params.get("object")?.trim() || null;
    const requestedView = params.get("object_view");
    const activeView: StorageSpaceObjectDetailsView =
      requestedView === "history" || requestedView === "sharing" || requestedView === "details"
        ? requestedView
        : "preview";
    return {
      activeView: params.get("object_deleted") === "1" && requestedView == null ? "history" as const : activeView,
      isDeleted: params.get("object_deleted") === "1",
      objectKey,
    };
  }, [location.search]);

  const selectSpaceDetailTab = useCallback(
    (tab: SpaceDetailTab) => {
      const params = new URLSearchParams(location.search);
      if (tab !== "files") {
        params.delete("object");
        params.delete("object_view");
        params.delete("object_deleted");
      }
      if (tab === "files") {
        params.delete("tab");
      } else {
        params.set("tab", tab);
      }
      const search = params.toString();
      navigate(
        {
          pathname: location.pathname,
          search: search ? `?${search}` : "",
        },
        { replace: true },
      );
    },
    [location.pathname, location.search, navigate],
  );

  useEffect(() => {
    if (!space) return;
    setAccessMode(spaceAccessMode);
    setAccessAccountMemberRole(space.accountMemberRole ?? "Editor");
  }, [space, spaceAccessMode]);

  useEffect(() => {
    let cancelled = false;
    const canListExternalLinks = Boolean(
      space &&
        space.status !== "Archived" &&
        (space.role === "Owner" || space.role === "Manager"),
    );
    if (
      activeTab !== "external-links" ||
      !space ||
      !accountIdForApi ||
      !canListExternalLinks
    ) {
      setExternalLinks([]);
      setExternalLinksLoading(false);
      setExternalLinksError(null);
      return () => {
        cancelled = true;
      };
    }
    setExternalLinksLoading(true);
    setExternalLinksError(null);
    listPortalStorageSpacePublicLinks(accountIdForApi, space.id, {
      includeRevoked: true,
    })
      .then((links) => {
        if (!cancelled) setExternalLinks(links);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setExternalLinks([]);
          setExternalLinksError(
            extractApiError(
              err,
              t({
                en: "Unable to load external links.",
                fr: "Impossible de charger les liens externes.",
                de: "Externe Links können nicht geladen werden.",
                zh: "无法加载外部链接。",
              }),
            ),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setExternalLinksLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, activeTab, space, t]);

  useEffect(() => {
    if (!startGuideStorageKey) {
      setStartGuideDismissed(false);
      return;
    }
    setStartGuideDismissed(readClientStorageKey(startGuideStorageKey) === "true");
  }, [startGuideStorageKey]);

  const shouldLoadAccessSummary = Boolean(
    space &&
      accountIdForApi &&
      (activeTab === "collaborators" ||
        (activeTab === "files" &&
          (space.shareCount == null ||
            (generalSettings.browser_enabled &&
              generalSettings.browser_portal_enabled &&
              space.status !== "Archived" &&
              space.canBrowse &&
              space.role === "Manager" &&
              space.visibility === "shared"))))
  );

  const loadAccessSummary = useCallback(async () => {
    if (!space || !accountIdForApi || !shouldLoadAccessSummary) {
      setAccessSummary(null);
      return;
    }
    setAccessSummaryLoading(true);
    setAccessError(null);
    try {
      const summary = await fetchPortalStorageSpaceAccessSummary(accountIdForApi, space.id);
      setAccessSummary(summary);
      const mode = summary.mode === "all" ? "account" : summary.mode;
      setAccessMode(mode);
      setAccessAccountMemberRole(summary.default_account_member_role ?? space.accountMemberRole ?? "Editor");
    } catch (err) {
      console.error(err);
      setAccessSummary(null);
      setAccessError(extractApiError(err, t({ en: "Unable to load access details.", fr: "Impossible de charger les détails d'accès.", de: "Zugriffsdetails können nicht geladen werden.", zh: "无法加载访问详情。" })));
    } finally {
      setAccessSummaryLoading(false);
    }
  }, [accountIdForApi, shouldLoadAccessSummary, space, t]);

  useEffect(() => {
    void loadAccessSummary();
  }, [loadAccessSummary]);

  const handleArchive = () => {
    if (!space || !accountIdForApi) return;
    setArchiveDialogOpen(true);
  };

  const handleRequestSaveAccess = () => {
    if (!space || !accountIdForApi || !accessChanged) return;
    setPendingAccessChange({ mode: accessMode, accountMemberRole: accessAccountMemberRole });
  };

  const confirmAccessChange = async (change: PendingAccessChange) => {
    if (!space || !accountIdForApi) return;
    setAccessBusy(true);
    setMessage(null);
    try {
      await updatePortalStorageSpace(accountIdForApi, space.id, {
        ...portalAccessPayloadFromMode(change.mode, change.accountMemberRole),
      });
      setPendingAccessChange(null);
      refreshWorkspaceData();
      await loadAccessSummary();
      setMessage(t({ en: "Access updated.", fr: "Accès mis à jour.", de: "Zugriff aktualisiert.", zh: "访问权限已更新。" }));
    } catch (err) {
      console.error(err);
      setMessage(extractApiError(err, t({ en: "Unable to update access.", fr: "Impossible de mettre à jour l'accès.", de: "Zugriff kann nicht aktualisiert werden.", zh: "无法更新访问权限。" })));
      setPendingAccessChange(null);
    } finally {
      setAccessBusy(false);
    }
  };

  const handleAccessRoleChange = (share: PortalStorageSpaceShare, role: PortalStorageSpaceGrantRole) => {
    if (role === share.role) return;
    setPendingAccessRoleChange({ share, role });
  };

  const confirmAccessRoleChange = async ({ share, role }: PendingAccessRoleChange) => {
    if (!space || !accountIdForApi || share.user_id == null) return;
    setAccessBusy(true);
    setMessage(null);
    try {
      await updatePortalStorageSpaceShare(accountIdForApi, space.id, share.user_id, role);
      await loadAccessSummary();
      setPendingAccessRoleChange(null);
      setMessage(t({
        en: `${share.email} now has ${portalRoleLabel(role, t)} access to ${space.name}.`,
        fr: `${share.email} dispose maintenant de l'accès ${portalRoleLabel(role, t)} à ${space.name}.`,
        de: `${share.email} hat jetzt ${portalRoleLabel(role, t)}-Zugriff auf ${space.name}.`,
        zh: `${share.email} 现在对 ${space.name} 拥有${portalRoleLabel(role, t)}权限。`,
      }));
    } catch (err) {
      console.error(err);
      setMessage(extractApiError(err, t({ en: "Unable to update this person.", fr: "Impossible de mettre à jour cette personne.", de: "Diese Person kann nicht aktualisiert werden.", zh: "无法更新此人员。" })));
      setPendingAccessRoleChange(null);
    } finally {
      setAccessBusy(false);
    }
  };


  const confirmAccessRevoke = async (share: PortalStorageSpaceShare) => {
    if (!space || !accountIdForApi || share.user_id == null) return;
    setAccessBusy(true);
    setMessage(null);
    try {
      await revokePortalStorageSpaceShare(accountIdForApi, space.id, share.user_id);
      setPendingAccessRevoke(null);
      await loadAccessSummary();
      setMessage(t({ en: "Access revoked.", fr: "Accès révoqué.", de: "Zugriff widerrufen.", zh: "访问权限已撤销。" }));
    } catch (err) {
      console.error(err);
      setMessage(extractApiError(err, t({ en: "Unable to revoke access.", fr: "Impossible de révoquer l'accès.", de: "Zugriff kann nicht widerrufen werden.", zh: "无法撤销访问权限。" })));
      setPendingAccessRevoke(null);
    } finally {
      setAccessBusy(false);
    }
  };

  const confirmArchive = async () => {
    if (!space || !accountIdForApi) return;
    setMetadataBusy(true);
    setMessage(null);
    try {
      await updatePortalStorageSpace(accountIdForApi, space.id, { archived: true });
      setArchiveDialogOpen(false);
      navigate("/portal/storage-spaces");
    } catch (err) {
      console.error(err);
      setMessage(extractApiError(err, t({ en: "Unable to archive this space.", fr: "Impossible d'archiver cet espace.", de: "Dieser Bereich kann nicht archiviert werden.", zh: "无法归档此空间。" })));
      setMetadataBusy(false);
    }
  };

  const handleRestore = async () => {
    if (!space || !accountIdForApi) return;
    setMetadataBusy(true);
    setMessage(null);
    try {
      await updatePortalStorageSpace(accountIdForApi, space.id, { archived: false });
      refreshWorkspaceData();
      setMessage(t({ en: "Space restored.", fr: "Espace restauré.", de: "Bereich wiederhergestellt.", zh: "空间已恢复。" }));
    } catch (err) {
      console.error(err);
      setMessage(extractApiError(err, t({ en: "Unable to restore this space.", fr: "Impossible de restaurer cet espace.", de: "Dieser Bereich kann nicht wiederhergestellt werden.", zh: "无法恢复此空间。" })));
    } finally {
      setMetadataBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!space || !accountIdForApi || !space.canDelete) return;
    setDeleteBusy(true);
    setDeleteError(null);
    setMessage(null);
    try {
      await deletePortalStorageSpace(accountIdForApi, space.id);
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
          })
        )
      );
    } finally {
      setDeleteBusy(false);
    }
  };

  const confirmTakeOwnership = async () => {
    if (!space || !accountIdForApi || !space.canTakeOwnership) return;
    setTakeOwnershipBusy(true);
    setMessage(null);
    try {
      await takePortalStorageSpaceOwnership(accountIdForApi, space.id);
      setTakeOwnershipDialogOpen(false);
      refreshWorkspaceData();
      await loadAccessSummary();
      setMessage(t({ en: "You now own this private space.", fr: "Vous êtes désormais propriétaire de cet espace privé.", de: "Sie besitzen nun diesen privaten Bereich.", zh: "你现在拥有此私有空间。" }));
    } catch (err) {
      console.error(err);
      setMessage(extractApiError(err, t({ en: "Unable to take ownership.", fr: "Impossible de reprendre la propriété.", de: "Eigentümerschaft kann nicht übernommen werden.", zh: "无法接管所有权。" })));
    } finally {
      setTakeOwnershipBusy(false);
    }
  };

  const confirmTrashRestore = async (item: BrowserDeletedObjectTarget) => {
    if (!space || !accountIdForApi || restoringTrashKey) return;
    setRestoringTrashKey(item.key);
    setMessage(null);
    try {
      await restorePortalStorageSpaceObject(accountIdForApi, space.id, item.key);
      setTrashRestoreTarget(null);
      setBrowserRefreshToken((current) => current + 1);
      refreshWorkspaceData();
      setMessage(
        t({
          en: `${item.name} restored to its original location.`,
          fr: `${item.name} restauré à son emplacement d'origine.`,
          de: `${item.name} wurde am ursprünglichen Ort wiederhergestellt.`,
          zh: `已将 ${item.name} 恢复到原始位置。`,
        }),
      );
    } catch (err) {
      console.error(err);
      setMessage(
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

  const pageState = resolvePortalWorkspacePageState({
    accountLoading,
    loading: loading && !space,
    accountError,
    error: space ? null : error,
    hasAccountContext,
    loadingMessage: t({ en: "Loading space...", fr: "Chargement de l'espace...", de: "Bereich wird geladen...", zh: "正在加载空间…" }),
    noAccountMessage: t({ en: "Select a project to view this space.", fr: "Sélectionnez un projet pour voir cet espace.", de: "Wählen Sie ein Projekt aus, um diesen Bereich anzuzeigen.", zh: "选择项目以查看此空间。" }),
  });
  if (pageState) return pageState;

  if (!space || !accountIdForApi) {
    return <PortalPageState>{t({ en: "Space not available.", fr: "Espace indisponible.", de: "Bereich nicht verfügbar.", zh: "空间不可用。" })}</PortalPageState>;
  }

  const browserAvailable =
    Boolean(generalSettings.browser_enabled) && Boolean(generalSettings.browser_portal_enabled);
  const isArchived = space.status === "Archived";
  const canBrowse = Boolean(space.canBrowse) && !isArchived;
  const hasFullAccess = space.role === "Owner" || space.role === "Manager";
  const canConfigureIcon = state?.portal_role === "portal_manager";
  const canModifyObjects = canBrowse && (hasFullAccess || space.role === "Editor");
  const lockedBucketName = space.internalName ?? space.id;
  const canInvitePeople = !isArchived && space.role === "Manager" && space.visibility === "shared";
  const knownCollaboratorCount = Math.max(
    space.shareCount ?? 0,
    accessSummary?.explicit_shares.length ?? 0
  );
  const collaboratorsUnknown = space.shareCount == null && !accessSummary;
  const spaceHasStarted = (space.objectCount ?? 0) > 0 || knownCollaboratorCount > 0;
  const showStartSpacePanel =
    canModifyObjects &&
    !startGuideDismissed &&
    !collaboratorsUnknown &&
    !spaceHasStarted &&
    (showSpaceReadyBanner || space.objectCount === 0);
  const canCreatePublicLinks = Boolean(
    canBrowse &&
    accessSummary?.can_create_public_links
  );
  const canCreateExternalAccess = Boolean(
    canBrowse &&
    hasFullAccess &&
    state?.can_create_external_sharing
  );
  const externalLinksUnavailableReason = isArchived
    ? t({
        en: "Restore this archived space to review links.",
        fr: "Restaurez cet espace archivé pour voir ses liens.",
        de: "Archivierte Bereiche zeigen keine externen Links.",
        zh: "请恢复此已归档空间以查看链接。",
      })
    : !hasFullAccess
      ? t({
          en: "Only owners and managers can review links.",
          fr: "Accès propriétaire ou gestionnaire requis.",
          de: "Nur Owner und Manager sehen externe Links.",
          zh: "只有所有者和管理员可以查看链接。",
        })
      : null;
  const externalLinksTableStatus = resolveListTableStatus({
    loading: externalLinksLoading,
    error: externalLinksError,
    rowCount: externalLinks.length,
  });
  const historyCleanupEnabled = Boolean(state?.storage_space_version_cleanup_enabled);
  const canCleanHistory = Boolean(historyCleanupEnabled && !isArchived && hasFullAccess);
  const deletionStatsKnown = space.objectCount != null && space.usedBytes != null;
  const storageSpaceIsEmpty = deletionStatsKnown && space.objectCount === 0 && space.usedBytes === 0;
  const pageDescription = space.description
    ? t({
        en: `${space.description} Created ${space.createdLabel}. Region: ${space.region ?? "-"}.`,
        fr: `${space.description} Créé le ${space.createdLabel}. Région : ${space.region ?? "-"}.`,
        de: `${space.description} Erstellt am ${space.createdLabel}. Region: ${space.region ?? "-"}.`,
        zh: `${space.description} 创建于 ${space.createdLabel}。区域：${space.region ?? "-"}。`,
      })
    : t({
        en: `Created ${space.createdLabel}. Region: ${space.region ?? "-"}.`,
        fr: `Créé le ${space.createdLabel}. Région : ${space.region ?? "-"}.`,
        de: `Erstellt am ${space.createdLabel}. Region: ${space.region ?? "-"}.`,
        zh: `创建于 ${space.createdLabel}。区域：${space.region ?? "-"}。`,
      });

  const dismissStartGuide = () => {
    setStartGuideDismissed(true);
    if (!startGuideStorageKey) return;
    writeClientStorageKey(startGuideStorageKey, "true");
  };

  const openHistoryCleanupDialog = () => {
    if (!canCleanHistory) return;
    setHistoryCleanupConfirmOpen(true);
  };

  const closeHistoryCleanupDialog = () => {
    setHistoryCleanupDialogOpen(false);
  };

  const confirmHistoryCleanup = () => {
    if (!canCleanHistory) return;
    setHistoryCleanupConfirmOpen(false);
    setHistoryCleanupDialogOpen(true);
  };

  const filesSection = (
    <section id="space-files" className="space-y-3">
      {isArchived ? (
        <PageBanner tone="warning">
          {t({ en: "This space is archived. Files and public links are suspended until it is restored.", fr: "Cet espace est archivé. Les fichiers et liens publics sont suspendus jusqu'à sa restauration.", de: "Dieser Bereich ist archiviert. Dateien und öffentliche Links sind bis zur Wiederherstellung ausgesetzt.", zh: "此空间已归档。文件和公开链接将在恢复空间前暂停使用。" })}
        </PageBanner>
      ) : !canBrowse ? (
        <PageBanner tone="warning">
          {t({ en: "Files are not available for this private space. You can still manage its collaborators and settings.", fr: "Les fichiers ne sont pas disponibles pour cet espace privé. Vous pouvez toujours gérer ses collaborateurs et paramètres.", de: "Dateien sind für diesen privaten Bereich nicht verfügbar. Sie können weiterhin Mitwirkende und Einstellungen verwalten.", zh: "无法访问此私有空间的文件。你仍可管理协作者和设置。" })}
        </PageBanner>
      ) : browserAvailable ? (
        <div className="min-h-[520px] h-[min(72vh,760px)]">
          <BrowserEmbed
            accountIdForApi={accountIdForApi}
            executionContextKind="portal_account"
            hasContext={hasAccountContext}
            workspaceSurface="portal"
            functionalProfile="portal"
            density="comfortable"
            capabilityFacts={{
              canWriteObjects: canModifyObjects,
              canDeleteObjects: canModifyObjects,
              canRestoreObjects: canModifyObjects,
              canCreatePublicLinks,
            }}
            lockedBucketName={lockedBucketName}
            lockedBucketLabel={space.name}
            storageEndpointCapabilities={selectedAccount?.storage_endpoint_capabilities ?? null}
            onOpenObjectDetails={(target) => {
              if (target.bucketName !== lockedBucketName) return;
              const params = new URLSearchParams(location.search);
              const replacingOpenDrawer = Boolean(params.get("object"));
              params.delete("tab");
              params.set("object", target.key);
              params.set(
                "object_view",
                resolveStorageSpaceObjectDetailsView(target),
              );
              if (target.isDeleted) params.set("object_deleted", "1");
              else params.delete("object_deleted");
              navigate(
                { pathname: location.pathname, search: `?${params.toString()}` },
                {
                  replace: replacingOpenDrawer,
                  state: { ...(location.state ?? {}), objectDrawerOpenedFromList: true },
                },
              );
              if (target.intent === "create-public-link") {
                setObjectCreateLinkRequestToken((current) => current + 1);
              }
            }}
            refreshToken={browserRefreshToken}
            deletedObjectsOptions={{
              visible: showDeletedFiles,
              showToggle: true,
              canRestore: canModifyObjects,
              onVisibilityChange: (visible) => {
                const params = new URLSearchParams(location.search);
                params.delete("tab");
                if (visible) {
                  params.set("show_deleted", "1");
                } else {
                  params.delete("show_deleted");
                }
                const search = params.toString();
                navigate(
                  {
                    pathname: location.pathname,
                    search: search ? `?${search}` : "",
                  },
                  { replace: true },
                );
              },
              onRestoreObject: canModifyObjects
                ? setTrashRestoreTarget
                : undefined,
              onRestorePrefix: canModifyObjects
                ? setDeletedPrefixRestoreTarget
                : undefined,
            }}
          />
        </div>
      ) : (
        <PageBanner tone="warning">
          {t({ en: "Files are unavailable. Ask an administrator to enable file browsing for this workspace.", fr: "Les fichiers sont indisponibles. Demandez à un administrateur d'activer la navigation pour cet espace de travail.", de: "Dateien sind nicht verfügbar. Bitten Sie einen Administrator, Dateibrowsing für diesen Workspace zu aktivieren.", zh: "文件不可用。请让管理员为此工作区启用文件浏览。" })}
        </PageBanner>
      )}
    </section>
  );

  const startSpacePanel = showStartSpacePanel ? (
    <section className={cx(uiPanelMutedClass, "p-4")} aria-labelledby="space-start-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="space-start-title" className={cx("text-[15px] font-bold", uiTitleTextClass)}>
            {t({ en: "Start this space", fr: "Démarrer cet espace", de: "Diesen Bereich starten", zh: "开始使用此空间" })}
          </h2>
          <p className={cx("mt-1 max-w-3xl text-xs leading-5", uiMutedTextClass)}>
            {t({
              en: "Keep the first steps focused: add the files people need, then invite collaborators when the space is ready.",
              fr: "Gardez les premières étapes simples : ajoutez les fichiers utiles, puis invitez les collaborateurs quand l'espace est prêt.",
              de: "Halten Sie die ersten Schritte fokussiert: Fügen Sie die benötigten Dateien hinzu und laden Sie danach Mitwirkende ein.",
              zh: "先添加大家需要的文件，再在空间准备就绪后邀请协作者。",
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {space.objectCount === 0 ? (
            <UiBadge tone="warning">{t({ en: "No files yet", fr: "Aucun fichier", de: "Noch keine Dateien", zh: "暂无文件" })}</UiBadge>
          ) : null}
          <UiButton size="xs" variant="secondary" onClick={dismissStartGuide}>
            {t({ en: "Dismiss guide", fr: "Masquer le guide", de: "Anleitung ausblenden", zh: "关闭指引" })}
          </UiButton>
        </div>
      </div>
      <ol className="mt-4 grid gap-3 md:grid-cols-2">
        <li className="flex min-h-[112px] flex-col justify-between rounded-md border border-[color:var(--ui-border-soft)] bg-[var(--ui-surface)] p-3">
          <div>
            <div className={cx("text-[11px] font-semibold uppercase", uiMutedTextClass)}>
              {t({ en: "Step 1", fr: "Étape 1", de: "Schritt 1", zh: "第 1 步" })}
            </div>
            <h3 className={cx("mt-1 text-sm font-bold", uiTitleTextClass)}>
              {t({ en: "Add files or folders", fr: "Ajouter des fichiers ou dossiers", de: "Dateien oder Ordner hinzufügen", zh: "添加文件或文件夹" })}
            </h3>
            <p className={cx("mt-1 text-xs leading-5", uiMutedTextClass)}>
              {t({
                en: "Use the file area below as the working place for this project or dataset.",
                fr: "Utilisez la zone de fichiers ci-dessous comme espace de travail du projet ou du jeu de données.",
                de: "Nutzen Sie den Dateibereich unten als Arbeitsbereich für dieses Projekt oder diesen Datensatz.",
                zh: "使用下方文件区域存放此项目或数据集的内容。",
              })}
            </p>
          </div>
          <div className="mt-3">
            <Link
              to={`${storageSpacePath(space)}#space-files`}
              className={cx(uiButtonBaseClass, uiButtonVariants.primary, "h-8 px-3 py-1.5 text-xs")}
            >
              {t({ en: "Add files", fr: "Ajouter des fichiers", de: "Dateien hinzufügen", zh: "添加文件" })}
            </Link>
          </div>
        </li>
        <li className="flex min-h-[112px] flex-col justify-between rounded-md border border-[color:var(--ui-border-soft)] bg-[var(--ui-surface)] p-3">
          <div>
            <div className={cx("text-[11px] font-semibold uppercase", uiMutedTextClass)}>
              {t({ en: "Step 2", fr: "Étape 2", de: "Schritt 2", zh: "第 2 步" })}
            </div>
            <h3 className={cx("mt-1 text-sm font-bold", uiTitleTextClass)}>
              {t({ en: "Invite collaborators", fr: "Inviter des collaborateurs", de: "Mitwirkende einladen", zh: "邀请协作者" })}
            </h3>
            <p className={cx("mt-1 text-xs leading-5", uiMutedTextClass)}>
              {canInvitePeople
                ? t({
                    en: "Bring people in once the file structure is ready for them.",
                    fr: "Invitez les personnes concernées lorsque l'organisation des fichiers est prête.",
                    de: "Laden Sie Personen ein, sobald die Dateistruktur für sie bereit ist.",
                    zh: "文件结构准备就绪后，再邀请大家加入。",
                  })
                : t({
                    en: "This space is private for now. Access can be opened from the Collaborators section when allowed.",
                    fr: "Cet espace est privé pour l'instant. L'accès pourra être ouvert depuis la section Collaborateurs si vous y êtes autorisé.",
                    de: "Dieser Bereich ist vorerst privat. Der Zugriff kann bei entsprechender Berechtigung im Bereich Mitwirkende geöffnet werden.",
                    zh: "此空间目前为私有。在允许的情况下，可从“协作者”部分开放访问。",
                  })}
            </p>
          </div>
          <div className="mt-3">
            {canInvitePeople && savedAccessMode === "restricted" ? (
              <button
                type="button"
                onClick={() => {
                  selectSpaceDetailTab("collaborators");
                  setAccessPeopleDialogOpen(true);
                }}
                className={cx(uiButtonBaseClass, uiButtonVariants.secondary, "h-8 px-3 py-1.5 text-xs")}
              >
                {t({ en: "Invite people", fr: "Inviter", de: "Einladen", zh: "邀请人员" })}
              </button>
            ) : (
              <span className={cx("text-xs font-semibold", uiMutedTextClass)}>
                {t({ en: "Private for now", fr: "Privé pour l'instant", de: "Vorerst privat", zh: "目前为私有" })}
              </span>
            )}
          </div>
        </li>
      </ol>
    </section>
  ) : null;

  return (
    <div
      className={workflowPageHostClass(
        accessPeopleDialogOpen ||
          historyCleanupDialogOpen ||
          Boolean(deletedPrefixRestoreTarget),
      )}
    >
      <PageHeader
        title={space.name}
        description={pageDescription}
        breadcrumbs={portalBreadcrumbs({ label: t({ en: "Spaces", fr: "Espaces", de: "Bereiche", zh: "空间" }), to: "/portal/storage-spaces" }, { label: space.name })}
        inlineContent={<UiBadge tone={portalStorageSpaceStatusTone(space)}>{portalStatusLabel(space.status, t)}</UiBadge>}
        actions={[
          ...(canInvitePeople && savedAccessMode === "restricted"
            ? [{
                label: t({ en: "Invite people", fr: "Inviter", de: "Einladen", zh: "邀请人员" }),
                onClick: () => {
                  selectSpaceDetailTab("collaborators");
                  setAccessPeopleDialogOpen(true);
                },
                variant: "secondary" as const,
              }]
            : []),
        ]}
      />

      <SettingsNavigationGuard dirty={settingsDirty} title={draftLabels.discardTitle}
        description={draftLabels.discardDescription} confirmLabel={draftLabels.discard}
        cancelLabel={draftLabels.keepEditing} closeLabel={draftLabels.close}
        onDiscard={() => setSettingsDirty(false)} />
      {error && <PageBanner tone="error">{error}</PageBanner>}
      {message ? <PageBanner tone="info">{message}</PageBanner> : null}
      {showSpaceReadyBanner ? (
        <PageBanner tone="success">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-bold">
                {onboardingState?.portalSpaceImported
                  ? t({ en: "Space added.", fr: "Espace ajouté.", de: "Bereich hinzugefügt.", zh: "空间已添加。" })
                  : t({ en: "Space created.", fr: "Espace créé.", de: "Bereich erstellt.", zh: "空间已创建。" })}
              </div>
              <div className="mt-1">
                {t({
                  en: "Use the start guide below to add files and bring collaborators in at the right time.",
                  fr: "Utilisez le guide de démarrage ci-dessous pour ajouter des fichiers et inviter les collaborateurs au bon moment.",
                  de: "Nutzen Sie die Starthilfe unten, um Dateien hinzuzufügen und Mitwirkende zum richtigen Zeitpunkt einzuladen.",
                  zh: "使用下方入门指引添加文件，并在合适的时候邀请协作者。",
                })}
              </div>
            </div>
          </div>
        </PageBanner>
      ) : null}

      <PortalPageTabs
        tabs={[
          { id: "files", label: t({ en: "Files", fr: "Fichiers", de: "Dateien", zh: "文件" }) },
          { id: "collaborators", label: t({ en: "Collaborators", fr: "Collaborateurs", de: "Mitwirkende", zh: "协作者" }) },
          { id: "external-links", label: t({ en: "External links", fr: "Liens externes", de: "Externe Links", zh: "外部链接" }) },
          { id: "statistics", label: t({ en: "Statistics", fr: "Statistiques", de: "Statistiken", zh: "统计" }) },
          { id: "settings", label: t({ en: "Settings", fr: "Réglages", de: "Einstellungen", zh: "设置" }) },
        ]}
        activeTab={activeTab}
        onChange={(tab) => selectSpaceDetailTab(tab as SpaceDetailTab)}
        ariaLabel={t({
          en: "Space sections",
          fr: "Sections de l'espace",
          de: "Bereichsabschnitte",
          zh: "空间分区",
        })}
        idPrefix="portal-space-detail"
      />

      {activeTab === "files" ? (
        <PortalTabPanel idPrefix="portal-space-detail" tabId="files">
          {startSpacePanel}
          {filesSection}
        </PortalTabPanel>
      ) : null}

      {activeTab === "statistics" ? (
        <PortalTabPanel idPrefix="portal-space-detail" tabId="statistics">
          <PortalStorageSpaceStatistics
            accountIdForApi={accountIdForApi}
            accountName={workspace.accountName}
            rgwAccountId={selectedAccount?.rgw_account_id}
            space={space}
          />
        </PortalTabPanel>
      ) : null}

      {activeTab === "collaborators" ? (
        <PortalTabPanel idPrefix="portal-space-detail" tabId="collaborators">
          <UiCard>
          {accessSummaryLoading ? (
            <div className={cx("text-xs font-semibold", uiMutedTextClass)}>
              {t({ en: "Loading access...", fr: "Chargement des accès...", de: "Zugriff wird geladen...", zh: "正在加载访问权限…" })}
            </div>
          ) : accessError ? (
            <PageBanner tone="warning">{accessError}</PageBanner>
          ) : accessSummary ? (
            <div className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <UiBadge tone={savedAccessMode === "private" ? "neutral" : "info"}>
                    {savedAccessMode === "account"
                      ? portalShareScopeLabel("shared", "account", t)
                      : savedAccessMode === "restricted"
                      ? portalShareScopeLabel("shared", "restricted", t)
                      : portalShareScopeLabel("private", "restricted", t)}
                  </UiBadge>
                  {isArchived ? <UiBadge tone="warning">{portalStatusLabel("Archived", t)}</UiBadge> : null}
                </div>
                <p className={cx("mt-2 text-xs font-medium", uiMutedTextClass)}>
                  {isArchived
                    ? t({ en: "Archived spaces have no active collaborator access.", fr: "Les espaces archivés n'ont aucun accès collaborateur actif.", de: "Archivierte Bereiche haben keinen aktiven Mitwirkendenzugriff.", zh: "已归档空间没有有效的协作者访问权限。" })
                    : portalAccessModeDescription(savedAccessMode, t)}
                </p>
                <p className={cx("mt-1 text-[11px] font-semibold", uiMutedTextClass)}>
                  {portalAccessModeSummary(savedAccessMode, accessSummary.explicit_shares.length, accessSummary.effective_member_count, t)}
                </p>
              </div>
              <div>
                <div className={cx("text-[11px] font-semibold uppercase", uiMutedTextClass)}>
                  {accessSummary.owner
                    ? t({ en: "Owner", fr: "Propriétaire", de: "Eigentümer", zh: "所有者" })
                    : t({ en: "Managed by", fr: "Géré par", de: "Verwaltet von", zh: "管理者" })}
                </div>
                <div className={cx("mt-1 font-bold", uiTitleTextClass)}>
                  {accessSummary.owner
                    ? accessSummary.owner.display_name || accessSummary.owner.email
                    : t({ en: "Project managers", fr: "Gestionnaires du projet", de: "Projektmanager", zh: "项目管理员" })}
                </div>
                {accessSummary.owner ? (
                  <div className={cx("text-[11px] font-medium", uiMutedTextClass)}>{accessSummary.owner.email}</div>
                ) : null}
              </div>
              <div>
                <div className={cx("text-[11px] font-semibold uppercase", uiMutedTextClass)}>
                  {t({ en: "Public links", fr: "Liens publics", de: "Öffentliche Links", zh: "公开链接" })}
                </div>
                <button
                  type="button"
                  onClick={() => selectSpaceDetailTab("external-links")}
                  className="mt-1 inline-flex text-sm font-bold text-primary hover:underline dark:text-primary-200"
                >
                  {t({
                    en: `${accessSummary.public_link_count} public link${accessSummary.public_link_count > 1 ? "s" : ""}`,
                    fr: `${accessSummary.public_link_count} lien${accessSummary.public_link_count > 1 ? "s" : ""} public${accessSummary.public_link_count > 1 ? "s" : ""}`,
                    de: `${accessSummary.public_link_count} öffentliche Links`,
                    zh: `${accessSummary.public_link_count} 个公开链接`,
                  })}
                </button>
              </div>
            </div>

            {accessSummary.can_manage_access ? (
              <div className="space-y-3 border-t border-[color:var(--ui-border-soft)] pt-4">
                <PageBanner tone="info">
                  {t({
                    en: "Project membership makes a person eligible to be invited. File access is controlled here for this space.",
                    fr: "Être membre du projet permet d'être invité. L'accès réel aux fichiers se règle ici, pour cet espace.",
                    de: "Die Projektmitgliedschaft ermöglicht eine Einladung. Der tatsächliche Dateizugriff wird hier für diesen Bereich festgelegt.",
                    zh: "项目成员资格仅使人员具备被邀请的资格。此空间的文件访问权限在这里控制。",
                  })}
                </PageBanner>
                <PortalAccessModeFields
                  mode={accessMode}
                  onModeChange={setAccessMode}
                  accountMemberRole={accessAccountMemberRole}
                  onAccountMemberRoleChange={setAccessAccountMemberRole}
                  disabled={accessBusy || isArchived}
                  allowedModes={["account", "restricted"]}
                  modeLabel={t({ en: "Who can access this space?", fr: "Qui peut accéder à cet espace ?", de: "Wer kann auf diesen Bereich zugreifen?", zh: "谁可以访问此空间？" })}
                  roleLabel={t({ en: "Default role for team members", fr: "Rôle par défaut des membres", de: "Standardrolle für Teammitglieder", zh: "团队成员默认角色" })}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <UiButton
                    size="sm"
                    disabled={!accessChanged || accessBusy || isArchived}
                    onClick={handleRequestSaveAccess}
                  >
                    {t({ en: "Save access", fr: "Enregistrer l'accès", de: "Zugriff speichern", zh: "保存访问权限" })}
                  </UiButton>
                  {accessChanged ? (
                    <span className={cx("text-[11px] font-semibold", uiMutedTextClass)}>
                      {t({ en: "Confirm before changing who has access.", fr: "Une confirmation sera demandée avant de modifier les personnes couvertes.", de: "Vor der Änderung der berechtigten Personen ist eine Bestätigung erforderlich.", zh: "更改访问人员前请确认。" })}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="space-y-2 border-t border-[color:var(--ui-border-soft)] pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className={cx("text-sm font-bold", uiTitleTextClass)}>
                  {t({ en: "Direct collaborators", fr: "Collaborateurs directs", de: "Direkte Mitwirkende", zh: "直接协作者" })}
                </h3>
                <span className={cx("text-[11px] font-semibold", uiMutedTextClass)}>
                  {t({
                    en: "Roles below apply only to this space.",
                    fr: "Les rôles ci-dessous s'appliquent uniquement à cet espace.",
                    de: "Die folgenden Rollen gelten nur für diesen Bereich.",
                    zh: "以下角色仅适用于此空间。",
                  })}
                </span>
              </div>
              {accessSummary.explicit_shares.length > 0 ? (
                <div className="space-y-2">
                  {accessSummary.explicit_shares.map((share) => (
                    <div key={share.id} className="grid gap-2 rounded-md border border-[color:var(--ui-border)] px-3 py-2 md:grid-cols-[minmax(0,1fr)_150px_auto] md:items-center">
                      <div className="min-w-0">
                        <div className={cx("truncate text-xs font-bold", uiTitleTextClass)}>{share.email}</div>
                        {savedAccessMode === "private" ? (
                          <div className={cx("text-[11px] font-semibold", uiMutedTextClass)}>
                            {t({ en: "Inactive while private", fr: "Inactif tant que l'accès est privé", de: "Inaktiv bei privatem Zugriff", zh: "私有状态下不生效" })}
                          </div>
                        ) : null}
                      </div>
                      {accessSummary.can_manage_access && share.user_id != null && savedAccessMode !== "private" ? (
                        <UiSelect
                          size="compact"
                          className="h-8"
                          value={share.role}
                          disabled={accessBusy || accessChanged || isArchived}
                          onChange={(event) => handleAccessRoleChange(share, event.target.value as PortalStorageSpaceGrantRole)}
                          aria-label={t({ en: `Access for ${share.email}`, fr: `Accès pour ${share.email}`, de: `Zugriff für ${share.email}`, zh: `${share.email} 的访问权限` })}
                        >
                          <option value="Viewer">{portalRoleLabel("Viewer", t)}</option>
                          <option value="Editor">{portalRoleLabel("Editor", t)}</option>
                        </UiSelect>
                      ) : (
                        <PortalRoleBadge role={share.role} />
                      )}
                      {accessSummary.can_manage_access && share.user_id != null && savedAccessMode !== "private" ? (
                        <UiButton
                          size="xs"
                          variant="danger"
                          disabled={accessBusy || accessChanged || isArchived}
                          onClick={() => setPendingAccessRevoke(share)}
                        >
                          {t({ en: "Revoke", fr: "Révoquer", de: "Widerrufen", zh: "撤销" })}
                        </UiButton>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className={cx("text-xs font-semibold", uiMutedTextClass)}>
                  {t({ en: "No direct collaborators yet.", fr: "Aucun collaborateur direct pour l'instant.", de: "Noch keine direkten Mitwirkenden.", zh: "暂无直接协作者。" })}
                </div>
              )}
            </div>

            {accessSummary.can_manage_access && savedAccessMode === "restricted" ? (
              <div className="space-y-3 border-t border-[color:var(--ui-border-soft)] pt-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className={cx("text-sm font-bold", uiTitleTextClass)}>
                      {t({ en: "Add people", fr: "Ajouter des personnes", de: "Personen hinzufügen", zh: "添加人员" })}
                    </h3>
                    <p className={cx("mt-1 text-xs font-semibold", uiMutedTextClass)}>
                      {t({
                        en: "Invite collaborators when this space is ready to share.",
                        fr: "Invitez des collaborateurs lorsque cet espace est prêt à être partagé.",
                        de: "Laden Sie Mitwirkende ein, wenn dieser Bereich bereit zum Teilen ist.",
                        zh: "在此空间准备好共享后邀请协作者。",
                      })}
                    </p>
                  </div>
                  <UiButton
                    size="sm"
                    disabled={accessBusy || accessChanged || isArchived}
                    onClick={() => setAccessPeopleDialogOpen(true)}
                  >
                    {t({ en: "Add people", fr: "Ajouter", de: "Hinzufügen", zh: "添加人员" })}
                  </UiButton>
                </div>
                {accessChanged ? (
                  <div className={cx("text-xs font-semibold", uiMutedTextClass)}>
                    {t({ en: "Save the access mode before editing direct collaborators.", fr: "Enregistrez le mode d'accès avant de modifier les collaborateurs directs.", de: "Speichern Sie den Zugriffsmodus, bevor Sie direkte Mitwirkende bearbeiten.", zh: "请先保存访问模式，再编辑直接协作者。" })}
                  </div>
                ) : null}
              </div>
            ) : null}
            </div>
          ) : null}
          </UiCard>
        </PortalTabPanel>
      ) : null}

      {activeTab === "external-links" ? (
        <PortalTabPanel idPrefix="portal-space-detail" tabId="external-links">
          {externalLinksUnavailableReason ? (
            <PageBanner tone={isArchived ? "warning" : "info"}>
              {externalLinksUnavailableReason}
            </PageBanner>
          ) : (
            <div className="space-y-3">
              {externalLinksError && externalLinks.length > 0 ? (
                <PageBanner tone="error">{externalLinksError}</PageBanner>
              ) : null}
              <PortalPublicLinksTable
                links={externalLinks}
                status={externalLinksTableStatus}
                busyLinkId={busyExternalLinkId}
                showCopyForInactive
                onCopy={copyExternalLink}
                onRevoke={setPendingExternalLinkRevoke}
                errorMessage={externalLinksError ?? undefined}
                emptyMessage={t({
                  en: "No external links for this space.",
                  fr: "Aucun lien externe pour cet espace.",
                  de: "Keine externen Links für diesen Bereich.",
                  zh: "此空间没有外部链接。",
                })}
              />
            </div>
          )}
        </PortalTabPanel>
      ) : null}

      {activeTab === "settings" ? (
        <PortalTabPanel idPrefix="portal-space-detail" tabId="settings">
          <PortalStorageSpaceSettings key={`${accountIdForApi}:${space.id}`}
            accountId={accountIdForApi} space={space} canConfigureIcon={canConfigureIcon}
            canCreateExternalAccess={canCreateExternalAccess}
            historyCleanupEnabled={historyCleanupEnabled} onDirtyChange={setSettingsDirty} onRefresh={refreshWorkspaceData}
            managementActions={(historyDirty) => <div className="flex flex-wrap justify-end gap-2">
              {space.canTakeOwnership && <SettingsButton variant="secondary" disabled={historyDirty || takeOwnershipBusy}
                onClick={() => setTakeOwnershipDialogOpen(true)}>{t({ en: "Take ownership", fr: "Reprendre la propriété", de: "Eigentümerschaft übernehmen", zh: "接管所有权" })}</SettingsButton>}
              <SettingsButton variant={isArchived ? "secondary" : "warning"} disabled={historyDirty || metadataBusy}
                onClick={isArchived ? handleRestore : handleArchive}>{isArchived ? t({ en: "Restore", fr: "Restaurer", de: "Wiederherstellen", zh: "恢复" }) : t({ en: "Archive", fr: "Archiver", de: "Archivieren", zh: "归档" })}</SettingsButton>
              <SettingsButton variant="danger" disabled={historyDirty || !canCleanHistory} onClick={openHistoryCleanupDialog}>
                {t({ en: "Clean up history", fr: "Nettoyer l’historique", de: "Historie bereinigen", zh: "清理历史记录" })}</SettingsButton>
              {space.canDelete && <SettingsButton variant="danger" disabled={historyDirty || metadataBusy || deleteBusy}
                onClick={() => { setDeleteError(null); setDeleteDialogOpen(true); }}>{t({ en: "Delete space", fr: "Supprimer l’espace", de: "Bereich löschen", zh: "删除空间" })}</SettingsButton>}
            </div>} />
        </PortalTabPanel>
      ) : null}

      {trashRestoreTarget ? (
        <ConfirmActionDialog
          title={t({
            en: "Restore this file?",
            fr: "Restaurer ce fichier ?",
            de: "Diese Datei wiederherstellen?",
            zh: "恢复此文件？",
          })}
          description={t({
            en: "The latest recoverable version will return to its original folder.",
            fr: "La dernière version récupérable retournera dans son dossier d'origine.",
            de: "Die neueste wiederherstellbare Version wird in ihren ursprünglichen Ordner zurückgelegt.",
            zh: "最新的可恢复版本将返回其原始文件夹。",
          })}
          confirmLabel={t({
            en: "Restore file",
            fr: "Restaurer le fichier",
            de: "Datei wiederherstellen",
            zh: "恢复文件",
          })}
          cancelLabel={t({ en: "Cancel", fr: "Annuler", de: "Abbrechen", zh: "取消" })}
          tone="primary"
          loading={restoringTrashKey === trashRestoreTarget.key}
          details={[
            {
              label: t({ en: "File", fr: "Fichier", de: "Datei", zh: "文件" }),
              value: trashRestoreTarget.name,
            },
            {
              label: t({ en: "Original location", fr: "Emplacement d'origine", de: "Ursprünglicher Ort", zh: "原始位置" }),
              value: trashRestoreTarget.key,
              mono: true,
            },
            {
              label: t({ en: "Deleted", fr: "Supprimé", de: "Gelöscht", zh: "删除时间" }),
              value: portalDateTimeLabel(trashRestoreTarget.deletedAt, locale),
            },
          ]}
          impacts={[
            t({
              en: "The file will reappear in Files at the same location.",
              fr: "Le fichier réapparaîtra dans Fichiers, au même emplacement.",
              de: "Die Datei erscheint unter Dateien wieder am selben Ort.",
              zh: "文件将重新出现在“文件”中的原位置。",
            }),
            t({
              en: "Its previous history remains available.",
              fr: "Son historique précédent reste disponible.",
              de: "Der bisherige Verlauf bleibt verfügbar.",
              zh: "其历史记录仍然可用。",
            }),
          ]}
          onCancel={() => setTrashRestoreTarget(null)}
          onConfirm={() => void confirmTrashRestore(trashRestoreTarget)}
        />
      ) : null}

      {activeTab === "files" && objectDrawerState.objectKey ? (
        <StorageSpaceObjectDetailsDrawer
          accountId={accountIdForApi}
          activeView={objectDrawerState.activeView}
          canCreatePublicLinks={canCreatePublicLinks}
          canModify={canModifyObjects}
          createPublicLinkRequestToken={objectCreateLinkRequestToken}
          isDeleted={objectDrawerState.isDeleted}
          objectKey={objectDrawerState.objectKey}
          space={space}
          onClose={() => {
            const openedFromList = Boolean(
              (location.state as { objectDrawerOpenedFromList?: boolean } | null)?.objectDrawerOpenedFromList,
            );
            if (openedFromList) {
              navigate(-1);
              return;
            }
            const params = new URLSearchParams(location.search);
            params.delete("object");
            params.delete("object_view");
            params.delete("object_deleted");
            const search = params.toString();
            navigate(
              { pathname: location.pathname, search: search ? `?${search}` : "" },
              { replace: true, state: location.state },
            );
          }}
          onCreatePublicLinkRequestHandled={() =>
            setObjectCreateLinkRequestToken(0)
          }
          onMessage={setMessage}
          onPublicLinkCreated={() => void loadAccessSummary()}
          onRefreshObjects={() => {
            setBrowserRefreshToken((current) => current + 1);
            refreshWorkspaceData();
          }}
          onViewChange={(view) => {
            const params = new URLSearchParams(location.search);
            params.set("object_view", view);
            navigate(
              { pathname: location.pathname, search: `?${params.toString()}` },
              { replace: true, state: location.state },
            );
          }}
        />
      ) : null}

      {accessPeopleDialogOpen && accountIdForApi && accessSummary?.can_manage_access && savedAccessMode === "restricted" ? (
        <PortalAddPeopleWorkflow accountId={accountIdForApi} spaceId={space.id} spaceName={space.name}
          existingRoles={existingAccessRolesByUserId} disabled={accessChanged || isArchived}
          onClose={() => setAccessPeopleDialogOpen(false)} onAdded={async (count) => {
            setAccessPeopleDialogOpen(false);
            await loadAccessSummary();
            setMessage(t({
              en: `${count} ${count === 1 ? "person" : "people"} added to ${space.name}.`,
              fr: `${count} personne${count > 1 ? "s" : ""} ajoutée${count > 1 ? "s" : ""} à ${space.name}.`,
              de: `${count} ${count === 1 ? "Person" : "Personen"} zu ${space.name} hinzugefügt.`,
              zh: `已将 ${count} 人添加到 ${space.name}。`,
            }));
          }} />
      ) : null}

      {historyCleanupConfirmOpen ? (
        <ConfirmActionDialog
          title={t({ en: "Clean up history", fr: "Nettoyer l'historique", de: "Historie bereinigen", zh: "清理历史记录" })}
          description={t({
            en: "Confirm that you want to permanently remove older file history from this space.",
            fr: "Confirmez la suppression définitive de l'ancien historique des fichiers de cet espace.",
            de: "Bestätigen Sie, dass ältere Dateihistorie aus diesem Bereich dauerhaft entfernt werden soll.",
            zh: "确认要永久移除此空间中较早的文件历史记录。",
          })}
          confirmLabel={t({ en: "Start cleanup", fr: "Démarrer le nettoyage", de: "Bereinigung starten", zh: "开始清理" })}
          cancelLabel={t({ en: "Cancel", fr: "Annuler", de: "Abbrechen", zh: "取消" })}
          details={[
            { label: t({ en: "Space", fr: "Espace", de: "Bereich", zh: "空间" }), value: space.name },
            {
              label: t({ en: "Current storage", fr: "Stockage courant", de: "Aktueller Speicher", zh: "当前存储用量" }),
              value: formatBytes(space.usedBytes),
            },
          ]}
          impacts={[
            t({
              en: "Current files stay available.",
              fr: "Les fichiers courants restent disponibles.",
              de: "Aktuelle Dateien bleiben verfügbar.",
              zh: "当前文件仍然可用。",
            }),
            t({
              en: "Older file versions and leftover deletion records are permanently removed.",
              fr: "Les anciennes versions de fichiers et les traces de suppression restantes sont supprimées définitivement.",
              de: "Ältere Dateiversionen und verbliebene Löschvermerke werden dauerhaft entfernt.",
              zh: "较早的文件版本和残留删除记录将被永久移除。",
            }),
            t({
              en: "The cleanup scans the entire space and can take some time.",
              fr: "Le nettoyage parcourt tout l'espace et peut prendre du temps.",
              de: "Die Bereinigung durchsucht den gesamten Bereich und kann einige Zeit dauern.",
              zh: "清理会扫描整个空间，可能需要一些时间。",
            }),
          ]}
          onCancel={() => setHistoryCleanupConfirmOpen(false)}
          onConfirm={confirmHistoryCleanup}
        />
      ) : null}

      {deletedPrefixRestoreTarget ? (
        <PortalDeletedPrefixRestoreWorkflow
          accountId={accountIdForApi}
          spaceId={space.id}
          spaceName={space.name}
          target={deletedPrefixRestoreTarget}
          onClose={() => setDeletedPrefixRestoreTarget(null)}
          onBrowserRefresh={() =>
            setBrowserRefreshToken((current) => current + 1)
          }
          onWorkspaceRefresh={refreshWorkspaceData}
        />
      ) : null}

      {historyCleanupDialogOpen ? (
        <PortalStorageSpaceHistoryCleanupWorkflow
          accountId={accountIdForApi}
          spaceId={space.id}
          spaceName={space.name}
          usedBytes={space.usedBytes}
          enabled={canCleanHistory}
          onClose={closeHistoryCleanupDialog}
          onStart={() => setMessage(null)}
          onRefresh={refreshWorkspaceData}
          onCompleted={(bytesFreed) => {
            setMessage(
              t({
                en: `History cleanup completed. Estimated space gained: ${formatBytes(bytesFreed)}.`,
                fr: `Nettoyage de l'historique terminé. Espace estimé gagné : ${formatBytes(bytesFreed)}.`,
                de: `Historienbereinigung abgeschlossen. Geschätzter frei gewordener Speicher: ${formatBytes(bytesFreed)}.`,
                zh: `历史记录清理完成。预计释放空间：${formatBytes(bytesFreed)}。`,
              }),
            );
          }}
        />
      ) : null}

      {pendingExternalLinkRevoke ? (
        <PortalPublicLinkRevokeDialog
          link={pendingExternalLinkRevoke}
          loading={busyExternalLinkId === pendingExternalLinkRevoke.id}
          onCancel={() => setPendingExternalLinkRevoke(null)}
          onConfirm={() =>
            void revokeExternalLink(pendingExternalLinkRevoke).finally(() =>
              setPendingExternalLinkRevoke(null),
            )
          }
        />
      ) : null}

      {pendingAccessChange ? (
        <ConfirmActionDialog
          title={t({ en: "Change collaborators", fr: "Modifier les collaborateurs", de: "Mitwirkende ändern", zh: "更改协作者" })}
          description={t({ en: "Confirm who can access this space.", fr: "Confirmez qui peut accéder à cet espace.", de: "Bestätigen Sie, wer auf diesen Bereich zugreifen kann.", zh: "确认谁可以访问此空间。" })}
          confirmLabel={t({ en: "Update access", fr: "Mettre à jour l'accès", de: "Zugriff aktualisieren", zh: "更新访问权限" })}
          tone="primary"
          loading={accessBusy}
          details={[
            { label: t({ en: "Space", fr: "Espace", de: "Bereich", zh: "空间" }), value: space.name },
            {
              label: t({ en: "New access", fr: "Nouvel accès", de: "Neuer Zugriff", zh: "新的访问权限" }),
              value: pendingAccessChange.mode === "account"
                ? portalShareScopeLabel("shared", "account", t)
                : pendingAccessChange.mode === "restricted"
                ? portalShareScopeLabel("shared", "restricted", t)
                : portalShareScopeLabel("private", "restricted", t),
            },
          ]}
          impacts={pendingAccessChange.mode === "private"
            ? [
                t({ en: "Only the owner keeps active access.", fr: "Seul le propriétaire conserve un accès actif.", de: "Nur der Eigentümer behält aktiven Zugriff.", zh: "只有所有者保留有效访问权限。" }),
                t({ en: "Existing direct collaborator grants are kept but become inactive while the space is private.", fr: "Les droits directs existants sont conservés mais deviennent inactifs tant que l'espace est privé.", de: "Bestehende direkte Berechtigungen bleiben erhalten, sind bei privatem Zugriff aber inaktiv.", zh: "现有直接协作者授权会保留，但在空间为私有时不生效。" }),
                t({ en: "Public links are suspended while the space is private.", fr: "Les liens publics sont suspendus tant que l'espace est privé.", de: "Öffentliche Links sind bei privatem Zugriff ausgesetzt.", zh: "空间为私有时，公开链接将暂停使用。" }),
              ]
            : pendingAccessChange.mode === "account"
            ? [
                t({ en: "Current and future Portal members of this account receive access automatically.", fr: "Les membres Portal actuels et futurs de ce compte recevront automatiquement l'accès.", de: "Aktuelle und zukünftige Portal-Mitglieder dieses Kontos erhalten automatisch Zugriff.", zh: "此账户当前及未来的 Portal 成员将自动获得访问权限。" }),
                t({ en: "Direct collaborator grants remain available for explicit role overrides.", fr: "Les droits directs restent disponibles pour les rôles explicites.", de: "Direkte Berechtigungen bleiben für explizite Rollen erhalten.", zh: "直接协作者授权仍可用于单独覆盖角色。" }),
                t({ en: "Public links remain managed separately.", fr: "Les liens publics restent gérés séparément.", de: "Öffentliche Links werden weiterhin separat verwaltet.", zh: "公开链接仍独立管理。" }),
              ]
            : [
                t({ en: "Only the owner and direct collaborators keep user access.", fr: "Seuls le propriétaire et les collaborateurs directs conservent un accès utilisateur.", de: "Nur der Eigentümer und direkte Mitwirkende behalten Benutzerzugriff.", zh: "只有所有者和直接协作者保留用户访问权限。" }),
                t({ en: "Account-wide automatic access stops.", fr: "L'accès automatique à tout le compte s'arrête.", de: "Der automatische accountweite Zugriff endet.", zh: "面向全账户的自动访问将停止。" }),
                t({ en: "Public links remain managed separately.", fr: "Les liens publics restent gérés séparément.", de: "Öffentliche Links werden weiterhin separat verwaltet.", zh: "公开链接仍独立管理。" }),
              ]}
          onCancel={() => setPendingAccessChange(null)}
          onConfirm={() => confirmAccessChange(pendingAccessChange)}
        />
      ) : null}

      {pendingAccessRevoke ? (
        <ConfirmActionDialog
          title={t({ en: "Revoke access", fr: "Révoquer l'accès", de: "Zugriff widerrufen", zh: "撤销访问权限" })}
          description={t({ en: "Confirm that you want to remove this direct collaborator.", fr: "Confirmez que vous voulez retirer ce collaborateur direct.", de: "Bestätigen Sie, dass Sie diesen direkten Mitwirkenden entfernen möchten.", zh: "确认要移除此直接协作者。" })}
          confirmLabel={t({ en: "Revoke access", fr: "Révoquer l'accès", de: "Zugriff widerrufen", zh: "撤销访问权限" })}
          loading={accessBusy}
          details={[
            { label: t({ en: "Person", fr: "Personne", de: "Person", zh: "人员" }), value: pendingAccessRevoke.email },
            { label: t({ en: "Space", fr: "Espace", de: "Bereich", zh: "空间" }), value: space.name },
            { label: t({ en: "Access", fr: "Accès", de: "Zugriff", zh: "访问权限" }), value: portalRoleLabel(pendingAccessRevoke.role, t) },
          ]}
          impacts={[
            t({ en: "This person loses direct access immediately.", fr: "Cette personne perd immédiatement son accès direct.", de: "Diese Person verliert sofort den direkten Zugriff.", zh: "此人将立即失去直接访问权限。" }),
            t({ en: "Files in the space are not deleted.", fr: "Les fichiers de l'espace ne sont pas supprimés.", de: "Dateien im Bereich werden nicht gelöscht.", zh: "空间中的文件不会被删除。" }),
          ]}
          onCancel={() => setPendingAccessRevoke(null)}
          onConfirm={() => confirmAccessRevoke(pendingAccessRevoke)}
        />
      ) : null}

      {pendingAccessRoleChange ? (
        <ConfirmActionDialog
          title={t({
            en: "Change access role",
            fr: "Modifier le rôle d'accès",
            de: "Zugriffsrolle ändern",
            zh: "更改访问角色",
          })}
          description={t({
            en: "Review the new role before applying it to this space.",
            fr: "Vérifiez le nouveau rôle avant de l'appliquer à cet espace.",
            de: "Prüfen Sie die neue Rolle, bevor Sie sie auf diesen Bereich anwenden.",
            zh: "请先检查新角色，再将其应用到此空间。",
          })}
          confirmLabel={t({
            en: "Update role",
            fr: "Mettre à jour le rôle",
            de: "Rolle aktualisieren",
            zh: "更新角色",
          })}
          tone="primary"
          loading={accessBusy}
          details={[
            {
              label: t({ en: "Person", fr: "Personne", de: "Person", zh: "人员" }),
              value: pendingAccessRoleChange.share.email,
            },
            {
              label: t({ en: "Space", fr: "Espace", de: "Bereich", zh: "空间" }),
              value: space.name,
            },
            {
              label: t({ en: "Current role", fr: "Rôle actuel", de: "Aktuelle Rolle", zh: "当前角色" }),
              value: portalRoleLabel(pendingAccessRoleChange.share.role, t),
            },
            {
              label: t({ en: "New role", fr: "Nouveau rôle", de: "Neue Rolle", zh: "新角色" }),
              value: portalRoleLabel(pendingAccessRoleChange.role, t),
            },
          ]}
          onCancel={() => setPendingAccessRoleChange(null)}
          onConfirm={() => confirmAccessRoleChange(pendingAccessRoleChange)}
        />
      ) : null}

      {takeOwnershipDialogOpen ? (
        <ConfirmActionDialog
          title={t({ en: "Take ownership", fr: "Reprendre la propriété", de: "Eigentümerschaft übernehmen", zh: "接管所有权" })}
          description={t({
            en: "Confirm that you want to become the owner of this private space.",
            fr: "Confirmez que vous souhaitez devenir propriétaire de cet espace privé.",
            de: "Bestätigen Sie, dass Sie Eigentümer dieses privaten Bereichs werden möchten.",
            zh: "确认要成为此私有空间的所有者。",
          })}
          confirmLabel={t({ en: "Take ownership", fr: "Reprendre la propriété", de: "Übernehmen", zh: "接管所有权" })}
          loading={takeOwnershipBusy}
          details={[
            { label: t({ en: "Space", fr: "Espace", de: "Bereich", zh: "空间" }), value: space.name },
            { label: t({ en: "Current owner", fr: "Propriétaire actuel", de: "Aktueller Eigentümer", zh: "当前所有者" }), value: space.ownerLabel ?? "-" },
          ]}
          impacts={[
            t({ en: "You receive the Owner role for this private space.", fr: "Vous recevez le rôle Propriétaire pour cet espace privé.", de: "Sie erhalten die Eigentümerrolle für diesen privaten Bereich.", zh: "你将获得此私有空间的所有者角色。" }),
            t({ en: "The previous owner loses their access to this private space.", fr: "L'ancien propriétaire perd son accès à cet espace privé.", de: "Der vorherige Eigentümer verliert den Zugriff auf diesen privaten Bereich.", zh: "原所有者将失去对此私有空间的访问权限。" }),
          ]}
          warning={t({ en: "Ownership transfer is immediate.", fr: "Le transfert de propriété est immédiat.", de: "Die Eigentumsübertragung erfolgt sofort.", zh: "所有权转移立即生效。" })}
          onCancel={() => setTakeOwnershipDialogOpen(false)}
          onConfirm={confirmTakeOwnership}
        />
      ) : null}

      {archiveDialogOpen ? (
        <ConfirmActionDialog
          title={t({ en: "Archive space", fr: "Archiver l'espace", de: "Bereich archivieren", zh: "归档空间" })}
          description={t({ en: "Confirm that you want to archive this space.", fr: "Confirmez que vous voulez archiver cet espace.", de: "Bestätigen Sie, dass Sie diesen Bereich archivieren möchten.", zh: "确认要归档此空间。" })}
          confirmLabel={t({ en: "Archive space", fr: "Archiver l'espace", de: "Bereich archivieren", zh: "归档空间" })}
          loading={metadataBusy}
          details={[
            { label: t({ en: "Space", fr: "Espace", de: "Bereich", zh: "空间" }), value: space.name },
            { label: t({ en: "Status", fr: "Statut", de: "Status", zh: "状态" }), value: t({ en: "Can be restored later", fr: "Restaurable plus tard", de: "Kann später wiederhergestellt werden", zh: "以后可以恢复" }) },
          ]}
          impacts={[
            t({ en: "The space is removed from active file work until it is restored.", fr: "L'espace est retiré des fichiers actifs jusqu'à sa restauration.", de: "Der Bereich wird bis zur Wiederherstellung aus der aktiven Dateiarbeit entfernt.", zh: "空间将暂停文件操作，直到恢复。" }),
            t({ en: "Existing files are kept and are not deleted.", fr: "Les fichiers existants sont conservés et ne sont pas supprimés.", de: "Bestehende Dateien bleiben erhalten und werden nicht gelöscht.", zh: "现有文件会保留，不会被删除。" }),
            t({ en: "Public links and file access are suspended while archived.", fr: "Les liens publics et l'accès aux fichiers sont suspendus pendant l'archivage.", de: "Öffentliche Links und Dateizugriff sind während der Archivierung ausgesetzt.", zh: "归档期间，公开链接和文件访问将暂停。" }),
          ]}
          warning={t({ en: "Archiving is reversible from this settings section.", fr: "L'archivage est réversible depuis cette section de paramètres.", de: "Die Archivierung kann in diesem Einstellungsbereich rückgängig gemacht werden.", zh: "可从此设置部分恢复已归档的空间。" })}
          onCancel={() => setArchiveDialogOpen(false)}
          onConfirm={confirmArchive}
        />
      ) : null}

      {deleteDialogOpen ? (
        <ConfirmActionDialog
          title={t({ en: "Delete space", fr: "Supprimer l'espace", de: "Bereich löschen", zh: "删除空间" })}
          description={
            deleteError
              ? deleteError
              : storageSpaceIsEmpty
              ? t({
                  en: "Confirm the permanent deletion of this space and its storage bucket.",
                  fr: "Confirmez la suppression définitive de cet espace et de son bucket de stockage.",
                  de: "Bestätigen Sie die endgültige Löschung dieses Bereichs und seines Speicher-Buckets.",
                  zh: "确认永久删除此空间及其存储桶。",
                })
              : deletionStatsKnown
              ? t({
                  en: "This space cannot be deleted yet. Delete every current file, then clean up its history before trying again.",
                  fr: "Cet espace ne peut pas encore être supprimé. Supprimez tous les fichiers courants, puis nettoyez son historique avant de réessayer.",
                  de: "Dieser Bereich kann noch nicht gelöscht werden. Löschen Sie zuerst alle aktuellen Dateien und bereinigen Sie anschließend die Historie.",
                  zh: "暂时无法删除此空间。请先删除所有当前文件，再清理历史记录，然后重试。",
                })
              : t({
                  en: "Current storage statistics are unavailable. The server will verify that the bucket is empty before deleting anything.",
                  fr: "Les statistiques de stockage sont indisponibles. Le serveur vérifiera que le bucket est vide avant toute suppression.",
                  de: "Aktuelle Speicherstatistiken sind nicht verfügbar. Der Server prüft vor dem Löschen, ob der Bucket leer ist.",
                  zh: "无法获取当前存储统计信息。服务器将在执行删除前验证存储桶是否为空。",
                })
          }
          confirmLabel={t({ en: "Delete space", fr: "Supprimer l'espace", de: "Bereich löschen", zh: "删除空间" })}
          cancelLabel={t({ en: "Cancel", fr: "Annuler", de: "Abbrechen", zh: "取消" })}
          loading={deleteBusy}
          confirmDisabled={deletionStatsKnown && !storageSpaceIsEmpty}
          details={[
            { label: t({ en: "Space", fr: "Espace", de: "Bereich", zh: "空间" }), value: space.name },
            {
              label: t({ en: "Current files", fr: "Fichiers courants", de: "Aktuelle Dateien", zh: "当前文件" }),
              value: space.objectCount == null ? "-" : formatCompactNumber(space.objectCount),
            },
            {
              label: t({ en: "Current storage", fr: "Stockage courant", de: "Aktueller Speicher", zh: "当前存储用量" }),
              value: formatBytes(space.usedBytes),
            },
          ]}
          impacts={
            storageSpaceIsEmpty
              ? [
                  t({ en: "The Storage Space and its bucket are permanently deleted.", fr: "Le Storage Space et son bucket sont supprimés définitivement.", de: "Der Storage Space und sein Bucket werden endgültig gelöscht.", zh: "存储空间及其存储桶将被永久删除。" }),
                  t({ en: "Collaborator access, external credentials, and public links are revoked.", fr: "Les accès collaborateurs, identifiants externes et liens publics sont révoqués.", de: "Zugriffe von Mitwirkenden, externe Anmeldedaten und öffentliche Links werden widerrufen.", zh: "协作者访问权限、外部凭据和公开链接将被撤销。" }),
                ]
              : [
                  isArchived
                    ? t({ en: "Restore the space before removing files and cleaning its history.", fr: "Restaurez l'espace avant de supprimer les fichiers et de nettoyer son historique.", de: "Stellen Sie den Bereich wieder her, bevor Sie Dateien und Historie löschen.", zh: "请先恢复空间，再移除文件和清理历史记录。" })
                    : t({ en: "Remove current files from the Files tab.", fr: "Supprimez les fichiers courants depuis l'onglet Fichiers.", de: "Entfernen Sie aktuelle Dateien auf der Registerkarte Dateien.", zh: "从“文件”选项卡移除当前文件。" }),
                  t({ en: "Use History cleanup to remove older versions and delete markers.", fr: "Utilisez Nettoyage de l'historique pour retirer les anciennes versions et les delete markers.", de: "Verwenden Sie die Historienbereinigung, um ältere Versionen und Löschmarkierungen zu entfernen.", zh: "使用历史记录清理功能移除旧版本和删除标记。" }),
                ]
          }
          warning={t({
            en: "Portal never empties the bucket automatically during deletion.",
            fr: "Portal ne vide jamais automatiquement le bucket pendant la suppression.",
            de: "Portal leert den Bucket beim Löschen niemals automatisch.",
            zh: "删除空间时，Portal 不会自动清空存储桶。",
          })}
          onCancel={() => {
            if (deleteBusy) return;
            setDeleteDialogOpen(false);
            setDeleteError(null);
          }}
          onConfirm={confirmDelete}
        />
      ) : null}
    </div>
  );
}
