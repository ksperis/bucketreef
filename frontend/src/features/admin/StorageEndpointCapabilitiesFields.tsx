/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { StorageProvider } from "../../api/storageEndpoints";
import { SettingsSection, SettingsItem, SettingsSwitch } from "../../components/settings/SettingsLayout";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import { awsIamEndpointForRegion, awsStsEndpointForRegion, type FeaturesState, type FeatureKey } from "./storageEndpointFormModel";
import { useStorageEndpointI18n } from "./storageEndpointMessages";

export default function StorageEndpointCapabilitiesFields({
  features, provider, region, readOnly, updateFeatures, invalidateChecks,
  detecting, detectionError, warnings, usageUnavailable, signedProbeBlockedReason, detectedCapabilities,
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
  detectedCapabilities: { account: boolean; usage: boolean; metrics: boolean } | null;
}) {
  const { text } = useStorageEndpointI18n();
  const ceph = provider === "ceph";
  const aws = provider === "aws";
  const toggle = (key: FeatureKey, title: string, locked = false, available = true) =>
    <SettingsItem key={key} title={title} compact action={<SettingsSwitch ariaLabel={title}
      checked={features[key].enabled} disabled={readOnly || locked || !available}
      onChange={enabled => updateFeatures(current => ({ ...current, [key]: { ...current[key], enabled } }))} />} />;
  return <>
    {ceph && <SettingsSection title={text("cephServices")}
      description={text("cephServicesDescription")}
      presentation="compact">
      <div className="settings-fields">
        {detecting && <UiInlineMessage tone="info" role="status">{text("featureDetectionProgress")}</UiInlineMessage>}
        {detectionError && <UiInlineMessage tone="error" role="alert">{detectionError}</UiInlineMessage>}
        {warnings.map((warning, index) => <UiInlineMessage key={index} tone="warning">{warning}</UiInlineMessage>)}
        {usageUnavailable && <UiInlineMessage tone="warning">
          {text("usageLogDisabledNotice")}
        </UiInlineMessage>}
        <div>
          {toggle("admin", text("adminEnabled"), true)}
          {toggle("account", text("accountsEnabled"), false, detectedCapabilities?.account === true)}
          {toggle("usage", text("usageLogEnabled"), false, detectedCapabilities?.usage === true)}
          {toggle("metrics", text("metricsEnabled"), false, detectedCapabilities?.metrics === true)}
          {toggle("sns", text("snsTopicsEnabled"))}
          {toggle("replication", text("bucketReplicationEnabled"))}
        </div>
        <UiInput label={text("cephAdminEndpointOverride")} value={features.admin.endpoint} readOnly={readOnly}
          placeholder="https://rgw-admin.example.com" onChange={event => { invalidateChecks(); updateFeatures(current => ({
            ...current, admin: { ...current.admin, endpoint: event.target.value },
          })); }} />
      </div>
    </SettingsSection>}
    <SettingsSection title={text("s3Capabilities")} description={text("capabilitiesDescription")} presentation="compact">
      <div className="settings-fields">
        <div>
          {toggle("sts", text("stsEnabled"))}
          {toggle("static_website", text("staticWebsiteEnabled"))}
          {toggle("iam", text("iamEnabled"))}
          {toggle("sse", text("sseEnabled"))}
        </div>
        <div className="settings-fields sm:grid-cols-2">
          <UiInput label={aws ? text("stsEndpoint") : text("endpointOverride", { service: "STS" })}
            value={aws ? awsStsEndpointForRegion(region) : features.sts.endpoint} readOnly={readOnly || aws} disabled={!features.sts.enabled}
            hint={!features.sts.enabled ? text("enableFirst", { service: "STS" }) : aws ? text("derivedFromAwsRegion") : undefined}
            onChange={event => { if (!aws) updateFeatures(current => ({ ...current, sts: { ...current.sts, endpoint: event.target.value } })); }} />
          <UiInput label={aws ? text("iamEndpoint") : text("endpointOverride", { service: "IAM" })}
            value={aws ? awsIamEndpointForRegion(region) : features.iam.endpoint} readOnly={readOnly || aws} disabled={!features.iam.enabled}
            hint={!features.iam.enabled ? text("enableFirst", { service: "IAM" }) : aws ? text("derivedFromAwsRegion") : undefined}
            onChange={event => { if (!aws) updateFeatures(current => ({ ...current, iam: { ...current.iam, endpoint: event.target.value } })); }} />
        </div>
      </div>
    </SettingsSection>
    <SettingsSection title={text("healthChecks")} description={text("healthChecksDescription")} presentation="compact">
      <div className="settings-fields">
        <UiSelect label={text("healthcheckMode")} value={features.healthcheck.mode ?? "http"} disabled={readOnly || !ceph}
          hint={signedProbeBlockedReason ?? undefined} onChange={event => updateFeatures(current => ({
            ...current, healthcheck: { ...current.healthcheck, mode: event.target.value === "s3" ? "s3" : "http" },
          }))}>
          <option value="http">{text("httpProbe")}</option>
          <option value="s3" disabled={Boolean(signedProbeBlockedReason)}>
            {text("s3SignedProbe")}{signedProbeBlockedReason ? text("requiresSupervisionCredentials") : ""}
          </option>
        </UiSelect>
        <UiInput label={text("healthcheckUrlOverride")} value={features.healthcheck.endpoint} readOnly={readOnly}
          hint={text("healthcheckUrlHint")}
          onChange={event => updateFeatures(current => ({ ...current, healthcheck: { ...current.healthcheck, endpoint: event.target.value } }))} />
      </div>
    </SettingsSection>
  </>;
}
