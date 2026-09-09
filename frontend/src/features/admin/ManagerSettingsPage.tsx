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
import { AppSettingsToggle } from "./settings/AppSettingsFields";
import { useAppSettingsDraft } from "./settings/useAppSettingsDraft";
import {
  validateInteger,
  type AppSettingsValues,
  type FieldErrors,
  type SettingsPath,
} from "./settings/appSettingsDraft";

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
  "general.bucket_usage_stats_enabled",
  "manager.manager_rgw_usage_metrics_enabled",
  "general.bucket_quota_management_enabled",
  "general.manager_ceph_s3_user_keys_enabled",
  "general.managed_private_connection_provisioning_enabled",
  "general.bucket_migration_enabled",
  "general.bucket_compare_enabled",
  "general.bucket_integrity_check_enabled",
  "general.bucket_purge_enabled",
  ...migrationFields.map((field) => field.path),
] as const satisfies readonly SettingsPath[];

function validate(values: AppSettingsValues): FieldErrors {
  const errors: FieldErrors = {};
  for (const field of migrationFields)
    errors[field.path] = validateInteger(
      values[field.path],
      field.label,
      1,
      field.max,
    );
  if (
    !errors[migrationFields[0].path] &&
    Number(values[migrationFields[0].path]) >
      Number(values[migrationFields[1].path])
  )
    errors[migrationFields[0].path] =
      "Default parallelism must not exceed the maximum per migration.";
  return errors;
}

export default function ManagerSettingsPage() {
  const form = useAppSettingsDraft(paths, validate);
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [dialogDirty, setDialogDirty] = useState(false);
  return (
    <AdminSettingsFrame
      title="Manager settings"
      description="Configure measurements, administrative access and bucket tools."
      page="manager-settings"
      resetTitle="Reset Manager settings draft?"
      form={form}
      dialogDirty={dialogDirty}
      dialogs={
        migrationOpen && (
          <SettingsDraftDialog
            title="Bucket migration controls"
            initialValue={
              Object.fromEntries(
                migrationFields.map((field) => [
                  field.path,
                  form.draft[field.path],
                ]),
              ) as AppSettingsValues
            }
            validate={validate}
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
                    <span>{field.label}</span>
                    <SettingsField
                      label={field.label}
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
        title="Usage and metrics"
        description="Composition scans and RGW measurements remain independent."
      >
        <AppSettingsToggle
          form={form}
          field="general.bucket_usage_stats_enabled"
          title="Bucket composition statistics"
          description="Enables scan-calculated statistics in Manager and Portal."
        />
        <AppSettingsToggle
          form={form}
          field="manager.manager_rgw_usage_metrics_enabled"
          title="RGW traffic and usage metrics"
          description="Available when the selected context and endpoint meet the prerequisites."
        />
      </SettingsSection>
      <SettingsSection
        presentation="compact"
        title="Administration and access"
        description="Enable tools without changing storage-side permissions."
      >
        <AppSettingsToggle
          form={form}
          field="general.bucket_quota_management_enabled"
          title="Bucket quota management"
          description="Ceph account and RGW user contexts require buckets=write on the endpoint Admin Ops identity."
        />
        <AppSettingsToggle
          form={form}
          field="general.manager_ceph_s3_user_keys_enabled"
          title="Ceph S3 User access-key management"
          description="RGW key management for eligible S3 User contexts."
        />
        <AppSettingsToggle
          form={form}
          field="general.managed_private_connection_provisioning_enabled"
          title="Provision managed private connections"
          description="Provision credentials for eligible users without revealing generated secrets."
          experimental
        />
      </SettingsSection>
      <SettingsSection
        presentation="compact"
        title="Manager tools"
        description="Optional administrative and operational tools available in Manager."
      >
        <AppSettingsToggle
          form={form}
          field="general.bucket_migration_enabled"
          title="Bucket migration tool"
          experimental
        />
        <SettingsItem
          compact
          title="Bucket migration controls"
          description={`Default: ${form.draft[migrationFields[0].path]} · Maximum: ${form.draft[migrationFields[1].path]} · Active per endpoint: ${form.draft[migrationFields[2].path]}`}
          action={
            <SettingsButton
              variant="secondary"
              onClick={() => setMigrationOpen(true)}
            >
              Configure migration
            </SettingsButton>
          }
        />
        <AppSettingsToggle
          form={form}
          field="general.bucket_compare_enabled"
          title="Bucket compare tool"
        />
        <AppSettingsToggle
          form={form}
          field="general.bucket_integrity_check_enabled"
          title="Bucket integrity check tool"
        />
        <AppSettingsToggle
          form={form}
          field="general.bucket_purge_enabled"
          title="Bucket purge tool"
          description="Also controls purge actions in Ceph Admin and Storage Ops."
        />
      </SettingsSection>
    </AdminSettingsFrame>
  );
}
