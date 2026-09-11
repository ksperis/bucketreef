/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { copyTextToClipboard } from "../utils/clipboard";
import { SettingsButton } from "./settings/SettingsControls";
import UiBadge from "./ui/UiBadge";
import { cx, uiToneBannerClasses } from "./ui/styles";

type OneTimeSecretValue = {
  label: ReactNode;
  value: string;
  copyLabel?: ReactNode;
};

type OneTimeSecretPanelProps = {
  title: ReactNode;
  description: ReactNode;
  values: OneTimeSecretValue[];
  badge?: ReactNode;
  actions?: ReactNode;
  className?: string;
  copyFeedback?: { copied: string; failed: string };
};

const defaultCopyFeedback = {
  copied: "Copied to clipboard.",
  failed: "Unable to copy. Select and copy this value manually.",
};

function SecretValue({ label, value, copyLabel, feedback }: OneTimeSecretValue & { feedback: typeof defaultCopyFeedback }) {
  const labelId = useId();
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const generation = useRef(0);
  const copying = useRef(false);

  useEffect(() => {
    generation.current += 1;
    copying.current = false;
    setCopyState("idle");
    return () => { generation.current += 1; };
  }, [value]);

  const copy = async () => {
    if (copying.current || !value) return;
    const attempt = ++generation.current;
    copying.current = true;
    setCopyState("copying");
    try {
      await copyTextToClipboard(value);
      if (attempt === generation.current) setCopyState("copied");
    } catch {
      if (attempt === generation.current) setCopyState("failed");
    } finally {
      if (attempt === generation.current) copying.current = false;
    }
  };

  return (
    <div role="group" aria-labelledby={labelId} className="min-w-0">
      <p id={labelId} className="settings-label mb-1">{label}</p>
      <div>
        <div className="flex flex-wrap items-start gap-2">
          <code className="block min-w-0 flex-1 basis-48 whitespace-pre-wrap break-all rounded border border-[var(--ui-border)] bg-[var(--ui-surface)] px-2 py-1 font-mono settings-body text-[var(--ui-text)]">
            {value}
          </code>
          {copyLabel && <SettingsButton type="button" variant="secondary" disabled={!value || copyState === "copying"}
            aria-busy={copyState === "copying"} aria-describedby={labelId} onClick={() => void copy()}>
            {copyLabel}
          </SettingsButton>}
        </div>
        {copyState === "copied" && <p role="status" className="mt-1 settings-field-help text-emerald-700 dark:text-emerald-300">{feedback.copied}</p>}
        {copyState === "failed" && <p role="alert" className="mt-1 settings-field-help text-rose-700 dark:text-rose-300">{feedback.failed}</p>}
      </div>
    </div>
  );
}

export default function OneTimeSecretPanel({
  title,
  description,
  values,
  badge,
  actions,
  className,
  copyFeedback = defaultCopyFeedback,
}: OneTimeSecretPanelProps) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={cx("one-time-secret-panel min-w-0 rounded-md border p-3", uiToneBannerClasses.warning, className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 basis-64 [overflow-wrap:anywhere]">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={titleId} className="settings-section-title">{title}</h2>
            {badge && <UiBadge tone="warning">{badge}</UiBadge>}
          </div>
          <p className="settings-description mt-1">{description}</p>
        </div>
        {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className={cx("mt-3 grid min-w-0 grid-cols-1 gap-3", values.length > 1 && "sm:grid-cols-2")}>
        {values.map((item, index) => <SecretValue key={index} {...item} feedback={copyFeedback} />)}
      </div>
    </section>
  );
}
