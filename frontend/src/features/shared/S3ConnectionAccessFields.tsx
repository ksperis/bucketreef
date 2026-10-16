/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useId } from "react";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import { cx, uiMutedTextClass, uiPanelMutedClass, uiTitleTextClass } from "../../components/ui/styles";
import { useSharedI18n } from "./sharedI18n";

type S3ConnectionAccessFieldsProps = {
  accessManager: boolean;
  accessBrowser: boolean;
  onAccessManagerChange: (checked: boolean) => void;
  onAccessBrowserChange: (checked: boolean) => void;
  title?: string;
  hint?: string;
  className?: string;
  variant?: "plain" | "panel";
  identitySummary?: string | null;
  error?: string;
};

export default function S3ConnectionAccessFields({
  accessManager,
  accessBrowser,
  onAccessManagerChange,
  onAccessBrowserChange,
  title = "Workspace access",
  hint = "At least one access must be enabled.",
  className,
  variant = "plain",
  identitySummary,
  error,
}: S3ConnectionAccessFieldsProps) {
  const { text: surfaceText } = useSharedI18n();
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hintId, error ? errorId : undefined].filter(Boolean).join(" ");
  return (
    <section className={cx("grid min-w-0 gap-2", variant === "panel" ? cx("px-3 py-3", uiPanelMutedClass) : "", className)}>
      <div className={cx("ui-body", uiTitleTextClass)}>{title}</div>
      <div className="flex flex-wrap items-center gap-4">
        <UiCheckboxField
          checked={accessManager}
          onChange={(event) => onAccessManagerChange(event.target.checked)}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          className="settings-choice ui-body text-[var(--ui-text)]"
        >
          {surfaceText("Access manager")}</UiCheckboxField>
        <UiCheckboxField
          checked={accessBrowser}
          onChange={(event) => onAccessBrowserChange(event.target.checked)}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          className="settings-choice ui-body text-[var(--ui-text)]"
        >
          {surfaceText("Access browser")}</UiCheckboxField>
      </div>
      <p id={hintId} className={cx("ui-caption", uiMutedTextClass)}>{hint}</p>
      {error && <p id={errorId} role="alert" className="ui-caption text-rose-600 dark:text-rose-200">{error}</p>}
      {identitySummary ? <p className={cx("ui-caption [overflow-wrap:anywhere]", uiMutedTextClass)}>{surfaceText("RGW identity:")}{identitySummary}</p> : null}
    </section>
  );
}
