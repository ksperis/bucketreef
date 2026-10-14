/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback } from "react";
import { useI18n, type I18nMessage } from "../../i18n";

const m = (en: string, zh: string) => ({ en, zh });

const auditLogsMessage = {
  title: m("Audit trail", "操作审计日志"),
  description: m("Control-plane and security events. Object operations belong in provider S3 access logs.", "记录控制面和安全事件。对象操作应在存储服务的 S3 访问日志中查看。"),
  adminBreadcrumb: m("Admin", "管理员"),
  allActors: m("All actors", "所有操作人"),
  superadmin: m("Superadmin", "超级管理员"),
  admin: m("Admin", "管理员"),
  user: m("User", "用户"),
  noAccess: m("No access", "无访问权限"),
  allScopes: m("All scopes", "所有范围"),
  adminArea: m("Admin area", "管理区域"),
  managerArea: m("Manager area", "Manager 区域"),
  portalArea: m("Portal area", "Portal 区域"),
  adminUi: m("Admin UI", "管理界面"),
  managerUi: m("Manager UI", "Manager 界面"),
  portalUi: m("Portal UI", "Portal 界面"),
  success: m("Success", "成功"),
  failure: m("Failure", "失败"),
  failed: m("Failed", "失败"),
  error: m("Error", "错误"),
  loadError: m("Unable to load audit logs.", "无法加载操作审计日志。"),
  refreshError: m("Unable to refresh audit logs.", "无法刷新操作审计日志。"),
  olderError: m("Unable to load older logs.", "无法加载较早的日志。"),
  action: m("Action", "操作"),
  filterByAction: m("Filter by action", "按操作筛选"),
  allActions: m("All actions", "所有操作"),
  status: m("Status", "状态"),
  filterByStatus: m("Filter by status", "按状态筛选"),
  allStatuses: m("All statuses", "所有状态"),
  role: m("Role", "角色"),
  filterByRole: m("Filter by actor role", "按操作人角色筛选"),
  workspace: m("Workspace", "工作区"),
  filterByScope: m("Filter by workspace scope", "按工作区范围筛选"),
  time: m("Time", "时间"),
  actor: m("Actor", "操作人"),
  scope: m("Scope", "范围"),
  target: m("Target", "目标"),
  account: m("S3 Account/User", "S3 账号/用户"),
  accountFallback: m("S3Account #{id}", "S3 账号 #{id}"),
  executionContext: m("Execution context", "执行上下文"),
  rgwAccount: m("RGW Account", "RGW 账户"),
  rgwUser: m("RGW User", "RGW 用户"),
  s3Connection: m("S3 Connection", "S3 连接"),
  cephAdmin: m("Ceph Admin", "Ceph 管理"),
  managerSession: m("Manager session", "Manager 会话"),
  details: m("Details", "详情"),
  loadedCount: m("{filtered} of {total} loaded entries", "已加载 {total} 条记录，当前显示 {filtered} 条"),
  search: m("Search audit logs", "搜索操作审计日志"),
  searchPlaceholder: m("Search actor, action, target, context, or message", "搜索操作人、操作、目标、上下文或消息"),
  refreshing: m("Refreshing…", "正在刷新…"),
  refresh: m("Refresh", "刷新"),
  filterHelp: m("Action and status filters apply to loaded entries. Load older entries to extend the results.", "操作和状态筛选仅应用于已加载的记录。加载较早的记录可扩大结果范围。"),
  loadingAudit: m("Loading audit data...", "正在加载审计数据…"),
  noEntries: m("No audit entries.", "没有审计记录。"),
  noMatches: m("No audit entries match the current filters.", "没有符合当前筛选条件的审计记录。"),
  loading: m("Loading…", "正在加载…"),
  loadOlder: m("Load older", "加载较早的记录"),
  noMore: m("No more", "没有更多记录"),
} satisfies Record<string, I18nMessage>;

type AuditLogsMessageKey = keyof typeof auditLogsMessage;
export type AuditLogsText = (key: AuditLogsMessageKey, values?: Record<string, string | number>) => string;

export function useAuditLogsI18n() {
  const { locale, t } = useI18n();
  const text: AuditLogsText = useCallback(
    (key, values) => t(auditLogsMessage[key]).replace(/\{(\w+)\}/g, (match, name: string) => String(values?.[name] ?? match)),
    [t],
  );
  return { locale, text };
}
