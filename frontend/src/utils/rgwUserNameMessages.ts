/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { translate, type I18nMessage } from "../i18n";
import type { UiLanguage } from "../components/language";

const messages: Record<string, I18nMessage> = {
  "UID is required.": { en: "UID is required.", fr: "Le UID est obligatoire.", de: "Die UID ist erforderlich.", zh: "必须填写 UID。" },
  "Tenant must contain only ASCII letters, digits or underscores.": { en: "Tenant must contain only ASCII letters, digits or underscores.", fr: "Le tenant doit contenir uniquement des lettres ASCII, des chiffres ou des tirets bas.", de: "Der Tenant darf nur ASCII-Buchstaben, Ziffern oder Unterstriche enthalten.", zh: "租户只能包含 ASCII 字母、数字或下划线。" },
  "Tenant must not be a reserved RGW account ID.": { en: "Tenant must not be a reserved RGW account ID.", fr: "Le tenant ne doit pas être un identifiant de compte RGW réservé.", de: "Der Tenant darf keine reservierte RGW-Konto-ID sein.", zh: "租户不能使用保留的 RGW 账户 ID。" },
  "UID must contain a non-empty user identifier after '$'.": { en: "UID must contain a non-empty user identifier after '$'.", fr: "Le UID doit contenir un identifiant utilisateur non vide après « $ ».", de: "Die UID muss nach '$' eine nicht leere Benutzerkennung enthalten.", zh: "UID 在 '$' 后必须包含非空的用户标识符。" },
  "UID must not be a reserved RGW account ID.": { en: "UID must not be a reserved RGW account ID.", fr: "Le UID ne doit pas être un identifiant de compte RGW réservé.", de: "Die UID darf keine reservierte RGW-Konto-ID sein.", zh: "UID 不能使用保留的 RGW 账户 ID。" },
  "UID 'anonymous' is reserved.": { en: "UID 'anonymous' is reserved.", fr: "Le UID « anonymous » est réservé.", de: "Die UID 'anonymous' ist reserviert.", zh: "UID 'anonymous' 是保留名称。" },
  "UID must be valid UTF-8.": { en: "UID must be valid UTF-8.", fr: "Le UID doit être en UTF-8 valide.", de: "Die UID muss gültiges UTF-8 enthalten.", zh: "UID 必须是有效的 UTF-8。" },
};

export function rgwUserNameErrorText(error: string | undefined, locale: UiLanguage): string | undefined {
  return error ? translate(messages[error] ?? error, locale) : undefined;
}
