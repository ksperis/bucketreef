/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback } from "react";
import type { UiLanguage } from "../../components/language";
import { interpolateText, intlLocale, lookupCatalogMessage, useI18n } from "../../i18n";
import managerDe from "./manager.de.json";
import managerFr from "./manager.fr.json";
import managerZh from "./manager.zh.json";

export type ManagerTextValues = Record<string, string | number>;

const MANAGER_CATALOGS = {
  fr: [managerFr],
  de: [managerDe],
  zh: [managerZh],
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
