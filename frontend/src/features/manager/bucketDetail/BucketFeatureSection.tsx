/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import { SettingsSection } from "../../../components/settings/SettingsLayout";
import UiBadge from "../../../components/ui/UiBadge";
import { cx } from "../../../components/ui/styles";
import type { BucketFeatureMode, BucketFeatureVisualState } from "./bucketFeatureState";

type BucketFeaturePresentation = "simple" | "workbench";

type BucketFeatureSectionProps = {
  title: string;
  description: string;
  mode: BucketFeatureMode;
  visualState: BucketFeatureVisualState;
  presentation?: BucketFeaturePresentation;
  successMessage?: ReactNode;
  busy?: boolean;
  showConfiguredBadge?: boolean;
  actions?: ReactNode;
  children: ReactNode;
  testId?: string;
};

export default function BucketFeatureSection({
  title,
  description,
  mode,
  visualState,
  presentation = "simple",
  successMessage,
  busy = false,
  showConfiguredBadge = true,
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
        className="settings-fields min-w-0"
        aria-label={`${title} configuration`}
        aria-busy={busy}
        disabled={busy || visualState === "disabled"}
        data-testid={testId}
        data-feature-state={visualState}
        data-feature-mode={mode}
        data-feature-presentation={presentation}
      >
        <div
          className={cx(
            "flex min-w-0 flex-wrap items-center justify-between gap-2",
            presentation === "workbench" && "border-b border-[var(--ui-border-soft)] pb-2",
          )}
        >
          <div role="status" className="shrink-0">
            {visualState === "unsaved" && <UiBadge tone="warning">Unsaved changes</UiBadge>}
            {visualState === "configured" && showConfiguredBadge && <UiBadge tone="primary">Configured</UiBadge>}
            {visualState === "disabled" && <UiBadge tone="neutral">Unavailable</UiBadge>}
          </div>
          {actions && (
            <div
              role="group"
              aria-label={`${title} actions`}
              className="flex min-w-0 flex-wrap items-center justify-end gap-2"
            >
              {actions}
            </div>
          )}
        </div>
        {successMessage ? (
          <div aria-live="polite">
            <UiBadge tone="success">{successMessage}</UiBadge>
          </div>
        ) : null}
        {children}
      </fieldset>
    </SettingsSection>
  );
}
