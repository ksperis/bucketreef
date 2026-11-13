/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import FeatureOverrideField from "../../components/settings/FeatureOverrideField";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { useAdminI18n } from "./adminI18n";

type ManagerFeatureOverrideValue = boolean | null;

type CommonManagerFeatureKey =
  | "allow_rgw_usage_metrics"
  | "allow_cost_estimation"
  | "allow_access_key_metadata"
  | "allow_access_key_expiration"
  | "allow_activity_history"
  | "allow_multisite_endpoint_switching"
  | "allow_manager_browser_data_access_for_all_admins"
  | "allow_bucket_quota_management";

type UserManagerFeatureKey =
  | CommonManagerFeatureKey
  | "allow_access_key_management"
  | "allow_managed_private_connection_provisioning";

type CommonManagerFeatureValues = Record<CommonManagerFeatureKey, ManagerFeatureOverrideValue>;
type UserManagerFeatureValues = CommonManagerFeatureValues &
  Record<Exclude<UserManagerFeatureKey, CommonManagerFeatureKey>, ManagerFeatureOverrideValue>;

type AdminManagerFeatureOverridesProps =
  | {
      resource: "account";
      value: CommonManagerFeatureValues;
      disabled: boolean;
      bucketQuotaAvailable: boolean;
      onChange: (key: CommonManagerFeatureKey, value: ManagerFeatureOverrideValue) => void;
    }
  | {
      resource: "user";
      value: UserManagerFeatureValues;
      disabled: boolean;
      bucketQuotaAvailable: boolean;
      onChange: (key: UserManagerFeatureKey, value: ManagerFeatureOverrideValue) => void;
    };

export default function AdminManagerFeatureOverrides(props: AdminManagerFeatureOverridesProps) {
  const { text: adminText } = useAdminI18n();
  const { generalSettings } = useGeneralSettings();
  const policies = generalSettings.manager_feature_policies;
  const account = props.resource === "account";
  const managerBrowserDataAccessActive = policies.manager_browser_data_access !== "disabled"
    && (props.value.allow_manager_browser_data_access_for_all_admins
      ?? policies.manager_browser_data_access === "default_on");

  return (
    <div className="settings-stack">
      {managerBrowserDataAccessActive && (
        <UiInlineMessage tone="warning">
          {adminText(account
            ? "Audit limitation: automatic Manager Browser data access is active for this RGW Account. All eligible Account administrators can use the account root identity for data-plane access. BucketReef does not audit those data-plane actions; configure data-plane auditing in RGW."
            : "Audit limitation: automatic Manager Browser data access is active for this RGW User. All eligible Manager administrators can use the same access key stored for Manager administration. BucketReef does not audit those data-plane actions; configure data-plane auditing in RGW.")}
        </UiInlineMessage>
      )}
      <SettingsSection presentation="compact" title={adminText("Data access")}>
        <FeatureOverrideField
          title={adminText("Manager Browser data access")}
          value={props.value.allow_manager_browser_data_access_for_all_admins}
          policy={policies.manager_browser_data_access}
          disabled={props.disabled}
          triState
          help={adminText(
            account
              ? "Controls automatic embedded Browser data-plane access for all eligible Account administrators of this RGW Account. Access uses the account root identity. Explicit per-association grants remain independent."
              : "Controls automatic embedded Browser data-plane access for all administrators already assigned to this RGW User. Access uses the same access key stored for Manager administration. Explicit per-association grants remain independent.",
          )}
          onChange={(value) => props.onChange("allow_manager_browser_data_access_for_all_admins", value)}
        />
      </SettingsSection>
      <SettingsSection presentation="compact" title={adminText("Usage and metrics")}>
        <FeatureOverrideField
          title={adminText("RGW traffic and usage metrics")}
          value={props.value.allow_rgw_usage_metrics}
          policy={policies.rgw_usage_metrics}
          disabled={props.disabled}
          triState
          {...(account
            ? {
                help: adminText(
                  "Controls traffic and usage metrics for this RGW Account. Endpoint capabilities and supervision credentials still apply.",
                ),
              }
            : {
                description: adminText(
                  "Controls traffic and usage metrics for this RGW User. Endpoint capabilities and supervision credentials still apply.",
                ),
              })}
          onChange={(value) => props.onChange("allow_rgw_usage_metrics", value)}
        />
        <FeatureOverrideField
          title={adminText("Cost estimation")}
          value={props.value.allow_cost_estimation}
          policy={policies.cost_estimation}
          disabled={props.disabled}
          triState
          description={adminText(
            account
              ? "Controls the Cost tab for this RGW Account in Manager Usage & Metrics."
              : "Controls the Cost tab for this RGW User in Manager Usage & Metrics.",
          )}
          onChange={(value) => props.onChange("allow_cost_estimation", value)}
        />
      </SettingsSection>

      <SettingsSection presentation="compact" title={adminText("Access-key extensions")}>
        <FeatureOverrideField
          title={adminText("Access-key names and notes")}
          value={props.value.allow_access_key_metadata}
          policy={policies.access_key_metadata}
          disabled={props.disabled}
          triState
          description={adminText(
            account
              ? "Optional. Name and notes are stored in BucketReef."
              : "Name and notes are stored in BucketReef.",
          )}
          onChange={(value) => props.onChange("allow_access_key_metadata", value)}
        />
        <FeatureOverrideField
          title={adminText("Access-key expiration")}
          value={props.value.allow_access_key_expiration}
          policy={policies.access_key_expiration}
          disabled={props.disabled}
          triState
          help={adminText(
            account
              ? "Schedules provider-side key disabling. Requires scheduled jobs; recorded expirations remain scheduled after opt-out."
              : "Requires Ceph, key management and scheduled jobs. Existing expirations remain scheduled.",
          )}
          onChange={(value) => props.onChange("allow_access_key_expiration", value)}
        />
      </SettingsSection>

      <SettingsSection presentation="compact" title={adminText("Activity history")}>
        <FeatureOverrideField
          title={adminText("Manager activity history")}
          value={props.value.allow_activity_history}
          policy={policies.activity_history}
          disabled={props.disabled}
          triState
          description={adminText(
            account
              ? "Shows account-scoped Manager control and configuration actions. It does not include S3 object access logs."
              : "Shows RGW User Manager control and configuration actions. It does not include S3 object access logs.",
          )}
          onChange={(value) => props.onChange("allow_activity_history", value)}
        />
      </SettingsSection>

      <SettingsSection presentation="compact" title={adminText("RGW multisite")}>
        <FeatureOverrideField
          title={adminText("Endpoint switching")}
          value={props.value.allow_multisite_endpoint_switching}
          policy={policies.rgw_multisite_endpoint_switching}
          disabled={props.disabled}
          triState
          help={adminText(
            account
              ? "Grants endpoint switching for this RGW Account when the destination is in the same realm and zonegroup. UI User and UI Group grants remain additive."
              : "Grants endpoint switching for this RGW User when the destination is in the same realm and zonegroup. UI User and UI Group grants remain additive.",
          )}
          onChange={(value) => props.onChange("allow_multisite_endpoint_switching", value)}
        />
      </SettingsSection>

      <SettingsSection presentation="compact" title={adminText("Privileged Ceph operations")}>
        <FeatureOverrideField
          title={adminText("Bucket quota management")}
          value={props.value.allow_bucket_quota_management}
          policy={policies.bucket_quota_management}
          disabled={props.disabled}
          triState
          unavailable={!props.bucketQuotaAvailable ? adminText("Endpoint permission required") : undefined}
          description={adminText(
            account
              ? "Requires buckets=write on the endpoint Admin Ops identity. Storage authorization remains required."
              : "Requires buckets=write on the endpoint Admin Ops identity.",
          )}
          onChange={(value) => props.onChange("allow_bucket_quota_management", value)}
        />
        {!account && (
          <>
            <FeatureOverrideField
              title={adminText("Ceph S3 User keys")}
              value={props.value.allow_access_key_management}
              policy={policies.ceph_s3_user_keys}
              disabled={props.disabled}
              triState
              description={adminText(
                "Manages RGW User keys in Manager; storage and endpoint permissions remain required.",
              )}
              onChange={(value) => props.onChange("allow_access_key_management", value)}
            />
            <FeatureOverrideField
              title={adminText("Managed private connection provisioning")}
              value={props.value.allow_managed_private_connection_provisioning}
              policy={policies.managed_private_connection_provisioning}
              disabled={props.disabled}
              triState
              help={adminText(
                "Requires an eligible UI user and compatible endpoint. Generated secrets remain managed by BucketReef.",
              )}
              onChange={(value) => props.onChange("allow_managed_private_connection_provisioning", value)}
            />
          </>
        )}
      </SettingsSection>
    </div>
  );
}
