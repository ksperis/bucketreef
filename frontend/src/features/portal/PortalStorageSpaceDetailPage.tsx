/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import ErrorState from "../../components/errors/ErrorState";
import PortalAddPeopleWorkflow from "./PortalAddPeopleWorkflow";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
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
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { workflowPageHostClass } from "../../components/WorkflowPage";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import UiBadge from "../../components/ui/UiBadge";
import UiButton, { UiButtonLink } from "../../components/ui/UiButton";
import {
  cx,
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
import { formatBytes } from "../../utils/format";
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
  portalAccessModeFromParts,
  portalAccessPayloadFromMode,
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
import PortalStorageSpaceCollaboratorsPanel from "./PortalStorageSpaceCollaboratorsPanel";
import PortalStorageSpaceAccessDialogs, {
  type PendingAccessChange,
  type PendingAccessRoleChange,
} from "./PortalStorageSpaceAccessDialogs";
import PortalStorageSpaceLifecycleDialogs from "./PortalStorageSpaceLifecycleDialogs";
import PortalStorageSpaceManagementDialogs from "./PortalStorageSpaceManagementDialogs";
import {
  portalStorageSpaceStatusTone,
  resolvePortalWorkspacePageState,
} from "./portalUi";
import {
  portalRoleLabel,
  portalStatusLabel,
} from "./portalI18n";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";
import { usePortalPublicLinkActions } from "./usePortalPublicLinkActions";

import { usePortalAccountContext } from "./PortalAccountContext";
import PortalStorageSpaceSettings from "./PortalStorageSpaceSettings";
import SettingsNavigationGuard from "../../components/settings/SettingsNavigationGuard";
import { SettingsButton } from "../../components/settings/SettingsControls";
import { settingsLabels } from "../../components/settings/settingsLabels";

const isDemo = import.meta.env.MODE === "demo";

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
  const { t } = useI18n();
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
  const [loadedObjectKeys, setLoadedObjectKeys] = useState<string[]>([]);
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
    return <ErrorState kind="not_found" presentation="embedded" />;
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

  const previewIndex = loadedObjectKeys.indexOf(objectDrawerState.objectKey ?? "");
  const navigatePreview = (index: number) => {
    const key = loadedObjectKeys[index];
    if (key === undefined) return;
    const params = new URLSearchParams(location.search);
    params.set("object", key);
    params.set("object_view", "preview");
    params.delete("object_deleted");
    navigate({ pathname: location.pathname, search: "?" + params.toString() }, { replace: true, state: location.state });
  };
  const previewNavigation = previewIndex < 0 ? undefined : {
    previous: previewIndex > 0 ? () => navigatePreview(previewIndex - 1) : undefined,
    next: previewIndex + 1 < loadedObjectKeys.length ? () => navigatePreview(previewIndex + 1) : undefined,
    position: (previewIndex + 1) + " / " + loadedObjectKeys.length,
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
            onLoadedFilesChange={setLoadedObjectKeys}
            contextIdForApi={accountIdForApi == null ? null : String(accountIdForApi)}
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
              onRestorePrefix: !isDemo && canModifyObjects
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
            <UiButtonLink
              to={`${storageSpacePath(space)}#space-files`}
              size="sm"
            >
              {t({ en: "Add files", fr: "Ajouter des fichiers", de: "Dateien hinzufügen", zh: "添加文件" })}
            </UiButtonLink>
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
              <UiButton
                size="sm"
                variant="secondary"
                onClick={() => {
                  selectSpaceDetailTab("collaborators");
                  setAccessPeopleDialogOpen(true);
                }}
              >
                {t({ en: "Invite people", fr: "Inviter", de: "Einladen", zh: "邀请人员" })}
              </UiButton>
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
            bucketUsageStatsEnabled={state?.bucket_usage_stats_enabled === true}
          />
        </PortalTabPanel>
      ) : null}

      {activeTab === "collaborators" ? (
        <PortalTabPanel idPrefix="portal-space-detail" tabId="collaborators">
          <PortalStorageSpaceCollaboratorsPanel
            summary={accessSummary}
            loading={accessSummaryLoading}
            error={accessError}
            savedAccessMode={savedAccessMode}
            isArchived={isArchived}
            accessMode={accessMode}
            accountMemberRole={accessAccountMemberRole}
            accessBusy={accessBusy}
            accessChanged={accessChanged}
            onAccessModeChange={setAccessMode}
            onAccountMemberRoleChange={setAccessAccountMemberRole}
            onSaveAccess={handleRequestSaveAccess}
            onRoleChange={handleAccessRoleChange}
            onRevoke={setPendingAccessRevoke}
            onAddPeople={() => setAccessPeopleDialogOpen(true)}
            onOpenExternalLinks={() => selectSpaceDetailTab("external-links")}
          />
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

      {activeTab === "files" && objectDrawerState.objectKey ? (
        <StorageSpaceObjectDetailsDrawer
          navigation={previewNavigation}
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

      <PortalStorageSpaceAccessDialogs
        spaceName={space.name}
        loading={accessBusy}
        pendingAccessChange={pendingAccessChange}
        pendingAccessRevoke={pendingAccessRevoke}
        pendingAccessRoleChange={pendingAccessRoleChange}
        onAccessChangeCancel={() => setPendingAccessChange(null)}
        onAccessChangeConfirm={confirmAccessChange}
        onAccessRevokeCancel={() => setPendingAccessRevoke(null)}
        onAccessRevokeConfirm={confirmAccessRevoke}
        onAccessRoleChangeCancel={() => setPendingAccessRoleChange(null)}
        onAccessRoleChangeConfirm={confirmAccessRoleChange}
      />

      <PortalStorageSpaceLifecycleDialogs
        spaceName={space.name}
        usedBytes={space.usedBytes}
        trashRestoreTarget={trashRestoreTarget}
        restoringTrashKey={restoringTrashKey}
        historyCleanupConfirmOpen={historyCleanupConfirmOpen}
        onTrashRestoreCancel={() => setTrashRestoreTarget(null)}
        onTrashRestoreConfirm={confirmTrashRestore}
        onHistoryCleanupCancel={() => setHistoryCleanupConfirmOpen(false)}
        onHistoryCleanupConfirm={confirmHistoryCleanup}
      />

      <PortalStorageSpaceManagementDialogs
        space={{
          name: space.name,
          ownerLabel: space.ownerLabel,
          objectCount: space.objectCount,
          usedBytes: space.usedBytes,
        }}
        isArchived={isArchived}
        takeOwnershipOpen={takeOwnershipDialogOpen}
        takeOwnershipBusy={takeOwnershipBusy}
        onTakeOwnershipCancel={() => setTakeOwnershipDialogOpen(false)}
        onTakeOwnershipConfirm={confirmTakeOwnership}
        archiveOpen={archiveDialogOpen}
        archiveBusy={metadataBusy}
        onArchiveCancel={() => setArchiveDialogOpen(false)}
        onArchiveConfirm={confirmArchive}
        deleteOpen={deleteDialogOpen}
        deleteBusy={deleteBusy}
        deleteError={deleteError}
        onDeleteCancel={() => {
          if (deleteBusy) return;
          setDeleteDialogOpen(false);
          setDeleteError(null);
        }}
        onDeleteConfirm={confirmDelete}
      />
    </div>
  );
}
