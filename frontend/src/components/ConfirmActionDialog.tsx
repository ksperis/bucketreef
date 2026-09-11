/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import ModalActions from "./ModalActions";
import { type ReactNode, useId } from "react";
import Modal from "./Modal";
import UiButton from "./ui/UiButton";
import UiInlineMessage from "./ui/UiInlineMessage";
import "./settings/compactSettings.css";

type ConfirmActionDialogDetail = {
  label: string;
  value: ReactNode;
  mono?: boolean;
};

type ConfirmActionDialogProps = {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  processingLabel?: string;
  impactLabel?: string;
  closeLabel?: string;
  tone?: "danger" | "primary";
  loading?: boolean;
  confirmDisabled?: boolean;
  details?: ConfirmActionDialogDetail[];
  impacts?: ReactNode[];
  warning?: ReactNode;
  error?: ReactNode;
  maxWidthClass?: string;
  zIndexClass?: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function ConfirmActionDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  processingLabel = "Processing...",
  impactLabel = "Impact",
  closeLabel,
  tone = "danger",
  loading = false,
  confirmDisabled = false,
  details = [],
  impacts = [],
  warning,
  error,
  maxWidthClass = "max-w-xl",
  zIndexClass,
  onCancel,
  onConfirm,
}: ConfirmActionDialogProps) {
  const descriptionId = useId();
  return (
    <Modal
      className="settings-dialog"
      title={title}
      onClose={onCancel}
      maxWidthClass={maxWidthClass}
      zIndexClass={zIndexClass}
      closeDisabled={loading}
      closeOnBackdropClick={!loading}
      closeOnEscape={!loading}
      closeLabel={closeLabel}
      closeAriaLabel={closeLabel}
      ariaDescribedby={descriptionId}
    >
      <div className="settings-stack">
        <p id={descriptionId} className="settings-body text-[var(--ui-text-muted)] [overflow-wrap:anywhere]">{description}</p>

        {details.length > 0 && (
          <dl className="grid gap-2">
            {details.map((detail) => (
              <div key={detail.label} className="grid min-w-0 gap-1 border-b border-[var(--ui-border-soft)] pb-2 last:border-0 last:pb-0 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3">
                <dt className="settings-label min-w-0 [overflow-wrap:anywhere]">{detail.label}</dt>
                <dd className={`settings-body min-w-0 [overflow-wrap:anywhere] ${detail.mono ? "font-mono" : ""}`}>{detail.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {impacts.length > 0 && (
          <UiInlineMessage tone="warning">
            <p className="settings-label">{impactLabel}</p>
            <ul className="settings-body mt-1 list-disc space-y-1 pl-4 [overflow-wrap:anywhere]">
              {impacts.map((impact, index) => <li key={index}>{impact}</li>)}
            </ul>
          </UiInlineMessage>
        )}

        {warning && <UiInlineMessage tone="neutral" className="[overflow-wrap:anywhere]">{warning}</UiInlineMessage>}
        {error && <UiInlineMessage tone="error" role="alert" className="[overflow-wrap:anywhere]">{error}</UiInlineMessage>}

        <ModalActions>
          <UiButton variant="secondary" onClick={onCancel} disabled={loading}>{cancelLabel}</UiButton>
          <UiButton variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} disabled={loading || confirmDisabled}>
            {loading ? processingLabel : confirmLabel}
          </UiButton>
        </ModalActions>
      </div>
    </Modal>
  );
}
