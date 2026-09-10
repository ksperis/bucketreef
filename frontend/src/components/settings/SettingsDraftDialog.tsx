/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import ModalActions from "../ModalActions";
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  SettingsButton,
  SettingsDialog,
  useSettingsCloseGuard,
} from "./SettingsControls";
import { useSettingsDraft } from "./useSettingsDraft";

export default function SettingsDraftDialog<T>({
  title,
  initialValue,
  onApply,
  onClose,
  onDirtyChange,
  validate,
  children,
  labels,
  maxWidthClass,
}: {
  title: string;
  initialValue: T;
  onApply: (value: T) => void;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  validate?: (value: T) => Record<string, string | undefined>;
  children: (
    value: T,
    setValue: Dispatch<SetStateAction<T>>,
    errors: Record<string, string | undefined>,
    validateDraft: () => boolean,
  ) => ReactNode;
  labels?: {
    apply: string;
    cancel: string;
    close: string;
    discardTitle: string;
    discardDescription: string;
    discard: string;
    keepEditing: string;
  };
  maxWidthClass?: string;
}) {
  const initialFocus = useRef<HTMLElement | null>(null);
  const { draft, setDraft, dirty } = useSettingsDraft(initialValue);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const guard = useSettingsCloseGuard({
    hasUnsavedChanges: dirty,
    onClose,
    title: labels?.discardTitle,
    description: labels?.discardDescription,
    cancelLabel: labels?.keepEditing,
    confirmLabel: labels?.discard,
    closeLabel: labels?.close,
  });
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  const validateDraft = () => {
    const nextErrors = validate?.(draft) ?? {};
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) {
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>('[role="dialog"] [aria-invalid="true"]')
          ?.focus(),
      );
      return false;
    }
    return true;
  };
  const apply = () => {
    if (!validateDraft()) return;
    onApply(draft);
    onClose();
  };
  return (
    <>
      <SettingsDialog
        initialFocusRef={initialFocus}
        title={title}
        onClose={guard.requestClose}
        closeLabel={labels?.close}
        closeAriaLabel={labels?.close}
        maxWidthClass={maxWidthClass}
      >
        <form
          className="settings-stack"
          ref={(node) => {
            initialFocus.current =
              node?.querySelector<HTMLElement>(
                "input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
              ) ?? null;
          }}
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
          noValidate
        >
          <div className="settings-fields">
            {children(draft, setDraft, errors, validateDraft)}
          </div>
          <ModalActions>
            <SettingsButton variant="secondary" onClick={guard.requestClose}>
              {labels?.cancel ?? "Cancel"}
            </SettingsButton>
            <SettingsButton onClick={apply}>
              {labels?.apply ?? "Apply"}
            </SettingsButton>
          </ModalActions>
        </form>
      </SettingsDialog>
      {guard.confirmationDialog}
    </>
  );
}
