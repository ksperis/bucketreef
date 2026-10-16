/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useState } from "react";
import {
  SettingsItem,
  SettingsSection,
} from "../../components/settings/SettingsLayout";
import {
  SettingsButton,
  SettingsField,
} from "../../components/settings/SettingsControls";
import SettingsDraftDialog from "../../components/settings/SettingsDraftDialog";
import AdminSettingsFrame from "./settings/AdminSettingsFrame";
import {
  AppSettingsPolicy,
  FEATURE_POLICY_SECTION_DESCRIPTION,
} from "./settings/AppSettingsFields";
import { useAppSettingsDraft } from "./settings/useAppSettingsDraft";
import {
  validateInteger,
  type AppSettingsValues,
  type FieldErrors,
  type SettingsPath,
} from "./settings/appSettingsDraft";
import { useAdminI18n } from "./adminI18n";

const migrationFields = [
  {
    path: "manager.bucket_migration_parallelism_default",
    label: "Default parallelism",
    max: 128,
  },
  {
    path: "manager.bucket_migration_parallelism_max",
    label: "Max parallelism per migration",
    max: 128,
  },
  {
    path: "manager.bucket_migration_max_active_per_endpoint",
    label: "Max active migrations per endpoint",
    max: 64,
  },
] as const;
const paths = [
  "manager.feature_policies.rgw_usage_metrics",
  "manager.feature_policies.bucket_quota_management",
  "manager.feature_policies.activity_history",
  "manager.feature_policies.ceph_s3_user_keys",
  "manager.feature_policies.access_key_metadata",
  "manager.feature_policies.access_key_expiration",
  "manager.feature_policies.managed_private_connection_provisioning",
  "manager.feature_policies.bucket_migration",
  "manager.feature_policies.bucket_compare",
  "manager.feature_policies.bucket_integrity_check",
  "manager.feature_policies.bucket_purge",
  "manager.feature_policies.feature_rules",
  ...migrationFields.map((field) => field.path),
] as const satisfies readonly SettingsPath[];

function validate(values: AppSettingsValues, text: (message: string) => string): FieldErrors {
  const errors: FieldErrors = {};
  for (const field of migrationFields)
    errors[field.path] = validateInteger(
      values[field.path],
      text(field.label),
      1,
      field.max,
    );
  if (
    !errors[migrationFields[0].path] &&
    Number(values[migrationFields[0].path]) >
      Number(values[migrationFields[1].path])
  )
    errors[migrationFields[0].path] =
      text("Default parallelism must not exceed the maximum per migration.");
  return errors;
}

export default function ManagerSettingsPage() {
  const { text } = useAdminI18n();
  const form = useAppSettingsDraft(paths, (values) => validate(values, text));
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [dialogDirty, setDialogDirty] = useState(false);
  return (
    <AdminSettingsFrame
      title={text("Manager settings")}
      description={text("Configure measurements, administrative access and bucket tools.")}
      page="manager-settings"
      resetTitle={text("Reset Manager settings draft?")}
      form={form}
      dialogDirty={dialogDirty}
      dialogs={
        migrationOpen && (
          <SettingsDraftDialog
            title={text("Bucket migration controls")}
            initialValue={
              Object.fromEntries(
                migrationFields.map((field) => [
                  field.path,
                  form.draft[field.path],
                ]),
              ) as AppSettingsValues
            }
            validate={(values) => validate(values, text)}
            onDirtyChange={setDialogDirty}
            onClose={() => setMigrationOpen(false)}
            onApply={(values) =>
              migrationFields.forEach((field) =>
                form.setValue(field.path, values[field.path]),
              )
            }
          >
            {(values, setValues, errors) => (
              <>
                {migrationFields.map((field) => (
                  <label key={field.path}>
                    <span>{text(field.label)}</span>
                    <SettingsField
                      label={text(field.label)}
                      type="number"
                      min={1}
                      max={field.max}
                      step={1}
                      value={String(values[field.path] ?? "")}
                      error={errors[field.path]}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          [field.path]: event.target.value,
                        }))
                      }
                    />
                  </label>
                ))}
              </>
            )}
          </SettingsDraftDialog>
        )
      }
    >
      <SettingsSection
        presentation="compact"
        title={text("Usage and metrics")}
        description={text(FEATURE_POLICY_SECTION_DESCRIPTION)}
      >
        <AppSettingsPolicy
          form={form}
          field="manager.feature_policies.rgw_usage_metrics"
          title={text("RGW traffic and usage metrics")}
          description={text("Available when the selected context and endpoint meet the prerequisites.")}
        />
      </SettingsSection>
      <SettingsSection
        presentation="compact"
        title={text("Administration and access")}
        description={text(FEATURE_POLICY_SECTION_DESCRIPTION)}
      >
        <AppSettingsPolicy
          form={form}
          field="manager.feature_policies.activity_history"
          title={text("Manager activity history")}
          description={text("Control and configuration history for supported Manager execution contexts. Enabled by default; each RGW Account, RGW User, or shared S3 Connection can inherit, enable, or disable it.")}
        />
        <AppSettingsPolicy
          form={form}
          field="manager.feature_policies.bucket_quota_management"
          title={text("Bucket quota management")}
          description={text("Ceph account and RGW user contexts require buckets=write on the endpoint Admin Ops identity.")}
        />
        <AppSettingsPolicy
          form={form}
          field="manager.feature_policies.ceph_s3_user_keys"
          title={text("Ceph S3 User access-key management")}
          description={text("RGW key management for eligible S3 User contexts.")}
        />
        <AppSettingsPolicy
          form={form}
          field="manager.feature_policies.access_key_metadata"
          title={text("Access-key names and notes")}
          description={text("Allow selected RGW Accounts and Users to add BucketReef-managed labels and notes to access keys.")}
        />
        <AppSettingsPolicy
          form={form}
          field="manager.feature_policies.access_key_expiration"
          title={text("Access-key expiration")}
          description={text("Allow selected RGW Accounts and Users to schedule provider-side access-key disabling. Requires scheduled jobs.")}
        />
        <AppSettingsPolicy
          form={form}
          field="manager.feature_policies.managed_private_connection_provisioning"
          title={text("Provision managed private connections")}
          description={text("Provision credentials for eligible users without revealing generated secrets.")}
          experimental
        />
      </SettingsSection>
      <SettingsSection
        presentation="compact"
        title={text("Manager tools")}
        description={text(FEATURE_POLICY_SECTION_DESCRIPTION)}
      >
        <AppSettingsPolicy
          form={form}
          field="manager.feature_policies.bucket_migration"
          title={text("Bucket migration tool")}
          experimental
        />
        <SettingsItem
          compact
          title={text("Bucket migration controls")}
          description={text("Default: {default} · Maximum: {maximum} · Active per endpoint: {active}", {
            default: String(form.draft[migrationFields[0].path]),
            maximum: String(form.draft[migrationFields[1].path]),
            active: String(form.draft[migrationFields[2].path]),
          })}
          action={
            <SettingsButton
              variant="secondary"
              onClick={() => setMigrationOpen(true)}
            >
              {text("Configure migration")}
            </SettingsButton>
          }
        />
        <AppSettingsPolicy
          form={form}
          field="manager.feature_policies.bucket_compare"
          title={text("Bucket compare tool")}
        />
        <AppSettingsPolicy
          form={form}
          field="manager.feature_policies.bucket_integrity_check"
          title={text("Bucket integrity check tool")}
        />
        <AppSettingsPolicy
          form={form}
          field="manager.feature_policies.bucket_purge"
          title={text("Bucket purge tool")}
          description={text("Also controls purge actions in Ceph Admin and Storage Ops.")}
        />
        <AppSettingsPolicy form={form} field="manager.feature_policies.feature_rules" title={text("Feature rule inventory")} description={text("Access to the Manager feature-rule inventory. Requires an eligible Manager role and storage context.")} />
      </SettingsSection>
    </AdminSettingsFrame>
  );
}
