/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useState, type FormEvent } from "react";
import {
  CephAdminRgwAccountDetail,
  createCephAdminAccount,
  CreateCephAdminAccountPayload,
} from "../../api/cephAdminAccounts";
import SettingsWorkflowForm from "../../components/settings/SettingsWorkflowForm";
import { useSettingsDraft } from "../../components/settings/useSettingsDraft";
import PageBanner from "../../components/PageBanner";
import CephAdminAccountFormFields from "./CephAdminAccountFormFields";
import {
  createEmptyCephAdminAccountDraft,
  parseCephAdminAccountLimits,
  validateCephAdminAccountForm,
  type CephAdminAccountDraft,
} from "./cephAdminAccountForm";
import { focusFirstInvalidField } from "../../utils/focusFirstInvalidField";
import { extractApiError } from "../../utils/apiError";
import { rgwTenantFormatError } from "../../utils/resourceNames";
import CephAdminQuotaFields from "./CephAdminQuotaFields";
import { cephAdminPageBreadcrumbs } from "./cephAdminBreadcrumbs";
import {
  parseOptionalNonNegativeInteger,
  parseQuotaBytes,
} from "./quotaForm";
import { useCephAdminI18n } from "./cephAdminI18n";

type Props = {
  endpointId: number;
  onClose: () => void;
  onCreated?: (detail: CephAdminRgwAccountDetail) => void;
};

type AccountCreateDraft = CephAdminAccountDraft & { tenant: string };

export default function CephAdminAccountCreateModal({ endpointId, onClose, onCreated }: Props) {
  const { text: surfaceText } = useCephAdminI18n();
  const { draft, setDraft, accept, dirty } = useSettingsDraft<AccountCreateDraft>(() => ({
    ...createEmptyCephAdminAccountDraft(),
    tenant: "",
  }));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const validation = validateCephAdminAccountForm(draft.profile, draft.accountQuota, draft.bucketQuota, true);
  const tenantError = rgwTenantFormatError(draft.tenant.trim());

  const submit = (event: FormEvent<HTMLFormElement>) => {
    if (saving) return;
    setError(null);
    setStatus(null);
    setValidationAttempted(true);
    if (validation.invalid || tenantError) {
      focusFirstInvalidField(event.currentTarget);
      return;
    }
    const limits = parseCephAdminAccountLimits(draft.profile);
    const parsedAccountQuotaBytes = draft.accountQuota.enabled ? parseQuotaBytes(draft.accountQuota.size, draft.accountQuota.unit) : null;
    const parsedAccountQuotaObjects = draft.accountQuota.enabled ? parseOptionalNonNegativeInteger(draft.accountQuota.objects) : null;
    const parsedBucketQuotaBytes = draft.bucketQuota.enabled ? parseQuotaBytes(draft.bucketQuota.size, draft.bucketQuota.unit) : null;
    const parsedBucketQuotaObjects = draft.bucketQuota.enabled ? parseOptionalNonNegativeInteger(draft.bucketQuota.objects) : null;

    const payload: CreateCephAdminAccountPayload = {
      account_name: draft.profile.accountName.trim(),
      tenant: draft.tenant.trim() || undefined,
      email: draft.profile.email.trim() || undefined,
      max_users: limits.max_users ?? undefined,
      max_buckets: limits.max_buckets ?? undefined,
      max_roles: limits.max_roles ?? undefined,
      max_groups: limits.max_groups ?? undefined,
      max_access_keys: limits.max_access_keys ?? undefined,
      quota_enabled: draft.accountQuota.enabled ? true : undefined,
      quota_max_size_bytes: parsedAccountQuotaBytes ?? undefined,
      quota_max_objects: parsedAccountQuotaObjects ?? undefined,
      bucket_quota_enabled: draft.bucketQuota.enabled ? true : undefined,
      bucket_quota_max_size_bytes: parsedBucketQuotaBytes ?? undefined,
      bucket_quota_max_objects: parsedBucketQuotaObjects ?? undefined,
    };

    setSaving(true);
    return (async () => {
      try {
        const response = await createCephAdminAccount(endpointId, payload);
        onCreated?.(response.account);
        accept(draft);
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
      dirty={dirty}
      busy={saving}
      error={error}
      submitLabel={surfaceText("Create account")}
      busyLabel={surfaceText("Creating...")}
      onSubmit={submit}
      onClose={onClose}
    >
      {status && <PageBanner tone="success">{status}</PageBanner>}
      <CephAdminAccountFormFields creating values={draft.profile}
        tenant={{ value: draft.tenant, error: validationAttempted ? tenantError ?? undefined : undefined,
          onChange: (tenant) => setDraft(value => ({ ...value, tenant })) }}
        errors={validationAttempted ? validation.profile : undefined}
        onChange={(field, value) => setDraft(current => ({
          ...current,
          profile: { ...current.profile, [field]: value },
        }))} />

      <CephAdminQuotaFields
        title={surfaceText("Account quota")}
        enabledLabel={surfaceText("Enable account quota")}
        enabled={draft.accountQuota.enabled}
        onEnabledChange={(enabled) => setDraft(current => ({ ...current, accountQuota: { ...current.accountQuota, enabled } }))}
        sizeValue={draft.accountQuota.size}
        onSizeChange={(size) => setDraft(current => ({ ...current, accountQuota: { ...current.accountQuota, size } }))}
        unitValue={draft.accountQuota.unit}
        onUnitChange={(unit) => setDraft(current => ({ ...current, accountQuota: { ...current.accountQuota, unit } }))}
        sizeError={validationAttempted ? validation.accountQuota.size : undefined}
        objectError={validationAttempted ? validation.accountQuota.objects : undefined}
        objectValue={draft.accountQuota.objects}
        onObjectChange={(objects) => setDraft(current => ({ ...current, accountQuota: { ...current.accountQuota, objects } }))}
      />

      <CephAdminQuotaFields
        title={surfaceText("Bucket quota")}
        enabledLabel={surfaceText("Enable bucket quota")}
        enabled={draft.bucketQuota.enabled}
        onEnabledChange={(enabled) => setDraft(current => ({ ...current, bucketQuota: { ...current.bucketQuota, enabled } }))}
        sizeValue={draft.bucketQuota.size}
        onSizeChange={(size) => setDraft(current => ({ ...current, bucketQuota: { ...current.bucketQuota, size } }))}
        unitValue={draft.bucketQuota.unit}
        onUnitChange={(unit) => setDraft(current => ({ ...current, bucketQuota: { ...current.bucketQuota, unit } }))}
        sizeError={validationAttempted ? validation.bucketQuota.size : undefined}
        objectError={validationAttempted ? validation.bucketQuota.objects : undefined}
        objectValue={draft.bucketQuota.objects}
        onObjectChange={(objects) => setDraft(current => ({ ...current, bucketQuota: { ...current.bucketQuota, objects } }))}
      />
    </SettingsWorkflowForm>
  );
}
