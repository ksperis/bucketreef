/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import ErrorState from "../../components/errors/ErrorState";
import { useI18n } from "../../i18n";

export default function FeatureDisabledPage({ feature }: { feature: string }) {
  const { t } = useI18n();
  return <ErrorState kind="feature_disabled" description={t({
    en: `${feature} is disabled. Contact your administrator if you need access.`,
    fr: `${feature} est désactivé. Contactez votre administrateur si vous en avez besoin.`,
  })} />;
}
