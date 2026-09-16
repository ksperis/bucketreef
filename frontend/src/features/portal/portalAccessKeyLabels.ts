/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { PortalAccessKey } from "../../api/portalAccessKeys";
import type { useI18n } from "../../i18n";

export function keyTargetLabel(key: PortalAccessKey, t: ReturnType<typeof useI18n>["t"]): string {
  if (key.target_type === "external") {
    return key.external_email || t({ en: "External user", fr: "Utilisateur externe", de: "Externer Benutzer", zh: "外部用户" });
  }
  return t({ en: "Myself", fr: "Moi-même", de: "Ich selbst", zh: "我自己" });
}

export function keyScopeLabel(key: PortalAccessKey, t: ReturnType<typeof useI18n>["t"]): string {
  if (key.target_type === "external") {
    const permission = key.permission === "read_write"
      ? t({ en: "Read/write", fr: "Lecture/écriture", de: "Lesen/Schreiben", zh: "读写" })
      : t({ en: "Read only", fr: "Lecture seule", de: "Nur lesen", zh: "只读" });
    return key.storage_space_name ? `${key.storage_space_name} · ${permission}` : permission;
  }
  return t({ en: "Portal grants", fr: "Droits Portal", de: "Portal-Berechtigungen", zh: "Portal 授权" });
}

function keyPermissionLabel(key: PortalAccessKey, t: ReturnType<typeof useI18n>["t"]): string {
  if (key.permission === "read_write") {
    return t({ en: "Read/write", fr: "Lecture/écriture", de: "Lesen/Schreiben", zh: "读写" });
  }
  return t({ en: "Read only", fr: "Lecture seule", de: "Nur lesen", zh: "只读" });
}

function keyCreatedDateLabel(createdAt: string | null | undefined, locale: string): string | null {
  if (!createdAt) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" }).format(date);
}

export function keyConnectionLabel(
  key: PortalAccessKey,
  locale: string,
  t: ReturnType<typeof useI18n>["t"]
): string {
  if (key.target_type === "external") {
    return [
      key.external_email || t({ en: "External user", fr: "Utilisateur externe", de: "Externer Benutzer", zh: "外部用户" }),
      key.storage_space_name,
      keyPermissionLabel(key, t),
    ].filter(Boolean).join(" · ");
  }
  const createdDate = keyCreatedDateLabel(key.created_at, locale);
  const createdLabel = createdDate
    ? t({ en: `created ${createdDate}`, fr: `créé le ${createdDate}`, de: `erstellt am ${createdDate}`, zh: `创建于 ${createdDate}` })
    : null;
  const suffix = key.access_key_id.length > 4 ? `…${key.access_key_id.slice(-4)}` : key.access_key_id;
  return [keyTargetLabel(key, t), createdLabel, suffix].filter(Boolean).join(" · ");
}
