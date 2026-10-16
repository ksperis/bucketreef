/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback } from "react";

import { useI18n } from "../../i18n";
import { adminMessage } from "./adminI18n";

const m = (en: string, zh: string) => adminMessage(en, zh);

const adminAssociationMessages = {
  associationTypes: m("Association types", "关联类型"),
  managerRole: m("Manager role", "Manager 角色"),
  portalRole: m("Portal role", "Portal 角色"),
  noResults: m("No results.", "没有结果。"),
  addSelected: m("Add selected", "添加所选项"),
  search: m("Search", "搜索"),
  searchPlaceholder: m("Search...", "搜索…"),
  showingFirstMatches: m(
    "Showing first {count} matches. Use the search box to narrow down the list.",
    "仅显示前 {count} 个匹配项。请使用搜索框缩小列表范围。",
  ),
  selectedCount: m("{count} selected", "已选择 {count} 项"),
  cancel: m("Cancel", "取消"),
  advanced: m("Advanced", "高级设置"),
  advancedSettings: m("Advanced association settings", "高级关联设置"),
  accountAdministratorRequirement: m(
    "This permission is effective only when this same association also has the Account administrator role.",
    "仅当同一关联同时具有账户管理员角色时，此权限才会生效。",
  ),
  rgwUserPermissionAggregation: m(
    "Direct and UI group permissions are aggregated for this RGW user.",
    "此 RGW 用户的直接权限和 UI 用户组权限将合并计算。",
  ),
  allowManagerBrowserDataAccess: m(
    "Allow Manager Browser data access",
    "允许 Manager Browser 数据访问",
  ),
  managerBrowserDataAccessDescription: m(
    "Disabled by default. This permits data-plane Browser operations from the active Manager context.",
    "默认禁用。启用后，当前 Manager 上下文可以执行 Browser 数据面操作。",
  ),
};

type AdminAssociationMessageKey = keyof typeof adminAssociationMessages;

export function useAdminAssociationI18n() {
  const { t } = useI18n();
  const text = useCallback(
    (key: AdminAssociationMessageKey, values?: Record<string, string | number>) =>
      t(adminAssociationMessages[key]).replace(/\{(\w+)\}/g, (match, name: string) =>
        String(values?.[name] ?? match),
      ),
    [t],
  );

  return { text };
}
