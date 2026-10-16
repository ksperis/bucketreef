/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { ComponentProps } from "react";
import UiTagEditor from "../../components/UiTagEditor";
import UiInput from "../../components/ui/UiInput";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import { useSharedI18n } from "./sharedI18n";

type Props = {
  name: string;
  onNameChange: (value: string) => void;
  nameError?: string;
  catalogError?: string | null;
  tagEditor: ComponentProps<typeof UiTagEditor>;
};

export default function S3ConnectionIdentityFields({ name, onNameChange, nameError, catalogError, tagEditor }: Props) {
  const { text: surfaceText } = useSharedI18n();
  return (
    <SettingsSection title={surfaceText("Connection")} presentation="compact">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="settings-fields">
          <UiInput label={surfaceText("Name")} value={name} onChange={(event) => onNameChange(event.target.value)} error={nameError} required />
        </div>
        <div className="settings-form min-w-0">
          {catalogError && <UiInlineMessage tone="warning">{catalogError}</UiInlineMessage>}
          <UiTagEditor {...tagEditor} label={surfaceText("Tags")} compact />
        </div>
      </div>
    </SettingsSection>
  );
}
