/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { StorageProvider } from "../../api/storageEndpoints";
import { SettingsSection, SettingsItem, SettingsSwitch } from "../../components/settings/SettingsLayout";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import { awsIamEndpointForRegion, awsStsEndpointForRegion, type FeaturesState, type FeatureKey } from "./storageEndpointFormModel";

export default function StorageEndpointCapabilitiesFields({
  features, provider, region, readOnly, updateFeatures, invalidateChecks,
  detecting, detectionError, warnings, usageUnavailable, signedProbeBlockedReason,
}: {
  features: FeaturesState;
  provider: StorageProvider;
  region: string;
  readOnly: boolean;
  updateFeatures: (updater: (current: FeaturesState) => FeaturesState) => void;
  invalidateChecks: () => void;
  detecting: boolean;
  detectionError: string | null;
  warnings: string[];
  usageUnavailable: boolean;
  signedProbeBlockedReason: string | null;
}) {
  const ceph = provider === "ceph";
  const aws = provider === "aws";
  const toggle = (key: FeatureKey, title: string, detected = false) =>
    <SettingsItem key={key} title={title} compact action={<SettingsSwitch ariaLabel={title}
      checked={features[key].enabled} disabled={readOnly || detected}
      onChange={enabled => updateFeatures(current => ({ ...current, [key]: { ...current[key], enabled } }))} />} />;
  return <>
    {ceph && <SettingsSection title="Ceph services"
      description="Admin, account API, usage log, and metrics are auto-detected from credentials. Usage log/metrics require supervision credentials."
      presentation="compact">
      <div className="settings-fields">
        {detecting && <UiInlineMessage tone="info" role="status">Feature detection in progress from entered credentials.</UiInlineMessage>}
        {detectionError && <UiInlineMessage tone="error" role="alert">{detectionError}</UiInlineMessage>}
        {warnings.map((warning, index) => <UiInlineMessage key={index} tone="warning">{warning}</UiInlineMessage>)}
        {usageUnavailable && <UiInlineMessage tone="warning">
          Usage Log does not seem enabled on RGW (`rgw_enable_usage_log`), so activity stats will not be populated.
        </UiInlineMessage>}
        <div>
          {toggle("admin", "Admin enabled", true)}
          {toggle("account", "Accounts enabled", true)}
          {toggle("usage", "Usage Log enabled", true)}
          {toggle("metrics", "Metrics enabled", true)}
          {toggle("sns", "SNS topics enabled")}
          {toggle("replication", "Bucket replication enabled")}
        </div>
        <UiInput label="Ceph admin endpoint override (optional)" value={features.admin.endpoint} readOnly={readOnly}
          placeholder="https://rgw-admin.example.com" onChange={event => { invalidateChecks(); updateFeatures(current => ({
            ...current, admin: { ...current.admin, endpoint: event.target.value },
          })); }} />
      </div>
    </SettingsSection>}
    <SettingsSection title="S3 capabilities" description="Enabled features describe endpoint configuration, not live health." presentation="compact">
      <div className="settings-fields">
        <div>
          {toggle("sts", "STS enabled")}
          {toggle("static_website", "Static website enabled")}
          {toggle("iam", "IAM enabled")}
          {toggle("sse", "Server-Side Encryption (SSE) enabled")}
        </div>
        <div className="settings-fields sm:grid-cols-2">
          <UiInput label={aws ? "STS endpoint" : "STS endpoint override (optional)"}
            value={aws ? awsStsEndpointForRegion(region) : features.sts.endpoint} readOnly={readOnly || aws} disabled={!features.sts.enabled}
            hint={!features.sts.enabled ? "Enable STS first to define a dedicated STS endpoint." : aws ? "Derived from the AWS region." : undefined}
            onChange={event => { if (!aws) updateFeatures(current => ({ ...current, sts: { ...current.sts, endpoint: event.target.value } })); }} />
          <UiInput label={aws ? "IAM endpoint" : "IAM endpoint override (optional)"}
            value={aws ? awsIamEndpointForRegion(region) : features.iam.endpoint} readOnly={readOnly || aws} disabled={!features.iam.enabled}
            hint={!features.iam.enabled ? "Enable IAM first to define a dedicated IAM endpoint." : aws ? "Derived from the AWS region." : undefined}
            onChange={event => { if (!aws) updateFeatures(current => ({ ...current, iam: { ...current.iam, endpoint: event.target.value } })); }} />
        </div>
      </div>
    </SettingsSection>
    <SettingsSection title="Health checks" description="Choose how the endpoint is monitored." presentation="compact">
      <div className="settings-fields">
        <UiSelect label="Healthcheck mode" value={features.healthcheck.mode ?? "http"} disabled={readOnly || !ceph}
          hint={signedProbeBlockedReason ?? undefined} onChange={event => updateFeatures(current => ({
            ...current, healthcheck: { ...current.healthcheck, mode: event.target.value === "s3" ? "s3" : "http" },
          }))}>
          <option value="http">HTTP probe</option>
          <option value="s3" disabled={Boolean(signedProbeBlockedReason)}>
            S3 signed probe{signedProbeBlockedReason ? " (requires supervision credentials)" : ""}
          </option>
        </UiSelect>
        <UiInput label="Healthcheck URL override (optional)" value={features.healthcheck.endpoint} readOnly={readOnly}
          hint="Empty value uses the endpoint URL. S3 mode signs a lightweight request with endpoint credentials."
          onChange={event => updateFeatures(current => ({ ...current, healthcheck: { ...current.healthcheck, endpoint: event.target.value } }))} />
      </div>
    </SettingsSection>
  </>;
}
