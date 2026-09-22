/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useState } from "react";
import { createPortal } from "react-dom";
import SettingsDraftDialog from "../../components/settings/SettingsDraftDialog";
import { SettingsItem, SettingsSection, SettingsSwitch } from "../../components/settings/SettingsLayout";
import { ListActionButton } from "../../components/list/ListControls";

type Props = {
  targetLabel: string;
  associationKind: "account" | "rgw_user";
  allowManagerBrowserDataAccess: boolean;
  onApply: (allowed: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
  disabled?: boolean;
};

export default function AdminAssociationAdvancedSettings({
  targetLabel, associationKind, allowManagerBrowserDataAccess, onApply, onDirtyChange, disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  return <>
    <ListActionButton disabled={disabled} onClick={() => setOpen(true)}>Advanced</ListActionButton>
    {open && createPortal(<SettingsDraftDialog title="Advanced association settings"
      initialValue={allowManagerBrowserDataAccess} onApply={onApply} onDirtyChange={onDirtyChange} disabled={disabled}
      onClose={() => setOpen(false)} maxWidthClass="max-w-lg">
      {(allowed, setAllowed) => <SettingsSection title={targetLabel} presentation="compact"
        description={associationKind === "account"
          ? "This permission is effective only when this same association also has the Account administrator role."
          : "Direct and UI group permissions are aggregated for this RGW user."}>
        <SettingsItem compact title="Allow Manager Browser data access"
          description="Disabled by default. This permits data-plane Browser operations from the active Manager context."
          action={<SettingsSwitch checked={allowed} onChange={setAllowed} disabled={disabled}
            ariaLabel="Allow Manager Browser data access" />} />
      </SettingsSection>}
    </SettingsDraftDialog>, document.body)}
  </>;
}
