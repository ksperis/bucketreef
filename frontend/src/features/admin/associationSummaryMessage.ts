/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback } from "react";
import type { UiLanguage } from "../../components/language";
import { translate, useI18n } from "../../i18n";
import { adminMessage } from "./adminI18n";

const m = (en: string, zh: string) => adminMessage(en, zh);

const associationSummaryMessage = {
  none: m("None", "无"),
  roles: m("Roles", "角色"),
  moreDescription: m("… {count} more", "… 还有 {count} 项"),
  details: m("{label} details", "{label}详情"),
  total: m("{count} total", "共 {count} 项"),
  moreEntry: m("+{count} more entry", "另有 {count} 项"),
  moreEntries: m("+{count} more entries", "另有 {count} 项"),
  accountAdministrator: m("Account administrator", "账户管理员"),
  portalManager: m("Portal manager", "Portal 管理员"),
  portalUser: m("Portal user", "Portal 用户"),
  member: m("Member", "成员"),
  superadmin: m("Superadmin", "超级管理员"),
  admin: m("Admin", "管理员"),
  noUiAccess: m("No UI access", "无 UI 访问权限"),
  user: m("User", "用户"),
  linkedAssociations: m("Linked associations", "关联项"),
  linkedAssociationCount: m("{count} linked association", "{count} 个关联项"),
  linkedAssociationsCount: m("{count} linked associations", "{count} 个关联项"),
  linkedPrincipals: m("Linked principals", "关联主体"),
  linkedPrincipalCount: m("{count} linked principal", "{count} 个关联主体"),
  linkedPrincipalsCount: m("{count} linked principals", "{count} 个关联主体"),
  uiGroup: m("UI group", "UI 用户组"),
  uiUser: m("UI user", "UI 用户"),
  editPrincipal: m("Edit {kind} {label}", "编辑{kind} {label}"),
  categoryCount: m("{count} {category}", "{count} 个{category}"),
};

type AssociationSummaryMessageKey = keyof typeof associationSummaryMessage;

export function associationSummaryText(key: AssociationSummaryMessageKey, locale: UiLanguage = "en", values?: Record<string, string | number>) {
  return translate(associationSummaryMessage[key], locale).replace(/\{(\w+)\}/g, (match, name: string) => String(values?.[name] ?? match));
}

const roleKeys = ["accountAdministrator", "portalManager", "portalUser", "member", "superadmin", "admin", "noUiAccess", "user"] as const;

export function associationSummaryRoleText(role: string, locale: UiLanguage) {
  const key = roleKeys.find(candidate => associationSummaryText(candidate) === role);
  return key ? associationSummaryText(key, locale) : role;
}

export function useAssociationSummaryI18n() {
  const { locale } = useI18n();
  const text = useCallback(
    (key: AssociationSummaryMessageKey, values?: Record<string, string | number>) => associationSummaryText(key, locale, values),
    [locale],
  );
  return { locale, text };
}
