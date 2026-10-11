/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback } from "react";
import { useI18n, type I18nMessage } from "../i18n";

const m = (en: string, zh: string): I18nMessage => ({ en, zh });
const m4 = (en: string, fr: string, de: string, zh: string): I18nMessage => ({
  en,
  fr,
  de,
  zh,
});

export const shellMessages = {
  unavailableContext: m("Unavailable in current context.", "当前上下文不可用。"),
  navigation: m("Navigation", "导航"),
  navigationAria: m4("{title} navigation", "Navigation {title}", "{title}-Navigation", "{title} 导航"),
  expandSidebar: m4("Expand sidebar", "Développer la barre latérale", "Seitenleiste erweitern", "展开侧边栏"),
  collapseSidebar: m4("Collapse sidebar", "Réduire la barre latérale", "Seitenleiste einklappen", "收起侧边栏"),
  closeMobileNavigation: m("Close mobile navigation", "关闭移动端导航"),
  profile: m4("Profile", "Profil", "Profil", "个人资料"),

  unknown: m("Unknown", "未知"),
  s3Session: m("S3 Session", "S3 会话"),
  superadmin: m("Superadmin", "超级管理员"),
  admin: m("Admin", "管理员"),
  user: m("User", "用户"),
  noAccess: m("No access", "无访问权限"),
  session: m("Session", "会话"),
  openNavigation: m("Open navigation", "打开导航"),
  closeNavigation: m("Close navigation", "关闭导航"),

  accountActionsFor: m4("Account actions for {display}", "Actions du compte pour {display}", "Kontoaktionen für {display}", "账户操作：{display}"),
  accountActions: m4("Account actions", "Actions du compte", "Kontoaktionen", "账户操作"),
  signedInAs: m4("Signed in as", "Connecté en tant que", "Angemeldet als", "登录身份"),
  userProfile: m4("User profile", "Profil utilisateur", "Benutzerprofil", "用户资料"),
  personalDetailsPreferences: m4("Personal details and preferences", "Informations personnelles et préférences", "Persönliche Angaben und Einstellungen", "个人信息与偏好设置"),
  privateS3Connections: m4("Private S3 connections", "Connexions S3 privées", "Private S3-Verbindungen", "私有 S3 连接"),
  manageEndpointsCredentials: m4("Manage your endpoints and credentials", "Gérer vos endpoints et identifiants", "Endpunkte und Zugangsdaten verwalten", "管理你的端点和凭据"),
  signOut: m4("Sign out", "Se déconnecter", "Abmelden", "退出登录"),

  workspace: m4("Workspace", "Espace de travail", "Arbeitsbereich", "工作区"),
  switchWorkspace: m4("Switch workspace", "Changer d’espace de travail", "Arbeitsbereich wechseln", "切换工作区"),

  adminMode: m("Admin mode", "管理员模式"),
  adminShort: m("Admin", "管理员"),
  connectionMode: m("Connection mode", "连接模式"),
  connectionShort: m("Connection", "连接"),
  s3UserMode: m("S3 user mode", "S3 用户模式"),
  s3UserShort: m("S3 user", "S3 用户"),
  sharedConnection: m4("Shared connection", "Connexion partagée", "Freigegebene Verbindung", "共享连接"),
  privateConnection: m4("Private connection", "Connexion privée", "Private Verbindung", "私有连接"),
  s3UserIdentity: m4("S3 user identity", "Identité utilisateur S3", "S3-Benutzeridentität", "S3 用户身份"),
  rgwAccount: m4("RGW account", "Compte RGW", "RGW-Konto", "RGW 账户"),
  selectContextAccount: m4("Select context account", "Sélectionner le compte du contexte", "Kontextkonto auswählen", "选择上下文账户"),
  account: m4("Account", "Compte", "Konto", "账户"),
  currentIamIdentity: m4("Current IAM identity", "Identité IAM actuelle", "Aktuelle IAM-Identität", "当前 IAM 身份"),
  unavailableForContext: m4("Not available for this context", "Non disponible pour ce contexte", "Für diesen Kontext nicht verfügbar", "当前上下文不可用"),
  searchAccounts: m4("Search accounts", "Rechercher des comptes", "Konten durchsuchen", "搜索账户"),
  searchAccountPlaceholder: m4("Search account...", "Rechercher un compte...", "Konto suchen...", "搜索账户…"),
  noAccountMatches: m4("No account matches your search.", "Aucun compte ne correspond à votre recherche.", "Kein Konto entspricht Ihrer Suche.", "没有匹配的账户。"),
  accountContextFor: m4("Account context {label}", "Contexte de compte {label}", "Kontokontext {label}", "账户上下文 {label}"),

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
