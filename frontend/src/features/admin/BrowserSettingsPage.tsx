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
import { useAdminI18n } from "./adminI18n";

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

function validate(values: AppSettingsValues, text: (message: string) => string): FieldErrors {
  const errors: FieldErrors = {};
  for (const path of paths.filter((path) => path.endsWith("parallelism")))
    errors[path] = validateInteger(values[path], text("Parallelism"), 1, 20);
  errors["browser.streaming_zip_threshold_mb"] = validateInteger(
    values["browser.streaming_zip_threshold_mb"],
    text("Streaming threshold"),
    0,
    10240,
  );
  return errors;
}

export default function BrowserSettingsPage() {
  const { text } = useAdminI18n();
  const form = useAppSettingsDraft(paths, (values) => validate(values, text));
  return (
    <AdminSettingsFrame
      title={text("Browser settings")}
      description={text("Choose where Browser is available and configure transfers.")}
      page="browser-settings"
      resetTitle={text("Reset Browser settings draft?")}
      form={form}
    >
      <SettingsSection
        presentation="compact"
        title={text("Workspace availability")}
        description={text("These options enable the surface. Storage permissions still apply.")}
      >
        <AppSettingsToggle
          form={form}
          field="general.browser_root_enabled"
          title={text("Browser workspace")}
          description={text("Standalone object and bucket explorer.")}
          ariaLabel={text("Enable standalone Browser")}
        />
        <AppSettingsToggle
          form={form}
          field="general.browser_manager_enabled"
          title={text("Manager")}
          description={text("Embedded Browser for administration. Avoid using admin or root identities for day-to-day object operations.")}
          ariaLabel={text("Enable Browser in Manager")}
        />
        <AppSettingsToggle
          form={form}
          field="general.browser_portal_enabled"
          title={text("Portal Storage Spaces")}
          description={text("File browsing within a selected Storage Space.")}
          ariaLabel={text("Enable Browser in Portal Storage Spaces")}
        />
        <AppSettingsToggle
          form={form}
          field="general.browser_ceph_admin_enabled"
          title={text("Ceph Admin")}
          description={text("Uses endpoint-wide credentials. Object ownership may differ; prefer a connection with the expected owner for daily work.")}
          ariaLabel={text("Enable Browser in Ceph Admin")}
        />
      </SettingsSection>
      <SettingsSection
        presentation="compact"
        title={text("Direct transfers")}
        description={text("Concurrent browser-to-storage operations. Limits are between 1 and 20.")}
      >
        <AppSettingsNumber
          form={form}
          field="browser.direct_upload_parallelism"
          title={text("Direct uploads")}
          max={20}
        />
        <AppSettingsNumber
          form={form}
          field="browser.direct_download_parallelism"
          title={text("Direct downloads")}
          max={20}
        />
        <AppSettingsNumber
          form={form}
          field="browser.other_operations_parallelism"
          title={text("Other operations")}
          description={text("Recursive deletes and server-side copies.")}
          max={20}
        />
      </SettingsSection>
      <SettingsSection
        presentation="compact"
        title={text("Server relay")}
        description={text("Proxy transfers through the application server when direct transfers are unavailable.")}
      >
        <AppSettingsToggle
          form={form}
          field="browser.allow_proxy_transfers"
          title={text("Allow proxy transfers")}
          ariaLabel={text("Enable proxy mode")}
        />
        <AppSettingsNumber
          form={form}
          field="browser.proxy_upload_parallelism"
          title={text("Proxy uploads")}
          max={20}
          disabled={!form.draft["browser.allow_proxy_transfers"]}
        />
        <AppSettingsNumber
          form={form}
          field="browser.proxy_download_parallelism"
          title={text("Proxy downloads")}
          max={20}
          disabled={!form.draft["browser.allow_proxy_transfers"]}
        />
      </SettingsSection>
      <SettingsSection
        presentation="compact"
        title={text("ZIP downloads")}
        description={text("Stream larger archives when the browser supports it.")}
      >
        <AppSettingsNumber
          form={form}
          field="browser.streaming_zip_threshold_mb"
          title={text("Streaming threshold (MB)")}
          description={text("Set to 0 to always stream. Maximum: 10,240 MB.")}
          min={0}
          max={10240}
        />
      </SettingsSection>
    </AdminSettingsFrame>
  );
}
