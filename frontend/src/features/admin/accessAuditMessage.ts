/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback } from "react";
import type { AccessAuditRightCode, AccessAuditScope } from "../../api/accessAudit";
import { interpolateText, useI18n, type I18nMessage } from "../../i18n";
import { adminMessage } from "./adminI18n";

const m = (en: string, zh: string) => adminMessage(en, zh);

const accessAuditMessage = {
  admin: m("Admin", "管理员"),
  accessAudit: m("Access audit", "访问权限审计"),
  title: m("Effective access audit", "有效访问权限审计"),
  description: m("Review saved BucketReef permissions after direct and UI Group grants are combined.", "查看合并直接授权与 UI 用户组授权后的已保存 BucketReef 权限。"),
  loadError: m("Unable to load effective access audit.", "无法加载有效访问权限审计。"),
  exportError: m("Unable to export effective access audit.", "无法导出有效访问权限审计。"),
  entryCount: m("{count} entry", "{count} 条记录"),
  entriesCount: m("{count} entries", "{count} 条记录"),
  searchAccess: m("Search effective access", "搜索有效访问权限"),
  searchPlaceholder: m("Search users, targets, rights, or groups", "搜索用户、目标、权限或用户组"),
  scope: m("Scope", "范围"),
  filterScope: m("Filter by scope", "按范围筛选"),
  allScopes: m("All scopes", "所有范围"),
  right: m("Right", "权限"),
  filterRight: m("Filter by right", "按权限筛选"),
  allRights: m("All rights", "所有权限"),
  source: m("Source", "来源"),
  filterSource: m("Filter by source", "按来源筛选"),
  allSources: m("All sources", "所有来源"),
  direct: m("Direct", "直接授权"),
  uiGroup: m("UI Group", "UI 用户组"),
  uiUser: m("UI User", "UI 用户"),
  uiUserContext: m("UI User: {name}", "UI 用户：{name}"),
  uiGroupContext: m("UI Group: {name}", "UI 用户组：{name}"),
  uiGroupNumber: m("UI Group #{id}", "UI 用户组 #{id}"),
  target: m("Target", "目标"),
  targetContext: m("{scope}: {name}", "{scope}：{name}"),
  contextFilter: m("Context filter: {context}", "上下文筛选：{context}"),
  clearContext: m("Clear context", "清除上下文"),
  exportCsv: m("Export CSV", "导出 CSV"),
  noMatchingAccess: m("No effective access matches the current filters.", "没有符合当前筛选条件的有效访问权限。"),
  noGrantedRights: m("No effective BucketReef rights are currently granted.", "当前没有已授予的有效 BucketReef 权限。"),
  inactive: m("Inactive", "已停用"),
  effectiveRights: m("Effective rights", "有效权限"),
  effectiveRightCount: m("{count} effective right", "{count} 项有效权限"),
  effectiveRightsCount: m("{count} effective rights", "{count} 项有效权限"),
  sources: m("Sources", "来源"),
  loadingAccess: m("Loading effective access...", "正在加载有效访问权限…"),
  loadAccessError: m("Unable to load effective access.", "无法加载有效访问权限。"),
  platform: m("Platform", "平台"),
  rgwAccount: m("RGW Account", "RGW 账户"),
  rgwUser: m("RGW User", "RGW 用户"),
  s3Connection: m("S3 Connection", "S3 连接"),
  cephAdmin: m("Ceph Admin", "Ceph 管理"),
  storageOps: m("Storage Ops", "存储运维"),
  managerBucketCompare: m("Manager · Bucket compare", "Manager · 存储桶比较"),
  managerIntegrityCheck: m("Manager · Integrity check", "Manager · 完整性检查"),
  managerBucketMigration: m("Manager · Bucket migration", "Manager · 存储桶迁移"),
  managerFeatureRules: m("Manager · Feature rules", "Manager · 功能规则"),
  managerBucketPurge: m("Manager · Bucket purge", "Manager · 清空存储桶"),
  privateConnectionCreate: m("Create manual private connections", "创建手动私有连接"),
  managedPrivateConnectionProvision: m("Provision managed private connections", "预配托管私有连接"),
  browserAdvancedFeatures: m("Browser advanced features", "Browser 高级功能"),
  accountAdministrator: m("Account administrator", "账户管理员"),
  portalManager: m("Portal manager", "Portal 管理员"),
  portalUser: m("Portal user", "Portal 用户"),
  managerBrowserDataAccess: m("Manager Browser data access", "Manager Browser 数据访问"),
  rgwUserAccess: m("RGW user access", "RGW 用户访问"),
  sharedConnectionAccess: m("S3 connection access", "S3 连接访问"),
} satisfies Record<string, I18nMessage>;

type AccessAuditMessageKey = keyof typeof accessAuditMessage;
export type AccessAuditText = (key: AccessAuditMessageKey, values?: Record<string, string | number>) => string;

const scopeMessageKeys: Record<AccessAuditScope, AccessAuditMessageKey> = {
  platform: "platform",
  rgw_account: "rgwAccount",
  rgw_user: "rgwUser",
  s3_connection: "s3Connection",
};

const rightMessageKeys: Record<AccessAuditRightCode, AccessAuditMessageKey> = {
  ceph_admin: "cephAdmin",
  storage_ops: "storageOps",
  manager_bucket_compare: "managerBucketCompare",
  manager_bucket_integrity_check: "managerIntegrityCheck",
  manager_bucket_migration: "managerBucketMigration",
  manager_feature_rules: "managerFeatureRules",
  manager_bucket_purge: "managerBucketPurge",
  private_connection_create: "privateConnectionCreate",
  managed_private_connection_provision: "managedPrivateConnectionProvision",
  browser_advanced_features: "browserAdvancedFeatures",
  account_administrator: "accountAdministrator",
  portal_manager: "portalManager",
  portal_user: "portalUser",
  manager_browser_data_access: "managerBrowserDataAccess",
  rgw_user_access: "rgwUserAccess",
  shared_connection_access: "sharedConnectionAccess",
};

export function useAccessAuditI18n() {
  const { t } = useI18n();
  const text = useCallback<AccessAuditText>(
    (key, values) => interpolateText(t(accessAuditMessage[key]), values),
    [t],
  );
  const scopeLabel = useCallback((scope: AccessAuditScope, fallback?: string) => {
    const key = Object.hasOwn(scopeMessageKeys, scope) ? scopeMessageKeys[scope] : undefined;
    if (key) return text(key);
    return fallback ?? scope;
  }, [text]);
  const rightLabel = useCallback((code: AccessAuditRightCode, fallback: string) => {
    const key = Object.hasOwn(rightMessageKeys, code) ? rightMessageKeys[code] : undefined;
    return key ? text(key) : fallback;
  }, [text]);
  return { text, scopeLabel, rightLabel };
}
