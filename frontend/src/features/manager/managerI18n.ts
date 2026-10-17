/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback } from "react";
import type { UiLanguage } from "../../components/language";
import { interpolateText, intlLocale, lookupCatalogMessage, useI18n } from "../../i18n";
import catalogs from "bucketreef-i18n/manager";

export type ManagerTextValues = Record<string, string | number>;

const MANAGER_CATALOGS = {
  fr: [catalogs.fr],
  de: [catalogs.de],
  zh: [catalogs.zh],
} as const;

export function managerText(
  message: string,
  locale: UiLanguage = "en",
  values?: ManagerTextValues,
): string {
  return interpolateText(lookupCatalogMessage(message, locale, MANAGER_CATALOGS) ?? message, values);
}

export function managerIntlLocale(locale: UiLanguage): string {
  return intlLocale(locale);
}

export function useManagerI18n() {
  const { locale } = useI18n();
  const text = useCallback(
    (message: string, values?: ManagerTextValues) => managerText(message, locale, values),
    [locale],
  );

  return {
    locale,
    intlLocale: managerIntlLocale(locale),
    text,
  };
}
