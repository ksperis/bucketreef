/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import { SettingsSection } from "../../../components/settings/SettingsLayout";
import UiBadge from "../../../components/ui/UiBadge";
import type { BucketFeatureMode, BucketFeatureVisualState } from "./bucketFeatureState";

type BucketFeatureSectionProps = {
  title: string;
  description: string;
  mode: BucketFeatureMode;
  visualState: BucketFeatureVisualState;
  busy?: boolean;
  actions?: ReactNode;
  children: ReactNode;
  testId?: string;
};

export default function BucketFeatureSection({
  title,
  description,
  mode,
  visualState,
  busy = false,
  actions,
  children,
  testId,
}: BucketFeatureSectionProps) {
  return (
    <SettingsSection
      title={title}
      description={description}
      presentation="compact"
    >
      <fieldset
        className="settings-fields min-w-0 space-y-3"
        aria-label={`${title} configuration`}
        aria-busy={busy}
        disabled={busy || visualState === "disabled"}
        data-testid={testId}
        data-feature-state={visualState}
        data-feature-mode={mode}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="status">
            {visualState === "unsaved" && <UiBadge tone="warning">Unsaved changes</UiBadge>}
            {visualState === "configured" && <UiBadge tone="neutral">Configured</UiBadge>}
            {visualState === "disabled" && <UiBadge tone="neutral">Unavailable</UiBadge>}
          </div>
          {actions && (
            <div role="group" aria-label={`${title} actions`} className="flex flex-wrap items-center gap-2">
              {actions}
            </div>
          )}
        </div>
        {children}
      </fieldset>
    </SettingsSection>
  );
}
