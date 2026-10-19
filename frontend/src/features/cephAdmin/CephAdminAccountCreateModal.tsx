/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useState, type FormEvent } from "react";
import {
  CephAdminRgwAccountDetail,
  createCephAdminAccount,
  CreateCephAdminAccountPayload,
} from "../../api/cephAdminAccounts";
import SettingsWorkflowForm from "../../components/settings/SettingsWorkflowForm";
import PageBanner from "../../components/PageBanner";
import CephAdminAccountFormFields from "./CephAdminAccountFormFields";
import { parseCephAdminAccountLimits, validateCephAdminAccountForm } from "./cephAdminAccountForm";
import { focusFirstInvalidField } from "../../utils/focusFirstInvalidField";
import { extractApiError } from "../../utils/apiError";
import { stableSignature } from "../../utils/stableSignature";
import { rgwTenantFormatError } from "../../utils/resourceNames";
import CephAdminQuotaFields from "./CephAdminQuotaFields";
import { cephAdminPageBreadcrumbs } from "./cephAdminBreadcrumbs";
import {
  parseOptionalNonNegativeInteger,
  parseQuotaBytes,
  type CephAdminQuotaUnit,
} from "./quotaForm";
import { useCephAdminI18n } from "./cephAdminI18n";

type Props = {
  endpointId: number;
  onClose: () => void;
  onCreated?: (detail: CephAdminRgwAccountDetail) => void;
};

export default function CephAdminAccountCreateModal({ endpointId, onClose, onCreated }: Props) {
  const { text: surfaceText } = useCephAdminI18n();
  const [accountName, setAccountName] = useState("");
  const [tenant, setTenant] = useState("");
  const [email, setEmail] = useState("");
  const [maxUsers, setMaxUsers] = useState("");
  const [maxBuckets, setMaxBuckets] = useState("");
  const [maxRoles, setMaxRoles] = useState("");
  const [maxGroups, setMaxGroups] = useState("");
  const [maxAccessKeys, setMaxAccessKeys] = useState("");

  const [accountQuotaEnabled, setAccountQuotaEnabled] = useState(false);
  const [accountQuotaSize, setAccountQuotaSize] = useState("");
  const [accountQuotaUnit, setAccountQuotaUnit] = useState<CephAdminQuotaUnit>("GiB");
  const [accountQuotaObjects, setAccountQuotaObjects] = useState("");

  const [bucketQuotaEnabled, setBucketQuotaEnabled] = useState(false);
  const [bucketQuotaSize, setBucketQuotaSize] = useState("");
  const [bucketQuotaUnit, setBucketQuotaUnit] = useState<CephAdminQuotaUnit>("GiB");
  const [bucketQuotaObjects, setBucketQuotaObjects] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const currentSignature = useMemo(
    () =>
      stableSignature({
        accountName,
        tenant,
        email,
        maxUsers,
        maxBuckets,
        maxRoles,
        maxGroups,
        maxAccessKeys,
        accountQuotaEnabled,
        accountQuotaSize,
        accountQuotaUnit,
        accountQuotaObjects,
        bucketQuotaEnabled,
        bucketQuotaSize,
        bucketQuotaUnit,
        bucketQuotaObjects,
      }),
    [
      accountName,
      tenant,
      accountQuotaEnabled,
      accountQuotaObjects,
      accountQuotaSize,
      accountQuotaUnit,
      bucketQuotaEnabled,
      bucketQuotaObjects,
      bucketQuotaSize,
      bucketQuotaUnit,
      email,
      maxAccessKeys,
      maxBuckets,
      maxGroups,
      maxRoles,
      maxUsers,
    ]
  );
  const [initialSignature, setInitialSignature] = useState(currentSignature);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const profileValues = { accountName, email, maxUsers, maxBuckets, maxRoles, maxGroups, maxAccessKeys };
  const validation = validateCephAdminAccountForm(profileValues,
    { enabled: accountQuotaEnabled, size: accountQuotaSize, unit: accountQuotaUnit, objects: accountQuotaObjects },
    { enabled: bucketQuotaEnabled, size: bucketQuotaSize, unit: bucketQuotaUnit, objects: bucketQuotaObjects }, true);
  const tenantError = rgwTenantFormatError(tenant.trim());

  const submit = (event: FormEvent<HTMLFormElement>) => {
    if (saving) return;
    setError(null);
    setStatus(null);
    setValidationAttempted(true);
    if (validation.invalid || tenantError) {
      focusFirstInvalidField(event.currentTarget);
      return;
    }
    const limits = parseCephAdminAccountLimits(profileValues);
    const parsedAccountQuotaBytes = accountQuotaEnabled ? parseQuotaBytes(accountQuotaSize, accountQuotaUnit) : null;
    const parsedAccountQuotaObjects = accountQuotaEnabled ? parseOptionalNonNegativeInteger(accountQuotaObjects) : null;
    const parsedBucketQuotaBytes = bucketQuotaEnabled ? parseQuotaBytes(bucketQuotaSize, bucketQuotaUnit) : null;
    const parsedBucketQuotaObjects = bucketQuotaEnabled ? parseOptionalNonNegativeInteger(bucketQuotaObjects) : null;

    const payload: CreateCephAdminAccountPayload = {
      account_name: accountName.trim(),
      tenant: tenant.trim() || undefined,
      email: email.trim() || undefined,
      max_users: limits.max_users ?? undefined,
      max_buckets: limits.max_buckets ?? undefined,
      max_roles: limits.max_roles ?? undefined,
      max_groups: limits.max_groups ?? undefined,
      max_access_keys: limits.max_access_keys ?? undefined,
      quota_enabled: accountQuotaEnabled ? true : undefined,
      quota_max_size_bytes: parsedAccountQuotaBytes ?? undefined,
      quota_max_objects: parsedAccountQuotaObjects ?? undefined,
      bucket_quota_enabled: bucketQuotaEnabled ? true : undefined,
      bucket_quota_max_size_bytes: parsedBucketQuotaBytes ?? undefined,
      bucket_quota_max_objects: parsedBucketQuotaObjects ?? undefined,
    };

    setSaving(true);
    return (async () => {
      try {
        const response = await createCephAdminAccount(endpointId, payload);
        onCreated?.(response.account);
        setInitialSignature(currentSignature);
        setStatus(surfaceText("Account {id} created.", { id: response.account.account_id }));
      } catch (err) {
        setError(extractApiError(err, surfaceText("Unexpected error")));
      } finally {
        setSaving(false);
      }
    })();
  };

  return (
    <SettingsWorkflowForm
      title={surfaceText("Create account")}
      description={surfaceText("Define the RGW account identity and quotas in a dedicated Ceph Admin workflow.")}
      breadcrumbs={cephAdminPageBreadcrumbs("accounts", { label: surfaceText("Create") })}
      backLabel={surfaceText("Back to accounts")}
      width="standard"
      contentVariant="plain"
      formLabel={surfaceText("Create RGW account")}
      dirty={currentSignature !== initialSignature}
      busy={saving}
      error={error}
      submitLabel={surfaceText("Create account")}
      busyLabel={surfaceText("Creating...")}
      onSubmit={submit}
      onClose={onClose}
    >
      {status && <PageBanner tone="success">{status}</PageBanner>}
      <CephAdminAccountFormFields creating values={profileValues}
        tenant={{ value: tenant, error: validationAttempted ? tenantError ?? undefined : undefined, onChange: setTenant }}
        errors={validationAttempted ? validation.profile : undefined}
        onChange={(field, value) => ({ accountName: setAccountName, email: setEmail,
          maxBuckets: setMaxBuckets, maxUsers: setMaxUsers, maxRoles: setMaxRoles,
          maxGroups: setMaxGroups, maxAccessKeys: setMaxAccessKeys })[field](value)} />

      <CephAdminQuotaFields
        title={surfaceText("Account quota")}
        enabledLabel={surfaceText("Enable account quota")}
        enabled={accountQuotaEnabled}
        onEnabledChange={setAccountQuotaEnabled}
        sizeValue={accountQuotaSize}
        onSizeChange={setAccountQuotaSize}
        unitValue={accountQuotaUnit}
        onUnitChange={setAccountQuotaUnit}
        sizeError={validationAttempted ? validation.accountQuota.size : undefined}
        objectError={validationAttempted ? validation.accountQuota.objects : undefined}
        objectValue={accountQuotaObjects}
        onObjectChange={setAccountQuotaObjects}
      />

      <CephAdminQuotaFields
        title={surfaceText("Bucket quota")}
        enabledLabel={surfaceText("Enable bucket quota")}
        enabled={bucketQuotaEnabled}
        onEnabledChange={setBucketQuotaEnabled}
        sizeValue={bucketQuotaSize}
        onSizeChange={setBucketQuotaSize}
        unitValue={bucketQuotaUnit}
        onUnitChange={setBucketQuotaUnit}
        sizeError={validationAttempted ? validation.bucketQuota.size : undefined}
        objectError={validationAttempted ? validation.bucketQuota.objects : undefined}
        objectValue={bucketQuotaObjects}
        onObjectChange={setBucketQuotaObjects}
      />
    </SettingsWorkflowForm>
  );
}
