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
  "manager.feature_policies.cost_estimation",
  "manager.feature_policies.bucket_quota_management",
  "manager.feature_policies.activity_history",
  "manager.feature_policies.ceph_s3_user_keys",
  "manager.feature_policies.access_key_metadata",
  "manager.feature_policies.access_key_expiration",
  "manager.feature_policies.manager_browser_data_access",
  "manager.feature_policies.managed_private_connection_provisioning",
  "manager.feature_policies.rgw_multisite_endpoint_switching",
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
  const managerBrowserDataAccessDetails = (
    <div className="grid gap-2">
      <div>
        {text("Controls automatic embedded Browser data-plane access for all eligible administrators of RGW Accounts and RGW Users. Explicit per-association grants remain independent.")}
      </div>
      <div>
        <div className="font-medium">{text("Policy behavior")}</div>
        <ul className="mt-1 list-disc space-y-1 pl-4">
          <li>{text("Disabled: no automatic access. Explicit Allow Manager Browser data access grants on associations remain effective.")}</li>
          <li>{text("Targeted activation: automatic access is enabled only for RGW Accounts or RGW Users explicitly enabled in their Manager features.")}</li>
          <li>{text("Enabled by default: automatic access applies to eligible RGW Accounts and RGW Users unless the resource explicitly disables it.")}</li>
        </ul>
      </div>
      <div>
        <div className="font-medium">{text("Why this is generally not recommended")}</div>
        <div className="mt-1">
          {text("Automatic RGW Account access uses the account root identity. Automatic RGW User access reuses the same access key stored for Manager administration.")}
        </div>
        <div className="mt-1">
          {text("BucketReef does not record these data-plane operations in its application audit logs, so it cannot provide per-action attribution for Browser object operations.")}
        </div>
      </div>
      <div>
        <div className="font-medium">{text("Preferred alternatives")}</div>
        <ul className="mt-1 list-disc space-y-1 pl-4">
          <li>
            <span className="font-medium">{text("Provision managed private connections")}</span>{" "}
            {text("When available, this lets administrators create personal access backed by a distinct RGW User credential and private S3 connection. The generated secret is not exposed to the browser.")}
          </li>
          <li>
            <span className="font-medium">{text("Explicit association grants")}</span>{" "}
            {text("Use the advanced Allow Manager Browser data access setting only on the user or group associations that need embedded Browser access.")}
          </li>
        </ul>
      </div>
      <div>
        {text("If object-level audit attribution is required, configure data-plane auditing in RGW.")}
      </div>
    </div>
  );
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
                  <div key={field.path} className="grid gap-1">
                    <span className="settings-label">{text(field.label)}</span>
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
                  </div>
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
        <AppSettingsPolicy
          form={form}
          field="manager.feature_policies.cost_estimation"
          title={text("Cost estimation")}
          description={text("Show estimated costs in Manager Usage & Metrics when Cost is enabled globally.")}
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
          description={text("Control and configuration history for supported Manager execution contexts.")}
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
          field="manager.feature_policies.manager_browser_data_access"
          title={text("Manager Browser data access")}
          defaultOnWarning={{
            label: text("Audit limitation"),
            description: managerBrowserDataAccessDetails,
          }}
          description={managerBrowserDataAccessDetails}
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
        title={text("RGW multisite")}
        description={text("Control endpoint-switching grants supplied by RGW Accounts and RGW Users. UI User and UI Group grants remain additive.")}
      >
        <AppSettingsPolicy
          form={form}
          field="manager.feature_policies.rgw_multisite_endpoint_switching"
          title={text("RGW Account and User endpoint switching")}
          description={text("Endpoint switching for compatible RGW Accounts and RGW Users.")}
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
