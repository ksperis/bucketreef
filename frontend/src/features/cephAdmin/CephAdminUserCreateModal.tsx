/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useI18n } from "../../i18n";
import { rgwUserNameErrorText } from "../../utils/rgwUserNameMessages";
import { rgwUserUidFormatError, rgwTenantFormatError } from "../../utils/resourceNames";
import { useCallback, useMemo, useState, type FormEvent } from "react";
import {
  CephAdminRgwUserDetail,
  createCephAdminUser,
  CreateCephAdminUserPayload,
} from "../../api/cephAdminUsers";
import { listCephAdminAccounts } from "../../api/cephAdminAccounts";
import PaginationControls from "../../components/PaginationControls";
import AddS3ConnectionFromKeyModal from "../../components/AddS3ConnectionFromKeyModal";
import SettingsWorkflowForm from "../../components/settings/SettingsWorkflowForm";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import { SettingsButton } from "../../components/settings/SettingsControls";
import { useSettingsDraft } from "../../components/settings/useSettingsDraft";
import OneTimeSecretPanel from "../../components/OneTimeSecretPanel";
import PageBanner from "../../components/PageBanner";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import usePaginatedOptions from "../../hooks/usePaginatedOptions";
import { CephAdminUserProfileFields, CephAdminUserFlags, CephAdminUserCapsFields } from "./CephAdminUserFormFields";
import {
  createEmptyCephAdminUserDraft,
  parseCephAdminUserCaps,
  validateCephAdminUserLimits,
  type CephAdminUserDraft,
} from "./cephAdminUserForm";
import { extractApiError } from "../../utils/apiError";
import { focusFirstInvalidField } from "../../utils/focusFirstInvalidField";
import { canCreateManualPrivateConnections, readStoredUser } from "../../utils/workspaces";
import { buildCephConnectionDefaults } from "../shared/s3ConnectionFromKey";
import CephAdminQuotaFields from "./CephAdminQuotaFields";
import { cephAdminPageBreadcrumbs } from "./cephAdminBreadcrumbs";
import {
  parseOptionalNonNegativeInteger,
  parseQuotaBytes,
} from "./quotaForm";
import { useCephAdminI18n } from "./cephAdminI18n";

type Props = {
  endpointId: number;
  endpointUrl?: string | null;
  onClose: () => void;
  onCreated?: (detail: CephAdminRgwUserDetail) => void;
};

type AccountOption = {
  account_id: string;
  account_name?: string | null;
  tenant: string;
};

type UserCreateDraft = CephAdminUserDraft & {
  selectedAccountId: string;
  uid: string;
  tenant: string;
  generateKey: boolean;
};

export default function CephAdminUserCreateModal({ endpointId, endpointUrl, onClose, onCreated }: Props) {
  const { text: surfaceText } = useCephAdminI18n();
  const canAddAsS3Connection = useMemo(
    () => canCreateManualPrivateConnections(readStoredUser()),
    []
  );
  const { locale } = useI18n();
  const [selectedAccountOption, setSelectedAccountOption] = useState<AccountOption | null>(null);
  const { draft, setDraft, accept, dirty } = useSettingsDraft<UserCreateDraft>(() => ({
    ...createEmptyCephAdminUserDraft(),
    selectedAccountId: "",
    uid: "",
    tenant: "",
    generateKey: true,
  }));

  const [saving, setSaving] = useState(false);
  const [showAddConnectionModal, setShowAddConnectionModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [generatedKey, setGeneratedKey] = useState<{ access_key: string; secret_key: string } | null>(null);
  const loadAccountOptions = useCallback(async ({ page, page_size, search }: {
    page?: number;
    page_size?: number;
    search?: string;
  }) => {
    const response = await listCephAdminAccounts(endpointId, {
      page,
      page_size,
      search,
      sort_by: "account_id",
      sort_dir: "asc",
      include: ["profile"],
    });
    return {
      ...response,
      items: response.items.map((item) => ({
        account_id: item.account_id,
        account_name: item.account_name,
        tenant: item.tenant ?? "",
      })),
    };
  }, [endpointId]);
  const accountCatalog = usePaginatedOptions(loadAccountOptions, { initialPageSize: 25 });
  const accounts = useMemo(() => {
    const current = accountCatalog.items.filter((item) => item.account_id);
    if (
      selectedAccountOption &&
      !current.some((item) => item.account_id === selectedAccountOption.account_id)
    ) {
      return [selectedAccountOption, ...current];
    }
    return current;
  }, [accountCatalog.items, selectedAccountOption]);

  const selectedAccount = useMemo(
    () =>
      selectedAccountOption?.account_id === draft.selectedAccountId
        ? selectedAccountOption
        : accounts.find((account) => account.account_id === draft.selectedAccountId) ?? null,
    [accounts, draft.selectedAccountId, selectedAccountOption],
  );
  const effectiveTenant = selectedAccount ? selectedAccount.tenant : draft.tenant.trim();

  const [validationShown, setValidationShown] = useState(false);
  const uidFormatError = rgwUserNameErrorText(rgwUserUidFormatError(draft.uid.trim(), effectiveTenant), locale);
  const tenantFormatError = rgwUserNameErrorText(rgwTenantFormatError(effectiveTenant), locale);
  const validationErrors = {
    ...(uidFormatError ? { uid: uidFormatError } : {}),
    ...(tenantFormatError ? { tenant: tenantFormatError } : {}),
    ...validateCephAdminUserLimits({
      maxBuckets: draft.profile.maxBuckets,
      quotaEnabled: draft.quota.enabled,
      quotaSize: draft.quota.size,
      quotaUnit: draft.quota.unit,
      quotaObjects: draft.quota.objects,
    }),
    ...(!draft.uid.trim() ? { uid: rgwUserNameErrorText("UID is required.", locale)! } : {}),
  };
  const fieldErrors = validationShown ? validationErrors : { uid: uidFormatError, tenant: tenantFormatError };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    if (saving) return;
    setValidationShown(true);
    setError(null);
    if (Object.keys(validationErrors).length > 0) {
      focusFirstInvalidField(event.currentTarget);
      return;
    }
    setStatus(null);
    setGeneratedKey(null);

    const normalizedUid = draft.uid.trim();
    const normalizedAccountId = draft.selectedAccountId.trim() || undefined;
    const normalizedTenant = effectiveTenant || undefined;
    const parsedMaxBuckets = parseOptionalNonNegativeInteger(draft.profile.maxBuckets);
    const parsedQuotaBytes = draft.quota.enabled ? parseQuotaBytes(draft.quota.size, draft.quota.unit) : null;
    const parsedQuotaObjects = draft.quota.enabled ? parseOptionalNonNegativeInteger(draft.quota.objects) : null;

    const payload: CreateCephAdminUserPayload = {
      uid: normalizedUid,
      account_id: normalizedAccountId,
      tenant: normalizedTenant,
      display_name: draft.profile.displayName.trim() || undefined,
      email: draft.profile.email.trim() || undefined,
      suspended: draft.flags.suspended,
      max_buckets: parsedMaxBuckets ?? undefined,
      op_mask: draft.profile.opMask.trim() || undefined,
      system: draft.flags.system,
      account_root: normalizedAccountId ? true : undefined,
      generate_key: draft.generateKey,
      quota_enabled: draft.quota.enabled ? true : undefined,
      quota_max_size_bytes: parsedQuotaBytes ?? undefined,
      quota_max_objects: parsedQuotaObjects ?? undefined,
      caps:
        draft.caps.text.trim() !== ""
          ? {
              mode: draft.caps.mode,
              values: parseCephAdminUserCaps(draft.caps.text),
            }
          : undefined,
    };

    setSaving(true);
    return (async () => {
      try {
        const response = await createCephAdminUser(endpointId, payload);
        onCreated?.(response.detail);
        setGeneratedKey(response.generated_key);
        accept(draft);
        setStatus(surfaceText("User {uid} created.", { uid: response.detail.uid }));
      } catch (err) {
        setError(extractApiError(err, surfaceText("Unexpected error")));
      } finally {
        setSaving(false);
      }
    })();
  };

  const addConnectionDefaults = generatedKey
    ? buildCephConnectionDefaults(draft.uid, generatedKey.access_key, {
        accountId: draft.selectedAccountId,
        tenant: effectiveTenant,
      })
    : null;

  return <>
    <SettingsWorkflowForm
      title={surfaceText("Create user")}
      description={surfaceText("Create an RGW user with its initial quotas, capabilities and access key.")}
      breadcrumbs={cephAdminPageBreadcrumbs("users", { label: surfaceText("Create") })}
      backLabel={surfaceText("Back to users")}
      width="wide"
      contentVariant="plain"
      formLabel={surfaceText("Create RGW user")}
      dirty={dirty}
      busy={saving}
      error={error}
      submitLabel={surfaceText("Create user")}
      busyLabel={surfaceText("Creating...")}
      onSubmit={submit}
      onClose={onClose}
    >
      {status && <PageBanner tone="success">{status}</PageBanner>}
      {accountCatalog.error && <PageBanner tone="warning">{surfaceText("Unable to load account list:")}{accountCatalog.error}</PageBanner>}
      {generatedKey && (
        <OneTimeSecretPanel
          title={surfaceText("Access key created")}
          description={surfaceText("Secret is shown only once.")}
          values={[
            { label: surfaceText("Access key"), value: generatedKey.access_key, copyLabel: surfaceText("Copy") },
            { label: surfaceText("Secret key"), value: generatedKey.secret_key, copyLabel: surfaceText("Copy") },
          ]}
          actions={canAddAsS3Connection ? (
            <SettingsButton
              type="button"
              onClick={() => setShowAddConnectionModal(true)}
              variant="secondary"
            >
              {surfaceText("Add as S3 Connection")}</SettingsButton>
          ) : undefined}
        />
      )}

      <SettingsSection title={surfaceText("Identity")} presentation="compact">
        <div className="settings-stack">
          <div className="settings-fields md:grid-cols-2">
            <UiInput
              label={surfaceText("Search accounts")}
              value={accountCatalog.search}
              onChange={(event) => accountCatalog.setSearch(event.target.value)}
              disabled={saving}
              fieldClassName="md:col-span-2"
            />
            <UiSelect label={surfaceText("Account (optional)")} value={draft.selectedAccountId}
              onChange={(event) => {
                const nextId = event.target.value;
                setDraft(current => ({ ...current, selectedAccountId: nextId }));
                setSelectedAccountOption(accounts.find((account) => account.account_id === nextId) ?? null);
              }} disabled={accountCatalog.loading}
              fieldClassName="md:col-span-2" hint={draft.selectedAccountId ? surfaceText("The new user will be the account root.") : undefined}>
              <option value="">{surfaceText("No account")}</option>
              {accounts.map((account) => <option key={account.account_id} value={account.account_id}>
                {account.account_name ? `${account.account_name} (${account.account_id})` : account.account_id}
                {account.tenant ? ` · ${account.tenant}` : ""}
              </option>)}
            </UiSelect>
            <div className="md:col-span-2">
              <PaginationControls
                page={accountCatalog.page}
                pageSize={accountCatalog.pageSize}
                total={accountCatalog.total}
                onPageChange={accountCatalog.setPage}
                onPageSizeChange={accountCatalog.setPageSize}
                disabled={accountCatalog.loading || saving}
              />
            </div>
            <UiInput label={surfaceText("UID")} required value={draft.uid}
              onChange={(event) => setDraft(current => ({ ...current, uid: event.target.value }))} error={fieldErrors.uid} />
            <UiInput label={surfaceText("Tenant")} value={effectiveTenant} disabled={Boolean(selectedAccount)}
              onChange={(event) => setDraft(current => ({ ...current, tenant: event.target.value }))}
              hint={selectedAccount ? surfaceText("Inherited from the selected account.") : undefined} error={fieldErrors.tenant} />
          </div>
          <CephAdminUserProfileFields values={draft.profile}
            onChange={(field, value) => setDraft(current => ({ ...current, profile: { ...current.profile, [field]: value } }))}
            maxBucketsError={fieldErrors.maxBuckets} />
        </div>
      </SettingsSection>
      <CephAdminUserFlags values={draft.flags} readOnlyFields={["admin"]}
        onChange={(field, value) => setDraft(current => ({ ...current, flags: { ...current.flags, [field]: value } }))}>
        <UiCheckboxField checked={draft.generateKey}
          onChange={(event) => setDraft(current => ({ ...current, generateKey: event.target.checked }))} className="settings-choice">
          {surfaceText("Generate access key")}</UiCheckboxField>
      </CephAdminUserFlags>
      <CephAdminQuotaFields title={surfaceText("User quota")} enabledLabel={surfaceText("Enable user quota")}
        enabled={draft.quota.enabled} onEnabledChange={(enabled) => setDraft(current => ({ ...current, quota: { ...current.quota, enabled } }))}
        sizeValue={draft.quota.size} onSizeChange={(size) => setDraft(current => ({ ...current, quota: { ...current.quota, size } }))}
        unitValue={draft.quota.unit} onUnitChange={(unit) => setDraft(current => ({ ...current, quota: { ...current.quota, unit } }))}
        objectValue={draft.quota.objects} onObjectChange={(objects) => setDraft(current => ({ ...current, quota: { ...current.quota, objects } }))}
        sizeError={fieldErrors.quotaSize} objectError={fieldErrors.quotaObjects} />
      <CephAdminUserCapsFields mode={draft.caps.mode}
        onModeChange={(mode) => setDraft(current => ({ ...current, caps: { ...current.caps, mode } }))}
        value={draft.caps.text} onChange={(text) => setDraft(current => ({ ...current, caps: { ...current.caps, text } }))} />
    </SettingsWorkflowForm>

    {canAddAsS3Connection && showAddConnectionModal && generatedKey && addConnectionDefaults && (
      <AddS3ConnectionFromKeyModal
        isOpen={showAddConnectionModal}
        title={surfaceText("Add this key as S3 Connection")}
        zIndexClass="z-[60]"
        lockEndpoint
        accessKeyId={generatedKey.access_key}
        secretAccessKey={generatedKey.secret_key}
        defaultName={addConnectionDefaults.name}
        defaultEndpointId={endpointId}
        defaultEndpointUrl={endpointUrl ?? null}
        defaultProviderHint="ceph"
        defaultAccessManager={false}
        defaultAccessBrowser
        defaultRgwUserUid={addConnectionDefaults.rgwIdentity.userUid}
        defaultRgwTenant={addConnectionDefaults.rgwIdentity.tenant}
        defaultRgwAccountId={addConnectionDefaults.rgwIdentity.accountId}
        onClose={() => setShowAddConnectionModal(false)}
        onCreated={() => {
          setStatus(surfaceText("S3 connection created."));
          setError(null);
        }}
      />
    )}
  </>;
}
