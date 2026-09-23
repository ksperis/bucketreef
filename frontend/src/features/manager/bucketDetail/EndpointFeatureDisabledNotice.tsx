/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import UiInlineMessage from "../../../components/ui/UiInlineMessage";

export default function EndpointFeatureDisabledNotice({ featureLabel }: { featureLabel: string }) {
  return <UiInlineMessage>{featureLabel} is disabled on this endpoint.</UiInlineMessage>;
}
