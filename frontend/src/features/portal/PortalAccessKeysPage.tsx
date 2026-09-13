/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ListActions, ListActionButton } from "../../components/list/ListControls";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  createPortalAccessKey,
  deletePortalAccessKey,
  fetchPortalAccessKeysState,
  updatePortalAccessKeyStatus,
  type PortalAccessKey,
  type PortalAccessKeyCreate,
  type PortalAccessKeysState,
} from "../../api/portalAccessKeys";
import {
  listPortalStorageSpaces,
  type PortalStorageSpaceSummary,
} from "../../api/portal";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import Modal from "../../components/Modal";
import WorkflowPage, { WorkflowActions, workflowPageHostClass } from "../../components/WorkflowPage";
import OneTimeSecretPanel from "../../components/OneTimeSecretPanel";
import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import DataTableShell, {
  dataTableDefaultActionProps,
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import ListPageSection from "../../components/list/ListPageSection";
import { resolveListTableStatus } from "../../components/list/listTableStatus";

import UiButton from "../../components/ui/UiButton";
import { cx, uiInputClass, uiLabelClass, uiMutedTextClass, uiPanelMutedClass, uiRadioClass, uiTitleTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { usePortalAccountContext } from "./PortalAccountContext";
import {
  buildCyberduckBookmark,
  buildGenericConnectionSheet,
  buildRcloneConfig,
  buildWinScpProfile,
  bucketNameForPortalExternalTool,
  parsePortalExternalToolEndpoint,
  portalExternalToolBaseFilename,
  portalExternalToolPermissionLabel,
  portalExternalToolRcloneRemoteName,
  portalExternalToolRcloneSecretEnvironmentVariable,
  storageSpaceNameForPortalExternalTool,
  triggerPortalExternalToolDownload,
  type PortalExternalToolConnection,
} from "./portalExternalToolAccess";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import { portalAccessKeyStatusLabel, portalDateTimeLabel } from "./portalI18n";

type PendingAccessKeyAction =
  | { type: "disable"; key: PortalAccessKey }
  | { type: "delete"; key: PortalAccessKey };

type CreateTarget = "self" | "external";
type ExternalPermission = "read_only" | "read_write";

function keyTargetLabel(key: PortalAccessKey, t: ReturnType<typeof useI18n>["t"]): string {
  if (key.target_type === "external") {
    return key.external_email || t({ en: "External user", fr: "Utilisateur externe", de: "Externer Benutzer", zh: "外部用户" });
  }
  return t({ en: "Myself", fr: "Moi-même", de: "Ich selbst", zh: "我自己" });
}

function keyScopeLabel(key: PortalAccessKey, t: ReturnType<typeof useI18n>["t"]): string {
  if (key.target_type === "external") {
    const permission = key.permission === "read_write"
      ? t({ en: "Read/write", fr: "Lecture/écriture", de: "Lesen/Schreiben", zh: "读写" })
      : t({ en: "Read only", fr: "Lecture seule", de: "Nur lesen", zh: "只读" });
    return key.storage_space_name ? `${key.storage_space_name} · ${permission}` : permission;
  }
  return t({ en: "Portal grants", fr: "Droits Portal", de: "Portal-Berechtigungen", zh: "Portal 授权" });
}

function keyPermissionLabel(key: PortalAccessKey, t: ReturnType<typeof useI18n>["t"]): string {
  if (key.permission === "read_write") {
    return t({ en: "Read/write", fr: "Lecture/écriture", de: "Lesen/Schreiben", zh: "读写" });
  }
  return t({ en: "Read only", fr: "Lecture seule", de: "Nur lesen", zh: "只读" });
}

function keyCreatedDateLabel(createdAt: string | null | undefined, locale: string): string | null {
  if (!createdAt) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" }).format(date);
}

function keyConnectionLabel(
  key: PortalAccessKey,
  locale: string,
  t: ReturnType<typeof useI18n>["t"]
): string {
  if (key.target_type === "external") {
    return [
      key.external_email || t({ en: "External user", fr: "Utilisateur externe", de: "Externer Benutzer", zh: "外部用户" }),
      key.storage_space_name,
      keyPermissionLabel(key, t),
    ].filter(Boolean).join(" · ");
  }
  const createdDate = keyCreatedDateLabel(key.created_at, locale);
  const createdLabel = createdDate
    ? t({ en: `created ${createdDate}`, fr: `créé le ${createdDate}`, de: `erstellt am ${createdDate}`, zh: `创建于 ${createdDate}` })
    : null;
  const suffix = key.access_key_id.length > 4 ? `…${key.access_key_id.slice(-4)}` : key.access_key_id;
  return [keyTargetLabel(key, t), createdLabel, suffix].filter(Boolean).join(" · ");
}

function isOwnerStorageSpace(space: PortalStorageSpaceSummary): boolean {
  return (space.role === "Owner" || space.role === "Manager") && !space.archived_at;
}

export default function PortalAccessKeysPage() {
  const { locale, t } = useI18n();
  const [searchParams] = useSearchParams();
  const { accountIdForApi, hasAccountContext, loading: accountLoading, error: accountError } = usePortalAccountContext();
  const [state, setState] = useState<PortalAccessKeysState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<PortalAccessKey | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAccessKeyAction | null>(null);
  const [createWizardOpen, setCreateWizardOpen] = useState(false);
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const [createTarget, setCreateTarget] = useState<CreateTarget>("self");
  const [externalEmail, setExternalEmail] = useState("");
  const [externalPermission, setExternalPermission] = useState<ExternalPermission>("read_only");
  const [selectedSpaceId, setSelectedSpaceId] = useState("");
  const [storageSpaces, setStorageSpaces] = useState<PortalStorageSpaceSummary[]>([]);
  const [storageSpacesLoading, setStorageSpacesLoading] = useState(false);
  const [storageSpacesError, setStorageSpacesError] = useState<string | null>(null);
  const [connectionSpaces, setConnectionSpaces] = useState<PortalStorageSpaceSummary[]>([]);
  const [connectionSpacesLoading, setConnectionSpacesLoading] = useState(false);
  const [connectionSpacesError, setConnectionSpacesError] = useState<string | null>(null);
  const [connectionKeyId, setConnectionKeyId] = useState("");
  const [connectionSpaceId, setConnectionSpaceId] = useState("");
  const [connectionCopyMessage, setConnectionCopyMessage] = useState<string | null>(null);
  const [queryCreateHandled, setQueryCreateHandled] = useState(false);

  const requestedSpaceId = searchParams.get("space_id") ?? "";
  const requestedCreateTarget = searchParams.get("create") ?? "";

  const loadKeys = useCallback(async () => {
    if (!hasAccountContext || !accountIdForApi) {
      setState(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPortalAccessKeysState(accountIdForApi);
      setState(data);
    } catch (err) {
      console.error(err);
      setState(null);
      setError(extractApiError(err, t({ en: "Unable to load tool access.", fr: "Impossible de charger les accès outil.", de: "Werkzeugzugriff kann nicht geladen werden.", zh: "无法加载工具访问凭据。" })));
    } finally {
      setLoading(false);
    }
  }, [accountIdForApi, hasAccountContext, t]);

  useEffect(() => {
    setCreatedKey(null);
    setActionMessage(null);
    void loadKeys();
  }, [loadKeys]);

  const loadStorageSpacesForWizard = useCallback(async () => {
    if (!accountIdForApi) return;
    setStorageSpacesLoading(true);
    setStorageSpacesError(null);
    try {
      const spaces = await listPortalStorageSpaces(accountIdForApi, { sort: "name" });
      const ownerSpaces = spaces.filter(isOwnerStorageSpace);
      setStorageSpaces(ownerSpaces);
      setSelectedSpaceId((current) => {
        if (current && ownerSpaces.some((space) => space.id === current)) {
          return current;
        }
        const requested = ownerSpaces.find(
          (space) => space.id === requestedSpaceId || space.internal_bucket_name === requestedSpaceId
        );
        if (requested) return requested.id;
        return ownerSpaces[0]?.id || "";
      });
    } catch (err) {
      console.error(err);
      setStorageSpaces([]);
      setSelectedSpaceId("");
      setStorageSpacesError(extractApiError(err, t({ en: "Unable to load spaces.", fr: "Impossible de charger les espaces.", de: "Bereiche können nicht geladen werden.", zh: "无法加载空间。" })));
    } finally {
      setStorageSpacesLoading(false);
    }
  }, [accountIdForApi, requestedSpaceId, t]);

  useEffect(() => {
    if (!createWizardOpen || createTarget !== "external") return;
    void loadStorageSpacesForWizard();
  }, [createTarget, createWizardOpen, loadStorageSpacesForWizard]);

  const loadConnectionSpaces = useCallback(async () => {
    if (!accountIdForApi) return;
    setConnectionSpacesLoading(true);
    setConnectionSpacesError(null);
    try {
      const spaces = await listPortalStorageSpaces(accountIdForApi, { sort: "name" });
      const activeSpaces = spaces.filter((space) => !space.archived_at);
      setConnectionSpaces(activeSpaces);
      setConnectionSpaceId((current) => {
        if (current && activeSpaces.some((space) => space.id === current || space.internal_bucket_name === current)) {
          return current;
        }
        const requested = activeSpaces.find(
          (space) => space.id === requestedSpaceId || space.internal_bucket_name === requestedSpaceId
        );
        return requested?.id || activeSpaces[0]?.id || "";
      });
    } catch (err) {
      console.error(err);
      setConnectionSpaces([]);
      setConnectionSpaceId("");
      setConnectionSpacesError(extractApiError(err, t({ en: "Unable to load spaces.", fr: "Impossible de charger les espaces.", de: "Bereiche können nicht geladen werden.", zh: "无法加载空间。" })));
    } finally {
      setConnectionSpacesLoading(false);
    }
  }, [accountIdForApi, requestedSpaceId, t]);

  useEffect(() => {
    if (!state || !hasAccountContext || !accountIdForApi) return;
    void loadConnectionSpaces();
  }, [accountIdForApi, hasAccountContext, loadConnectionSpaces, state]);

  const visibleKeys = useMemo(() => {
    const keys = (state?.access_keys ?? []).filter((key) => !key.is_portal);
    if (createdKey && !createdKey.is_portal && !keys.some((key) => key.access_key_id === createdKey.access_key_id)) {
      return [createdKey, ...keys];
    }
    return keys;
  }, [createdKey, state?.access_keys]);
  const activeKeys = useMemo(() => visibleKeys.filter((key) => key.is_active), [visibleKeys]);
  const personalKeys = useMemo(
    () => visibleKeys.filter((key) => key.target_type !== "external"),
    [visibleKeys]
  );
  const canManageAccessKeys = Boolean(state?.can_manage_access_keys);
  const maxAccessKeys = state?.max_access_keys ?? 0;
  const personalAccessLimitReached = maxAccessKeys > 0 && personalKeys.length >= maxAccessKeys;
  const tableStatus = resolveListTableStatus({ loading, error, rowCount: visibleKeys.length });
  const selectedSpace = useMemo(
    () => storageSpaces.find((space) => space.id === selectedSpaceId) ?? null,
    [selectedSpaceId, storageSpaces]
  );
  const selectedConnectionKey = useMemo(
    () => activeKeys.find((key) => key.access_key_id === connectionKeyId) ?? activeKeys[0] ?? null,
    [activeKeys, connectionKeyId]
  );
  const selectedConnectionKeyBucket = selectedConnectionKey?.target_type === "external"
    ? bucketNameForPortalExternalTool(selectedConnectionKey, null)
    : "";
  const selectedConnectionSpace = useMemo(() => {
    const matchValue = selectedConnectionKeyBucket || connectionSpaceId;
    return (
      connectionSpaces.find((space) => space.id === matchValue || space.internal_bucket_name === matchValue) ??
      connectionSpaces[0] ??
      null
    );
  }, [connectionSpaceId, connectionSpaces, selectedConnectionKeyBucket]);
  const selectedConnectionBucketName = bucketNameForPortalExternalTool(selectedConnectionKey, selectedConnectionSpace);
  const selectedConnection: PortalExternalToolConnection | null = selectedConnectionKey && selectedConnectionBucketName
    ? {
        key: selectedConnectionKey,
        endpoint: parsePortalExternalToolEndpoint(state?.s3_endpoint),
        forcePathStyle: Boolean(state?.force_path_style),
        storageSpaceName: storageSpaceNameForPortalExternalTool(selectedConnectionKey, selectedConnectionSpace),
        bucketName: selectedConnectionBucketName,
        permissionLabel: portalExternalToolPermissionLabel(selectedConnectionKey.permission),
      }
    : null;
  const connectionEndpointLabel = selectedConnection?.endpoint?.original || state?.s3_endpoint || t({ en: "Configured storage service", fr: "Service de stockage configuré", de: "Konfigurierter Speicherdienst", zh: "已配置的存储服务" });
  const setupFileUnavailable = Boolean(selectedConnection && !selectedConnection.endpoint);
  const selectedConnectionNeedsSpace = Boolean(selectedConnectionKey && !selectedConnectionKeyBucket);
  const selectedConnectionHasNoSpace =
    selectedConnectionNeedsSpace &&
    !connectionSpacesLoading &&
    !connectionSpacesError &&
    connectionSpaces.length === 0;
  const rcloneRemoteName = selectedConnection ? portalExternalToolRcloneRemoteName(selectedConnection) : "remote";
  const rcloneSecretEnvironmentVariable = selectedConnection
    ? portalExternalToolRcloneSecretEnvironmentVariable(selectedConnection)
    : "RCLONE_CONFIG_REMOTE_SECRET_ACCESS_KEY";

  useEffect(() => {
    if (!selectedConnectionKey && activeKeys[0]) {
      setConnectionKeyId(activeKeys[0].access_key_id);
    }
  }, [activeKeys, selectedConnectionKey]);

  useEffect(() => {
    if (!selectedConnectionKeyBucket) {
      setConnectionSpaceId((current) => {
        if (connectionSpaces.some((space) => space.id === current || space.internal_bucket_name === current)) {
          return current;
        }
        return connectionSpaces[0]?.id || "";
      });
      return;
    }
    const matchingSpace = connectionSpaces.find(
      (space) => space.id === selectedConnectionKeyBucket || space.internal_bucket_name === selectedConnectionKeyBucket
    );
    setConnectionSpaceId(matchingSpace?.id || selectedConnectionKeyBucket);
  }, [connectionSpaces, selectedConnectionKeyBucket]);

  useEffect(() => {
    if (
      queryCreateHandled ||
      requestedCreateTarget !== "external" ||
      !state ||
      !canManageAccessKeys ||
      !requestedSpaceId
    ) {
      return;
    }
    setCreateTarget("external");
    setSelectedSpaceId(requestedSpaceId);
    setStorageSpacesError(null);
    setCreateWizardOpen(true);
    setQueryCreateHandled(true);
  }, [canManageAccessKeys, queryCreateHandled, requestedCreateTarget, requestedSpaceId, state]);

  const openCreateWizard = () => {
    if (createDisabled) return;
    setCreateTarget(personalAccessLimitReached ? "external" : "self");
    setExternalEmail("");
    setExternalPermission("read_only");
    setSelectedSpaceId(storageSpaces[0]?.id || "");
    setStorageSpacesError(null);
    setCreateWizardOpen(true);
  };

  const closeCreateWizard = () => {
    if (busy === "create") return;
    setCreateWizardOpen(false);
  };

  const handleCreateKey = async () => {
    if (!accountIdForApi || !canManageAccessKeys) return;
    if (createTarget === "self" && personalAccessLimitReached) return;
    const payload: PortalAccessKeyCreate =
      createTarget === "external"
        ? {
            target_type: "external",
            storage_space_id: selectedSpaceId,
            external_email: externalEmail.trim(),
            permission: externalPermission,
          }
        : { target_type: "self" };
    if (payload.target_type === "external" && (!payload.storage_space_id || !payload.external_email)) return;
    setBusy("create");
    setError(null);
    setActionMessage(null);
    try {
      const key = await createPortalAccessKey(accountIdForApi, payload);
      setCreatedKey(key);
      setConnectionKeyId(key.access_key_id);
      const createdBucket = bucketNameForPortalExternalTool(key, selectedSpace);
      if (createdBucket) {
        setConnectionSpaceId(createdBucket);
      }
      setActionMessage(
        key.secret_access_key ? null : key.target_type === "external"
          ? t({ en: "External tool access created", fr: "Accès outil externe créé", de: "Externer Werkzeugzugriff erstellt", zh: "已创建外部工具访问凭据" })
          : t({ en: "Personal tool access created", fr: "Accès outil personnel créé", de: "Persönlicher Werkzeugzugriff erstellt", zh: "已创建个人工具访问凭据" })
      );
      setCreateWizardOpen(false);
      await loadKeys();
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, t({ en: "Unable to create tool access.", fr: "Impossible de créer l'accès outil.", de: "Werkzeugzugriff kann nicht erstellt werden.", zh: "无法创建工具访问凭据。" })));
    } finally {
      setBusy(null);
    }
  };

  const updateKeyStatus = async (key: PortalAccessKey, active: boolean) => {
    if (!accountIdForApi || !canManageAccessKeys || key.is_portal) return;
    setBusy(`toggle:${key.access_key_id}`);
    setError(null);
    setActionMessage(null);
    try {
      await updatePortalAccessKeyStatus(accountIdForApi, key.access_key_id, active);
      setActionMessage(active ? t({ en: "Tool access enabled", fr: "Accès outil activé", de: "Werkzeugzugriff aktiviert", zh: "已启用工具访问" }) : t({ en: "Tool access disabled", fr: "Accès outil désactivé", de: "Werkzeugzugriff deaktiviert", zh: "已禁用工具访问" }));
      setPendingAction(null);
      await loadKeys();
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, t({ en: "Unable to update tool access.", fr: "Impossible de mettre à jour l'accès outil.", de: "Werkzeugzugriff kann nicht aktualisiert werden.", zh: "无法更新工具访问凭据。" })));
      setPendingAction(null);
    } finally {
      setBusy(null);
    }
  };

  const handleToggleKey = (key: PortalAccessKey) => {
    if (!accountIdForApi || !canManageAccessKeys || key.is_portal) return;
    const active = key.is_active;
    if (active) {
      setPendingAction({ type: "disable", key });
      return;
    }
    void updateKeyStatus(key, true);
  };

  const handleDeleteKey = (key: PortalAccessKey) => {
    if (!accountIdForApi || !canManageAccessKeys || key.is_portal) return;
    setPendingAction({ type: "delete", key });
  };

  const confirmDeleteKey = async (key: PortalAccessKey) => {
    if (!accountIdForApi || !canManageAccessKeys || key.is_portal) return;
    setBusy(`delete:${key.access_key_id}`);
    setError(null);
    setActionMessage(null);
    try {
      await deletePortalAccessKey(accountIdForApi, key.access_key_id);
      setActionMessage(t({ en: "Tool access deleted", fr: "Accès outil supprimé", de: "Werkzeugzugriff gelöscht", zh: "已删除工具访问凭据" }));
      setPendingAction(null);
      await loadKeys();
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, t({ en: "Unable to delete tool access.", fr: "Impossible de supprimer l'accès outil.", de: "Werkzeugzugriff kann nicht gelöscht werden.", zh: "无法删除工具访问凭据。" })));
      setPendingAction(null);
    } finally {
      setBusy(null);
    }
  };

  const handleDownloadCyberduckBookmark = () => {
    if (!selectedConnection) return;
    if (!selectedConnection.endpoint) {
      setActionMessage(null);
      setError(t({ en: "Cyberduck bookmark download needs a valid service address.", fr: "Le téléchargement du favori Cyberduck nécessite une adresse de service valide.", de: "Der Cyberduck-Bookmark benötigt eine gültige Serviceadresse.", zh: "下载 Cyberduck 书签需要有效的服务地址。" }));
      return;
    }
    const filename = `${portalExternalToolBaseFilename(selectedConnection)}.duck`;
    triggerPortalExternalToolDownload(filename, buildCyberduckBookmark(selectedConnection), "application/xml;charset=utf-8");
    setError(null);
    setActionMessage(t({ en: "Cyberduck bookmark downloaded.", fr: "Favori Cyberduck téléchargé.", de: "Cyberduck-Bookmark heruntergeladen.", zh: "已下载 Cyberduck 书签。" }));
  };

  const handleDownloadWinScpProfile = () => {
    if (!selectedConnection?.endpoint) return;
    const filename = `${portalExternalToolBaseFilename(selectedConnection)}-winscp.ini`;
    triggerPortalExternalToolDownload(filename, buildWinScpProfile(selectedConnection), "text/plain;charset=utf-8");
    setError(null);
    setActionMessage(t({ en: "WinSCP profile downloaded.", fr: "Profil WinSCP téléchargé.", de: "WinSCP-Profil heruntergeladen.", zh: "已下载 WinSCP 配置。" }));
  };

  const handleDownloadRcloneConfig = () => {
    if (!selectedConnection?.endpoint) return;
    const filename = `${portalExternalToolBaseFilename(selectedConnection)}-rclone.conf`;
    triggerPortalExternalToolDownload(filename, buildRcloneConfig(selectedConnection), "text/plain;charset=utf-8");
    setError(null);
    setActionMessage(t({ en: "rclone configuration downloaded.", fr: "Configuration rclone téléchargée.", de: "rclone-Konfiguration heruntergeladen.", zh: "已下载 rclone 配置。" }));
  };

  const handleDownloadConnectionSheet = () => {
    if (!selectedConnection) return;
    const filename = `${portalExternalToolBaseFilename(selectedConnection)}.txt`;
    triggerPortalExternalToolDownload(
      filename,
      buildGenericConnectionSheet(selectedConnection),
      "text/plain;charset=utf-8"
    );
    setError(null);
    setActionMessage(t({ en: "Connection details downloaded.", fr: "Détails de connexion téléchargés.", de: "Verbindungsdetails heruntergeladen.", zh: "已下载连接信息。" }));
  };

  const closeConnectionDialog = () => {
    setConnectionCopyMessage(null);
    setConnectionDialogOpen(false);
  };

  const openConnectionDialog = (key?: PortalAccessKey) => {
    if (key) setConnectionKeyId(key.access_key_id);
    setConnectionCopyMessage(null);
    setConnectionDialogOpen(true);
  };

  const handleCopyConnectionValue = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setConnectionCopyMessage(t({ en: "Value copied.", fr: "Valeur copiée.", de: "Wert kopiert.", zh: "已复制。" }));
    } catch {
      setConnectionCopyMessage(t({ en: "Unable to copy this value.", fr: "Impossible de copier cette valeur.", de: "Dieser Wert kann nicht kopiert werden.", zh: "无法复制此值。" }));
    }
  };

  const configureDisabled = accountLoading || loading || !hasAccountContext || !accountIdForApi || !state || Boolean(busy);
  const createDisabled = !state || !canManageAccessKeys || Boolean(busy);
  const createWizardSubmitDisabled =
    busy === "create" ||
    !accountIdForApi ||
    (createTarget === "self" && personalAccessLimitReached) ||
    (createTarget === "external" &&
      (!selectedSpaceId || !externalEmail.trim() || storageSpacesLoading || Boolean(storageSpacesError)));
  const accessKeyColumns: DataTableColumn<PortalAccessKey>[] = [
    {
      id: "access-key",
      label: t({ en: "Access ID", fr: "ID d'accès", de: "Zugriffs-ID", zh: "访问密钥 ID" }),
      primary: true,
      cellClassName: "max-w-[18rem] break-all font-mono",
      render: (key) => key.access_key_id,
    },
    {
      id: "status",
      label: t({ en: "Status", fr: "Statut", de: "Status", zh: "状态" }),
      cellClassName: "text-slate-700 dark:text-slate-200",
      render: (key) => portalAccessKeyStatusLabel(key.is_active, t),
    },
    {
      id: "target",
      label: t({ en: "Recipient", fr: "Destinataire", de: "Empfänger", zh: "接收人" }),
      cellClassName: "min-w-[10rem]",
      render: (key) => keyTargetLabel(key, t),
    },
    {
      id: "scope",
      label: t({ en: "Scope", fr: "Périmètre", de: "Umfang", zh: "范围" }),
      cellClassName: "min-w-[12rem]",
      render: (key) => keyScopeLabel(key, t),
    },
    {
      id: "created",
      label: t({ en: "Created on", fr: "Créée le", de: "Erstellt am", zh: "创建时间" }),
      render: (key) => portalDateTimeLabel(key.created_at, locale),
    },
    {
      id: "actions",
      label: t({ en: "Actions", fr: "Actions", de: "Aktionen", zh: "操作" }),
      align: "right",
      mobileRole: "actions",
      render: (key) => {
        const active = key.is_active;
        const disabled = Boolean(busy) || !canManageAccessKeys;
        return (
          <ListActions>
            {active ? (
              <ListActionButton
                type="button"
                onClick={() => openConnectionDialog(key)}
                disabled={Boolean(busy)}
                aria-label={`${t({ en: "Connect", fr: "Connecter", de: "Verbinden", zh: "连接" })} ${keyConnectionLabel(key, locale, t)}`}
                {...dataTableDefaultActionProps}
              >
                {t({ en: "Connect", fr: "Connecter", de: "Verbinden", zh: "连接" })}
              </ListActionButton>
            ) : null}
            <ListActionButton
              type="button"
              onClick={() => handleToggleKey(key)}
              disabled={disabled}
            >
              {busy === `toggle:${key.access_key_id}`
                ? t({ en: "Saving...", fr: "Enregistrement...", de: "Wird gespeichert...", zh: "正在保存…" })
                : active
                  ? t({ en: "Disable", fr: "Désactiver", de: "Deaktivieren", zh: "禁用" })
                  : t({ en: "Enable", fr: "Activer", de: "Aktivieren", zh: "启用" })}
            </ListActionButton>
            <ListActionButton
              type="button"
              onClick={() => handleDeleteKey(key)}
               variant="danger"
              disabled={disabled}
            >
              {busy === `delete:${key.access_key_id}` ? t({ en: "Deleting...", fr: "Suppression...", de: "Wird gelöscht...", zh: "正在删除…" }) : t({ en: "Delete", fr: "Supprimer", de: "Löschen", zh: "删除" })}
            </ListActionButton>
          </ListActions>
        );
      },
    },
  ];

  return (
    <div className={workflowPageHostClass(createWizardOpen)}>
      <PageHeader actionPresentation="listing"
        title={t({ en: "External S3 tools", fr: "Outils S3 externes", de: "Externe S3-Werkzeuge", zh: "外部 S3 工具" })}
        description={t({
          en: "Create S3 credentials for a desktop app, script, or external partner. Keep each access limited to the right space.",
          fr: "Créez des identifiants S3 pour une application de bureau, un script ou un partenaire externe. Limitez chaque accès au bon espace.",
          de: "Erstellen Sie S3-Zugangsdaten für Desktop-Apps, Skripte oder externe Partner. Begrenzen Sie jeden Zugriff auf den passenden Bereich.",
          zh: "为桌面应用、脚本或外部合作伙伴创建 S3 凭据。请将每项访问限制在合适的空间内。",
        })}
        breadcrumbs={portalBreadcrumbs({
          label: t({ en: "External tools", fr: "Outils externes", de: "Externe Werkzeuge", zh: "外部工具" }),
        })}
        actions={[
          {
            label: t({ en: "Configure a tool", fr: "Configurer un outil", de: "Werkzeug konfigurieren", zh: "配置工具" }),
            onClick: () => openConnectionDialog(),
            variant: "secondary",
            disabled: configureDisabled,
          },
          {
            label: busy === "create" ? t({ en: "Creating...", fr: "Création...", de: "Wird erstellt...", zh: "正在创建…" }) : t({ en: "New tool access", fr: "Nouvel accès outil", de: "Neuer Werkzeugzugriff", zh: "新建工具访问凭据" }),
            onClick: openCreateWizard,
            variant: "primary",
            disabled: createDisabled,
          },
        ]}
      />

      {accountError && <PageBanner tone="error">{accountError}</PageBanner>}
      {error && <PageBanner tone="error">{error}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {state && !canManageAccessKeys && (
        <PageBanner tone="warning">{t({ en: "External-tool access is disabled for this project.", fr: "L'accès aux outils externes est désactivé pour ce projet.", de: "Der Zugriff für externe Werkzeuge ist für dieses Projekt deaktiviert.", zh: "此项目已禁用外部工具访问。" })}</PageBanner>
      )}
      {createdKey?.secret_access_key && (
        <div className="space-y-3">
          <OneTimeSecretPanel
            title={
              <span role="status">{createdKey.target_type === "external"
                ? t({ en: "External tool access created", fr: "Accès outil externe créé", de: "Externer Werkzeugzugriff erstellt", zh: "已创建外部工具访问凭据" })
                : t({ en: "Personal tool access created", fr: "Accès outil personnel créé", de: "Persönlicher Werkzeugzugriff erstellt", zh: "已创建个人工具访问凭据" })}</span>
            }
            description={
              <>{createdKey.target_type === "external"
                ? t({ en: "The secret is shown only once and is limited to the selected space.", fr: "Le secret n'est affiché qu'une seule fois et reste limité à l'espace sélectionné.", de: "Das Secret wird nur einmal angezeigt und bleibt auf den ausgewählten Bereich beschränkt.", zh: "密钥仅显示一次，访问范围限定为所选空间。" })
                : t({ en: "The secret is shown only once.", fr: "Le secret n'est affiché qu'une seule fois.", de: "Das Secret wird nur einmal angezeigt.", zh: "密钥仅显示一次。" })}{" "}{t({
                  en: "Copy the secret key, then choose Configure a tool.",
                  fr: "Copiez la clé secrète, puis choisissez « Configurer un outil ».",
                  de: "Kopieren Sie den geheimen Schlüssel und wählen Sie dann „Werkzeug konfigurieren“.",
                  zh: "复制私有密钥，然后选择“配置工具”。",
                })}</>
            }
            badge={t({ en: "Copy these values now", fr: "Copiez ces valeurs maintenant", de: "Diese Werte jetzt kopieren", zh: "请立即复制这些值" })}
            copyFeedback={{
              copied: t({ en: "Copied to clipboard.", fr: "Copié dans le presse-papiers.", de: "In die Zwischenablage kopiert.", zh: "已复制到剪贴板。" }),
              failed: t({ en: "Unable to copy. Select and copy this value manually.", fr: "Copie impossible. Sélectionnez et copiez cette valeur manuellement.", de: "Kopieren nicht möglich. Wählen Sie diesen Wert aus und kopieren Sie ihn manuell.", zh: "无法复制。请选中此值并手动复制。" }),
            }}
            values={[
              {
                label: t({ en: "Access ID", fr: "ID d'accès", de: "Zugriffs-ID", zh: "访问密钥 ID" }),
                value: createdKey.access_key_id,
                copyLabel: t({ en: "Copy Access ID", fr: "Copier l'ID d'accès", de: "Zugriffs-ID kopieren", zh: "复制访问密钥 ID" }),
              },
              {
                label: t({ en: "Secret key", fr: "Clé secrète", de: "Geheimer Schlüssel", zh: "私有密钥" }),
                value: createdKey.secret_access_key,
                copyLabel: t({ en: "Copy secret key", fr: "Copier la clé secrète", de: "Geheimen Schlüssel kopieren", zh: "复制私有密钥" }),
              },
            ]}
          />
        </div>
      )}

      {accountLoading ? (
        <PageBanner tone="info">{t({ en: "Loading project...", fr: "Chargement du projet...", de: "Projekt wird geladen...", zh: "正在加载项目…" })}</PageBanner>
      ) : !hasAccountContext ? (
        <PageEmptyState
          title={t({ en: "Select a project before connecting external tools", fr: "Sélectionnez un projet avant de connecter des outils externes", de: "Wählen Sie ein Projekt aus, bevor Sie externe Werkzeuge verbinden", zh: "请先选择项目，再连接外部工具" })}
          description={t({ en: "External-tool access is scoped to the selected project.", fr: "L'accès aux outils externes est limité au projet sélectionné.", de: "Werkzeugzugriff ist auf das ausgewählte Projekt beschränkt.", zh: "外部工具的访问范围限定为所选项目。" })}
          tone="warning"
        />
      ) : (
        <ListPageSection variant="page"
          title={t({ en: "Tool access", fr: "Accès outil", de: "Werkzeugzugriff", zh: "工具访问" })}
          secondaryContent={<p>{t({
            en: "Store secrets when they are created; they cannot be shown again. Portal's own runtime access is hidden from this list.",
            fr: "Enregistrez les secrets à la création; ils ne pourront plus être affichés. L'accès runtime propre à Portal est masqué dans cette liste.",
            de: "Speichern Sie Secrets beim Erstellen; sie können nicht erneut angezeigt werden. Portals eigener Laufzeitzugriff ist in dieser Liste ausgeblendet.",
            zh: "请在创建时保存私有密钥，之后无法再次查看。Portal 自身运行时使用的访问凭据不会显示在此列表中。",
          })}</p>}
          countLabel={t({ en: `${visibleKeys.length} access`, fr: `${visibleKeys.length} accès`, de: `${visibleKeys.length} Zugriffe`, zh: `${visibleKeys.length} 项访问凭据` })}
        >
          <DataTableShell
            columns={accessKeyColumns}
            rows={visibleKeys}
            rowKey={(key) => key.access_key_id}
            status={tableStatus}
            loadingMessage={t({ en: "Loading tool access...", fr: "Chargement des accès outil...", de: "Werkzeugzugriff wird geladen...", zh: "正在加载工具访问凭据…" })}
            errorMessage={t({ en: "Unable to load tool access.", fr: "Impossible de charger les accès outil.", de: "Werkzeugzugriff kann nicht geladen werden.", zh: "无法加载工具访问凭据。" })}
            emptyMessage={t({ en: "No external tool access yet.", fr: "Aucun accès outil externe pour l'instant.", de: "Noch kein externer Werkzeugzugriff.", zh: "尚无外部工具访问凭据。" })}
            rowClassName={(key) =>
              cx(
                "hover:bg-slate-50 dark:hover:bg-slate-800/40",
                !key.is_active && "bg-slate-50/70 dark:bg-slate-900/40"
              )
            }
            responsiveCards
          />
        </ListPageSection>
      )}

      {connectionDialogOpen && state && hasAccountContext ? (
        <Modal
          title={t({ en: "Connect a tool", fr: "Connecter un outil", de: "Werkzeug verbinden", zh: "连接工具" })}
          titleAs="h2"
          onClose={closeConnectionDialog}
          maxWidthClass="max-w-4xl"
          closeLabel={t({ en: "Close", fr: "Fermer", de: "Schließen", zh: "关闭" })}
          closeAriaLabel={t({ en: "Close modal", fr: "Fermer la fenêtre", de: "Dialog schließen", zh: "关闭对话框" })}
        >
          <div className="space-y-5">
            {activeKeys.length === 0 ? (
              <PageEmptyState
                eyebrow={t({ en: "Access required", fr: "Accès requis", de: "Zugriff erforderlich", zh: "需要访问凭据" })}
                title={t({ en: "Create an active tool access first", fr: "Créez d'abord un accès outil actif", de: "Erstellen Sie zuerst einen aktiven Werkzeugzugriff", zh: "请先创建已启用的工具访问凭据" })}
                description={t({
                  en: "The configuration identifies which permissions the application will use.",
                  fr: "La configuration doit indiquer quels droits l'application utilisera.",
                  de: "Die Konfiguration muss festlegen, welche Berechtigungen die Anwendung verwendet.",
                  zh: "此配置决定应用使用的权限。",
                })}
                primaryAction={canManageAccessKeys ? {
                  label: t({ en: "Create tool access", fr: "Créer un accès outil", de: "Werkzeugzugriff erstellen", zh: "创建工具访问凭据" }),
                  onClick: () => {
                    closeConnectionDialog();
                    openCreateWizard();
                  },
                } : undefined}
              />
            ) : (
              <>
                <section className="space-y-3" aria-labelledby="portal-tool-connection-section">
                  <h3 id="portal-tool-connection-section" className={cx("ui-body font-semibold", uiTitleTextClass)}>
                    {t({ en: "Connection", fr: "Connexion", de: "Verbindung", zh: "连接" })}
                  </h3>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1">
                      <span className={uiLabelClass}>{t({ en: "Access used", fr: "Accès utilisé", de: "Verwendeter Zugriff", zh: "使用的访问凭据" })}</span>
                      <select
                        className={uiInputClass}
                        value={selectedConnectionKey?.access_key_id ?? ""}
                        onChange={(event) => setConnectionKeyId(event.target.value)}
                      >
                        {activeKeys.map((key) => (
                          <option key={key.access_key_id} value={key.access_key_id}>
                            {keyConnectionLabel(key, locale, t)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selectedConnectionKeyBucket ? (
                      <div className="space-y-1">
                        <span className={uiLabelClass}>{t({ en: "Space", fr: "Space", de: "Space", zh: "空间" })}</span>
                        <p className={cx("min-h-10 rounded-lg border px-3 py-2 ui-body", uiPanelMutedClass, uiTitleTextClass)}>
                          {selectedConnectionKey?.storage_space_name || selectedConnection?.storageSpaceName || selectedConnectionKeyBucket}
                          {" — "}
                          {t({
                            en: "fixed when this access was created",
                            fr: "défini lors de la création de cet accès",
                            de: "bei der Erstellung dieses Zugriffs festgelegt",
                            zh: "创建此访问凭据时已确定",
                          })}
                        </p>
                      </div>
                    ) : (
                      <label className="space-y-1">
                        <span className={uiLabelClass}>{t({ en: "Space", fr: "Space", de: "Space", zh: "空间" })}</span>
                        <select
                          className={uiInputClass}
                          value={connectionSpaceId}
                          onChange={(event) => setConnectionSpaceId(event.target.value)}
                          disabled={connectionSpacesLoading || connectionSpaces.length === 0}
                        >
                          {connectionSpacesLoading ? (
                            <option value="">{t({ en: "Loading...", fr: "Chargement...", de: "Wird geladen...", zh: "正在加载…" })}</option>
                          ) : connectionSpaces.length === 0 ? (
                            <option value="">{t({ en: "No Space", fr: "Aucun Space", de: "Kein Space", zh: "没有空间" })}</option>
                          ) : (
                            connectionSpaces.map((space) => (
                              <option key={space.id} value={space.id}>{space.name}</option>
                            ))
                          )}
                        </select>
                      </label>
                    )}
                  </div>
                </section>

                {selectedConnectionNeedsSpace && connectionSpacesError ? (
                  <PageBanner tone="warning">{connectionSpacesError}</PageBanner>
                ) : null}
                {selectedConnectionHasNoSpace ? (
                  <PageEmptyState
                    eyebrow={t({ en: "Space required", fr: "Space requis", de: "Space erforderlich", zh: "需要空间" })}
                    title={t({ en: "Create a Space to continue", fr: "Créez un Space pour continuer", de: "Erstellen Sie einen Space, um fortzufahren", zh: "创建空间以继续" })}
                    description={t({
                      en: "The application needs a Space to use as its initial folder.",
                      fr: "L'application a besoin d'un Space comme dossier initial.",
                      de: "Die Anwendung benötigt einen Space als Startordner.",
                      zh: "应用需要一个空间作为初始文件夹。",
                    })}
                    primaryAction={{
                      label: t({ en: "Create a Space", fr: "Créer un Space", de: "Space erstellen", zh: "创建空间" }),
                      to: "/portal/storage-spaces?create=1",
                    }}
                  />
                ) : selectedConnection ? (
                  <>
                    <section className="space-y-3" aria-labelledby="portal-tool-application-section">
                      <div>
                        <h3 id="portal-tool-application-section" className={cx("ui-body font-semibold", uiTitleTextClass)}>
                          {t({ en: "Choose your application", fr: "Choisissez votre application", de: "Wählen Sie Ihre Anwendung", zh: "选择应用" })}
                        </h3>
                        <p className={cx("mt-1 ui-caption", uiMutedTextClass)}>
                          {t({
                            en: "Install the application first if you do not already have it, then import the downloaded file.",
                            fr: "Installez d'abord l'application si nécessaire, puis importez le fichier téléchargé.",
                            de: "Installieren Sie die Anwendung bei Bedarf zuerst und importieren Sie dann die heruntergeladene Datei.",
                            zh: "如果尚未安装应用，请先安装，再导入下载的文件。",
                          })}
                        </p>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <article className={cx("flex min-h-[220px] flex-col p-4", uiPanelMutedClass)}>
                          <div>
                            <h4 className={cx("ui-body font-semibold", uiTitleTextClass)}>Cyberduck / Mountain Duck</h4>
                            <p className={cx("mt-1 ui-caption font-semibold", uiMutedTextClass)}>
                              {t({ en: "macOS and Windows", fr: "macOS et Windows", de: "macOS und Windows", zh: "macOS 和 Windows" })}
                            </p>
                            <p className={cx("mt-2 ui-caption", uiMutedTextClass)}>
                              {t({
                                en: "Browse files or mount the Space like a disk.",
                                fr: "Parcourez les fichiers ou montez le Space comme un disque.",
                                de: "Durchsuchen Sie Dateien oder binden Sie den Space wie ein Laufwerk ein.",
                                zh: "浏览文件或将空间挂载为磁盘。",
                              })}
                            </p>
                            <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 ui-caption">
                              <a
                                className="font-semibold text-primary hover:underline dark:text-primary-200"
                                href="https://cyberduck.io/download/"
                                target="_blank"
                                rel="noreferrer"
                                aria-label={t({ en: "Install Cyberduck from the official site (opens in a new tab)", fr: "Installer Cyberduck depuis le site officiel (s'ouvre dans un nouvel onglet)", de: "Cyberduck von der offiziellen Website installieren (öffnet einen neuen Tab)", zh: "从官方网站安装 Cyberduck（在新标签页中打开）" })}
                              >
                                {t({ en: "Install Cyberduck", fr: "Installer Cyberduck", de: "Cyberduck installieren", zh: "安装 Cyberduck" })}
                              </a>
                              <a
                                className="font-semibold text-primary hover:underline dark:text-primary-200"
                                href="https://mountainduck.io/"
                                target="_blank"
                                rel="noreferrer"
                                aria-label={t({ en: "Install Mountain Duck from the official site (opens in a new tab)", fr: "Installer Mountain Duck depuis le site officiel (s'ouvre dans un nouvel onglet)", de: "Mountain Duck von der offiziellen Website installieren (öffnet einen neuen Tab)", zh: "从官方网站安装 Mountain Duck（在新标签页中打开）" })}
                              >
                                {t({ en: "Install Mountain Duck", fr: "Installer Mountain Duck", de: "Mountain Duck installieren", zh: "安装 Mountain Duck" })}
                              </a>
                            </p>
                          </div>
                          <UiButton
                            type="button"
                            className="mt-auto self-start"
                            variant="secondary"
                            onClick={handleDownloadCyberduckBookmark}
                            disabled={setupFileUnavailable}
                            aria-label={`${t({ en: "Download Cyberduck or Mountain Duck configuration (.duck) for", fr: "Télécharger la configuration Cyberduck ou Mountain Duck (.duck) pour", de: "Cyberduck- oder Mountain-Duck-Konfiguration (.duck) herunterladen für", zh: "下载 Cyberduck 或 Mountain Duck 配置（.duck），适用于" })} ${selectedConnection.storageSpaceName}`}
                          >
                            {t({ en: "Download configuration (.duck)", fr: "Télécharger la configuration (.duck)", de: "Konfiguration herunterladen (.duck)", zh: "下载配置（.duck）" })}
                          </UiButton>
                        </article>
                        <article className={cx("flex min-h-[220px] flex-col p-4", uiPanelMutedClass)}>
                          <div>
                            <h4 className={cx("ui-body font-semibold", uiTitleTextClass)}>WinSCP</h4>
                            <p className={cx("mt-1 ui-caption font-semibold", uiMutedTextClass)}>Windows</p>
                            <p className={cx("mt-2 ui-caption", uiMutedTextClass)}>
                              {t({
                                en: "Transfer files with a graphical interface.",
                                fr: "Transférez des fichiers avec une interface graphique.",
                                de: "Übertragen Sie Dateien mit einer grafischen Oberfläche.",
                                zh: "通过图形界面传输文件。",
                              })}
                            </p>
                            <p className="mt-3 ui-caption">
                              <a
                                className="font-semibold text-primary hover:underline dark:text-primary-200"
                                href="https://winscp.net/eng/download.php"
                                target="_blank"
                                rel="noreferrer"
                                aria-label={t({ en: "Install WinSCP from the official site (opens in a new tab)", fr: "Installer WinSCP depuis le site officiel (s'ouvre dans un nouvel onglet)", de: "WinSCP von der offiziellen Website installieren (öffnet einen neuen Tab)", zh: "从官方网站安装 WinSCP（在新标签页中打开）" })}
                              >
                                {t({ en: "Install WinSCP", fr: "Installer WinSCP", de: "WinSCP installieren", zh: "安装 WinSCP" })}
                              </a>
                            </p>
                          </div>
                          <UiButton
                            type="button"
                            className="mt-auto self-start"
                            variant="secondary"
                            onClick={handleDownloadWinScpProfile}
                            disabled={setupFileUnavailable}
                            aria-label={`${t({ en: "Download WinSCP profile (.ini) for", fr: "Télécharger le profil WinSCP (.ini) pour", de: "WinSCP-Profil (.ini) herunterladen für", zh: "下载 WinSCP 配置（.ini），适用于" })} ${selectedConnection.storageSpaceName}`}
                          >
                            {t({ en: "Download WinSCP profile (.ini)", fr: "Télécharger le profil WinSCP (.ini)", de: "WinSCP-Profil herunterladen (.ini)", zh: "下载 WinSCP 配置（.ini）" })}
                          </UiButton>
                        </article>
                      </div>
                    </section>

                    {setupFileUnavailable ? (
                      <PageBanner tone="warning">
                        {t({
                          en: "Configuration downloads are unavailable because the storage service address is invalid. Check the manual values or contact an administrator.",
                          fr: "Les téléchargements de configuration sont indisponibles car l'adresse du service de stockage est invalide. Vérifiez les valeurs manuelles ou contactez un administrateur.",
                          de: "Konfigurationsdownloads sind nicht verfügbar, weil die Adresse des Speicherdienstes ungültig ist. Prüfen Sie die manuellen Werte oder wenden Sie sich an einen Administrator.",
                          zh: "存储服务地址无效，无法下载配置。请检查手动配置值或联系管理员。",
                        })}
                      </PageBanner>
                    ) : null}

                    <details className={cx("group p-4", uiPanelMutedClass)}>
                      <summary className={cx("cursor-pointer ui-body font-semibold", uiTitleTextClass)}>
                        {t({ en: "Advanced tools and manual setup", fr: "Outils avancés et configuration manuelle", de: "Erweiterte Werkzeuge und manuelle Einrichtung", zh: "高级工具和手动配置" })}
                      </summary>
                      <div className="mt-4 space-y-5">
                        <section className="space-y-3" aria-labelledby="portal-rclone-setup">
                          <div>
                            <h4 id="portal-rclone-setup" className={cx("ui-body font-semibold", uiTitleTextClass)}>rclone</h4>
                            <p className={cx("mt-1 ui-caption", uiMutedTextClass)}>
                              {t({ en: "Command line and automation.", fr: "Ligne de commande et automatisation.", de: "Kommandozeile und Automatisierung.", zh: "命令行与自动化。" })}
                              {" "}
                              <a
                                className="font-semibold text-primary hover:underline dark:text-primary-200"
                                href="https://rclone.org/downloads/"
                                target="_blank"
                                rel="noreferrer"
                                aria-label={t({ en: "Install rclone from the official site (opens in a new tab)", fr: "Installer rclone depuis le site officiel (s'ouvre dans un nouvel onglet)", de: "rclone von der offiziellen Website installieren (öffnet einen neuen Tab)", zh: "从官方网站安装 rclone（在新标签页中打开）" })}
                              >
                                {t({ en: "Install rclone", fr: "Installer rclone", de: "rclone installieren", zh: "安装 rclone" })}
                              </a>
                            </p>
                          </div>
                          <div className="grid gap-2 ui-caption">
                            <div>
                              <span className={uiMutedTextClass}>{t({ en: "Secret environment variable", fr: "Variable d'environnement du secret", de: "Umgebungsvariable für das Secret", zh: "私有密钥环境变量" })}</span>
                              <code className={cx("mt-1 block break-all rounded-md px-2 py-1", uiTitleTextClass)}>{rcloneSecretEnvironmentVariable}</code>
                            </div>
                            <div>
                              <span className={uiMutedTextClass}>{t({ en: "Example command", fr: "Commande d'exemple", de: "Beispielbefehl", zh: "命令示例" })}</span>
                              <code className={cx("mt-1 block break-all rounded-md px-2 py-1", uiTitleTextClass)}>rclone lsd {rcloneRemoteName}:{selectedConnection.bucketName}</code>
                            </div>
                          </div>
                          <UiButton
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={handleDownloadRcloneConfig}
                            disabled={setupFileUnavailable}
                            aria-label={`${t({ en: "Download rclone configuration (.conf) for", fr: "Télécharger la configuration rclone (.conf) pour", de: "rclone-Konfiguration (.conf) herunterladen für", zh: "下载 rclone 配置（.conf），适用于" })} ${selectedConnection.storageSpaceName}`}
                          >
                            {t({ en: "Download rclone configuration (.conf)", fr: "Télécharger la configuration rclone (.conf)", de: "rclone-Konfiguration herunterladen (.conf)", zh: "下载 rclone 配置（.conf）" })}
                          </UiButton>
                        </section>

                        <section className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700" aria-labelledby="portal-manual-s3-setup">
                          <div>
                            <h4 id="portal-manual-s3-setup" className={cx("ui-body font-semibold", uiTitleTextClass)}>
                              {t({ en: "Other S3-compatible application", fr: "Autre application compatible S3", de: "Andere S3-kompatible Anwendung", zh: "其他兼容 S3 的应用" })}
                            </h4>
                            <p className={cx("mt-1 ui-caption", uiMutedTextClass)}>
                              {t({
                                en: "Enter the secret in the application when requested. It is never included in these downloads.",
                                fr: "Saisissez le secret dans l'application lorsqu'il est demandé. Il n'est jamais inclus dans ces téléchargements.",
                                de: "Geben Sie das Secret auf Nachfrage in der Anwendung ein. Es ist nie in diesen Downloads enthalten.",
                                zh: "在应用提示时输入私有密钥。下载文件中不会包含私有密钥。",
                              })}
                            </p>
                          </div>
                          <dl className="grid gap-3 ui-caption sm:grid-cols-2">
                            {[
                              {
                                label: t({ en: "S3 endpoint", fr: "Endpoint S3", de: "S3-Endpunkt", zh: "S3 端点" }),
                                value: connectionEndpointLabel,
                              },
                              {
                                label: t({ en: "Bucket", fr: "Bucket", de: "Bucket", zh: "存储桶" }),
                                value: selectedConnection.bucketName,
                              },
                              {
                                label: t({ en: "Access ID", fr: "ID d'accès", de: "Zugriffs-ID", zh: "访问密钥 ID" }),
                                value: selectedConnection.key.access_key_id,
                              },
                            ].map((item) => (
                              <div key={item.label}>
                                <dt className={uiMutedTextClass}>{item.label}</dt>
                                <dd className={cx("mt-1 break-all font-mono font-semibold", uiTitleTextClass)}>{item.value}</dd>
                                <UiButton
                                  type="button"
                                  size="xs"
                                  variant="ghost"
                                  className="mt-1"
                                  onClick={() => void handleCopyConnectionValue(item.value)}
                                  aria-label={`${t({ en: "Copy", fr: "Copier", de: "Kopieren", zh: "复制" })} ${item.label}: ${item.value}`}
                                >
                                  {t({ en: "Copy", fr: "Copier", de: "Kopieren", zh: "复制" })}
                                </UiButton>
                              </div>
                            ))}
                            <div>
                              <dt className={uiMutedTextClass}>{t({ en: "Addressing mode", fr: "Mode d'adressage", de: "Adressierungsmodus", zh: "寻址模式" })}</dt>
                              <dd className={cx("mt-1 font-semibold", uiTitleTextClass)}>
                                {selectedConnection.forcePathStyle
                                  ? t({ en: "Path-style", fr: "Style chemin", de: "Pfadstil", zh: "路径样式" })
                                  : t({ en: "Virtual-hosted style", fr: "Style hôte virtuel", de: "Virtueller Hoststil", zh: "虚拟主机样式" })}
                              </dd>
                            </div>
                          </dl>
                          <div className="flex flex-wrap items-center gap-3">
                            <UiButton
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={handleDownloadConnectionSheet}
                              aria-label={`${t({ en: "Download connection details (.txt) for", fr: "Télécharger les détails de connexion (.txt) pour", de: "Verbindungsdetails (.txt) herunterladen für", zh: "下载连接信息（.txt），适用于" })} ${selectedConnection.storageSpaceName}`}
                            >
                              {t({ en: "Download connection details (.txt)", fr: "Télécharger les détails de connexion (.txt)", de: "Verbindungsdetails herunterladen (.txt)", zh: "下载连接信息（.txt）" })}
                            </UiButton>
                            <span className={cx("ui-caption", uiMutedTextClass)} aria-live="polite">{connectionCopyMessage}</span>
                          </div>
                        </section>
                      </div>
                    </details>
                  </>
                ) : null}
              </>
            )}
          </div>
        </Modal>
      ) : null}

      {createWizardOpen ? (
        <WorkflowPage
          title={t({ en: "Create S3 tool access", fr: "Créer un accès outil S3", de: "S3-Werkzeugzugriff erstellen", zh: "创建 S3 工具访问凭据" })}
          description={t({
            en: "Choose the IAM user, S3 scope, and permissions, then keep the one-time secret visible until you are done.",
            fr: "Choisissez l'utilisateur IAM, le périmètre S3 et les droits, puis conservez le secret à usage unique jusqu'à la fin.",
            de: "Wählen Sie IAM-Benutzer, S3-Umfang und Rechte und behalten Sie das einmalige Geheimnis bis zum Abschluss sichtbar.",
            zh: "选择 IAM 用户、S3 范围和权限，然后保留仅显示一次的私有密钥，直到完成配置。",
          })}
          breadcrumbs={portalBreadcrumbs(
            {
              label: t({ en: "External tools", fr: "Outils externes", de: "Externe Werkzeuge", zh: "外部工具" }),
              to: "/portal/access-keys",
            },
            { label: t({ en: "Create", fr: "Créer", de: "Erstellen", zh: "创建" }) },
          )}
          backLabel={t({ en: "Back to tool access", fr: "Retour aux accès outil", de: "Zurück zum Werkzeugzugriff", zh: "返回工具访问" })}
          onBack={busy === "create" ? undefined : closeCreateWizard}
          width="standard"
        >
          <div className="space-y-4">
            {error ? <PageBanner tone="error">{error}</PageBanner> : null}
            {storageSpacesError ? <PageBanner tone="warning">{storageSpacesError}</PageBanner> : null}
            <PageBanner tone="info">
              {t({
                en: "If the recipient can sign in to Portal, prefer sharing the Space there. Create tool access for desktop applications, scripts, or direct S3 clients.",
                fr: "Si le destinataire peut se connecter à Portal, préférez le partage du Space. Créez un accès outil pour une application de bureau, un script ou un client S3 direct.",
                de: "Wenn sich der Empfänger bei Portal anmelden kann, geben Sie den Space bevorzugt dort frei. Werkzeugzugriff ist für Desktop-Anwendungen, Skripte oder direkte S3-Clients gedacht.",
                zh: "如果接收人可以登录 Portal，建议在 Portal 中共享空间。桌面应用、脚本或直接使用 S3 的客户端适合使用工具访问凭据。",
              })}
            </PageBanner>
            {personalAccessLimitReached ? (
              <PageBanner tone="info">
                {t({
                  en: `Your personal IAM user already has the maximum of ${maxAccessKeys} S3 access keys. You can still create access for an external user because it uses a separate IAM user.`,
                  fr: `Votre utilisateur IAM personnel a déjà atteint la limite de ${maxAccessKeys} clés d'accès S3. Vous pouvez toutefois créer un accès pour un utilisateur externe.`,
                  de: `Ihr persönlicher IAM-Benutzer hat bereits das Maximum von ${maxAccessKeys} S3-Zugriffsschlüsseln. Für externe Benutzer können Sie weiterhin Zugriff erstellen, da dafür ein separater IAM-Benutzer verwendet wird.`,
                  zh: `你的个人 IAM 用户已达到 ${maxAccessKeys} 个 S3 访问密钥的上限。你仍可为外部用户创建访问凭据，因为它使用独立的 IAM 用户。`,
                })}
              </PageBanner>
            ) : null}
            <section className="space-y-2">
              <p className={uiLabelClass}>{t({ en: "Recipient", fr: "Destinataire", de: "Empfänger", zh: "接收人" })}</p>
              <div className="grid gap-2 md:grid-cols-2">
                <label className={cx("flex min-h-[88px] cursor-pointer gap-3 p-3", uiPanelMutedClass, createTarget === "self" && "ring-2 ring-primary")}>
                  <input
                    type="radio"
                    name="portal-access-key-target"
                    aria-label={t({ en: "For myself", fr: "Pour moi-même", de: "Für mich", zh: "为自己创建" })}
                    className={cx("mt-1", uiRadioClass)}
                    checked={createTarget === "self"}
                    onChange={() => setCreateTarget("self")}
                    disabled={busy === "create" || personalAccessLimitReached}
                  />
                  <span className="space-y-1">
                    <span className={cx("block ui-body font-semibold", uiTitleTextClass)}>{t({ en: "For myself", fr: "Pour moi-même", de: "Für mich", zh: "为自己创建" })}</span>
                    <span className={cx("block ui-caption", uiMutedTextClass)}>
                      {t({ en: "Uses my current Portal grants.", fr: "Utilise mes droits Portal actuels.", de: "Verwendet meine aktuellen Portal-Berechtigungen.", zh: "使用我当前的 Portal 授权。" })}
                    </span>
                  </span>
                </label>
                <label className={cx("flex min-h-[88px] cursor-pointer gap-3 p-3", uiPanelMutedClass, createTarget === "external" && "ring-2 ring-primary")}>
                  <input
                    type="radio"
                    name="portal-access-key-target"
                    aria-label={t({ en: "For an external user", fr: "Pour un utilisateur externe", de: "Für einen externen Benutzer", zh: "为外部用户创建" })}
                    className={cx("mt-1", uiRadioClass)}
                    checked={createTarget === "external"}
                    onChange={() => setCreateTarget("external")}
                    disabled={busy === "create"}
                  />
                  <span className="space-y-1">
                    <span className={cx("block ui-body font-semibold", uiTitleTextClass)}>{t({ en: "For an external user", fr: "Pour un utilisateur externe", de: "Für einen externen Benutzer", zh: "为外部用户创建" })}</span>
                    <span className={cx("block ui-caption", uiMutedTextClass)}>
                      {t({ en: "Limits tool access to one space.", fr: "Limite l'accès outil à un seul espace.", de: "Beschränkt den Werkzeugzugriff auf einen Bereich.", zh: "将工具访问限制为一个空间。" })}
                    </span>
                  </span>
                </label>
              </div>
            </section>

            {createTarget === "external" ? (
              <section className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1">
                  <span className={uiLabelClass}>{t({ en: "External user", fr: "Utilisateur externe", de: "Externer Benutzer", zh: "外部用户" })}</span>
                  <input
                    className={uiInputClass}
                    value={externalEmail}
                    onChange={(event) => setExternalEmail(event.target.value)}
                    placeholder={t({ en: "name@example.org", fr: "nom@example.org", de: "name@example.org", zh: "name@example.org" })}
                    disabled={busy === "create"}
                  />
                </label>
                <label className="space-y-1">
                  <span className={uiLabelClass}>{t({ en: "Space", fr: "Espace", de: "Bereich", zh: "空间" })}</span>
                  <select
                    className={uiInputClass}
                    value={selectedSpaceId}
                    onChange={(event) => setSelectedSpaceId(event.target.value)}
                    disabled={busy === "create" || storageSpacesLoading || storageSpaces.length === 0}
                  >
                    {storageSpacesLoading ? (
                      <option value="">{t({ en: "Loading...", fr: "Chargement...", de: "Wird geladen...", zh: "正在加载…" })}</option>
                    ) : storageSpaces.length === 0 ? (
                      <option value="">{t({ en: "No owned space", fr: "Aucun espace propriétaire", de: "Kein eigener Bereich", zh: "没有自己拥有的空间" })}</option>
                    ) : (
                      storageSpaces.map((space) => (
                        <option key={space.id} value={space.id}>
                          {space.name}
                        </option>
                      ))
                    )}
                  </select>
                </label>
                <fieldset className="space-y-2 md:col-span-2">
                  <legend className={uiLabelClass}>{t({ en: "Permission", fr: "Droits", de: "Berechtigung", zh: "权限" })}</legend>
                  <div className="grid gap-2 md:grid-cols-2">
                    <label className={cx("flex min-h-[74px] cursor-pointer gap-3 p-3", uiPanelMutedClass, externalPermission === "read_only" && "ring-2 ring-primary")}>
                      <input
                        type="radio"
                        name="portal-external-access-permission"
                        aria-label={t({ en: "Read only", fr: "Lecture seule", de: "Nur lesen", zh: "只读" })}
                        className={cx("mt-1", uiRadioClass)}
                        checked={externalPermission === "read_only"}
                        onChange={() => setExternalPermission("read_only")}
                        disabled={busy === "create"}
                      />
                      <span>
                        <span className={cx("block ui-body font-semibold", uiTitleTextClass)}>{t({ en: "Read only", fr: "Lecture seule", de: "Nur lesen", zh: "只读" })}</span>
                        <span className={cx("block ui-caption", uiMutedTextClass)}>{t({ en: "List and download.", fr: "Lister et télécharger.", de: "Auflisten und herunterladen.", zh: "列出和下载。" })}</span>
                      </span>
                    </label>
                    <label className={cx("flex min-h-[74px] cursor-pointer gap-3 p-3", uiPanelMutedClass, externalPermission === "read_write" && "ring-2 ring-primary")}>
                      <input
                        type="radio"
                        name="portal-external-access-permission"
                        aria-label={t({ en: "Read/write", fr: "Lecture/écriture", de: "Lesen/Schreiben", zh: "读写" })}
                        className={cx("mt-1", uiRadioClass)}
                        checked={externalPermission === "read_write"}
                        onChange={() => setExternalPermission("read_write")}
                        disabled={busy === "create"}
                      />
                      <span>
                        <span className={cx("block ui-body font-semibold", uiTitleTextClass)}>{t({ en: "Read/write", fr: "Lecture/écriture", de: "Lesen/Schreiben", zh: "读写" })}</span>
                        <span className={cx("block ui-caption", uiMutedTextClass)}>{t({ en: "List, download, upload, and delete.", fr: "Lister, télécharger, déposer et supprimer.", de: "Auflisten, herunterladen, hochladen und löschen.", zh: "列出、下载、上传和删除。" })}</span>
                      </span>
                    </label>
                  </div>
                </fieldset>
              </section>
            ) : null}

            <section className={cx("space-y-2 p-3", uiPanelMutedClass)}>
              <p className={uiLabelClass}>{t({ en: "Summary", fr: "Récapitulatif", de: "Zusammenfassung", zh: "摘要" })}</p>
              <dl className="grid gap-2 ui-caption md:grid-cols-2">
                <div>
                  <dt className={uiMutedTextClass}>{t({ en: "Recipient", fr: "Destinataire", de: "Empfänger", zh: "接收人" })}</dt>
                  <dd className={cx("font-semibold", uiTitleTextClass)}>
                    {createTarget === "external"
                      ? externalEmail.trim() || t({ en: "External user", fr: "Utilisateur externe", de: "Externer Benutzer", zh: "外部用户" })
                      : t({ en: "Myself", fr: "Moi-même", de: "Ich selbst", zh: "我自己" })}
                  </dd>
                </div>
                <div>
                  <dt className={uiMutedTextClass}>{t({ en: "Scope", fr: "Périmètre", de: "Umfang", zh: "范围" })}</dt>
                  <dd className={cx("font-semibold", uiTitleTextClass)}>
                    {createTarget === "external"
                      ? selectedSpace?.name || t({ en: "Select a space", fr: "Sélectionner un espace", de: "Bereich auswählen", zh: "选择空间" })
                      : t({ en: "My Portal access", fr: "Mes accès Portal", de: "Mein Portal-Zugriff", zh: "我的 Portal 访问权限" })}
                  </dd>
                </div>
              </dl>
            </section>

            <WorkflowActions>
              <UiButton variant="secondary" onClick={closeCreateWizard} disabled={busy === "create"}>
                {t({ en: "Cancel", fr: "Annuler", de: "Abbrechen", zh: "取消" })}
              </UiButton>
              <UiButton onClick={handleCreateKey} loading={busy === "create"} disabled={createWizardSubmitDisabled}>
                {busy === "create"
                  ? t({ en: "Creating...", fr: "Création...", de: "Wird erstellt...", zh: "正在创建…" })
                  : t({ en: "Create access", fr: "Créer l'accès", de: "Zugriff erstellen", zh: "创建访问凭据" })}
              </UiButton>
            </WorkflowActions>
          </div>
        </WorkflowPage>
      ) : null}

      {pendingAction?.type === "disable" ? (
        <ConfirmActionDialog
          title={t({ en: "Disable tool access", fr: "Désactiver l'accès outil", de: "Werkzeugzugriff deaktivieren", zh: "禁用工具访问" })}
          description={t({ en: "Confirm that you want to disable this tool access.", fr: "Confirmez que vous voulez désactiver cet accès outil.", de: "Bestätigen Sie, dass Sie diesen Werkzeugzugriff deaktivieren möchten.", zh: "确认要禁用此工具访问。" })}
          confirmLabel={t({ en: "Disable access", fr: "Désactiver l'accès", de: "Zugriff deaktivieren", zh: "禁用访问" })}
          loading={busy === `toggle:${pendingAction.key.access_key_id}`}
          details={[
            { label: t({ en: "Access ID", fr: "ID d'accès", de: "Zugriffs-ID", zh: "访问密钥 ID" }), value: pendingAction.key.access_key_id, mono: true },
            { label: t({ en: "Recipient", fr: "Destinataire", de: "Empfänger", zh: "接收人" }), value: keyTargetLabel(pendingAction.key, t) },
            { label: t({ en: "Scope", fr: "Périmètre", de: "Umfang", zh: "范围" }), value: keyScopeLabel(pendingAction.key, t) },
            { label: t({ en: "Service address", fr: "Adresse du service", de: "Serviceadresse", zh: "服务地址" }), value: state?.s3_endpoint ?? t({ en: "Configured storage service", fr: "Service de stockage configuré", de: "Konfigurierter Speicherdienst", zh: "已配置的存储服务" }) },
          ]}
          impacts={[
            t({ en: "External tools using this access stop authenticating until it is re-enabled.", fr: "Les outils externes utilisant cet accès ne pourront plus s'authentifier jusqu'à sa réactivation.", de: "Externe Werkzeuge mit diesem Zugriff können sich nicht authentifizieren, bis er wieder aktiviert wird.", zh: "使用此凭据的外部工具将无法认证，直到重新启用。" }),
            t({ en: "The secret value cannot be displayed again from the Portal.", fr: "Le secret ne peut plus être affiché depuis le Portal.", de: "Das Secret kann im Portal nicht erneut angezeigt werden.", zh: "无法在 Portal 中再次查看私有密钥。" }),
            t({ en: "The active Portal runtime access is not affected.", fr: "L'accès runtime actif utilisé par Portal n'est pas affecté.", de: "Der aktive Portal-Laufzeitzugriff ist nicht betroffen.", zh: "Portal 当前运行时的访问不受影响。" }),
          ]}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => updateKeyStatus(pendingAction.key, false)}
        />
      ) : null}

      {pendingAction?.type === "delete" ? (
        <ConfirmActionDialog
          title={t({ en: "Delete tool access", fr: "Supprimer l'accès outil", de: "Werkzeugzugriff löschen", zh: "删除工具访问凭据" })}
          description={t({ en: "Confirm that you want to permanently delete this tool access.", fr: "Confirmez que vous voulez supprimer définitivement cet accès outil.", de: "Bestätigen Sie, dass Sie diesen Werkzeugzugriff dauerhaft löschen möchten.", zh: "确认要永久删除此工具访问凭据。" })}
          confirmLabel={t({ en: "Delete access", fr: "Supprimer l'accès", de: "Zugriff löschen", zh: "删除访问凭据" })}
          loading={busy === `delete:${pendingAction.key.access_key_id}`}
          details={[
            { label: t({ en: "Access ID", fr: "ID d'accès", de: "Zugriffs-ID", zh: "访问密钥 ID" }), value: pendingAction.key.access_key_id, mono: true },
            { label: t({ en: "Recipient", fr: "Destinataire", de: "Empfänger", zh: "接收人" }), value: keyTargetLabel(pendingAction.key, t) },
            { label: t({ en: "Scope", fr: "Périmètre", de: "Umfang", zh: "范围" }), value: keyScopeLabel(pendingAction.key, t) },
            { label: t({ en: "Service address", fr: "Adresse du service", de: "Serviceadresse", zh: "服务地址" }), value: state?.s3_endpoint ?? t({ en: "Configured storage service", fr: "Service de stockage configuré", de: "Konfigurierter Speicherdienst", zh: "已配置的存储服务" }) },
          ]}
          impacts={[
            t({ en: "External tools using this access stop working immediately.", fr: "Les outils externes utilisant cet accès cessent immédiatement de fonctionner.", de: "Externe Werkzeuge mit diesem Zugriff funktionieren sofort nicht mehr.", zh: "使用此凭据的外部工具将立即停止工作。" }),
            t({ en: "The secret value cannot be recovered or shown again.", fr: "Le secret ne peut pas être récupéré ni affiché à nouveau.", de: "Das Secret kann nicht wiederhergestellt oder erneut angezeigt werden.", zh: "私有密钥无法恢复或再次显示。" }),
            t({ en: "This deletion cannot be undone from the Portal.", fr: "Cette suppression ne peut pas être annulée depuis le Portal.", de: "Diese Löschung kann im Portal nicht rückgängig gemacht werden.", zh: "无法在 Portal 中撤销此删除操作。" }),
          ]}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => confirmDeleteKey(pendingAction.key)}
        />
      ) : null}
    </div>
  );
}
