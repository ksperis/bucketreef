/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback } from "react";
import { translate, useI18n, type I18nMessage } from "../../../i18n";
import { adminMessage } from "../adminI18n";

const m = (en: string, zh: string) => adminMessage(en, zh);

const appSettingsMessage = {
  loadError: m("Unable to load settings.", "无法加载设置。"),
  saveError: m("Unable to save settings.", "无法保存设置。"),
  defaultsError: m("Unable to load default settings.", "无法加载默认设置。"),
  saved: m("Settings saved.", "设置已保存。"),
  scopeError: m("Setting is outside this page's scope.", "此设置不在当前页面的范围内。"),
  fieldConflict: m("Changed on the server. Cancel to load the current value.", "服务器上的值已更改。取消更改可加载当前值。"),
  settingsConflict: m(
    "These settings changed on the server. Cancel to load their current values, or review your changes before trying again.",
    "这些设置在服务器上已更改。请取消更改以加载当前值，或检查你的更改后再重试。",
  ),
  experimental: m("Experimental", "实验性"),
  integerMinimum: m("{label} must be a whole number of at least {min}.", "{label}必须是大于或等于 {min} 的整数。"),
  integerRange: m("{label} must be a whole number between {min} and {max}.", "{label}必须是 {min} 到 {max} 之间的整数。"),
  verifyPasskey: m("Verify with passkey", "使用通行密钥验证"),
  verificationDescription: m(
    "Confirm your identity to continue this sensitive action in the current session.",
    "请确认你的身份，以在当前会话中继续此敏感操作。",
  ),
  cancel: m("Cancel", "取消"),
  close: m("Close", "关闭"),
  verificationCancelled: m(
    "Passkey verification was cancelled or timed out. Please try again.",
    "通行密钥验证已取消或超时，请重试。",
  ),
  verificationFailed: m("Passkey verification failed. Please try again.", "通行密钥验证失败，请重试。"),
} satisfies Record<string, I18nMessage>;

export type AppSettingsMessageKey = keyof typeof appSettingsMessage;
export type AppSettingsText = (key: AppSettingsMessageKey, values?: Record<string, string | number>) => string;

function interpolate(message: string, values?: Record<string, string | number>): string {
  return message.replace(/\{(\w+)\}/g, (match, name: string) => String(values?.[name] ?? match));
}

/** Pure utilities retain their English default without reading UI language state. */
export const appSettingsSource: AppSettingsText = (key, values) =>
  interpolate(translate(appSettingsMessage[key], "en"), values);

export function useAppSettingsI18n() {
  const { locale, t } = useI18n();
  const text: AppSettingsText = useCallback(
    (key, values) => interpolate(t(appSettingsMessage[key]), values),
    [t],
  );
  return { locale, text };
}
