/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { describe, expect, it } from "vitest";
import { translate } from "../../i18n";
import { formatPortalCurrency, portalAccountRoleLabel, portalDateLabel } from "./portalI18n";

describe("portal i18n helpers", () => {
  it("translates the requested locale and falls back deterministically", () => {
    expect(translate({ en: "Storage Spaces", fr: "Espaces de stockage", de: "Speicherbereiche" }, "fr")).toBe("Espaces de stockage");
    expect(translate({ fr: "Partages", de: "Freigaben" }, "en")).toBe("Partages");
    expect(translate("Portal", "de")).toBe("Portal");
  });

  it("localizes Portal account roles without English workspace labels in German", () => {
    const translateGerman = (message: Parameters<typeof translate>[0]) => translate(message, "de");

    expect(portalAccountRoleLabel("portal_manager", translateGerman)).toBe("Arbeitsbereichsmanager");
    expect(portalAccountRoleLabel("portal_user", translateGerman)).toBe("Arbeitsbereichsmitglied");
  });
});

describe("Simplified Chinese Portal formatting", () => {
  it("uses translated messages and falls back to English for untranslated messages", () => {
    expect(translate({ en: "Save", zh: "保存" }, "zh")).toBe("保存");
    expect(translate({ en: "New feature", fr: "Nouvelle fonctionnalité" }, "zh")).toBe("New feature");
  });

  it.each(["EUR", "USD", "CNY"])("keeps the configured %s currency in the Chinese locale", currency => {
    const expected = new Intl.NumberFormat("zh-CN", { style: "currency", currency, maximumFractionDigits: 2 }).format(1234.56);
    expect(formatPortalCurrency(1234.56, currency, "zh")).toBe(expected);
  });

  it("formats dates in Simplified Chinese", () => {
    expect(portalDateLabel("2026-09-16T12:00:00Z", "zh", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" })).toBe("2026年9月16日");
  });
});
