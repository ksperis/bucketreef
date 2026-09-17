/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { translate, type I18nMessage } from "../../i18n";

export function settingsLabels(t: (message: I18nMessage) => string = translate) {
  return {
    apply: t({ en: "Apply", fr: "Appliquer", de: "Übernehmen", zh: "应用" }),
    cancel: t({ en: "Cancel", fr: "Annuler", de: "Abbrechen", zh: "取消" }),
    close: t({ en: "Close", fr: "Fermer", de: "Schließen", zh: "关闭" }),
    discardTitle: t({
      en: "Discard changes?",
      fr: "Abandonner les modifications ?",
      de: "Änderungen verwerfen?",
      zh: "放弃更改？",
    }),
    discardDescription: t({
      en: "Your changes have not been saved.",
      fr: "Vos modifications n’ont pas été enregistrées.",
      de: "Ihre Änderungen wurden noch nicht gespeichert.",
      zh: "你的更改尚未保存。",
    }),
    discard: t({
      en: "Discard changes",
      fr: "Abandonner",
      de: "Änderungen verwerfen",
      zh: "放弃更改",
    }),
    keepEditing: t({
      en: "Keep editing",
      fr: "Continuer la modification",
      de: "Weiter bearbeiten",
      zh: "继续编辑",
    }),
  };
}
