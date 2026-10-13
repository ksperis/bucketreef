/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useState } from "react";
import {
  SettingsItem,
  SettingsSection,
} from "../../components/settings/SettingsLayout";
import { SettingsButton } from "../../components/settings/SettingsControls";
import SettingsDraftDialog from "../../components/settings/SettingsDraftDialog";
import UiTextarea from "../../components/ui/UiTextarea";
import AdminSettingsFrame from "./settings/AdminSettingsFrame";
import {
  AppSettingsNumber,
  AppSettingsPolicy,
  AppSettingsToggle,
  FEATURE_POLICY_SECTION_DESCRIPTION,
} from "./settings/AppSettingsFields";
import { useAppSettingsDraft } from "./settings/useAppSettingsDraft";
import {
  validateInteger,
  type AppSettingsValues,
  type FieldErrors,
  type SettingsPath,
} from "./settings/appSettingsDraft";

const paths = [
  "portal.feature_policies.browser_access",
  "portal.feature_policies.private_storage_space_create",
  "portal.feature_policies.named_bucket_create",
  "portal.feature_policies.user_access_key_create",
  "portal.feature_policies.user_external_sharing",
  "portal.feature_policies.server_access_logging",
  "portal.server_access_log_retention_days",
  "portal.feature_policies.storage_space_version_cleanup",
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
              <UiTextarea
                label="One origin per line"
                hint="These origins are added to the Portal CORS rule for new Storage Spaces."
                aria-label="CORS allowed origins"
                className="min-h-[96px]"
                rows={5}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            )}
          </SettingsDraftDialog>
        )
      }
    >
      <SettingsSection
        presentation="compact"
        title="Access and creation"
        description={FEATURE_POLICY_SECTION_DESCRIPTION}
      >
        <AppSettingsPolicy
          form={form}
          field="portal.feature_policies.browser_access"
          title="Browser workspace access"
          ariaLabel="Portal Browser workspace access"
          description="Show Portal projects in standalone Browser. File browsing inside Portal remains independent."
        />
        <AppSettingsPolicy
          form={form}
          field="portal.feature_policies.private_storage_space_create"
          title="Private Storage Space creation"
          description="Team Storage Spaces remain manager-only."
        />
        <AppSettingsPolicy
          form={form}
          field="portal.feature_policies.named_bucket_create"
          title="Named storage creation"
          description="Allow a backing storage name based on the name supplied during creation."
        />
      </SettingsSection>
      <SettingsSection
        presentation="compact"
        title="Personal access keys"
      >
        <AppSettingsPolicy
          form={form}
          field="portal.feature_policies.user_access_key_create"
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
        title="External sharing"
      >
        <AppSettingsPolicy
          form={form}
          field="portal.feature_policies.user_external_sharing"
          title="External sharing by Portal users"
          description="Allow Portal users to create public links and external S3 tool access only for Storage Spaces they own. Portal managers keep their existing project-wide capabilities."
        />
      </SettingsSection>
      <SettingsSection
        presentation="compact"
        title="Logging and history"
      >
        <AppSettingsPolicy
          form={form}
          field="portal.feature_policies.server_access_logging"
          title="Server access logging"
          description="Object-level audit. Without it, there is no exhaustive object history. Changing this reconciles existing Portal logging."
        />
        <AppSettingsNumber
          form={form}
          field="portal.server_access_log_retention_days"
          title="Server access log retention"
          description="Days; applies to newly created technical log buckets."
        />
        <AppSettingsPolicy
          form={form}
          field="portal.feature_policies.storage_space_version_cleanup"
          title="Storage Space history cleanup"
          description="Expose cleanup actions; storage permissions still determine who can execute them."
        />
      </SettingsSection>
      <SettingsSection
        presentation="compact"
        title="New Storage Space defaults"
        description="Applied at creation."
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
