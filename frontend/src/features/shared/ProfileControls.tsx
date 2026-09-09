/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { ComponentProps } from "react";
import Modal from "../../components/Modal";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import UiButton from "../../components/ui/UiButton";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { useProfileI18n } from "./profileMessages";

export function ProfileButton({ className = "", size = "sm", ...props }: ComponentProps<typeof UiButton>) {
  return <UiButton {...props} size={size} className={`settings-control ${className}`} />;
}

export function ProfileDialog(props: ComponentProps<typeof Modal>) {
  const { text } = useProfileI18n();
  return <div className="settings-dialog"><Modal maxWidthClass="max-w-lg" closeLabel={text("close")} closeAriaLabel={text("close")} {...props} /></div>;
}

export function ProfileConfirmation(props: ComponentProps<typeof ConfirmActionDialog>) {
  const { text } = useProfileI18n();
  return <div className="settings-dialog"><ConfirmActionDialog cancelLabel={text("cancel")} closeLabel={text("close")} processingLabel={text("processing")} impactLabel={text("impact")} {...props} /></div>;
}

export function useProfileDraftGuard(options: Pick<Parameters<typeof useUnsavedChangesGuard>[0], "hasUnsavedChanges" | "onClose" | "disabled">) {
  const { text } = useProfileI18n();
  const guard = useUnsavedChangesGuard({ ...options, title: text("discardTitle"), description: text("discardDescription"), cancelLabel: text("keepEditing"), confirmLabel: text("discard"), closeLabel: text("close"), zIndexClass: "z-[100]" });
  return { ...guard, confirmationDialog: guard.confirmationDialog && <div className="settings-dialog">{guard.confirmationDialog}</div> };
}
