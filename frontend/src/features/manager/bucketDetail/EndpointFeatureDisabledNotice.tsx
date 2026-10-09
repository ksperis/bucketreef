/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import { useManagerI18n } from "../managerI18n";

export default function EndpointFeatureDisabledNotice({ featureLabel }: { featureLabel: string }) {
  const { text } = useManagerI18n();
  return <UiInlineMessage>{featureLabel} {text("is disabled on this endpoint.")}</UiInlineMessage>;
}
