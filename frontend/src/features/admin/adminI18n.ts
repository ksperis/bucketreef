/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback } from "react";
import type { UiLanguage } from "../../components/language";
import { interpolateText, intlLocale, lookupCatalogMessage, useI18n } from "../../i18n";
import catalogs from "bucketreef-i18n/admin";

export type AdminTextValues = Record<string, string | number>;

const ADMIN_CATALOGS = {
  fr: [catalogs.fr],
  de: [catalogs.de],
  zh: [catalogs.zh],
} as const;

export function adminText(
  message: string,
  locale: UiLanguage = "en",
  values?: AdminTextValues,
): string {
  return interpolateText(lookupCatalogMessage(message, locale, ADMIN_CATALOGS) ?? message, values);
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
    fr: lookupCatalogMessage(en, "fr", ADMIN_CATALOGS) ?? en,
    de: lookupCatalogMessage(en, "de", ADMIN_CATALOGS) ?? en,
    zh: lookupCatalogMessage(en, "zh", ADMIN_CATALOGS) ?? zhFallback ?? en,
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

