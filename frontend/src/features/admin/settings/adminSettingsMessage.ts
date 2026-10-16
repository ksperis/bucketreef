/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback } from "react";
import { useI18n } from "../../../i18n";
import { adminMessage } from "../adminI18n";

const m = (en: string, zh: string) => adminMessage(en, zh);

export const adminSettingsMessage = {
  admin: m("Admin", "管理员"),
  general: m("General", "常规"),
  authentication: m("Authentication", "认证"),
  manager: m("Manager", "Manager"),
  browser: m("Browser", "Browser"),
  portal: m("Portal", "Portal"),
  resetToDefaults: m("Reset to defaults", "重置为默认值"),
  demoReadOnly: import.meta.env.MODE === "demo"
    ? m("Read-only demo settings. Feature execution and external integrations are disabled.", "演示设置为只读。功能执行与外部集成已禁用。")
    : "",
  settingsUnavailable: m("Settings are unavailable.", "设置不可用。"),
  loadingSettings: m("Loading settings...", "正在加载设置…"),
  saveChanges: m("Save changes", "保存更改"),
  saving: m("Saving...", "正在保存…"),
  resetDescription: m("Replace this page's draft with application defaults.", "使用应用默认值替换本页草稿。"),
  loadDefaults: m("Load defaults", "加载默认值"),
  defaultsDraftWarning: m("Defaults are loaded into this form only. Review them, then use Save changes to apply them.", "默认值仅加载到本表单中。请检查后点击“保存更改”使其生效。"),
  processing: m("Processing...", "正在处理…"),
  impact: m("Impact", "影响"),
};

export type AdminSettingsMessageKey = keyof typeof adminSettingsMessage;
type AdminSettingsText = (key: AdminSettingsMessageKey, values?: Record<string, string | number>) => string;

export function useAdminSettingsI18n() {
  const { locale, t } = useI18n();
  const text = useCallback<AdminSettingsText>(
    (key, values) => t(adminSettingsMessage[key]).replace(/\{(\w+)\}/g, (match, name: string) => String(values?.[name] ?? match)),
    [t],
  );
  return { locale, t, text };
}
