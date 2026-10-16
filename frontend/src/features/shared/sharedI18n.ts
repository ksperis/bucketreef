/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback } from "react";
import type { UiLanguage } from "../../components/language";
import { interpolateText, lookupCatalogMessage, useI18n } from "../../i18n";
import adminDe from "../admin/admin.de.json";
import adminFr from "../admin/admin.fr.json";
import adminZh from "../admin/admin.zh.json";
import browserDe from "../browser/browser.de.json";
import browserFr from "../browser/browser.fr.json";
import browserZh from "../browser/browser.zh.json";
import cephAdminDe from "../cephAdmin/cephAdmin.de.json";
import cephAdminFr from "../cephAdmin/cephAdmin.fr.json";
import cephAdminZh from "../cephAdmin/cephAdmin.zh.json";
import managerDe from "../manager/manager.de.json";
import managerFr from "../manager/manager.fr.json";
import managerZh from "../manager/manager.zh.json";
import sharedDe from "./shared.de.json";
import sharedFr from "./shared.fr.json";
import sharedZh from "./shared.zh.json";

export type SharedTextValues = Record<string, string | number>;
export type SharedText = (message: string, values?: SharedTextValues) => string;

const catalogs = {
  fr: [sharedFr, managerFr, browserFr, cephAdminFr, adminFr],
  de: [sharedDe, managerDe, browserDe, cephAdminDe, adminDe],
  zh: [sharedZh, managerZh, browserZh, cephAdminZh, adminZh],
} as const;

function sharedText(
  message: string,
  locale: UiLanguage = "en",
  values?: SharedTextValues,
): string {
  return interpolateText(lookupCatalogMessage(message, locale, catalogs) ?? message, values);
}

export function useSharedI18n() {
  const { locale } = useI18n();
  const text = useCallback(
    (message: string, values?: SharedTextValues) => sharedText(message, locale, values),
    [locale],
  );
  return { locale, text };
}
