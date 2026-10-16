/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback } from "react";
import { useOptionalLanguage, type UiLanguage } from "./components/language";

export type I18nMessage = string | { en?: string; fr?: string; de?: string; zh?: string };

type TextValues = Record<string, string | number>;
type TranslationCatalog = Readonly<Record<string, string>>;
type CatalogsByLanguage = Partial<Record<UiLanguage, readonly TranslationCatalog[]>>;

export function translate(message: I18nMessage, locale: UiLanguage = "en"): string {
  if (typeof message === "string") return message;
  return message[locale] ?? message.en ?? message.fr ?? message.de ?? message.zh ?? "";
}

export function interpolateText(message: string, values?: TextValues): string {
  if (!values) return message;
  return message.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}

export function lookupCatalogMessage(
  message: string,
  locale: UiLanguage,
  catalogs: CatalogsByLanguage,
): string | undefined {
  if (locale === "en") return undefined;
  for (const catalog of catalogs[locale] ?? []) {
    const translated = catalog[message];
    if (translated !== undefined) return translated;
  }
  return undefined;
}

export function intlLocale(locale: UiLanguage): string {
  if (locale === "fr") return "fr-FR";
  if (locale === "de") return "de-DE";
  if (locale === "zh") return "zh-CN";
  return "en-US";
}

export function useI18n() {
  const languageContext = useOptionalLanguage();
  const locale = languageContext?.language ?? "en";
  const t = useCallback((message: I18nMessage) => translate(message, locale), [locale]);

  return {
    locale,
    t,
  };
}
