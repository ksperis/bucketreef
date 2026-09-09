/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { translate, type I18nMessage } from "../../i18n";

export function settingsLabels(t: (message: I18nMessage) => string = translate) {
  return {
    apply: t({ en: "Apply", fr: "Appliquer", de: "Übernehmen" }),
    cancel: t({ en: "Cancel", fr: "Annuler", de: "Abbrechen" }),
    close: t({ en: "Close", fr: "Fermer", de: "Schließen" }),
    discardTitle: t({
      en: "Discard changes?",
      fr: "Abandonner les modifications ?",
      de: "Änderungen verwerfen?",
    }),
    discardDescription: t({
      en: "Your changes have not been saved.",
      fr: "Vos modifications n’ont pas été enregistrées.",
      de: "Ihre Änderungen wurden noch nicht gespeichert.",
    }),
    discard: t({
      en: "Discard changes",
      fr: "Abandonner",
      de: "Änderungen verwerfen",
    }),
    keepEditing: t({
      en: "Keep editing",
      fr: "Continuer la modification",
      de: "Weiter bearbeiten",
    }),
  };
}
