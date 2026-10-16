/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback } from "react";
import { useI18n, type I18nMessage } from "../../i18n";
import { adminMessage } from "./adminI18n";

const m = (en: string, zh: string) => adminMessage(en, zh);

export const adminUserMessage = {
  emailRequired: m("Email is required.", "邮箱为必填项。"),
  invalidEmail: m("Enter a valid email address.", "请输入有效的邮箱地址。"),
  passwordRequired: m("Password is required.", "密码为必填项。"),
  identity: m("Identity", "身份信息"),
  email: m("Email", "邮箱"),
  emailPlaceholder: m("jane.doe@example.com", "jane.doe@example.com"),
  password: m("Password", "密码"),
  fullName: m("Full name", "姓名"),
  namePlaceholder: m("Jane Doe", "张三"),
  role: m("Role", "角色"),
  noAccess: m("No access", "无访问权限"),
  user: m("User", "用户"),
  admin: m("Admin", "管理员"),
  superadmin: m("Superadmin", "超级管理员"),
  restricted: m(" (restricted)", "（受限）"),
  explainRoles: m("Explain role access levels", "解释角色访问级别"),
  aboutRoles: m("About roles", "关于角色"),
  roleSummary: m("Role access summary", "角色访问概览"),
  noAccessSummary: m("No Access", "无访问权限"),
  profileOnly: m("No workspace access (profile only)", "无工作区访问权限（仅可访问个人资料）"),
  nonAdminWorkspaces: m("Non-admin workspaces only", "仅可访问非管理工作区"),
  adminAccess: m("User access + /admin", "用户权限 + /admin"),
  superadminAccess: m("Admin access + /admin settings", "管理员权限 + /admin 设置"),
  dedicatedFlags: m("Ceph Admin and Storage Ops also require dedicated access flags.", "Ceph Admin 和 Storage Ops 还需要专门的访问权限标记。"),
} satisfies Record<string, I18nMessage>;

export type AdminUserMessageKey = keyof typeof adminUserMessage;
export type AdminUserText = (key: AdminUserMessageKey, values?: Record<string, string | number>) => string;

export function useAdminUserI18n() {
  const { locale, t } = useI18n();
  const text: AdminUserText = useCallback(
    (key, values) => t(adminUserMessage[key]).replace(/\{(\w+)\}/g, (match, name: string) => String(values?.[name] ?? match)),
    [t],
  );
  return { locale, text };
}
