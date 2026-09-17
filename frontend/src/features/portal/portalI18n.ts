/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { I18nMessage } from "../../i18n";
import type { UiLanguage } from "../../components/language";
import type {
  PortalStorageSpaceVisibility,
} from "../../api/portal";
import type { PortalCollaboratorStorageSpaceAccessSource } from "../../api/portalCollaborators";
import type {
  PortalWorkspaceRole,
  PortalWorkspaceStatus,
} from "./portalWorkspaceModel";

type TFunction = (message: I18nMessage) => string;

function portalIntlLocale(locale: UiLanguage): string {
  if (locale === "fr") return "fr-FR";
  if (locale === "de") return "de-DE";
  if (locale === "zh") return "zh-CN";
  return "en-US";
}

export function portalRoleLabel(role: PortalWorkspaceRole, t: TFunction): string {
  if (role === "Manager") return t({ en: "Manager", fr: "Gestionnaire", de: "Manager", zh: "管理员" });
  if (role === "Owner") return t({ en: "Owner", fr: "Propriétaire", de: "Eigentümer", zh: "所有者" });
  if (role === "Editor") return t({ en: "Editor", fr: "Éditeur", de: "Bearbeiter", zh: "编辑者" });
  return t({ en: "Viewer", fr: "Lecteur", de: "Betrachter", zh: "查看者" });
}

export function portalStatusLabel(status: PortalWorkspaceStatus | "Archived", t: TFunction): string {
  if (status === "Archived") return t({ en: "Archived", fr: "Archivé", de: "Archiviert", zh: "已归档" });
  if (status === "Attention") return t({ en: "Attention", fr: "Attention", de: "Achtung", zh: "需要关注" });
  return t({ en: "Active", fr: "Actif", de: "Aktiv", zh: "活跃" });
}

export function portalShareScopeLabel(
  visibility: PortalStorageSpaceVisibility,
  shareScope: "restricted" | "account",
  t: TFunction,
): string {
  if (visibility !== "shared") {
    return t({ en: "Private", fr: "Privé", de: "Privat", zh: "私有" });
  }
  return shareScope === "account"
    ? t({ en: "Team", fr: "Équipe", de: "Team", zh: "团队" })
    : t({ en: "Selected people", fr: "Personnes choisies", de: "Ausgewählte Personen", zh: "指定人员" });
}

export function portalAccountRoleLabel(role: string | null | undefined, t: TFunction): string {
  if (role === "portal_manager") return t({ en: "Workspace manager", fr: "Gestionnaire d'espace", de: "Workspace-Manager", zh: "工作区管理员" });
  if (role === "portal_user") return t({ en: "Workspace member", fr: "Membre d'espace", de: "Workspace-Mitglied", zh: "工作区成员" });
  return t({ en: "Workspace member", fr: "Membre d'espace", de: "Workspace-Mitglied", zh: "工作区成员" });
}

export function portalAccessSourceLabel(source: string | null | undefined, t: TFunction): string {
  if (source === "direct") return t({ en: "Direct access", fr: "Accès direct", de: "Direkter Zugriff", zh: "直接访问" });
  if (source === "group") return t({ en: "Group access", fr: "Accès par groupe", de: "Gruppenzugriff", zh: "通过组访问" });
  return t({ en: "Direct and group access", fr: "Accès direct et par groupe", de: "Direkter und Gruppenzugriff", zh: "直接及通过组访问" });
}

export function portalCollaboratorSpaceAccessSourceLabel(
  source: PortalCollaboratorStorageSpaceAccessSource,
  t: TFunction,
): string {
  if (source === "direct") return t({ en: "Direct access", fr: "Accès direct", de: "Direkter Zugriff", zh: "直接访问" });
  if (source === "team") return t({ en: "Project team", fr: "Équipe projet", de: "Projektteam", zh: "项目团队" });
  if (source === "owner") return t({ en: "Ownership", fr: "Propriété", de: "Eigentum", zh: "所有权" });
  return t({ en: "Manager role", fr: "Rôle de gestionnaire", de: "Managerrolle", zh: "管理员角色" });
}

export function portalAccessKeyStatusLabel(active: boolean, t: TFunction): string {
  return active ? t({ en: "Active", fr: "Active", de: "Aktiv", zh: "活跃" }) : t({ en: "Inactive", fr: "Inactive", de: "Inaktiv", zh: "未启用" });
}

export function portalPublicLinkStatusLabel(status: string, t: TFunction): string {
  if (status === "Active") return t({ en: "Active", fr: "Actif", de: "Aktiv", zh: "活跃" });
  if (status === "Revoked") return t({ en: "Revoked", fr: "Révoqué", de: "Widerrufen", zh: "已撤销" });
  if (status === "Expired") return t({ en: "Expired", fr: "Expiré", de: "Abgelaufen", zh: "已过期" });
  return status;
}

export function portalSeverityLabel(label: string | null | undefined, t: TFunction): string {
  if (label === "Critical") return t({ en: "Critical", fr: "Critique", de: "Kritisch", zh: "严重" });
  if (label === "Warning") return t({ en: "Warning", fr: "Avertissement", de: "Warnung", zh: "警告" });
  if (label === "Info") return t({ en: "Info", fr: "Info", de: "Info", zh: "信息" });
  return label ?? t({ en: "Info", fr: "Info", de: "Info", zh: "信息" });
}

export function portalActivityActionLabel(action: string, t: TFunction): string {
  const normalized = action.trim().toLowerCase();
  if (normalized === "uploaded") return t({ en: "Uploaded", fr: "A envoyé", de: "Hochgeladen", zh: "已上传" });
  if (normalized === "downloaded") return t({ en: "Downloaded", fr: "A téléchargé", de: "Heruntergeladen", zh: "已下载" });
  if (normalized === "deleted") return t({ en: "Deleted", fr: "A supprimé", de: "Gelöscht", zh: "删除了" });
  if (normalized === "shared") return t({ en: "Shared", fr: "A partagé", de: "Freigegeben", zh: "已共享" });
  if (normalized === "created folder") return t({ en: "Created folder", fr: "A créé un dossier", de: "Ordner erstellt", zh: "创建了文件夹" });
  if (normalized === "created storage space") return t({ en: "Created space", fr: "A créé un espace", de: "Bereich erstellt", zh: "创建了空间" });
  if (normalized === "updated storage space") return t({ en: "Updated space", fr: "A mis à jour un espace", de: "Bereich aktualisiert", zh: "更新了空间" });
  if (normalized === "archived storage space") return t({ en: "Archived space", fr: "A archivé un espace", de: "Bereich archiviert", zh: "归档了空间" });
  if (normalized === "restored storage space") return t({ en: "Restored space", fr: "A restauré un espace", de: "Bereich wiederhergestellt", zh: "恢复了空间" });
  if (normalized === "updated share") return t({ en: "Updated collaborator", fr: "A mis à jour un collaborateur", de: "Mitwirkenden aktualisiert", zh: "更新了协作者" });
  if (normalized === "removed share") return t({ en: "Removed collaborator", fr: "A retiré un collaborateur", de: "Mitwirkenden entfernt", zh: "移除了协作者" });
  if (normalized === "created public link") return t({ en: "Created public link", fr: "A créé un lien public", de: "Öffentlichen Link erstellt", zh: "创建了公开链接" });
  if (normalized === "revoked public link") return t({ en: "Revoked public link", fr: "A révoqué un lien public", de: "Öffentlichen Link widerrufen", zh: "撤销了公开链接" });
  if (normalized === "create portal access key") return t({ en: "Created access key", fr: "A créé une clé d'accès", de: "Zugriffsschlüssel erstellt", zh: "创建了访问密钥" });
  if (normalized === "update portal access key status") return t({ en: "Updated access key status", fr: "A mis à jour le statut d'une clé d'accès", de: "Zugriffsschlüsselstatus aktualisiert", zh: "更新了访问密钥状态" });
  if (normalized === "delete portal access key") return t({ en: "Deleted access key", fr: "A supprimé une clé d'accès", de: "Zugriffsschlüssel gelöscht", zh: "删除了访问密钥" });
  return action;
}

export function portalTrendPeriodLabel(label: string | null | undefined, t: TFunction): string {
  const normalized = (label ?? "").trim().toLowerCase();
  if (normalized === "last 30 days") return t({ en: "last 30 days", fr: "les 30 derniers jours", de: "den letzten 30 Tagen", zh: "最近 30 天" });
  if (normalized === "last week") return t({ en: "last week", fr: "la semaine dernière", de: "der letzten Woche", zh: "上周" });
  if (normalized === "yesterday") return t({ en: "yesterday", fr: "hier", de: "gestern", zh: "昨天" });
  return label ?? "";
}

export function portalTimeAgoLabel(value?: string | null, locale: UiLanguage = "en", t?: TFunction): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const diffMs = Date.now() - parsed.getTime();
  if (diffMs < 60_000) return t?.({ en: "Now", fr: "Maintenant", de: "Jetzt", zh: "现在" }) ?? "Now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return t?.({ en: `${minutes}m ago`, fr: `il y a ${minutes} min`, de: `vor ${minutes} Min.`, zh: `${minutes} 分钟前` }) ?? `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t?.({ en: `${hours}h ago`, fr: `il y a ${hours} h`, de: `vor ${hours} Std.`, zh: `${hours} 小时前` }) ?? `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return t?.({ en: `${days}d ago`, fr: `il y a ${days} j`, de: `vor ${days} Tg.`, zh: `${days} 天前` }) ?? `${days}d ago`;
  return parsed.toLocaleDateString(portalIntlLocale(locale), { month: "short", day: "numeric" });
}

export function portalDateLabel(
  value?: string | null,
  locale: UiLanguage = "en",
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" },
): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(portalIntlLocale(locale), options);
}

export function portalDateTimeLabel(value?: string | null, locale: UiLanguage = "en"): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(portalIntlLocale(locale), {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatPortalCurrency(value: number | null | undefined, currency: string | null | undefined, locale: UiLanguage): string {
  if (value == null) return "-";
  try {
    return new Intl.NumberFormat(portalIntlLocale(locale), {
      style: "currency",
      currency: currency || "EUR",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency || "EUR"}`;
  }
}
