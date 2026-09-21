/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { type ReactNode, useId } from "react";

import { SettingsButton } from "../../../components/settings/SettingsControls";

type BucketFeatureJsonExampleProps = {
  show: boolean;
  onToggle: () => void;
  example: string;
  onUseExample?: () => void;
  helperText?: ReactNode;
  disabled?: boolean;
};

export default function BucketFeatureJsonExample({
  show,
  onToggle,
  example,
  onUseExample,
  helperText,
  disabled = false,
}: BucketFeatureJsonExampleProps) {
  const exampleId = useId();
  return (
    <div className="space-y-2 settings-description">
      <div className="flex flex-wrap items-center gap-2">
        <SettingsButton
          type="button"
          onClick={onToggle}
          disabled={disabled}
          aria-expanded={show}
          aria-controls={show ? exampleId : undefined}
          variant="ghost"
        >
          {show ? "Hide example" : "Show example"}
        </SettingsButton>
        {onUseExample && (
          <SettingsButton
            type="button"
            onClick={onUseExample}
            disabled={disabled}
            variant="secondary"
          >
            Use example
          </SettingsButton>
        )}
        {helperText}
      </div>
      {show && (
        <pre id={exampleId} className="whitespace-pre-wrap break-words rounded border border-[var(--ui-border-soft)] bg-[var(--ui-surface-muted)] p-3 font-mono text-[var(--ui-text)] [overflow-wrap:anywhere]">
          {example}
        </pre>
      )}
    </div>
  );
}
