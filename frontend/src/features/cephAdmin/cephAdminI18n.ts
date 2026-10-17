/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback } from "react";
import type { UiLanguage } from "../../components/language";
import { interpolateText, lookupCatalogMessage, useI18n } from "../../i18n";
import catalogs from "bucketreef-i18n/cephAdmin";

type CephAdminTextValues = Record<string, string | number>;

const CEPH_ADMIN_CATALOGS = {
  fr: [catalogs.fr],
  de: [catalogs.de],
  zh: [catalogs.zh],
} as const;

export function cephAdminText(
  message: string,
  locale: UiLanguage = "en",
  values?: CephAdminTextValues,
): string {
  return interpolateText(lookupCatalogMessage(message, locale, CEPH_ADMIN_CATALOGS) ?? message, values);
}

export function useCephAdminI18n() {
  const { locale } = useI18n();
  const text = useCallback(
    (message: string, values?: CephAdminTextValues) => cephAdminText(message, locale, values),
    [locale],
  );
  return { locale, text };
}
