/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useState } from "react";
import {
  SettingsItem,
  SettingsSection,
  settingsTextareaClassName,
} from "../../components/settings/SettingsLayout";
import { SettingsButton } from "../../components/settings/SettingsControls";
import SettingsDraftDialog from "../../components/settings/SettingsDraftDialog";
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
  "portal.browser_access_enabled",
  "portal.allow_private_storage_space_create",
  "portal.allow_portal_named_bucket_create",
  "portal.allow_portal_user_access_key_create",
  "portal.server_access_logging_enabled",
  "portal.server_access_log_retention_days",
  "portal.storage_space_version_cleanup_enabled",
  "portal.max_portal_user_access_keys",
  "portal.bucket_defaults.versioning",
  "portal.bucket_defaults.enable_cors",
  "portal.bucket_defaults.enable_lifecycle",
  "portal.bucket_defaults.noncurrent_version_expiration_days",
  "portal.bucket_defaults.cors_allowed_origins",
] as const satisfies readonly SettingsPath[];
const originsPath = "portal.bucket_defaults.cors_allowed_origins";
function validate(values: AppSettingsValues): FieldErrors {
  return {
    "portal.max_portal_user_access_keys": validateInteger(
      values["portal.max_portal_user_access_keys"],
      "Max S3 access keys per portal user",
      1,
    ),
    "portal.server_access_log_retention_days": validateInteger(
      values["portal.server_access_log_retention_days"],
      "Server access log retention",
      1,
    ),
    "portal.bucket_defaults.noncurrent_version_expiration_days":
      validateInteger(
        values["portal.bucket_defaults.noncurrent_version_expiration_days"],
        "Version history retention",
        1,
      ),
  };
}

export default function PortalSettingsPage() {
  const form = useAppSettingsDraft(paths, validate);
  const [corsOpen, setCorsOpen] = useState(false);
  const [dialogDirty, setDialogDirty] = useState(false);
  const origins = form.draft[originsPath] as string[] | undefined;
  return (
    <AdminSettingsFrame
      title="Portal settings"
      description="Platform capabilities and defaults for Portal projects."
      page="portal-settings"
      resetTitle="Reset Portal settings draft?"
      form={form}
      dialogDirty={dialogDirty}
      dialogs={
        corsOpen && (
          <SettingsDraftDialog
            title="CORS allowed origins"
            initialValue={(origins ?? []).join("\n")}
            onDirtyChange={setDialogDirty}
            onClose={() => setCorsOpen(false)}
            onApply={(value) =>
              form.setValue(originsPath, [
                ...new Set(
                  value
                    .split(/[,\n]/)
                    .map((item) => item.trim())
                    .filter(Boolean),
                ),
              ])
            }
          >
            {(value, setValue) => (
              <label>
                <span>One origin per line</span>
                <textarea
                  aria-label="CORS allowed origins"
                  className={settingsTextareaClassName}
                  rows={5}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                />
                <span className="text-xs text-[var(--ui-text-muted)]">
                  These origins are added to the Portal CORS rule for new
                  Storage Spaces.
                </span>
              </label>
            )}
          </SettingsDraftDialog>
        )
      }
    >
      <SettingsSection
        presentation="compact"
        title="Access and creation"
        description="Projects can personalize delegated options."
      >
        <AppSettingsToggle
          form={form}
          field="portal.browser_access_enabled"
          title="Browser workspace access"
          ariaLabel="Portal Browser workspace access"
          description="Show Portal projects in standalone Browser. File browsing inside Portal remains independent."
        />
        <AppSettingsToggle
          form={form}
          field="portal.allow_private_storage_space_create"
          title="Private Storage Space creation"
          description="Team Storage Spaces remain manager-only."
        />
        <AppSettingsToggle
          form={form}
          field="portal.allow_portal_named_bucket_create"
          title="Named storage creation"
          description="Allow a backing storage name based on the name supplied during creation."
        />
      </SettingsSection>
      <SettingsSection
        presentation="compact"
        title="Personal access keys"
        description="Keys managed by Portal users."
      >
        <AppSettingsToggle
          form={form}
          field="portal.allow_portal_user_access_key_create"
          title="Access key management"
        />
        <AppSettingsNumber
          form={form}
          field="portal.max_portal_user_access_keys"
          title="Max S3 access keys per portal user"
        />
      </SettingsSection>
      <SettingsSection
        presentation="compact"
        title="Logging and history"
        description="Audit and cleanup capabilities."
      >
        <AppSettingsToggle
          form={form}
          field="portal.server_access_logging_enabled"
          title="Server access logging"
          description="Object-level audit. Without it, there is no exhaustive object history. Changing this reconciles existing Portal logging."
        />
        <AppSettingsNumber
          form={form}
          field="portal.server_access_log_retention_days"
          title="Server access log retention"
          description="Days; applies to newly created technical log buckets."
        />
        <AppSettingsToggle
          form={form}
          field="portal.storage_space_version_cleanup_enabled"
          title="Storage Space history cleanup"
          description="Expose cleanup actions; storage permissions still determine who can execute them."
        />
      </SettingsSection>
      <SettingsSection
        presentation="compact"
        title="New Storage Space defaults"
        description="Applied during provisioning. Existing buckets are unchanged."
      >
        <AppSettingsToggle
          form={form}
          field="portal.bucket_defaults.versioning"
          title="Versioning"
        />
        <AppSettingsToggle
          form={form}
          field="portal.bucket_defaults.enable_lifecycle"
          title="Lifecycle baseline"
          description="Remove obsolete delete markers and expire older versions."
        />
        <AppSettingsNumber
          form={form}
          field="portal.bucket_defaults.noncurrent_version_expiration_days"
          title="Version history retention"
          description="Days to retain older versions."
        />
        <AppSettingsToggle
          form={form}
          field="portal.bucket_defaults.enable_cors"
          title="Portal CORS"
        />
        <SettingsItem
          compact
          title="CORS allowed origins"
          description={
            origins?.length ? origins.join(", ") : "No additional origins."
          }
          action={
            <SettingsButton
              variant="secondary"
              onClick={() => setCorsOpen(true)}
            >
              Configure origins
            </SettingsButton>
          }
        />
      </SettingsSection>
    </AdminSettingsFrame>
  );
}
