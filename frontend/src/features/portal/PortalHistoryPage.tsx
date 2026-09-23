/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ActiveFiltersBar from "../../components/ActiveFiltersBar";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import SettingsFormDialog from "../../components/settings/SettingsFormDialog";
import PageShell from "../../components/PageShell";
import PageBanner from "../../components/PageBanner";
import UiButton from "../../components/ui/UiButton";
import UiBadge from "../../components/ui/UiBadge";
import ListPageSection from "../../components/list/ListPageSection";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import { ListActionButton } from "../../components/list/ListControls";
import { cx, type UiTone, uiLabelClass, uiMutedTextClass } from "../../components/ui/styles";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { useI18n } from "../../i18n";
import {
  downloadPortalServerAccessRawLogs,
  fetchPortalServerAccessLogPage,
  type PortalServerAccessLogEntry,
  type PortalServerAccessRequesterIdentity,
} from "../../api/portalActivity";
import { extractApiError } from "../../utils/apiError";
import { triggerBlobDownload } from "../../utils/download";
import { formatBytes } from "../../utils/format";
import { resolvePortalWorkspacePageState } from "./portalUi";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import PortalPageTabs, { PortalTabPanel } from "./PortalPageTabs";
import PortalActivityPanel from "./PortalActivityPanel";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";
import AdvancedFilterDrawerShell from "../shared/AdvancedFilterDrawerShell";
import AdvancedFilterTextMatchField from "../shared/AdvancedFilterTextMatchField";
import {
  advancedFilterControlClass,
  advancedFilterFieldCardClass,
  advancedFilterSectionClass,
  advancedFilterSyncBadgeClass,
  advancedFilterToolbarButtonClass,
  buildTextFieldRules,
  formatAdvancedFilterSyncLabel,
  formatTextFilterSummary,
  parseExactListInput,
  renderAdvancedFilterDraftSummary,
  renderAdvancedFilterRuleCountBadge,
  type TextMatchMode,
} from "../shared/advancedFilterShared";

type HistoryTab = "activity" | "access";
type ServerLogActionFilter = "" | "upload" | "download" | "delete" | "list" | "metadata" | "other";
type ServerLogResultFilter = "" | "success" | "failure";
type ServerLogAdvancedFilterState = {
  action: ServerLogActionFilter;
  result: ServerLogResultFilter;
  path: string;
  pathMatchMode: TextMatchMode;
  identity: string;
  identityMatchMode: TextMatchMode;
};
type ServerLogAdvancedFilterField = "action" | "result" | "path" | "identity";
type ActiveServerLogFilterRemoveAction = { type: "advanced"; field: ServerLogAdvancedFilterField };

type ServerLogRow = {
  id: string;
  timestampLabel: string;
  timestampSort: number;
  operationLabel: string;
  operationDetail: string;
  rawOperation: string;
  targetLabel: string;
  targetDetail: string;
  statusLabel: string;
  statusDetail: string;
  statusTone: UiTone;
  identityLabel: string;
  identityDetail: string;
  identityKeyLabel: string;
  identityKindLabel: string;
  identityTone: UiTone;
  sourceDetail: string;
};

const defaultServerLogAdvancedFilter: ServerLogAdvancedFilterState = {
  action: "",
  result: "",
  path: "",
  pathMatchMode: "contains",
  identity: "",
  identityMatchMode: "contains",
};

function hasServerLogAdvancedFilters(advanced: ServerLogAdvancedFilterState | null): boolean {
  if (!advanced) return false;
  return Boolean(advanced.action || advanced.result || advanced.path.trim() || advanced.identity.trim());
}

function buildServerLogAdvancedFilterPayload(advanced: ServerLogAdvancedFilterState | null): string | undefined {
  if (!advanced) return undefined;
  const rules: Array<Record<string, unknown>> = [];
  if (advanced.action) {
    rules.push({ field: "action", op: "eq", value: advanced.action });
  }
  if (advanced.result) {
    rules.push({ field: "result", op: "eq", value: advanced.result });
  }
  rules.push(...buildTextFieldRules("path", advanced.path, advanced.pathMatchMode));
  rules.push(...buildTextFieldRules("identity", advanced.identity, advanced.identityMatchMode));
  if (rules.length === 0) return undefined;
  return JSON.stringify({ match: "all", rules });
}

function todayDateInputValue(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function shiftDateInputValue(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return todayDateInputValue();
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function formatServerLogTimestamp(value: string, locale: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function timestampSortValue(value?: string | null): number {
  if (!value) return 0;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function serverLogStatusTone(statusCode?: number | null): UiTone {
  if (statusCode == null) return "neutral";
  if (statusCode >= 400) return "danger";
  if (statusCode >= 300) return "warning";
  return "success";
}

function serverLogSizeBytes(entry: PortalServerAccessLogEntry): number | null {
  return entry.object_size ?? entry.bytes_sent ?? null;
}

function serverLogObjectLabel(entry: PortalServerAccessLogEntry): string {
  return entry.object_name || entry.object_key || "-";
}

function compactServerLogRequester(value?: string | null): string {
  if (!value) return "-";
  if (value.length <= 10) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function compactUserAgent(value?: string | null): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized === "-") return null;
  return normalized.length > 56 ? `${normalized.slice(0, 53)}...` : normalized;
}

function serverLogIdentityKindLabel(kind: PortalServerAccessRequesterIdentity["kind"], t: ReturnType<typeof useI18n>["t"]): string {
  switch (kind) {
    case "portal_user":
      return t({ en: "Portal user", fr: "Utilisateur portail", de: "Portal-Benutzer", zh: "Portal 用户" });
    case "external_access":
      return t({ en: "External access", fr: "Accès externe", de: "Externer Zugriff", zh: "外部访问" });
    case "rgw_user":
      return t({ en: "Storage user", fr: "Utilisateur stockage", de: "Speicherbenutzer", zh: "存储用户" });
    case "rgw_account":
      return t({ en: "Storage account", fr: "Compte stockage", de: "Speicherkonto", zh: "存储账户" });
    default:
      return t({ en: "Unknown", fr: "Inconnu", de: "Unbekannt", zh: "未知" });
  }
}

function serverLogIdentityTone(kind: PortalServerAccessRequesterIdentity["kind"], resolved: boolean): UiTone {
  if (!resolved || kind === "unknown") return "neutral";
  if (kind === "portal_user") return "primary";
  if (kind === "external_access") return "info";
  return "success";
}

function serverLogOperationLabel(entry: PortalServerAccessLogEntry, t: ReturnType<typeof useI18n>["t"]): string {
  switch (entry.operation_category) {
    case "upload":
      return t({ en: "Added a file", fr: "Fichier ajouté", de: "Datei hinzugefügt", zh: "添加了文件" });
    case "download":
      return t({ en: "Downloaded a file", fr: "Fichier téléchargé", de: "Datei heruntergeladen", zh: "下载了文件" });
    case "delete":
      return t({ en: "Deleted a file", fr: "Fichier supprimé", de: "Datei gelöscht", zh: "删除了文件" });
    case "list":
      return t({ en: "Listed content", fr: "Contenu listé", de: "Inhalt aufgelistet", zh: "列出了内容" });
    case "metadata":
      return t({ en: "Read or changed settings", fr: "Paramètres consultés ou modifiés", de: "Einstellungen gelesen oder geändert", zh: "读取或更改了设置" });
    default:
      return t({ en: "Recorded an access event", fr: "Événement d'accès enregistré", de: "Zugriffsereignis aufgezeichnet", zh: "记录了访问事件" });
  }
}

function serverLogOperationDetail(entry: PortalServerAccessLogEntry, objectLabel: string, t: ReturnType<typeof useI18n>["t"]): string {
  if (entry.operation_category === "list") {
    return t({
      en: `Listed ${entry.storage_space_name || entry.bucket_name}`,
      fr: `Consultation de ${entry.storage_space_name || entry.bucket_name}`,
      de: `${entry.storage_space_name || entry.bucket_name} aufgelistet`,
      zh: `列出了 ${entry.storage_space_name || entry.bucket_name}`,
    });
  }
  if (objectLabel === "-") {
    return entry.operation;
  }
  switch (entry.operation_category) {
    case "upload":
      return t({ en: `Added ${objectLabel}`, fr: `Ajout de ${objectLabel}`, de: `${objectLabel} hinzugefügt`, zh: `添加了 ${objectLabel}` });
    case "download":
      return t({ en: `Downloaded ${objectLabel}`, fr: `Téléchargement de ${objectLabel}`, de: `${objectLabel} heruntergeladen`, zh: `下载了 ${objectLabel}` });
    case "delete":
      return t({ en: `Deleted ${objectLabel}`, fr: `Suppression de ${objectLabel}`, de: `${objectLabel} gelöscht`, zh: `删除了 ${objectLabel}` });
    case "metadata":
      return t({ en: `Checked or changed ${objectLabel}`, fr: `Consultation ou modification de ${objectLabel}`, de: `${objectLabel} geprüft oder geändert`, zh: `检查或更改了 ${objectLabel}` });
    default:
      return t({ en: `Access event for ${objectLabel}`, fr: `Événement d'accès pour ${objectLabel}`, de: `Zugriffsereignis für ${objectLabel}`, zh: `${objectLabel} 的访问事件` });
  }
}

function serverLogStatusLabel(entry: PortalServerAccessLogEntry, t: ReturnType<typeof useI18n>["t"]): string {
  if (entry.status_code == null) return entry.error_code || "-";
  if (entry.status_code >= 400) {
    return t({ en: `Failed (${entry.status_code})`, fr: `Échec (${entry.status_code})`, de: `Fehlgeschlagen (${entry.status_code})`, zh: `失败（${entry.status_code}）` });
  }
  if (entry.status_code >= 300) {
    return t({ en: `Redirected (${entry.status_code})`, fr: `Redirection (${entry.status_code})`, de: `Weitergeleitet (${entry.status_code})`, zh: `重定向（${entry.status_code}）` });
  }
  return t({ en: `Succeeded (${entry.status_code})`, fr: `Réussi (${entry.status_code})`, de: `Erfolgreich (${entry.status_code})`, zh: `成功（${entry.status_code}）` });
}

function historyTabFromSearch(value: string | null): HistoryTab {
  if (value === "access") return value;
  return "activity";
}

export default function PortalHistoryPage() {
  const { t, locale } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedHistoryTab = historyTabFromSearch(searchParams.get("view"));
  const [serverLogDate, setServerLogDate] = useState(todayDateInputValue);
  const [serverLogSpaceId, setServerLogSpaceId] = useState("");
  const [showServerLogAdvancedFilter, setShowServerLogAdvancedFilter] = useState(false);
  const [serverLogAdvancedDraft, setServerLogAdvancedDraft] = useState<ServerLogAdvancedFilterState>(defaultServerLogAdvancedFilter);
  const [serverLogAdvancedApplied, setServerLogAdvancedApplied] = useState<ServerLogAdvancedFilterState | null>(null);
  const [serverLogs, setServerLogs] = useState<PortalServerAccessLogEntry[]>([]);
  const [serverLogsTotal, setServerLogsTotal] = useState(0);
  const [serverLogsLoading, setServerLogsLoading] = useState(false);
  const [serverLogsLoaded, setServerLogsLoaded] = useState(false);
  const [serverLogsError, setServerLogsError] = useState<string | null>(null);
  const [serverLogPage, setServerLogPage] = useState(1);
  const [serverLogPageSize, setServerLogPageSize] = useState(25);
  const [rawLogsModalOpen, setRawLogsModalOpen] = useState(false);
  const [rawLogsDateFrom, setRawLogsDateFrom] = useState(todayDateInputValue);
  const [rawLogsDateTo, setRawLogsDateTo] = useState(todayDateInputValue);
  const [rawLogsSpaceId, setRawLogsSpaceId] = useState("");
  const [rawLogsLoading, setRawLogsLoading] = useState(false);
  const [rawLogsError, setRawLogsError] = useState<string | null>(null);
  const {
    workspace,
    state,
    loading,
    error,
    hasAccountContext,
    accountError,
    accountLoading,
    stateLoading,
    activityLoading,
    accountIdForApi,
    selectedAccount,
  } = usePortalWorkspaceData({
    includeActivity: requestedHistoryTab === "activity",
  });
  const storageSpaces = workspace.spaces ?? [];
  const historyStateReady = hasAccountContext && !accountLoading && !stateLoading && state !== null;
  const serverAccessLoggingEnabled = state?.server_access_logging_enabled ?? true;
  const canViewServerAccessLogs =
    historyStateReady && !error &&
    (selectedAccount?.portal_role === "portal_manager" || state?.portal_role === "portal_manager");
  const activeHistoryTab: HistoryTab =
    requestedHistoryTab === "access" && (!serverAccessLoggingEnabled || !canViewServerAccessLogs)
      ? "activity"
      : requestedHistoryTab;
  const historyTabs = useMemo(() => {
    const tabs: Array<{ id: HistoryTab; label: string }> = [
      {
        id: "activity",
        label: t({ en: "Activity", fr: "Activité", de: "Aktivität", zh: "活动" }),
      },
    ];
    if (serverAccessLoggingEnabled && canViewServerAccessLogs) {
      tabs.push({ id: "access", label: t({ en: "Access logs", fr: "Journaux d'accès", de: "Zugriffsprotokolle", zh: "访问日志" }) });
    }
    return tabs;
  }, [canViewServerAccessLogs, serverAccessLoggingEnabled, t]);
  const selectHistoryTab = useCallback(
    (tab: HistoryTab, replace = false) => {
      const next = new URLSearchParams(searchParams);
      if (tab === "activity") next.delete("view");
      else next.set("view", tab);
      setSearchParams(next, { replace });
    },
    [searchParams, setSearchParams]
  );

  const serverLogAdvancedFilterParam = useMemo(
    () => buildServerLogAdvancedFilterPayload(serverLogAdvancedApplied),
    [serverLogAdvancedApplied]
  );
  const serverLogAdvancedDraftPayload = useMemo(
    () => buildServerLogAdvancedFilterPayload(serverLogAdvancedDraft),
    [serverLogAdvancedDraft]
  );
  const serverLogAdvancedAppliedPayload = useMemo(
    () => buildServerLogAdvancedFilterPayload(serverLogAdvancedApplied),
    [serverLogAdvancedApplied]
  );
  const serverLogAdvancedFilterActive = hasServerLogAdvancedFilters(serverLogAdvancedApplied);
  const hasPendingServerLogAdvancedChanges = serverLogAdvancedDraftPayload !== serverLogAdvancedAppliedPayload;
  const hasAnyServerLogAdvancedToClear = Boolean(serverLogAdvancedDraftPayload || serverLogAdvancedAppliedPayload);
  const serverLogAdvancedFilterCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: showServerLogAdvancedFilter && hasPendingServerLogAdvancedChanges,
    onClose: () => setShowServerLogAdvancedFilter(false),
    zIndexClass: "z-[70]",
  });

  const resetServerLogResults = useCallback(() => {
    setServerLogs([]);
    setServerLogsTotal(0);
    setServerLogsLoaded(false);
    setServerLogsError(null);
    setServerLogPage(1);
  }, []);

  const setServerDateAndReset = useCallback((value: string) => {
    setServerLogDate(value);
    resetServerLogResults();
  }, [resetServerLogResults]);

  const serverLogActionOptions = useMemo(
    () => [
      { value: "", label: t({ en: "Any action", fr: "Toutes les actions", de: "Jede Aktion", zh: "任意操作" }) },
      { value: "upload", label: t({ en: "Uploads", fr: "Envois", de: "Uploads", zh: "上传" }) },
      { value: "download", label: t({ en: "Downloads", fr: "Téléchargements", de: "Downloads", zh: "下载" }) },
      { value: "delete", label: t({ en: "Deletes", fr: "Suppressions", de: "Löschungen", zh: "删除" }) },
      { value: "list", label: t({ en: "Listings", fr: "Listages", de: "Auflistungen", zh: "列举" }) },
      { value: "metadata", label: t({ en: "Metadata/settings", fr: "Métadonnées/paramètres", de: "Metadaten/Einstellungen", zh: "元数据/设置" }) },
      { value: "other", label: t({ en: "Other access events", fr: "Autres événements d'accès", de: "Andere Zugriffsereignisse", zh: "其他访问事件" }) },
    ],
    [t]
  ) as Array<{ value: ServerLogActionFilter; label: string }>;
  const serverLogActionLabel = useCallback(
    (value: ServerLogActionFilter) => serverLogActionOptions.find((option) => option.value === value)?.label ?? value,
    [serverLogActionOptions]
  );
  const serverLogResultOptions = useMemo(
    () => [
      { value: "", label: t({ en: "Any result", fr: "Tous les résultats", de: "Jedes Ergebnis", zh: "任意结果" }) },
      { value: "success", label: t({ en: "Succeeded", fr: "Réussi", de: "Erfolgreich", zh: "成功" }) },
      { value: "failure", label: t({ en: "Failed", fr: "Échec", de: "Fehlgeschlagen", zh: "失败" }) },
    ] as Array<{ value: ServerLogResultFilter; label: string }>,
    [t]
  );
  const serverLogResultLabel = useCallback(
    (value: ServerLogResultFilter) => serverLogResultOptions.find((option) => option.value === value)?.label ?? value,
    [serverLogResultOptions]
  );

  const updateServerLogAdvancedField = useCallback((field: keyof ServerLogAdvancedFilterState, value: string) => {
    setServerLogAdvancedDraft((prev) => ({ ...prev, [field]: value }));
  }, []);
  const updateServerLogAdvancedMatchMode = useCallback((field: "pathMatchMode" | "identityMatchMode", value: TextMatchMode) => {
    setServerLogAdvancedDraft((prev) => ({ ...prev, [field]: value }));
  }, []);

  const activeFieldClass =
    "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-200/70 dark:border-emerald-400/70 dark:bg-emerald-500/15 dark:ring-emerald-500/25";
  const activeLabelClass = "text-emerald-700 dark:text-emerald-200";
  const pendingFieldClass =
    "border-amber-400 bg-amber-50 ring-2 ring-amber-300/70 dark:border-amber-400/70 dark:bg-amber-500/20 dark:ring-amber-500/25";
  const pendingLabelClass = "text-amber-700 dark:text-amber-300";
  const fieldHighlight = (isApplied: boolean, isPending: boolean) => {
    if (isPending) return { labelClass: pendingLabelClass, fieldClass: pendingFieldClass };
    if (isApplied) return { labelClass: activeLabelClass, fieldClass: activeFieldClass };
    return { labelClass: "", fieldClass: "" };
  };

  const pathAppliedValue = (serverLogAdvancedApplied?.path ?? "").trim();
  const identityAppliedValue = (serverLogAdvancedApplied?.identity ?? "").trim();
  const pathDraftValue = serverLogAdvancedDraft.path.trim();
  const identityDraftValue = serverLogAdvancedDraft.identity.trim();
  const pathAppliedParsed = useMemo(() => parseExactListInput(serverLogAdvancedApplied?.path ?? ""), [serverLogAdvancedApplied]);
  const pathDraftParsed = useMemo(() => parseExactListInput(serverLogAdvancedDraft.path), [serverLogAdvancedDraft.path]);
  const identityAppliedParsed = useMemo(() => parseExactListInput(serverLogAdvancedApplied?.identity ?? ""), [serverLogAdvancedApplied]);
  const identityDraftParsed = useMemo(() => parseExactListInput(serverLogAdvancedDraft.identity), [serverLogAdvancedDraft.identity]);
  const pathAppliedMode: TextMatchMode =
    pathAppliedParsed.listProvided && pathAppliedParsed.values.length > 0 ? "exact" : (serverLogAdvancedApplied?.pathMatchMode ?? "contains");
  const identityAppliedMode: TextMatchMode =
    identityAppliedParsed.listProvided && identityAppliedParsed.values.length > 0 ? "exact" : (serverLogAdvancedApplied?.identityMatchMode ?? "contains");
  const pathDraftForcesExact = pathDraftParsed.listProvided && pathDraftParsed.values.length > 0;
  const identityDraftForcesExact = identityDraftParsed.listProvided && identityDraftParsed.values.length > 0;
  const pathDraftMode: TextMatchMode = pathDraftForcesExact ? "exact" : serverLogAdvancedDraft.pathMatchMode;
  const identityDraftMode: TextMatchMode = identityDraftForcesExact ? "exact" : serverLogAdvancedDraft.identityMatchMode;
  const pathPending = pathDraftValue !== pathAppliedValue || (pathDraftValue.length > 0 && pathDraftMode !== pathAppliedMode);
  const identityPending = identityDraftValue !== identityAppliedValue || (identityDraftValue.length > 0 && identityDraftMode !== identityAppliedMode);
  const actionPending = serverLogAdvancedDraft.action !== (serverLogAdvancedApplied?.action ?? "");
  const resultPending = serverLogAdvancedDraft.result !== (serverLogAdvancedApplied?.result ?? "");
  const actionFieldState = fieldHighlight(Boolean(serverLogAdvancedApplied?.action), actionPending);
  const resultFieldState = fieldHighlight(Boolean(serverLogAdvancedApplied?.result), resultPending);
  const pathFieldState = fieldHighlight(Boolean(pathAppliedValue), pathPending);
  const identityFieldState = fieldHighlight(Boolean(identityAppliedValue), identityPending);

  const applyServerLogAdvancedFilter = useCallback(() => {
    setServerLogAdvancedApplied(serverLogAdvancedDraft);
    setShowServerLogAdvancedFilter(false);
    resetServerLogResults();
  }, [resetServerLogResults, serverLogAdvancedDraft]);
  const resetServerLogAdvancedFilter = useCallback(() => {
    setServerLogAdvancedDraft(defaultServerLogAdvancedFilter);
    setServerLogAdvancedApplied(null);
    resetServerLogResults();
  }, [resetServerLogResults]);
  const clearServerLogAdvancedField = useCallback((field: ServerLogAdvancedFilterField) => {
    setServerLogAdvancedDraft((prev) => {
      if (field === "action") return { ...prev, action: "" };
      if (field === "result") return { ...prev, result: "" };
      if (field === "path") return { ...prev, path: "" };
      return { ...prev, identity: "" };
    });
    setServerLogAdvancedApplied((prev) => {
      if (!prev) return prev;
      if (field === "action") return { ...prev, action: "" };
      if (field === "result") return { ...prev, result: "" };
      if (field === "path") return { ...prev, path: "" };
      return { ...prev, identity: "" };
    });
    resetServerLogResults();
  }, [resetServerLogResults]);
  const removeServerLogActiveFilterItem = useCallback((action: ActiveServerLogFilterRemoveAction) => {
    clearServerLogAdvancedField(action.field);
  }, [clearServerLogAdvancedField]);

  const activeServerLogFilterSummaryItems = useMemo(() => {
    const items: Array<{ id: string; label: string; remove: ActiveServerLogFilterRemoveAction }> = [];
    if (serverLogAdvancedApplied?.action) {
      items.push({
        id: "action",
        label: `${t({ en: "Action", fr: "Action", de: "Aktion", zh: "操作" })}: ${serverLogActionLabel(serverLogAdvancedApplied.action)}`,
        remove: { type: "advanced", field: "action" },
      });
    }
    if (serverLogAdvancedApplied?.result) {
      items.push({
        id: "result",
        label: `${t({ en: "Result", fr: "Résultat", de: "Ergebnis", zh: "结果" })}: ${serverLogResultLabel(serverLogAdvancedApplied.result)}`,
        remove: { type: "advanced", field: "result" },
      });
    }
    const pathLabel = serverLogAdvancedApplied
      ? formatTextFilterSummary(t({ en: "Path", fr: "Chemin", de: "Pfad", zh: "路径" }), serverLogAdvancedApplied.path, pathAppliedMode)
      : null;
    if (pathLabel) items.push({ id: "path", label: pathLabel, remove: { type: "advanced", field: "path" } });
    const identityLabel = serverLogAdvancedApplied
      ? formatTextFilterSummary(t({ en: "Person or key", fr: "Personne ou clé", de: "Person oder Schlüssel", zh: "人员或密钥" }), serverLogAdvancedApplied.identity, identityAppliedMode)
      : null;
    if (identityLabel) items.push({ id: "identity", label: identityLabel, remove: { type: "advanced", field: "identity" } });
    return items;
  }, [identityAppliedMode, pathAppliedMode, serverLogActionLabel, serverLogAdvancedApplied, serverLogResultLabel, t]);

  const serverLogAdvancedDraftSummaryItems = useMemo(() => {
    const items: Array<{ id: string; label: string }> = [];
    if (serverLogAdvancedDraft.action) {
      items.push({
        id: "action",
        label: `${t({ en: "Action", fr: "Action", de: "Aktion", zh: "操作" })}: ${serverLogActionLabel(serverLogAdvancedDraft.action)}`,
      });
    }
    if (serverLogAdvancedDraft.result) {
      items.push({
        id: "result",
        label: `${t({ en: "Result", fr: "Résultat", de: "Ergebnis", zh: "结果" })}: ${serverLogResultLabel(serverLogAdvancedDraft.result)}`,
      });
    }
    const pathLabel = formatTextFilterSummary(t({ en: "Path", fr: "Chemin", de: "Pfad", zh: "路径" }), serverLogAdvancedDraft.path, pathDraftMode);
    if (pathLabel) items.push({ id: "path", label: pathLabel });
    const identityLabel = formatTextFilterSummary(t({ en: "Person or key", fr: "Personne ou clé", de: "Person oder Schlüssel", zh: "人员或密钥" }), serverLogAdvancedDraft.identity, identityDraftMode);
    if (identityLabel) items.push({ id: "identity", label: identityLabel });
    return items;
  }, [identityDraftMode, pathDraftMode, serverLogActionLabel, serverLogAdvancedDraft, serverLogResultLabel, t]);
  const serverLogAdvancedDraftActiveCount = serverLogAdvancedDraftSummaryItems.length;

  useEffect(() => {
    if (loading || !historyStateReady || error) return;
    const rawView = searchParams.get("view");
    const invalidView = rawView !== null && !["activity", "access"].includes(rawView);
    const inaccessibleAccessView =
      requestedHistoryTab === "access" && (!serverAccessLoggingEnabled || !canViewServerAccessLogs);
    if (invalidView || inaccessibleAccessView || rawView === "activity") {
      selectHistoryTab("activity", true);
    }
  }, [
    historyStateReady,
    error,
    canViewServerAccessLogs,
    loading,
    requestedHistoryTab,
    searchParams,
    selectHistoryTab,
    serverAccessLoggingEnabled,
  ]);

  useEffect(() => {
    if (activeHistoryTab !== "access" || !serverAccessLoggingEnabled || !canViewServerAccessLogs || !accountIdForApi || !serverLogDate) return;
    let cancelled = false;
    setServerLogsLoading(true);
    setServerLogsError(null);
    setServerLogsLoaded(false);
      void fetchPortalServerAccessLogPage(accountIdForApi, {
        date: serverLogDate,
        spaceId: serverLogSpaceId || undefined,
        limit: serverLogPageSize,
        offset: (serverLogPage - 1) * serverLogPageSize,
        timezoneOffsetMinutes: new Date().getTimezoneOffset(),
        advancedFilter: serverLogAdvancedFilterParam,
      })
      .then((page) => {
        if (cancelled) return;
        setServerLogs(page.entries);
        setServerLogsTotal(page.total);
        setServerLogsLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
        setServerLogs([]);
        setServerLogsTotal(0);
        setServerLogsLoaded(true);
        setServerLogsError(
          extractApiError(
            err,
            t({
              en: "Unable to retrieve access history.",
              fr: "Impossible de récupérer l'historique d'accès.",
              de: "Zugriffsverlauf kann nicht abgerufen werden.",
              zh: "无法获取访问历史。",
            })
          )
        );
      })
      .finally(() => {
        if (!cancelled) setServerLogsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, activeHistoryTab, canViewServerAccessLogs, serverAccessLoggingEnabled, serverLogAdvancedFilterParam, serverLogDate, serverLogPage, serverLogPageSize, serverLogSpaceId, t]);

  const openRawLogsModal = useCallback(() => {
    setRawLogsDateFrom(serverLogDate);
    setRawLogsDateTo(serverLogDate);
    setRawLogsSpaceId(serverLogSpaceId);
    setRawLogsError(null);
    setRawLogsModalOpen(true);
  }, [serverLogDate, serverLogSpaceId]);

  const handleDownloadRawLogs = useCallback(async () => {
    if (!accountIdForApi) return;
    if (!rawLogsDateFrom || !rawLogsDateTo) {
      setRawLogsError(t({ en: "Select a start and end date.", fr: "Sélectionnez une date de début et de fin.", de: "Wählen Sie ein Start- und Enddatum.", zh: "请选择开始和结束日期。" }));
      return;
    }
    if (rawLogsDateTo < rawLogsDateFrom) {
      setRawLogsError(t({ en: "The end date must be after the start date.", fr: "La date de fin doit être après la date de début.", de: "Das Enddatum muss nach dem Startdatum liegen.", zh: "结束日期必须晚于开始日期。" }));
      return;
    }
    setRawLogsLoading(true);
    setRawLogsError(null);
    try {
      const result = await downloadPortalServerAccessRawLogs(accountIdForApi, {
        dateFrom: rawLogsDateFrom,
        dateTo: rawLogsDateTo,
        spaceId: rawLogsSpaceId || undefined,
        timezoneOffsetMinutes: new Date().getTimezoneOffset(),
      });
      triggerBlobDownload(result.filename, result.blob);
      setRawLogsModalOpen(false);
    } catch (err) {
      console.error(err);
      setRawLogsError(
        extractApiError(
          err,
          t({
            en: "Unable to export raw access logs.",
            fr: "Impossible d'exporter les logs d'accès bruts.",
            de: "Rohe Zugriffslogs können nicht exportiert werden.",
            zh: "无法导出原始访问日志。",
          })
        )
      );
    } finally {
      setRawLogsLoading(false);
    }
  }, [accountIdForApi, rawLogsDateFrom, rawLogsDateTo, rawLogsSpaceId, t]);

  const serverLogRows = useMemo<ServerLogRow[]>(() => {
    return serverLogs
      .map((entry) => {
        const objectLabel = serverLogObjectLabel(entry);
        const storageSpace = entry.storage_space_name || entry.storage_space_id || entry.bucket_name;
        const identity = entry.requester_identity;
        const identityKind = identity?.kind ?? "unknown";
        const sizeBytes = serverLogSizeBytes(entry);
        const userAgent = compactUserAgent(entry.user_agent);
        const statusDetailParts = [
          entry.error_code,
          sizeBytes == null ? null : formatBytes(sizeBytes),
        ].filter(Boolean);
        const sourceDetailParts = [
          entry.client_ip ? `IP ${entry.client_ip}` : null,
          userAgent,
        ].filter(Boolean);
        const identityKeyParts = [
          entry.requester ? `UID ${compactServerLogRequester(entry.requester)}` : null,
          identity?.access_key_id ? `key ${compactServerLogRequester(identity.access_key_id)}` : null,
        ].filter(Boolean);
        return {
          id: entry.id,
          timestampLabel: formatServerLogTimestamp(entry.timestamp, locale),
          timestampSort: timestampSortValue(entry.timestamp),
          operationLabel: serverLogOperationLabel(entry, t),
          operationDetail: serverLogOperationDetail(entry, objectLabel, t),
          rawOperation: entry.operation,
          targetLabel: storageSpace,
          targetDetail: entry.object_key || objectLabel,
          statusLabel: serverLogStatusLabel(entry, t),
          statusDetail: statusDetailParts.join(" · ") || "-",
          statusTone: serverLogStatusTone(entry.status_code),
          identityLabel: identity?.resolved
            ? identity.label
            : t({ en: "Unknown identity", fr: "Identité inconnue", de: "Unbekannte Identität", zh: "未知身份" }),
          identityDetail: identity?.detail || t({ en: "Requester was not resolved", fr: "Le demandeur n'a pas été résolu", de: "Requester wurde nicht aufgelöst", zh: "无法识别请求者" }),
          identityKeyLabel: identityKeyParts.join(" · ") || "-",
          identityKindLabel: serverLogIdentityKindLabel(identityKind, t),
          identityTone: serverLogIdentityTone(identityKind, Boolean(identity?.resolved)),
          sourceDetail: sourceDetailParts.join(" · ") || "-",
        };
      })
      .sort((left, right) => right.timestampSort - left.timestampSort);
  }, [locale, serverLogs, t]);

  const safeServerLogPage = Math.min(Math.max(serverLogPage, 1), Math.max(1, Math.ceil(serverLogsTotal / serverLogPageSize)));

  const serverLogColumns = useMemo<DataTableColumn<ServerLogRow>[]>(
    () => [
      {
        id: "operation",
        label: t({ en: "Action", fr: "Action", de: "Aktion", zh: "操作" }),
        primary: true,
        cellClassName: "min-w-[16rem] break-words",
        render: (entry) => (
          <div className="min-w-0">
            <div>{entry.operationLabel}</div>
            <div className={cx("mt-1 text-xs font-normal", uiMutedTextClass)}>{entry.operationDetail}</div>
            <div className={cx("mt-1 text-[11px] font-normal", uiMutedTextClass)}>{entry.rawOperation}</div>
          </div>
        ),
      },
      {
        id: "target",
        label: t({ en: "Space / file", fr: "Espace / fichier", de: "Bereich / Datei", zh: "空间 / 文件" }),
        cellClassName: "min-w-[14rem] break-words",
        render: (entry) => (
          <div className="min-w-0">
            <div>{entry.targetLabel}</div>
            <div className={cx("mt-1 text-xs font-normal", uiMutedTextClass)}>{entry.targetDetail}</div>
          </div>
        ),
      },
      {
        id: "identity",
        label: t({ en: "Person or key", fr: "Personne ou clé", de: "Person oder Schlüssel", zh: "人员或密钥" }),
        cellClassName: "min-w-[14rem] break-words",
        render: (entry) => (
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span>{entry.identityLabel}</span>
              <UiBadge tone={entry.identityTone}>{entry.identityKindLabel}</UiBadge>
            </div>
            <div className={cx("mt-1 text-xs font-normal", uiMutedTextClass)}>{entry.identityDetail}</div>
            <div className={cx("mt-1 text-[11px] font-normal", uiMutedTextClass)}>{entry.identityKeyLabel}</div>
          </div>
        ),
      },
      {
        id: "status",
        label: t({ en: "Result", fr: "Résultat", de: "Ergebnis", zh: "结果" }),
        render: (entry) => (
          <div className="min-w-0">
            <UiBadge tone={entry.statusTone}>{entry.statusLabel}</UiBadge>
            <div className={cx("mt-1 text-xs font-normal", uiMutedTextClass)}>{entry.statusDetail}</div>
          </div>
        ),
      },
      {
        id: "source",
        label: t({ en: "Date / source", fr: "Date / source", de: "Datum / Quelle", zh: "日期 / 来源" }),
        cellClassName: "min-w-[14rem] break-words",
        render: (entry) => (
          <div className="min-w-0">
            <div>{entry.timestampLabel}</div>
            <div className={cx("mt-1 text-xs font-normal", uiMutedTextClass)}>{entry.sourceDetail}</div>
          </div>
        ),
      },
    ],
    [t]
  );
  const serverLogsTableStatus = serverLogsLoading
    ? "loading"
    : serverLogsError
      ? "error"
      : !serverLogsLoaded && serverLogRows.length === 0
        ? "empty"
        : serverLogRows.length === 0
          ? "empty"
          : "ready";

  const pageState = resolvePortalWorkspacePageState({
    accountLoading,
    loading: loading || (hasAccountContext && !historyStateReady && !error) || (activeHistoryTab === "activity" && activityLoading),
    accountError,
    error,
    hasAccountContext,
    loadingMessage: t({ en: "Loading history...", fr: "Chargement de l'historique...", de: "Verlauf wird geladen...", zh: "正在加载历史记录…" }),
    noAccountMessage: t({ en: "Select a project to view history.", fr: "Sélectionnez un projet pour voir l'historique.", de: "Wählen Sie ein Projekt aus, um den Verlauf anzuzeigen.", zh: "选择项目以查看历史记录。" }),
  });
  if (pageState) return pageState;

  return (
    <PageShell actionPresentation="listing"
        title={t({ en: "History", fr: "Historique", de: "Verlauf", zh: "历史记录" })}
        description={t({
          en: "Review governance activity in your visible spaces and, for project managers, provider S3 access logs.",
          fr: "Consultez l'activité de gouvernance de vos espaces visibles et, pour les gestionnaires de projet, les journaux d'accès S3 du fournisseur.",
          de: "Prüfen Sie Governance-Aktivitäten in Ihren sichtbaren Bereichen und als Projektmanager die S3-Zugriffsprotokolle des Anbieters.",
          zh: "查看你可见空间的管理活动；项目管理员还可以查看存储服务提供方的 S3 访问日志。",
        })}
        breadcrumbs={portalBreadcrumbs({ label: t({ en: "History", fr: "Historique", de: "Verlauf", zh: "历史记录" }) })}
        actions={[{ label: t({ en: "Open spaces", fr: "Ouvrir les espaces", de: "Bereiche öffnen", zh: "打开空间列表" }), to: "/portal/storage-spaces", variant: "secondary" }]}
    >

      {historyTabs.length > 1 ? (
        <PortalPageTabs
          tabs={historyTabs}
          activeTab={activeHistoryTab}
          onChange={(tab) => selectHistoryTab(tab as HistoryTab)}
          ariaLabel={t({ en: "History views", fr: "Vues de l'historique", de: "Verlaufsansichten", zh: "历史记录视图" })}
          idPrefix="portal-history"
        />
      ) : null}

      <PortalTabPanel idPrefix="portal-history" tabId={activeHistoryTab}>
      {activeHistoryTab === "activity" ? (
        <PortalActivityPanel workspace={workspace} />
      ) : activeHistoryTab === "access" && serverAccessLoggingEnabled && canViewServerAccessLogs ? (
        <ListPageSection variant="page"
          title={t({ en: "Technical access logs", fr: "Journaux d'accès techniques", de: "Technische Zugriffsprotokolle", zh: "技术访问日志" })}
          countLabel={serverLogsLoaded
                ? t({
                    en: `${serverLogRows.length} of ${serverLogsTotal} access events shown`,
                    fr: `${serverLogRows.length} sur ${serverLogsTotal} événements d'accès affichés`,
                    de: `${serverLogRows.length} von ${serverLogsTotal} Zugriffsereignissen angezeigt`,
                    zh: `已显示 ${serverLogsTotal} 条访问事件中的 ${serverLogRows.length} 条`,
                  })
                : serverLogsError
                  ? t({ en: "Logs unavailable", fr: "Journaux indisponibles", de: "Protokolle nicht verfügbar", zh: "日志不可用" })
                  : t({ en: "Loading…", fr: "Chargement…", de: "Wird geladen…", zh: "正在加载…" })}
          filters={<>
            <UiInput label={t({ en: "Go to date", fr: "Aller à la date", de: "Zum Datum", zh: "跳转到日期" })}
              type="date" size="compact" value={serverLogDate} onChange={(event) => setServerDateAndReset(event.target.value)} />
            <UiSelect label={t({ en: "Storage space", fr: "Espace de stockage", de: "Speicherbereich", zh: "存储空间" })}
              size="compact" value={serverLogSpaceId} onChange={(event) => { setServerLogSpaceId(event.target.value); resetServerLogResults(); }}>
              <option value="">{t({ en: "All visible spaces", fr: "Tous les espaces visibles", de: "Alle sichtbaren Bereiche", zh: "所有可见空间" })}</option>
              {storageSpaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
            </UiSelect>
          </>}
          actions={<>
              <ListActionButton variant="secondary" onClick={() => setServerDateAndReset(shiftDateInputValue(serverLogDate, -1))}>
                {t({ en: "Previous day", fr: "Jour précédent", de: "Vortag", zh: "前一天" })}
              </ListActionButton>
              <ListActionButton variant="secondary" onClick={() => setServerDateAndReset(todayDateInputValue())}>
                {t({ en: "Today", fr: "Aujourd'hui", de: "Heute", zh: "今天" })}
              </ListActionButton>
              <ListActionButton variant="secondary" onClick={() => setServerDateAndReset(shiftDateInputValue(serverLogDate, 1))}>
                {t({ en: "Next day", fr: "Jour suivant", de: "Nächster Tag", zh: "后一天" })}
              </ListActionButton>
              <ListActionButton variant="secondary" onClick={openRawLogsModal} disabled={!accountIdForApi}>
                {t({ en: "Export logs", fr: "Exporter les logs", de: "Logs exportieren", zh: "导出日志" })}
              </ListActionButton>
              <ListActionButton
                variant="secondary"
                onClick={() => setShowServerLogAdvancedFilter(true)}
                className={advancedFilterToolbarButtonClass(showServerLogAdvancedFilter || serverLogAdvancedFilterActive)}
              >
                {t({ en: "Advanced filter", fr: "Filtre avancé", de: "Erweiterter Filter", zh: "高级筛选" })}
                {serverLogAdvancedFilterActive ? " · Active" : ""}
              </ListActionButton>
          </>}
          secondaryContent={<><p>{t({
            en: "Use these manager-only provider logs to investigate S3 requests. Delivery may be delayed and depends on logging activation and retention.",
            fr: "Utilisez ces journaux fournisseur réservés aux managers pour examiner les requêtes S3. Leur livraison peut être différée et dépend de l'activation et de la rétention.",
            de: "Untersuchen Sie mit diesen nur für Manager sichtbaren Anbieterprotokollen S3-Anfragen. Die Bereitstellung kann verzögert sein und hängt von Aktivierung und Aufbewahrung ab.",
            zh: "这些来自存储服务提供方的日志仅供管理员排查 S3 请求。日志可能延迟送达，且取决于日志启用状态及保留策略。",
          })}</p>{activeServerLogFilterSummaryItems.length > 0 ? (
            <ActiveFiltersBar
              className="mt-3"
              label={t({ en: "Active filters:", fr: "Filtres actifs :", de: "Aktive Filter:", zh: "当前筛选：" })}
              clearLabel={t({ en: "Clear all", fr: "Tout effacer", de: "Alle löschen", zh: "清除全部" })}
              items={activeServerLogFilterSummaryItems.map((item) => ({
                id: item.id,
                label: item.label,
                onRemove: () => removeServerLogActiveFilterItem(item.remove),
                removeLabel: t({ en: "Remove filter", fr: "Retirer le filtre", de: "Filter entfernen", zh: "移除筛选" }),
              }))}
              onClearAll={resetServerLogAdvancedFilter}
            />
          ) : null}</>}
        >
          {showServerLogAdvancedFilter ? (
            <>
              <AdvancedFilterDrawerShell
                title={t({ en: "Advanced filter", fr: "Filtre avancé", de: "Erweiterter Filter", zh: "高级筛选" })}
                badges={
                  <>
                    {renderAdvancedFilterRuleCountBadge(serverLogAdvancedDraftActiveCount)}
                    <span className={advancedFilterSyncBadgeClass(hasPendingServerLogAdvancedChanges)}>
                      {formatAdvancedFilterSyncLabel(hasPendingServerLogAdvancedChanges)}
                    </span>
                  </>
                }
                closeLabel={t({ en: "Close", fr: "Fermer", de: "Schließen", zh: "关闭" })}
                closeAriaLabel={t({ en: "Close advanced filter drawer", fr: "Fermer le panneau de filtre avancé", de: "Erweiterten Filter schließen", zh: "关闭高级筛选面板" })}
                onClose={serverLogAdvancedFilterCloseGuard.requestClose}
                footer={
                  <div className="flex flex-wrap justify-end gap-2">
                    <UiButton variant="secondary" size="sm" onClick={resetServerLogAdvancedFilter} disabled={!hasAnyServerLogAdvancedToClear}>
                      {t({ en: "Reset", fr: "Réinitialiser", de: "Zurücksetzen", zh: "重置" })}
                    </UiButton>
                    <UiButton size="sm" onClick={applyServerLogAdvancedFilter}>
                      {t({ en: "Apply filter", fr: "Appliquer le filtre", de: "Filter anwenden", zh: "应用筛选" })}
                    </UiButton>
                  </div>
                }
              >
                <div className="space-y-3">
                    {renderAdvancedFilterDraftSummary(serverLogAdvancedDraftSummaryItems)}
                    <section className={advancedFilterSectionClass}>
                      <div className="grid gap-3 md:grid-cols-4">
                        <div className={advancedFilterFieldCardClass()}>
                          <label className={cx(uiLabelClass, actionFieldState.labelClass)} htmlFor="portal-server-log-action-filter">
                            {t({ en: "Action", fr: "Action", de: "Aktion", zh: "操作" })}
                          </label>
                          <select
                            id="portal-server-log-action-filter"
                            value={serverLogAdvancedDraft.action}
                            onChange={(event) => updateServerLogAdvancedField("action", event.target.value as ServerLogActionFilter)}
                            className={advancedFilterControlClass(`mt-2 w-full px-2 py-1.5 ${actionFieldState.fieldClass}`)}
                          >
                            {serverLogActionOptions.map((option) => (
                              <option key={option.value || "any"} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className={advancedFilterFieldCardClass()}>
                          <label className={cx(uiLabelClass, resultFieldState.labelClass)} htmlFor="portal-server-log-result-filter">
                            {t({ en: "Result", fr: "Résultat", de: "Ergebnis", zh: "结果" })}
                          </label>
                          <select
                            id="portal-server-log-result-filter"
                            value={serverLogAdvancedDraft.result}
                            onChange={(event) => updateServerLogAdvancedField("result", event.target.value as ServerLogResultFilter)}
                            className={advancedFilterControlClass(`mt-2 w-full px-2 py-1.5 ${resultFieldState.fieldClass}`)}
                          >
                            {serverLogResultOptions.map((option) => (
                              <option key={option.value || "any"} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <AdvancedFilterTextMatchField
                          className="md:col-span-2"
                          label={t({ en: "Path", fr: "Chemin", de: "Pfad", zh: "路径" })}
                          fieldState={pathFieldState}
                          forcesExact={pathDraftForcesExact}
                          matchMode={pathDraftMode}
                          onChange={(value) => updateServerLogAdvancedField("path", value)}
                          onMatchModeChange={(value) => updateServerLogAdvancedMatchMode("pathMatchMode", value)}
                          containsLabel="~"
                          exactLabel="="
                          containsAriaLabel={t({ en: "Contains", fr: "Contient", de: "Enthält", zh: "包含" })}
                          exactAriaLabel={t({ en: "Exact", fr: "Exact", de: "Exakt", zh: "精确" })}
                          rows={3}
                          value={serverLogAdvancedDraft.path}
                        />
                        <AdvancedFilterTextMatchField
                          className="md:col-span-4"
                          label={t({ en: "Person or key", fr: "Personne ou clé", de: "Person oder Schlüssel", zh: "人员或密钥" })}
                          fieldState={identityFieldState}
                          forcesExact={identityDraftForcesExact}
                          matchMode={identityDraftMode}
                          onChange={(value) => updateServerLogAdvancedField("identity", value)}
                          onMatchModeChange={(value) => updateServerLogAdvancedMatchMode("identityMatchMode", value)}
                          containsLabel="~"
                          exactLabel="="
                          containsAriaLabel={t({ en: "Contains", fr: "Contient", de: "Enthält", zh: "包含" })}
                          exactAriaLabel={t({ en: "Exact", fr: "Exact", de: "Exakt", zh: "精确" })}
                          rows={3}
                          value={serverLogAdvancedDraft.identity}
                        />
                      </div>
                    </section>
                </div>
              </AdvancedFilterDrawerShell>
              {serverLogAdvancedFilterCloseGuard.confirmationDialog}
            </>
          ) : null}
          {serverLogsError && <PageBanner tone="error" className="mt-3">{serverLogsError}</PageBanner>}
          <div>
            <DataTableShell
              columns={serverLogColumns}
              rows={serverLogRows}
              rowKey={(entry) => entry.id}
              status={serverLogsTableStatus}
              loadingMessage={t({ en: "Retrieving access history...", fr: "Récupération de l'historique d'accès...", de: "Zugriffsverlauf wird abgerufen...", zh: "正在获取访问历史…" })}
              errorMessage={serverLogsError ?? t({ en: "Unable to retrieve access history.", fr: "Impossible de récupérer l'historique d'accès.", de: "Zugriffsverlauf kann nicht abgerufen werden.", zh: "无法获取访问历史。" })}
              emptyMessage={
                serverLogsLoaded
                  ? t({ en: "No access event for this selection.", fr: "Aucun événement d'accès pour cette sélection.", de: "Kein Zugriffsereignis für diese Auswahl.", zh: "所选条件下没有访问事件。" })
                  : t({ en: "Access history loads automatically for the selected date.", fr: "L'historique d'accès se charge automatiquement pour la date sélectionnée.", de: "Der Zugriffsverlauf wird automatisch für das ausgewählte Datum geladen.", zh: "将自动加载所选日期的访问历史。" })
              }
              pagination={{
                page: safeServerLogPage,
                pageSize: serverLogPageSize,
                total: serverLogsTotal,
                onPageChange: setServerLogPage,
                onPageSizeChange: (size) => {
                  setServerLogPageSize(size);
                  setServerLogPage(1);
                },
                pageSizeOptions: [10, 25, 50, 100],
                disabled: serverLogsLoading,
              }}
              responsiveCards
            />

          </div>
        </ListPageSection>
      ) : (
        <PortalActivityPanel workspace={workspace} />
      )}
      </PortalTabPanel>

      {rawLogsModalOpen ? (
        <SettingsFormDialog
          title={t({ en: "Export raw access logs", fr: "Exporter les logs d'accès bruts", de: "Rohe Zugriffslogs exportieren", zh: "导出原始访问日志" })}
          onClose={() => setRawLogsModalOpen(false)}
          draftKey={JSON.stringify([rawLogsDateFrom, rawLogsDateTo, rawLogsSpaceId])}
          busy={rawLogsLoading}
          error={rawLogsError}
          disabled={!accountIdForApi}
          onSubmit={handleDownloadRawLogs}
          submitLabel={t({ en: "Download export", fr: "Télécharger l'export", de: "Export herunterladen", zh: "下载导出文件" })}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <UiInput
              label={t({ en: "From", fr: "Du", de: "Von", zh: "开始" })}
              size="compact"
              type="date"
              value={rawLogsDateFrom}
              onChange={(event) => setRawLogsDateFrom(event.target.value)}
            />
            <UiInput
              label={t({ en: "To", fr: "Au", de: "Bis", zh: "结束" })}
              size="compact"
              type="date"
              value={rawLogsDateTo}
              onChange={(event) => setRawLogsDateTo(event.target.value)}
            />
          </div>
          <UiSelect
            label={t({ en: "Storage space", fr: "Espace de stockage", de: "Speicherbereich", zh: "存储空间" })}
            size="compact"
            value={rawLogsSpaceId}
            onChange={(event) => setRawLogsSpaceId(event.target.value)}
          >
            <option value="">{t({ en: "All visible spaces", fr: "Tous les espaces visibles", de: "Alle sichtbaren Bereiche", zh: "所有可见空间" })}</option>
            {storageSpaces.map((space) => (
              <option key={space.id} value={space.id}>{space.name}</option>
            ))}
          </UiSelect>
        </SettingsFormDialog>
      ) : null}
    </PageShell>
  );
}
