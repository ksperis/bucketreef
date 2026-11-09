/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import type { ReactNode } from "react";

import { WorkflowSection } from "../../components/WorkflowPage";
import UiBadge from "../../components/ui/UiBadge";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiInput from "../../components/ui/UiInput";
import { cx, uiCardMutedClass, uiMutedTextClass } from "../../components/ui/styles";

export function SetupOption({
  title,
  description,
  checked,
  disabled,
  disabledReason,
  recommended,
  experimental,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  disabledReason?: string;
  recommended?: string;
  experimental?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <UiCheckboxField
      className={cx(
        uiCardMutedClass,
        "min-h-28 w-full items-start gap-3 p-4",
        disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer",
        checked && !disabled && "outline outline-2 outline-[var(--ui-primary)]",
      )}
      checkboxClassName="mt-0.5 shrink-0"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    >
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="ui-body font-semibold text-[var(--ui-text)]">{title}</span>
          {recommended && <UiBadge tone="neutral">{recommended}</UiBadge>}
          {experimental && <UiBadge tone="neutral">{experimental}</UiBadge>}
        </span>
        <span className={cx("mt-1 block ui-caption", uiMutedTextClass)}>{description}</span>
        {disabledReason && (
          <span className="mt-2 block ui-caption text-[var(--ui-warning-text)]">
            {disabledReason}
          </span>
        )}
      </span>
    </UiCheckboxField>
  );
}

function CredentialHelp({ command, note }: { command: string; note?: string }) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer ui-caption font-medium">{note}</summary>
      <pre className="mt-2 whitespace-pre-wrap break-all rounded-md border border-[var(--ui-border)] bg-[var(--ui-surface-muted)] p-3 ui-caption">
        <code>{command}</code>
      </pre>
    </details>
  );
}

export function CredentialSection({
  title,
  description,
  accessLabel,
  secretLabel,
  accessKey,
  secretKey,
  required,
  stored,
  command,
  commandHelp,
  storedLabel,
  onAccessChange,
  onSecretChange,
  extraHelp,
  validation,
}: {
  title: string;
  description: string;
  accessLabel: string;
  secretLabel: string;
  accessKey: string;
  secretKey: string;
  required: boolean;
  stored: boolean;
  command?: string;
  commandHelp: string;
  storedLabel: string;
  onAccessChange: (value: string) => void;
  onSecretChange: (value: string) => void;
  extraHelp?: string;
  validation?: ReactNode;
}) {
  return (
    <WorkflowSection title={title} description={description}>
      {validation ? <div className="flex flex-wrap items-center gap-2">{validation}</div> : null}
      {stored ? (
        <UiInlineMessage tone="success">{storedLabel}</UiInlineMessage>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <UiInput
            label={accessLabel}
            type="password"
            autoComplete="off"
            required={required}
            value={accessKey}
            onChange={(event) => onAccessChange(event.target.value)}
          />
          <UiInput
            label={secretLabel}
            type="password"
            autoComplete="new-password"
            required={required}
            value={secretKey}
            onChange={(event) => onSecretChange(event.target.value)}
          />
        </div>
      )}
      {extraHelp && <p className={cx("mt-3 ui-caption", uiMutedTextClass)}>{extraHelp}</p>}
      {command && <CredentialHelp command={command} note={commandHelp} />}
    </WorkflowSection>
  );
}

export function SelectionCount({ count, label }: { count: number; label: string }) {
  return (
    <div className="flex justify-end">
      <UiBadge tone={count > 0 ? "success" : "neutral"}>{label}</UiBadge>
    </div>
  );
}
