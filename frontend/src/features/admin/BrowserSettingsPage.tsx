/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { SettingsSection } from "../../components/settings/SettingsLayout";
import AdminSettingsFrame from "./settings/AdminSettingsFrame";
import {
  AppSettingsNumber,
  AppSettingsToggle,
} from "./settings/AppSettingsFields";
import { useAppSettingsDraft } from "./settings/useAppSettingsDraft";
import {
  validateInteger,
  type AppSettingsValues,
  type FieldErrors,
  type SettingsPath,
} from "./settings/appSettingsDraft";

const paths = [
  "general.browser_root_enabled",
  "general.browser_manager_enabled",
  "general.browser_portal_enabled",
  "general.browser_ceph_admin_enabled",
  "browser.allow_proxy_transfers",
  "browser.direct_upload_parallelism",
  "browser.proxy_upload_parallelism",
  "browser.direct_download_parallelism",
  "browser.proxy_download_parallelism",
  "browser.other_operations_parallelism",
  "browser.streaming_zip_threshold_mb",
] as const satisfies readonly SettingsPath[];

function validate(values: AppSettingsValues): FieldErrors {
  const errors: FieldErrors = {};
  for (const path of paths.filter((path) => path.endsWith("parallelism")))
    errors[path] = validateInteger(values[path], "Parallelism", 1, 20);
  errors["browser.streaming_zip_threshold_mb"] = validateInteger(
    values["browser.streaming_zip_threshold_mb"],
    "Streaming threshold",
    0,
    10240,
  );
  return errors;
}

export default function BrowserSettingsPage() {
  const form = useAppSettingsDraft(paths, validate);
  return (
    <AdminSettingsFrame
      title="Browser settings"
      description="Choose where Browser is available and configure transfers."
      page="browser-settings"
      resetTitle="Reset Browser settings draft?"
      form={form}
    >
      <SettingsSection
        presentation="compact"
        title="Workspace availability"
        description="These options enable the surface. Storage permissions still apply."
      >
        <AppSettingsToggle
          form={form}
          field="general.browser_root_enabled"
          title="Browser workspace"
          description="Standalone object and bucket explorer."
          ariaLabel="Enable standalone Browser"
        />
        <AppSettingsToggle
          form={form}
          field="general.browser_manager_enabled"
          title="Manager"
          description="Embedded Browser for administration. Avoid using admin or root identities for day-to-day object operations."
          ariaLabel="Enable Browser in Manager"
        />
        <AppSettingsToggle
          form={form}
          field="general.browser_portal_enabled"
          title="Portal Storage Spaces"
          description="File browsing within a selected Storage Space."
          ariaLabel="Enable Browser in Portal Storage Spaces"
        />
        <AppSettingsToggle
          form={form}
          field="general.browser_ceph_admin_enabled"
          title="Ceph Admin"
          description="Uses endpoint-wide credentials. Object ownership may differ; prefer a connection with the expected owner for daily work."
          ariaLabel="Enable Browser in Ceph Admin"
        />
      </SettingsSection>
      <SettingsSection
        presentation="compact"
        title="Direct transfers"
        description="Concurrent browser-to-storage operations. Limits are between 1 and 20."
      >
        <AppSettingsNumber
          form={form}
          field="browser.direct_upload_parallelism"
          title="Direct uploads"
          max={20}
        />
        <AppSettingsNumber
          form={form}
          field="browser.direct_download_parallelism"
          title="Direct downloads"
          max={20}
        />
        <AppSettingsNumber
          form={form}
          field="browser.other_operations_parallelism"
          title="Other operations"
          description="Recursive deletes and server-side copies."
          max={20}
        />
      </SettingsSection>
      <SettingsSection
        presentation="compact"
        title="Server relay"
        description="Proxy transfers through the application server when direct transfers are unavailable."
      >
        <AppSettingsToggle
          form={form}
          field="browser.allow_proxy_transfers"
          title="Allow proxy transfers"
          ariaLabel="Enable proxy mode"
        />
        <AppSettingsNumber
          form={form}
          field="browser.proxy_upload_parallelism"
          title="Proxy uploads"
          max={20}
          disabled={!form.draft["browser.allow_proxy_transfers"]}
        />
        <AppSettingsNumber
          form={form}
          field="browser.proxy_download_parallelism"
          title="Proxy downloads"
          max={20}
          disabled={!form.draft["browser.allow_proxy_transfers"]}
        />
      </SettingsSection>
      <SettingsSection
        presentation="compact"
        title="ZIP downloads"
        description="Stream larger archives when the browser supports it."
      >
        <AppSettingsNumber
          form={form}
          field="browser.streaming_zip_threshold_mb"
          title="Streaming threshold (MB)"
          description="Set to 0 to always stream. Maximum: 10,240 MB."
          min={0}
          max={10240}
        />
      </SettingsSection>
    </AdminSettingsFrame>
  );
}
