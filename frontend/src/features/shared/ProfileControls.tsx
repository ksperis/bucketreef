/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import type { ComponentProps } from "react";
import {
  SettingsButton,
  SettingsDialog,
  useSettingsCloseGuard,
} from "../../components/settings/SettingsControls";
import { useProfileI18n } from "./profileMessages";

export const ProfileButton = SettingsButton;

export function ProfileDialog(props: ComponentProps<typeof SettingsDialog>) {
  const { text } = useProfileI18n();
  return (
    <SettingsDialog
      closeLabel={text("close")}
      closeAriaLabel={text("close")}
      {...props}
    />
  );
}

export function ProfileConfirmation(
  props: ComponentProps<typeof ConfirmActionDialog>,
) {
  const { text } = useProfileI18n();
  return (
    <ConfirmActionDialog
      cancelLabel={text("cancel")}
      closeLabel={text("close")}
      processingLabel={text("processing")}
      impactLabel={text("impact")}
      {...props}
    />
  );
}

export function useProfileDraftGuard(
  options: Pick<
    Parameters<typeof useSettingsCloseGuard>[0],
    "hasUnsavedChanges" | "onClose" | "disabled"
  >,
) {
  const { text } = useProfileI18n();
  return useSettingsCloseGuard({
    ...options,
    title: text("discardTitle"),
    description: text("discardDescription"),
    cancelLabel: text("keepEditing"),
    confirmLabel: text("discard"),
    closeLabel: text("close"),
    zIndexClass: "z-[100]",
  });
}
