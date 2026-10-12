/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useState } from "react";
import { createPortal } from "react-dom";
import SettingsDraftDialog from "../../components/settings/SettingsDraftDialog";
import { SettingsItem, SettingsSection, SettingsSwitch } from "../../components/settings/SettingsLayout";
import { ListActionButton } from "../../components/list/ListControls";
import { useAdminAssociationI18n } from "./adminAssociationMessages";

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
  const { text } = useAdminAssociationI18n();
  return <>
    <ListActionButton disabled={disabled} onClick={() => setOpen(true)}>{text("advanced")}</ListActionButton>
    {open && createPortal(<SettingsDraftDialog title={text("advancedSettings")}
      initialValue={allowManagerBrowserDataAccess} onApply={onApply} onDirtyChange={onDirtyChange} disabled={disabled}
      onClose={() => setOpen(false)} maxWidthClass="max-w-lg">
      {(allowed, setAllowed) => <SettingsSection title={targetLabel} presentation="compact"
        description={associationKind === "account"
          ? text("accountAdministratorRequirement")
          : text("rgwUserPermissionAggregation")}>
        <SettingsItem compact title={text("allowManagerBrowserDataAccess")}
          description={text("managerBrowserDataAccessDescription")}
          action={<SettingsSwitch checked={allowed} onChange={setAllowed} disabled={disabled}
            ariaLabel={text("allowManagerBrowserDataAccess")} />} />
      </SettingsSection>}
    </SettingsDraftDialog>, document.body)}
  </>;
}
