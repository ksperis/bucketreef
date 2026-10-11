/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { SettingsItem, SettingsSection } from "../../components/settings/SettingsLayout";
import SettingsOperationSection from "../../components/settings/SettingsOperationSection";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import type { ObjectRestoreTier } from "./useBrowserObjectArchiveRestore";
import { useBrowserI18n } from "./browserI18n";

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
  const { text } = useBrowserI18n();
  return (
    <div className="settings-compact settings-form">
      <SettingsSection title={text("Current status")} presentation="compact">
        <SettingsItem compact title={text("Storage class")}
          action={<span className="settings-body break-words">{currentStorageClass ?? "-"}</span>} />
        <SettingsItem compact title={text("Restore status")}
          action={<span className="settings-body break-words">{restoreStatusLabel ?? "No active restore."}</span>} />
      </SettingsSection>
      <SettingsOperationSection title={text("Archive restore")} description={text("Restore archived objects (GLACIER, GLACIER_IR, DEEP_ARCHIVE) for a limited duration.")}
        busy={saving} submitLabel={text("Request restore")} busyLabel={text("Submitting...")} onSubmit={onRestore}>
        <div className="settings-fields sm:grid-cols-2">
          <UiInput label={text("Days")} type="number" min={1} value={days} onChange={(event) => onDaysChange(event.target.value)} />
          <UiSelect label={text("Tier")} value={tier} onChange={(event) => onTierChange(event.target.value as ObjectRestoreTier)}>
            <option value="Standard">{text("Standard")}</option><option value="Bulk">{text("Bulk")}</option><option value="Expedited">{text("Expedited")}</option>
          </UiSelect>
        </div>
      </SettingsOperationSection>
    </div>
  );
}
