/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback } from "react";
import type { UiLanguage } from "../../components/language";
import { interpolateText, lookupCatalogMessage, useI18n } from "../../i18n";
import catalogs from "bucketreef-i18n/shared";

export type SharedTextValues = Record<string, string | number>;
export type SharedText = (message: string, values?: SharedTextValues) => string;

const SHARED_CATALOGS = {
  fr: [catalogs.fr],
  de: [catalogs.de],
  zh: [catalogs.zh],
} as const;

function sharedText(
  message: string,
  locale: UiLanguage = "en",
  values?: SharedTextValues,
): string {
  return interpolateText(lookupCatalogMessage(message, locale, SHARED_CATALOGS) ?? message, values);
}

export function sharedMessage(
  en: string,
  zhFallback?: string,
): { en: string; fr: string; de: string; zh: string } {
  return {
    en,
    fr: lookupCatalogMessage(en, "fr", SHARED_CATALOGS) ?? en,
    de: lookupCatalogMessage(en, "de", SHARED_CATALOGS) ?? en,
    zh: lookupCatalogMessage(en, "zh", SHARED_CATALOGS) ?? zhFallback ?? en,
  };
}

export function useSharedI18n() {
  const { locale } = useI18n();
  const text = useCallback(
    (message: string, values?: SharedTextValues) => sharedText(message, locale, values),
    [locale],
  );
  return { locale, text };
}
