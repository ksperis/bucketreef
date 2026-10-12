/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useId } from "react";
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
  const disabledReasonIdPrefix = useId();
  const ceph = provider === "ceph";
  const aws = provider === "aws";
  const toggle = (key: FeatureKey, title: string, locked = false, available = true, disabledReason?: string) => {
    const disabled = readOnly || locked || !available;
    const reason = disabled ? disabledReason : undefined;
    const reasonId = reason ? `${disabledReasonIdPrefix}-${key}-disabled-reason` : undefined;
    return <SettingsItem key={key} title={title} compact action={
      <span className="inline-flex" title={reason}>
        <SettingsSwitch ariaLabel={title} ariaDescribedBy={reasonId}
          checked={features[key].enabled} disabled={disabled}
          onChange={enabled => updateFeatures(current => ({ ...current, [key]: { ...current[key], enabled } }))} />
        {reasonId && <span id={reasonId} className="sr-only">{reason}</span>}
      </span>
    } />;
  };
  const readOnlyReason = readOnly ? text("cephServiceReadOnlyReason") : undefined;
  const unavailableReason = (key: "accountsUnavailableReason" | "usageLogUnavailableReason" | "metricsUnavailableReason") =>
    readOnlyReason ?? (detecting ? text("featureDetectionProgress") : text(key));
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
          {toggle("admin", text("adminEnabled"), true, true, readOnlyReason ?? text("adminAutoDetectedReason"))}
          {toggle("account", text("accountsEnabled"), false, detectedCapabilities?.account === true,
            unavailableReason("accountsUnavailableReason"))}
          {toggle("usage", text("usageLogEnabled"), false, detectedCapabilities?.usage === true,
            unavailableReason("usageLogUnavailableReason"))}
          {toggle("metrics", text("metricsEnabled"), false, detectedCapabilities?.metrics === true,
            unavailableReason("metricsUnavailableReason"))}
          {toggle("sns", text("snsTopicsEnabled"), false, true, readOnlyReason)}
          {toggle("replication", text("bucketReplicationEnabled"), false, true, readOnlyReason)}
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
