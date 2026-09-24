/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useId, type ReactNode } from "react";
import PageTabs from "../../../components/PageTabs";
import SettingsFormDialog from "../../../components/settings/SettingsFormDialog";

export type BucketFeatureEditorMode = "visual" | "json";

type BucketFeatureEditorDialogProps = {
  title: string;
  mode: BucketFeatureEditorMode;
  onModeChange: (mode: BucketFeatureEditorMode) => void;
  draftKey: string;
  busy?: boolean;
  dirty?: boolean;
  saveDisabled?: boolean;
  error?: string | null;
  visualContent: ReactNode;
  jsonContent: ReactNode;
  onSave: () => void | Promise<void>;
  onClose: (reason?: "navigation") => void;
};

export default function BucketFeatureEditorDialog({
  title,
  mode,
  onModeChange,
  draftKey,
  busy = false,
  dirty = true,
  saveDisabled = false,
  error,
  visualContent,
  jsonContent,
  onSave,
  onClose,
}: BucketFeatureEditorDialogProps) {
  const tabsId = useId();
  return (
    <SettingsFormDialog
      title={title}
      draftKey={draftKey}
      busy={busy}
      submitDisabled={!dirty || saveDisabled}
      error={error}
      submitLabel="Save"
      onSubmit={onSave}
      onClose={onClose}
      maxWidthClass="max-w-5xl"
      maxBodyHeightClass="max-h-[calc(100dvh-10rem)]"
    >
      <PageTabs
        tabs={[
          { id: "visual", label: "Visual", content: visualContent },
          { id: "json", label: "JSON", content: jsonContent },
        ]}
        activeTab={mode}
        onChange={(nextMode) => onModeChange(nextMode as BucketFeatureEditorMode)}
        variant="line"
        ariaLabel={`${title} editor mode`}
        idPrefix={tabsId}
      />
    </SettingsFormDialog>
  );
}
