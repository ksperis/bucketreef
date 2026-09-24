/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import { SettingsButton } from "../../../components/settings/SettingsControls";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import BucketFeatureSection from "./BucketFeatureSection";
import type { BucketFeatureMode, BucketFeatureVisualState } from "./bucketFeatureState";

type BucketFeatureSummarySectionProps = {
  title: string;
  description: string;
  visualState: BucketFeatureVisualState;
  mode?: BucketFeatureMode;
  metadata?: ReactNode;
  loading?: boolean;
  loadingMessage?: string;
  error?: string | null;
  successMessage?: ReactNode;
  editDisabled?: boolean;
  onEdit: () => void;
  children: ReactNode;
  testId?: string;
};

export default function BucketFeatureSummarySection({
  title,
  description,
  visualState,
  mode = "hybrid",
  metadata,
  loading = false,
  loadingMessage = "Loading configuration...",
  error,
  successMessage,
  editDisabled = false,
  onEdit,
  children,
  testId,
}: BucketFeatureSummarySectionProps) {
  return (
    <BucketFeatureSection
      title={title}
      description={description}
      mode={mode}
      visualState={visualState}
      presentation="workbench"
      successMessage={successMessage}
      busy={loading}
      showConfiguredBadge={false}
      testId={testId}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {visualState === "configured" && metadata ? <span className="settings-description">{metadata}</span> : null}
          <SettingsButton
            type="button"
            variant="secondary"
            onClick={onEdit}
            disabled={loading || Boolean(error) || editDisabled || visualState === "disabled"}
          >
            {visualState === "neutral" ? "Configure" : "Edit"}
          </SettingsButton>
        </div>
      }
    >
      {loading ? (
        <UiInlineMessage>{loadingMessage}</UiInlineMessage>
      ) : error ? (
        <UiInlineMessage tone="error">{error}</UiInlineMessage>
      ) : visualState === "neutral" ? (
        null
      ) : (
        children
      )}
    </BucketFeatureSection>
  );
}
