/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback } from "react";
import type { UiLanguage } from "../../components/language";
import { useI18n } from "../../i18n";
import adminDe from "../admin/admin.de.json";
import adminFr from "../admin/admin.fr.json";
import adminZh from "../admin/admin.zh.json";
import browserDe from "../browser/browser.de.json";
import browserFr from "../browser/browser.fr.json";
import browserZh from "../browser/browser.zh.json";
import managerDe from "../manager/manager.de.json";
import managerFr from "../manager/manager.fr.json";
import managerZh from "../manager/manager.zh.json";
import cephAdminDe from "./cephAdmin.de.json";
import cephAdminFr from "./cephAdmin.fr.json";
import cephAdminZh from "./cephAdmin.zh.json";

export type CephAdminTextValues = Record<string, string | number>;

const catalogs = {
  fr: [cephAdminFr, adminFr, managerFr, browserFr],
  de: [cephAdminDe, adminDe, managerDe, browserDe],
  zh: [cephAdminZh, adminZh, managerZh, browserZh],
} as const;

function lookup(message: string, locale: UiLanguage): string | undefined {
  if (locale === "en") return undefined;
  for (const catalog of catalogs[locale]) {
    const translated = (catalog as Record<string, string>)[message];
    if (translated !== undefined) return translated;
  }
  return undefined;
}

function interpolate(message: string, values?: CephAdminTextValues): string {
  if (!values) return message;
  return message.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}

export function cephAdminText(
  message: string,
  locale: UiLanguage = "en",
  values?: CephAdminTextValues,
): string {
  return interpolate(lookup(message, locale) ?? message, values);
}

export function useCephAdminI18n() {
  const { locale } = useI18n();
  const text = useCallback(
    (message: string, values?: CephAdminTextValues) => cephAdminText(message, locale, values),
    [locale],
  );
  return { locale, text };
}
