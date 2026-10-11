/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback } from "react";
import { useI18n, type I18nMessage } from "../../i18n";

const m = (en: string, fr: string, de: string, zh: string): I18nMessage => ({ en, fr, de, zh });

export const storageEndpointMessages = {
  providerCeph: m("Ceph", "Ceph", "Ceph", "Ceph"),
  providerAws: m("AWS", "AWS", "AWS", "AWS"),
  providerOther: m("Other", "Autre", "Andere", "其他"),
  serviceAdmin: m("Admin", "Administration", "Administration", "管理 API"),
  serviceAccount: m("Account API", "API de compte", "Konto-API", "账户 API"),
  serviceUsage: m("Usage Log", "Journal d’utilisation", "Nutzungsprotokoll", "使用日志"),
  serviceMetrics: m("Metrics", "Métriques", "Metriken", "指标"),
  serviceSns: m("SNS", "SNS", "SNS", "SNS"),
  serviceSts: m("STS", "STS", "STS", "STS"),
  serviceStaticWebsite: m("Static website", "Site statique", "Statische Website", "静态网站"),
  serviceIam: m("IAM", "IAM", "IAM", "IAM"),
  serviceSse: m("SSE", "SSE", "SSE", "SSE"),
  serviceReplication: m("Replication", "Réplication", "Replikation", "复制"),
  serviceHealthcheck: m("Healthcheck", "Contrôle de santé", "Gesundheitsprüfung", "健康检查"),
  search: m("Search {mode}: {query}", "Recherche {mode} : {query}", "Suche {mode}: {query}", "搜索{mode}：{query}"),
  matchContains: m("contains", "contient", "enthält", "包含"),
  matchExact: m("exact", "exact", "exakt", "完全匹配"),
  providerFilter: m("Provider: {provider}", "Fournisseur : {provider}", "Anbieter: {provider}", "提供方：{provider}"),
  endpoint: m("Endpoint", "Point de terminaison", "Endpunkt", "端点"),
  default: m("Default", "Par défaut", "Standard", "默认"),
  envManaged: m("Env managed", "Géré par l’environnement", "Umgebungsverwaltung", "环境管理"),
  protected: m("Protected", "Protégé", "Geschützt", "受保护"),
  provider: m("Provider", "Fournisseur", "Anbieter", "提供方"),
  notSpecified: m("Not specified", "Non spécifié", "Nicht angegeben", "未指定"),
  connection: m("Connection", "Connexion", "Verbindung", "连接"),
  tlsOn: m("TLS verification on", "Vérification TLS activée", "TLS-Prüfung aktiviert", "已启用 TLS 验证"),
  tlsOff: m("TLS verification off", "Vérification TLS désactivée", "TLS-Prüfung deaktiviert", "已关闭 TLS 验证"),
  pathStyle: m("Path style", "Style chemin", "Pfadstil", "路径样式"),
  virtualHostStyle: m("Virtual-host style", "Style hôte virtuel", "Virtual-Host-Stil", "虚拟主机样式"),
  enabledServices: m("Enabled services", "Services activés", "Aktivierte Dienste", "已启用服务"),
  none: m("None", "Aucun", "Keine", "无"),
  noneEnabled: m("None enabled", "Aucun service activé", "Keine aktiviert", "未启用服务"),
  actions: m("Actions", "Actions", "Aktionen", "操作"),
  setting: m("Setting...", "Définition…", "Wird festgelegt…", "正在设置…"),
  setAsDefault: m("Set as default", "Définir par défaut", "Als Standard festlegen", "设为默认"),
  edit: m("Edit", "Modifier", "Bearbeiten", "编辑"),
  view: m("View", "Afficher", "Anzeigen", "查看"),
  delete: m("Delete", "Supprimer", "Löschen", "删除"),
  retry: m("Retry", "Réessayer", "Erneut versuchen", "重试"),
  s3Endpoints: m("S3 Endpoints", "Points de terminaison S3", "S3-Endpunkte", "S3 端点"),
  loadingEndpoints: m("Loading endpoints...", "Chargement des points de terminaison…", "Endpunkte werden geladen…", "正在加载端点…"),
  endpointsUnavailable: m("Endpoints unavailable", "Points de terminaison indisponibles", "Endpunkte nicht verfügbar", "端点不可用"),
  endpointCount: m("{count} endpoint", "{count} point de terminaison", "{count} Endpunkt", "{count} 个端点"),
  endpointCountPlural: m("{count} endpoints", "{count} points de terminaison", "{count} Endpunkte", "{count} 个端点"),
  searchPlaceholder: m("Search name, URL, provider, region or tag", "Rechercher par nom, URL, fournisseur, région ou tag", "Name, URL, Anbieter, Region oder Tag suchen", "搜索名称、URL、提供方、区域或标签"),
  all: m("All", "Tous", "Alle", "全部"),
  loadingError: m("Unable to load endpoints. Use Retry to try again.", "Impossible de charger les points de terminaison. Utilisez Réessayer.", "Endpunkte konnten nicht geladen werden. Verwenden Sie Erneut versuchen.", "无法加载端点。请点击“重试”。"),
  noMatches: m("No endpoints match these filters.", "Aucun point de terminaison ne correspond à ces filtres.", "Keine Endpunkte entsprechen diesen Filtern.", "没有端点符合这些筛选条件。"),
  noConfigured: m("No endpoints configured yet.", "Aucun point de terminaison n’est encore configuré.", "Noch keine Endpunkte konfiguriert.", "尚未配置端点。"),
};

export type StorageEndpointMessageKey = keyof typeof storageEndpointMessages;
export type StorageEndpointText = (key: StorageEndpointMessageKey, values?: Record<string, string | number>) => string;

export function useStorageEndpointI18n() {
  const { t } = useI18n();
  const text: StorageEndpointText = useCallback(
    (key, values) => t(storageEndpointMessages[key]).replace(/\{(\w+)\}/g, (match, name: string) => String(values?.[name] ?? match)),
    [t],
  );
  return { text };
}
