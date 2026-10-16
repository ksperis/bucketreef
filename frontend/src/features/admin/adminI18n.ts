/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback } from "react";
import type { UiLanguage } from "../../components/language";
import { useI18n } from "../../i18n";
import browserDe from "../browser/browser.de.json";
import browserFr from "../browser/browser.fr.json";
import browserZh from "../browser/browser.zh.json";
import managerDe from "../manager/manager.de.json";
import managerFr from "../manager/manager.fr.json";
import managerZh from "../manager/manager.zh.json";
import adminDe from "./admin.de.json";
import adminFr from "./admin.fr.json";
import adminZh from "./admin.zh.json";

export type AdminTextValues = Record<string, string | number>;

const catalogs = {
  fr: [adminFr, managerFr, browserFr],
  de: [adminDe, managerDe, browserDe],
  zh: [adminZh, managerZh, browserZh],
} as const;

function lookup(message: string, locale: UiLanguage): string | undefined {
  if (locale === "en") return undefined;
  for (const catalog of catalogs[locale]) {
    const translated = (catalog as Record<string, string>)[message];
    if (translated !== undefined) return translated;
  }
  return undefined;
}

function interpolate(message: string, values?: AdminTextValues): string {
  if (!values) return message;
  return message.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}

export function adminText(
  message: string,
  locale: UiLanguage = "en",
  values?: AdminTextValues,
): string {
  return interpolate(lookup(message, locale) ?? message, values);
}

export function adminIntlLocale(locale: UiLanguage): string {
  if (locale === "fr") return "fr-FR";
  if (locale === "de") return "de-DE";
  if (locale === "zh") return "zh-CN";
  return "en-US";
}

export function adminMessage(
  en: string,
  zhFallback?: string,
): { en: string; fr: string; de: string; zh: string } {
  return {
    en,
    fr: lookup(en, "fr") ?? en,
    de: lookup(en, "de") ?? en,
    zh: lookup(en, "zh") ?? zhFallback ?? en,
  };
}

export function useAdminI18n() {
  const { locale } = useI18n();
  const text = useCallback(
    (message: string, values?: AdminTextValues) => adminText(message, locale, values),
    [locale],
  );
  return {
    locale,
    intlLocale: adminIntlLocale(locale),
    text,
  };
}

