/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import ModalActions from "../../components/ModalActions";
import { useEffect, useRef, useState } from "react";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { SettingsButton, SettingsDialog } from "../../components/settings/SettingsControls";
import UiTextarea from "../../components/ui/UiTextarea";

type BrowserConfirmModalProps = {
  title: string;
  message: string;
  confirmLabel?: string;
  loading?: boolean;
  tone?: "danger" | "primary";
  onCancel: () => void;
  onConfirm: () => void;
};

type BrowserCopyValueModalProps = {
  title: string;
  label?: string;
  value: string;
  onClose: () => void;
  onCopySuccess?: () => void;
};

export function BrowserConfirmModal({
  title,
  message,
  confirmLabel = "Confirm",
  loading = false,
  tone = "danger",
  onCancel,
  onConfirm,
}: BrowserConfirmModalProps) {
  return (
    <ConfirmActionDialog
      title={title}
      description={message}
      confirmLabel={confirmLabel}
      tone={tone}
      loading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
      maxWidthClass="max-w-lg"
    />
  );
}

export function BrowserCopyValueModal({
  title,
  label = "Value",
  value,
  onClose,
  onCopySuccess,
}: BrowserCopyValueModalProps) {
  const valueRef = useRef<HTMLTextAreaElement | null>(null);
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const pending = useRef(false);

  useEffect(() => {
    valueRef.current?.focus();
    valueRef.current?.select();
  }, []);

  const handleCopy = async () => {
    if (!value || pending.current) return;
    pending.current = true;
    setCopying(true);
    try {
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(value);
          setCopyHint("Copied to clipboard.");
          onCopySuccess?.();
          return;
        } catch {
          // Fall back to manual copy instructions.
        }
      }
      valueRef.current?.focus();
      valueRef.current?.select();
      setCopyHint("Select and copy manually.");
    } finally {
      pending.current = false;
      setCopying(false);
    }
  };

  return (
    <SettingsDialog title={title} onClose={onClose} maxWidthClass="max-w-2xl" initialFocusRef={valueRef}>
      <div className="settings-stack settings-fields">
        <UiTextarea label={label} ref={valueRef} className="font-mono" rows={4}
          readOnly value={value} spellCheck={false} />
        {copyHint && <p role="status" className="settings-description">{copyHint}</p>}
        <ModalActions>
          <SettingsButton variant="secondary" onClick={onClose}>Close</SettingsButton>
          <SettingsButton disabled={copying || !value} onClick={() => void handleCopy()}>
            {copying ? "Copying..." : "Copy"}
          </SettingsButton>
        </ModalActions>
      </div>
    </SettingsDialog>
  );
}
