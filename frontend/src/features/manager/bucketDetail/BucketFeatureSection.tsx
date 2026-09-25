/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useId, type ReactNode } from "react";
import UiBadge from "../../../components/ui/UiBadge";
import { cx, type UiTone } from "../../../components/ui/styles";
import type { BucketFeatureMode, BucketFeatureVisualState } from "./bucketFeatureState";
import "./bucketFeatureCards.css";

type BucketFeaturePresentation = "simple" | "collection" | "workbench";

type BucketFeatureSectionProps = {
  title: string;
  description: string;
  mode: BucketFeatureMode;
  visualState: BucketFeatureVisualState;
  presentation?: BucketFeaturePresentation;
  stateLabel?: ReactNode;
  stateTone?: UiTone;
  successMessage?: ReactNode;
  busy?: boolean;
  showConfiguredBadge?: boolean;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
};

function defaultStateBadge(
  visualState: BucketFeatureVisualState,
  showConfiguredBadge: boolean,
) {
  if (visualState === "unsaved") {
    return <UiBadge tone="warning">Unsaved changes</UiBadge>;
  }
  if (visualState === "configured" && showConfiguredBadge) {
    return <UiBadge tone="primary">Configured</UiBadge>;
  }
  if (visualState === "configured") {
    return null;
  }
  if (visualState === "disabled") {
    return <UiBadge tone="neutral">Unavailable</UiBadge>;
  }
  return <UiBadge tone="neutral">Inactive</UiBadge>;
}

export default function BucketFeatureSection({
  title,
  description,
  mode,
  visualState,
  presentation = "simple",
  stateLabel,
  stateTone,
  successMessage,
  busy = false,
  showConfiguredBadge = true,
  actions,
  children,
  className,
  testId,
}: BucketFeatureSectionProps) {
  const titleId = useId();
  const resolvedPresentation = presentation === "workbench" ? "collection" : presentation;
  const stateBadge = stateLabel ? (
    <UiBadge
      tone={
        stateTone
        ?? (visualState === "unsaved"
          ? "warning"
          : visualState === "configured"
            ? "primary"
            : "neutral")
      }
    >
      {stateLabel}
    </UiBadge>
  ) : defaultStateBadge(visualState, showConfiguredBadge);

  return (
    <section
      role="region"
      aria-labelledby={titleId}
      className={cx("bucket-feature-card", className)}
      data-feature-state={visualState}
      data-feature-mode={mode}
      data-feature-presentation={resolvedPresentation}
    >
      <fieldset
        className="bucket-feature-card-fieldset"
        aria-label={`${title} configuration`}
        aria-busy={busy}
        disabled={busy || visualState === "disabled"}
        data-testid={testId}
        data-feature-state={visualState}
        data-feature-mode={mode}
        data-feature-presentation={resolvedPresentation}
      >
        <div className="bucket-feature-card-header">
          <div className="min-w-0 flex-1">
            <h3 id={titleId} className="bucket-feature-card-title">{title}</h3>
            <p className="bucket-feature-card-description">{description}</p>
          </div>
          <div className="bucket-feature-card-toolbar">
            <div role="status" className="bucket-feature-card-status">
              {stateBadge}
            </div>
            {actions ? (
              <div
                role="group"
                aria-label={`${title} actions`}
                className="bucket-feature-card-actions"
              >
                {actions}
              </div>
            ) : null}
          </div>
        </div>

        <div className="bucket-feature-card-body">
          {successMessage ? (
            <div aria-live="polite" className="bucket-feature-card-feedback">
              <UiBadge tone="success">{successMessage}</UiBadge>
            </div>
          ) : null}
          {children}
        </div>
      </fieldset>
    </section>
  );
}
