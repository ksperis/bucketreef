/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import { CEPH_ADMIN_QUOTA_UNITS, type CephAdminQuotaUnit } from "./quotaForm";

type CephAdminQuotaFieldsProps = {
  title: string;
  enabledLabel: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  sizeValue: string;
  onSizeChange: (value: string) => void;
  unitValue: CephAdminQuotaUnit;
  onUnitChange: (unit: CephAdminQuotaUnit) => void;
  objectValue: string;
  onObjectChange: (value: string) => void;
  sizePlaceholder?: string;
  objectPlaceholder?: string;
  sizeError?: string;
  objectError?: string;
};

export default function CephAdminQuotaFields({
  title,
  enabledLabel,
  enabled,
  onEnabledChange,
  sizeValue,
  onSizeChange,
  unitValue,
  onUnitChange,
  objectValue,
  onObjectChange,
  sizePlaceholder,
  objectPlaceholder,
  sizeError,
  objectError,
}: CephAdminQuotaFieldsProps) {
  return (
    <SettingsSection title={title} presentation="compact">
      <div className="settings-fields">
        <UiCheckboxField
          className="settings-choice"
          checked={enabled}
          onChange={(event) => onEnabledChange(event.target.checked)}
        >
          {enabledLabel}
        </UiCheckboxField>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)]">
          <UiInput
            label="Storage quota"
            type="number"
            min={0}
            step="any"
            disabled={!enabled}
            value={sizeValue}
            onChange={(event) => onSizeChange(event.target.value)}
            placeholder={sizePlaceholder}
            error={sizeError}
          />
          <UiSelect
            label="Unit"
            disabled={!enabled}
            value={unitValue}
            onChange={(event) => onUnitChange(event.target.value as CephAdminQuotaUnit)}
          >
            {CEPH_ADMIN_QUOTA_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {unit === "B" ? "Bytes" : unit}
              </option>
            ))}
          </UiSelect>
          <UiInput
            label="Object quota"
            type="number"
            min={0}
            step={1}
            disabled={!enabled}
            value={objectValue}
            onChange={(event) => onObjectChange(event.target.value)}
            placeholder={objectPlaceholder}
            error={objectError}
          />
        </div>
      </div>
    </SettingsSection>
  );
}
