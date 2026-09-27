/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, type FormEventHandler } from "react";
import { useI18n, type I18nMessage } from "../../i18n";
import type { UiLanguage } from "../language";

type NativeValidationControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const messages = {
  valueMissing: {
    en: "Complete this field.",
    fr: "Renseignez ce champ.",
    de: "Füllen Sie dieses Feld aus.",
    zh: "请填写此字段。",
  },
  emailMismatch: {
    en: "Enter a valid email address.",
    fr: "Saisissez une adresse e-mail valide.",
    de: "Geben Sie eine gültige E-Mail-Adresse ein.",
    zh: "请输入有效的电子邮件地址。",
  },
  urlMismatch: {
    en: "Enter a valid URL.",
    fr: "Saisissez une URL valide.",
    de: "Geben Sie eine gültige URL ein.",
    zh: "请输入有效的网址。",
  },
  typeMismatch: {
    en: "Enter a value in the expected format.",
    fr: "Saisissez une valeur au format attendu.",
    de: "Geben Sie einen Wert im erwarteten Format ein.",
    zh: "请按要求的格式输入值。",
  },
  patternMismatch: {
    en: "Match the requested format.",
    fr: "Respectez le format demandé.",
    de: "Halten Sie das angeforderte Format ein.",
    zh: "请符合要求的格式。",
  },
  badInput: {
    en: "Enter a valid value.",
    fr: "Saisissez une valeur valide.",
    de: "Geben Sie einen gültigen Wert ein.",
    zh: "请输入有效值。",
  },
  invalid: {
    en: "Check the value in this field.",
    fr: "Vérifiez la valeur de ce champ.",
    de: "Überprüfen Sie den Wert in diesem Feld.",
    zh: "请检查此字段中的值。",
  },
} satisfies Record<string, I18nMessage>;

function translated(message: I18nMessage, locale: UiLanguage): string {
  if (typeof message === "string") return message;
  return message[locale] ?? message.en ?? "";
}

function lengthMessage(kind: "min" | "max", length: number, locale: UiLanguage): string {
  const message: I18nMessage = kind === "min"
    ? {
        en: `Use at least ${length} characters.`,
        fr: `Utilisez au moins ${length} caractères.`,
        de: `Verwenden Sie mindestens ${length} Zeichen.`,
        zh: `请至少输入 ${length} 个字符。`,
      }
    : {
        en: `Use no more than ${length} characters.`,
        fr: `Utilisez au maximum ${length} caractères.`,
        de: `Verwenden Sie höchstens ${length} Zeichen.`,
        zh: `请勿超过 ${length} 个字符。`,
      };
  return translated(message, locale);
}

function rangeMessage(kind: "min" | "max", value: string, locale: UiLanguage): string {
  const message: I18nMessage = kind === "min"
    ? {
        en: `Enter a value greater than or equal to ${value}.`,
        fr: `Saisissez une valeur supérieure ou égale à ${value}.`,
        de: `Geben Sie einen Wert größer oder gleich ${value} ein.`,
        zh: `请输入大于或等于 ${value} 的值。`,
      }
    : {
        en: `Enter a value less than or equal to ${value}.`,
        fr: `Saisissez une valeur inférieure ou égale à ${value}.`,
        de: `Geben Sie einen Wert kleiner oder gleich ${value} ein.`,
        zh: `请输入小于或等于 ${value} 的值。`,
      };
  return translated(message, locale);
}

export function localizedNativeValidationMessage(
  control: NativeValidationControl,
  locale: UiLanguage,
): string {
  const validity = control.validity;
  if (validity.valueMissing) return translated(messages.valueMissing, locale);
  if (validity.typeMismatch) {
    if (control instanceof HTMLInputElement && control.type === "email") {
      return translated(messages.emailMismatch, locale);
    }
    if (control instanceof HTMLInputElement && control.type === "url") {
      return translated(messages.urlMismatch, locale);
    }
    return translated(messages.typeMismatch, locale);
  }
  if (validity.tooShort && "minLength" in control) {
    return lengthMessage("min", control.minLength, locale);
  }
  if (validity.tooLong && "maxLength" in control) {
    return lengthMessage("max", control.maxLength, locale);
  }
  if (validity.rangeUnderflow && control instanceof HTMLInputElement) {
    return rangeMessage("min", control.min, locale);
  }
  if (validity.rangeOverflow && control instanceof HTMLInputElement) {
    return rangeMessage("max", control.max, locale);
  }
  if (validity.patternMismatch) return translated(messages.patternMismatch, locale);
  if (validity.badInput || validity.stepMismatch) return translated(messages.badInput, locale);
  return translated(messages.invalid, locale);
}

export function useLocalizedNativeValidation<T extends NativeValidationControl>(
  onInvalid?: FormEventHandler<T>,
  onInput?: FormEventHandler<T>,
) {
  const { locale } = useI18n();
  const handleInvalid = useCallback<FormEventHandler<T>>((event) => {
    event.currentTarget.setCustomValidity("");
    event.currentTarget.setCustomValidity(
      localizedNativeValidationMessage(event.currentTarget, locale),
    );
    onInvalid?.(event);
  }, [locale, onInvalid]);
  const handleInput = useCallback<FormEventHandler<T>>((event) => {
    event.currentTarget.setCustomValidity("");
    onInput?.(event);
  }, [onInput]);
  return { onInvalid: handleInvalid, onInput: handleInput };
}
