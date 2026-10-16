/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback } from "react";
import type { UiLanguage } from "../../components/language";
import { interpolateText, intlLocale, lookupCatalogMessage, useI18n } from "../../i18n";
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

export function adminText(
  message: string,
  locale: UiLanguage = "en",
  values?: AdminTextValues,
): string {
  return interpolateText(lookupCatalogMessage(message, locale, catalogs) ?? message, values);
}

export function adminIntlLocale(locale: UiLanguage): string {
  return intlLocale(locale);
}

export function adminMessage(
  en: string,
  zhFallback?: string,
): { en: string; fr: string; de: string; zh: string } {
  return {
    en,
    fr: lookupCatalogMessage(en, "fr", catalogs) ?? en,
    de: lookupCatalogMessage(en, "de", catalogs) ?? en,
    zh: lookupCatalogMessage(en, "zh", catalogs) ?? zhFallback ?? en,
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

