/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { SettingsItem, SettingsSection } from "../../components/settings/SettingsLayout";
import SettingsOperationSection from "../../components/settings/SettingsOperationSection";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import type { ObjectRestoreTier } from "./useBrowserObjectArchiveRestore";

type BrowserObjectArchiveTabProps = {
  currentStorageClass?: string | null;
  days: string;
  onDaysChange: (value: string) => void;
  onRestore: () => Promise<void> | void;
  onTierChange: (value: ObjectRestoreTier) => void;
  restoreStatusLabel?: string | null;
  saving: boolean;
  tier: ObjectRestoreTier;
};

export default function BrowserObjectArchiveTab({
  currentStorageClass, days, onDaysChange, onRestore, onTierChange,
  restoreStatusLabel, saving, tier,
}: BrowserObjectArchiveTabProps) {
  return (
    <div className="settings-compact settings-form">
      <SettingsSection title="Current status" presentation="compact">
        <SettingsItem compact title="Storage class"
          action={<span className="settings-body break-words">{currentStorageClass ?? "-"}</span>} />
        <SettingsItem compact title="Restore status"
          action={<span className="settings-body break-words">{restoreStatusLabel ?? "No active restore."}</span>} />
      </SettingsSection>
      <SettingsOperationSection title="Archive restore" description="Restore archived objects (GLACIER, GLACIER_IR, DEEP_ARCHIVE) for a limited duration."
        busy={saving} submitLabel="Request restore" busyLabel="Submitting..." onSubmit={onRestore}>
        <div className="settings-fields sm:grid-cols-2">
          <UiInput label="Days" type="number" min={1} value={days} onChange={(event) => onDaysChange(event.target.value)} />
          <UiSelect label="Tier" value={tier} onChange={(event) => onTierChange(event.target.value as ObjectRestoreTier)}>
            <option value="Standard">Standard</option><option value="Bulk">Bulk</option><option value="Expedited">Expedited</option>
          </UiSelect>
        </div>
      </SettingsOperationSection>
    </div>
  );
}
