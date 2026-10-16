/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback } from "react";
import type { UiLanguage } from "../../components/language";
import { interpolateText, intlLocale, lookupCatalogMessage, useI18n } from "../../i18n";
import browserDe from "./browser.de.json";
import browserFr from "./browser.fr.json";
import browserZh from "./browser.zh.json";

export type BrowserTextValues = Record<string, string | number>;
export type BrowserTextFn = (message: string, values?: BrowserTextValues) => string;

const BROWSER_CATALOGS = {
  fr: [browserFr],
  de: [browserDe],
  zh: [browserZh],
} as const;

export function browserText(
  message: string,
  locale: UiLanguage = "en",
  values?: BrowserTextValues,
): string {
  return interpolateText(lookupCatalogMessage(message, locale, BROWSER_CATALOGS) ?? message, values);
}

export const defaultBrowserText: BrowserTextFn = (message, values) => browserText(message, "en", values);

export function browserIntlLocale(locale: UiLanguage): string {
  return intlLocale(locale);
}

export function useBrowserI18n() {
  const { locale } = useI18n();
  const text = useCallback<BrowserTextFn>(
    (message, values) => browserText(message, locale, values),
    [locale],
  );

  return {
    locale,
    intlLocale: browserIntlLocale(locale),
    text,
  };
}
