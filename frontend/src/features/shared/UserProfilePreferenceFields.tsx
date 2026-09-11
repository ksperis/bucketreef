/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { UiLanguagePreference } from "../../components/language";
import { SettingsItem, SettingsSection, SettingsSwitch } from "../../components/settings/SettingsLayout";
import UiSelect from "../../components/ui/UiSelect";
import type { ProfileText } from "./profileMessages";

export function UserLanguageField({ value, onChange, disabled, text }: {
  value: UiLanguagePreference; onChange: (value: UiLanguagePreference) => void; disabled?: boolean; text: ProfileText;
}) {
  return <SettingsItem compact title={text("language")} action={
    <UiSelect aria-label={text("language")} className="settings-control w-full sm:w-56" value={value}
      disabled={disabled} onChange={event => onChange(event.target.value as UiLanguagePreference)}>
      <option value="auto">{text("browserAuto")}</option><option value="fr">Français</option>
      <option value="en">English</option><option value="de">Deutsch</option>
    </UiSelect>
  } />;
}

export function UserNotificationFields({ quotaAlerts, quotaWatch, canWatch, onQuotaAlertsChange, onQuotaWatchChange, disabled, text }: {
  quotaAlerts: boolean; quotaWatch: boolean; canWatch: boolean; disabled?: boolean; text: ProfileText;
  onQuotaAlertsChange: (value: boolean) => void; onQuotaWatchChange: (value: boolean) => void;
}) {
  return <SettingsSection presentation="compact" title={text("notifications")} description={text("notificationsHelp")}>
    <SettingsItem compact title={text("quotaAlerts")} action={<SettingsSwitch checked={quotaAlerts} disabled={disabled}
      onChange={onQuotaAlertsChange} ariaLabel={text("quotaAlerts")} />} />
    {canWatch && <SettingsItem compact title={text("quotaWatch")} description={text("quotaWatchHelp")}
      action={<SettingsSwitch checked={quotaWatch} disabled={disabled} onChange={onQuotaWatchChange} ariaLabel={text("quotaWatch")} />} />}
  </SettingsSection>;
}
