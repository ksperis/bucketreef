/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import ErrorState from "../../components/errors/ErrorState";
import { useI18n, type I18nMessage } from "../../i18n";

export default function FeatureDisabledPage({ feature }: { feature: I18nMessage }) {
  const { t } = useI18n();
  const featureLabel = t(feature);
  const description = t({
    en: "The {feature} feature is disabled. Contact your administrator if you need access.",
    fr: "La fonctionnalité {feature} est désactivée. Contactez votre administrateur si vous en avez besoin.",
    de: "Die Funktion {feature} ist deaktiviert. Wenden Sie sich an Ihre Administration, wenn Sie Zugriff benötigen.",
    zh: "{feature} 功能已禁用。如需访问，请联系管理员。",
  }).replace("{feature}", featureLabel);
  return <ErrorState kind="feature_disabled" description={description} />;
}
