/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
type StsSseDecisionInput = {
  stsAvailable: boolean;
  sseActive: boolean;
};

export const shouldUseStsPresigner = ({ stsAvailable, sseActive }: StsSseDecisionInput): boolean =>
  Boolean(stsAvailable && !sseActive);

export type BrowserUploadMode = "sts" | "direct" | "proxy" | "unavailable";

type BrowserUploadModeDecisionInput = {
  settingsLoaded: boolean;
  hasContext: boolean;
  hasBucket: boolean;
  corsEnabled: boolean | null;
  directAllowed: boolean;
  stsAllowed: boolean;
  stsAvailable: boolean;
  sseActive: boolean;
  proxyAllowed: boolean;
};

export const resolveBrowserUploadMode = ({
  settingsLoaded,
  hasContext,
  hasBucket,
  corsEnabled,
  directAllowed,
  stsAllowed,
  stsAvailable,
  sseActive,
  proxyAllowed,
}: BrowserUploadModeDecisionInput): BrowserUploadMode => {
  if (!settingsLoaded || !hasContext || !hasBucket) return "unavailable";
  if (corsEnabled === false) return proxyAllowed ? "proxy" : "unavailable";
  if (stsAllowed && stsAvailable && !sseActive) return "sts";
  if (directAllowed) return "direct";
  if (proxyAllowed) return "proxy";
  return "unavailable";
};
