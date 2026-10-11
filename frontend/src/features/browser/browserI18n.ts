/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback } from "react";
import type { UiLanguage } from "../../components/language";
import { useI18n } from "../../i18n";
import browserDe from "./browser.de.json";
import browserFr from "./browser.fr.json";
import browserZh from "./browser.zh.json";

export type BrowserTextValues = Record<string, string | number>;
export type BrowserTextFn = (message: string, values?: BrowserTextValues) => string;

const BROWSER_CATALOGS: Partial<Record<UiLanguage, Record<string, string>>> = {
  fr: browserFr,
  de: browserDe,
  zh: browserZh,
};

function interpolate(message: string, values?: BrowserTextValues): string {
  if (!values) return message;
  return message.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}

export function browserText(
  message: string,
  locale: UiLanguage = "en",
  values?: BrowserTextValues,
): string {
  const translated = BROWSER_CATALOGS[locale]?.[message] ?? message;
  return interpolate(translated, values);
}

export function browserIntlLocale(locale: UiLanguage): string {
  if (locale === "fr") return "fr-FR";
  if (locale === "de") return "de-DE";
  if (locale === "zh") return "zh-CN";
  return "en-US";
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
