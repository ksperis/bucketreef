/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback } from "react";
import { useI18n, type I18nMessage } from "../i18n";

const m = (en: string, zh: string): I18nMessage => ({ en, zh });

export const shellMessages = {
  unavailableContext: m("Unavailable in current context.", "当前上下文不可用。"),
  navigation: m("Navigation", "导航"),
  navigationAria: m("{title} navigation", "{title} 导航"),
  expandSidebar: m("Expand sidebar", "展开侧边栏"),
  collapseSidebar: m("Collapse sidebar", "收起侧边栏"),
  closeMobileNavigation: m("Close mobile navigation", "关闭移动端导航"),
  profile: m("Profile", "个人资料"),

  unknown: m("Unknown", "未知"),
  s3Session: m("S3 Session", "S3 会话"),
  superadmin: m("Superadmin", "超级管理员"),
  admin: m("Admin", "管理员"),
  user: m("User", "用户"),
  noAccess: m("No access", "无访问权限"),
  session: m("Session", "会话"),
  openNavigation: m("Open navigation", "打开导航"),
  closeNavigation: m("Close navigation", "关闭导航"),

  accountActionsFor: m("Account actions for {display}", "账户操作：{display}"),
  accountActions: m("Account actions", "账户操作"),
  signedInAs: m("Signed in as", "登录身份"),
  userProfile: m("User profile", "用户资料"),
  personalDetailsPreferences: m("Personal details and preferences", "个人信息与偏好设置"),
  privateS3Connections: m("Private S3 connections", "私有 S3 连接"),
  manageEndpointsCredentials: m("Manage your endpoints and credentials", "管理你的端点和凭据"),
  signOut: m("Sign out", "退出登录"),

  workspace: m("Workspace", "工作区"),
  switchWorkspace: m("Switch workspace", "切换工作区"),

  adminMode: m("Admin mode", "管理员模式"),
  adminShort: m("Admin", "管理员"),
  connectionMode: m("Connection mode", "连接模式"),
  connectionShort: m("Connection", "连接"),
  s3UserMode: m("S3 user mode", "S3 用户模式"),
  s3UserShort: m("S3 user", "S3 用户"),
  sharedConnection: m("Shared connection", "共享连接"),
  privateConnection: m("Private connection", "私有连接"),
  s3UserIdentity: m("S3 user identity", "S3 用户身份"),
  rgwAccount: m("RGW account", "RGW 账户"),
  selectContextAccount: m("Select context account", "选择上下文账户"),
  account: m("Account", "账户"),
  currentIamIdentity: m("Current IAM identity", "当前 IAM 身份"),
  unavailableForContext: m("Not available for this context", "当前上下文不可用"),
  searchAccounts: m("Search accounts", "搜索账户"),
  searchAccountPlaceholder: m("Search account...", "搜索账户…"),
  noAccountMatches: m("No account matches your search.", "没有匹配的账户。"),
  accountContextFor: m("Account context {label}", "账户上下文 {label}"),

  switchToLightTheme: {
    en: "Switch to light theme",
    fr: "Passer au thème clair",
    de: "Zum hellen Design wechseln",
    zh: "切换到浅色主题",
  },
  switchToDarkTheme: {
    en: "Switch to dark theme",
    fr: "Passer au thème sombre",
    de: "Zum dunklen Design wechseln",
    zh: "切换到深色主题",
  },
  documentation: {
    en: "Documentation",
    fr: "Documentation",
    de: "Dokumentation",
    zh: "文档",
  },
  openWorkspaceDocumentation: {
    en: "Open workspace documentation",
    fr: "Ouvrir la documentation de cet espace",
    de: "Dokumentation dieses Arbeitsbereichs öffnen",
    zh: "打开此工作区的文档",
  },
} as const;

export type ShellMessageKey = keyof typeof shellMessages;
export type ShellText = (key: ShellMessageKey, values?: Record<string, string | number>) => string;

export function useShellI18n() {
  const { t, locale } = useI18n();
  const text: ShellText = useCallback(
    (key, values) =>
      t(shellMessages[key]).replace(/\{(\w+)\}/g, (match, name: string) => String(values?.[name] ?? match)),
    [t],
  );
  return { text, locale };
}
