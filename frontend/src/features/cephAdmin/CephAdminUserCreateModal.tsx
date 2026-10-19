/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useI18n } from "../../i18n";
import { rgwUserNameErrorText } from "../../utils/rgwUserNameMessages";
import { rgwUserUidFormatError, rgwTenantFormatError } from "../../utils/resourceNames";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  CephAdminRgwUserDetail,
  createCephAdminUser,
  CreateCephAdminUserPayload,
} from "../../api/cephAdminUsers";
import { listCephAdminAccounts } from "../../api/cephAdminAccounts";
import AddS3ConnectionFromKeyModal from "../../components/AddS3ConnectionFromKeyModal";
import SettingsWorkflowForm from "../../components/settings/SettingsWorkflowForm";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import { SettingsButton } from "../../components/settings/SettingsControls";
import OneTimeSecretPanel from "../../components/OneTimeSecretPanel";
import PageBanner from "../../components/PageBanner";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import { CephAdminUserProfileFields, CephAdminUserFlags, CephAdminUserCapsFields } from "./CephAdminUserFormFields";
import { parseCephAdminUserCaps, validateCephAdminUserLimits, type CephAdminUserCapsMode } from "./cephAdminUserForm";
import { extractApiError } from "../../utils/apiError";
import { focusFirstInvalidField } from "../../utils/focusFirstInvalidField";
import { stableSignature } from "../../utils/stableSignature";
import { canCreateManualPrivateConnections, readStoredUser } from "../../utils/workspaces";
import { buildCephConnectionDefaults } from "../shared/s3ConnectionFromKey";
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
  endpointUrl?: string | null;
  onClose: () => void;
  onCreated?: (detail: CephAdminRgwUserDetail) => void;
};

type AccountOption = {
  account_id: string;
  account_name?: string | null;
  tenant: string;
};

export default function CephAdminUserCreateModal({ endpointId, endpointUrl, onClose, onCreated }: Props) {
  const { text: surfaceText } = useCephAdminI18n();
  const canAddAsS3Connection = useMemo(
    () => canCreateManualPrivateConnections(readStoredUser()),
    []
  );
  const { locale } = useI18n();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [uid, setUid] = useState("");
  const [tenant, setTenant] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [maxBuckets, setMaxBuckets] = useState("");
  const [opMask, setOpMask] = useState("");
  const [suspended, setSuspended] = useState(false);
  const [systemFlag, setSystemFlag] = useState(false);
  const [generateKey, setGenerateKey] = useState(true);
  const [quotaEnabled, setQuotaEnabled] = useState(false);
  const [quotaSize, setQuotaSize] = useState("");
  const [quotaUnit, setQuotaUnit] = useState<CephAdminQuotaUnit>("GiB");
  const [quotaObjects, setQuotaObjects] = useState("");
  const [capsMode, setCapsMode] = useState<CephAdminUserCapsMode>("replace");
  const [capsText, setCapsText] = useState("");

  const [saving, setSaving] = useState(false);
  const [showAddConnectionModal, setShowAddConnectionModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [generatedKey, setGeneratedKey] = useState<{ access_key: string; secret_key: string } | null>(null);
  const currentSignature = useMemo(
    () =>
      stableSignature({
        selectedAccountId,
        uid,
        tenant,
        displayName,
        email,
        maxBuckets,
        opMask,
        suspended,
        systemFlag,
        generateKey,
        quotaEnabled,
        quotaSize,
        quotaUnit,
        quotaObjects,
        capsMode,
        capsText,
      }),
    [
      capsMode,
      capsText,
      displayName,
      email,
      generateKey,
      maxBuckets,
      opMask,
      quotaEnabled,
      quotaObjects,
      quotaSize,
      quotaUnit,
      selectedAccountId,
      suspended,
      systemFlag,
      tenant,
      uid,
    ]
  );
  const [initialSignature, setInitialSignature] = useState(currentSignature);
  useEffect(() => {
    let cancelled = false;
    const loadAccounts = async () => {
      setAccountsLoading(true);
      setAccountsError(null);
      try {
        const response = await listCephAdminAccounts(endpointId, {
          page: 1,
          page_size: 200,
          sort_by: "account_id",
          sort_dir: "asc",
          include: ["profile"],
        });
        if (cancelled) return;
        const options = (response.items ?? [])
          .map((item) => ({ account_id: item.account_id, account_name: item.account_name, tenant: item.tenant ?? "" }))
          .filter((item) => item.account_id)
          .sort((a, b) => {
            const aLabel = `${a.account_name ?? ""} ${a.account_id}`.trim().toLowerCase();
            const bLabel = `${b.account_name ?? ""} ${b.account_id}`.trim().toLowerCase();
            return aLabel.localeCompare(bLabel);
          });
        setAccounts(options);
      } catch (err) {
        if (cancelled) return;
        setAccountsError(extractApiError(err, surfaceText("Unexpected error")));
      } finally {
        if (!cancelled) {
          setAccountsLoading(false);
        }
      }
    };
    void loadAccounts();
    return () => {
      cancelled = true;
    };
  }, [endpointId, surfaceText]);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.account_id === selectedAccountId) ?? null,
    [accounts, selectedAccountId],
  );
  const effectiveTenant = selectedAccount ? selectedAccount.tenant : tenant.trim();

  const [validationShown, setValidationShown] = useState(false);
  const uidFormatError = rgwUserNameErrorText(rgwUserUidFormatError(uid.trim(), effectiveTenant), locale);
  const tenantFormatError = rgwUserNameErrorText(rgwTenantFormatError(effectiveTenant), locale);
  const validationErrors = {
    ...(uidFormatError ? { uid: uidFormatError } : {}),
    ...(tenantFormatError ? { tenant: tenantFormatError } : {}),
    ...validateCephAdminUserLimits({ maxBuckets, quotaEnabled, quotaSize, quotaUnit, quotaObjects }),
    ...(!uid.trim() ? { uid: rgwUserNameErrorText("UID is required.", locale)! } : {}),
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

    const normalizedUid = uid.trim();
    const normalizedAccountId = selectedAccountId.trim() || undefined;
    const normalizedTenant = effectiveTenant || undefined;
    const parsedMaxBuckets = parseOptionalNonNegativeInteger(maxBuckets);
    const parsedQuotaBytes = quotaEnabled ? parseQuotaBytes(quotaSize, quotaUnit) : null;
    const parsedQuotaObjects = quotaEnabled ? parseOptionalNonNegativeInteger(quotaObjects) : null;

    const payload: CreateCephAdminUserPayload = {
      uid: normalizedUid,
      account_id: normalizedAccountId,
      tenant: normalizedTenant,
      display_name: displayName.trim() || undefined,
      email: email.trim() || undefined,
      suspended,
      max_buckets: parsedMaxBuckets ?? undefined,
      op_mask: opMask.trim() || undefined,
      system: systemFlag,
      account_root: normalizedAccountId ? true : undefined,
      generate_key: generateKey,
      quota_enabled: quotaEnabled ? true : undefined,
      quota_max_size_bytes: parsedQuotaBytes ?? undefined,
      quota_max_objects: parsedQuotaObjects ?? undefined,
      caps:
        capsText.trim() !== ""
          ? {
              mode: capsMode,
              values: parseCephAdminUserCaps(capsText),
            }
          : undefined,
    };

    setSaving(true);
    return (async () => {
      try {
        const response = await createCephAdminUser(endpointId, payload);
        onCreated?.(response.detail);
        setGeneratedKey(response.generated_key ?? null);
        setInitialSignature(currentSignature);
        setStatus(surfaceText("User {uid} created.", { uid: response.detail.uid }));
      } catch (err) {
        setError(extractApiError(err, surfaceText("Unexpected error")));
      } finally {
        setSaving(false);
      }
    })();
  };

  const addConnectionDefaults = generatedKey
    ? buildCephConnectionDefaults(uid, generatedKey.access_key, {
        accountId: selectedAccountId,
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
      dirty={currentSignature !== initialSignature}
      busy={saving}
      error={error}
      submitLabel={surfaceText("Create user")}
      busyLabel={surfaceText("Creating...")}
      onSubmit={submit}
      onClose={onClose}
    >
      {status && <PageBanner tone="success">{status}</PageBanner>}
      {accountsError && <PageBanner tone="warning">{surfaceText("Unable to load account list:")}{accountsError}</PageBanner>}
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
            <UiSelect label={surfaceText("Account (optional)")} value={selectedAccountId}
              onChange={(event) => setSelectedAccountId(event.target.value)} disabled={accountsLoading}
              fieldClassName="md:col-span-2" hint={selectedAccountId ? surfaceText("The new user will be the account root.") : undefined}>
              <option value="">{surfaceText("No account")}</option>
              {accounts.map((account) => <option key={account.account_id} value={account.account_id}>
                {account.account_name ? `${account.account_name} (${account.account_id})` : account.account_id}
                {account.tenant ? ` · ${account.tenant}` : ""}
              </option>)}
            </UiSelect>
            <UiInput label={surfaceText("UID")} required value={uid} onChange={(event) => setUid(event.target.value)} error={fieldErrors.uid} />
            <UiInput label={surfaceText("Tenant")} value={effectiveTenant} disabled={Boolean(selectedAccount)}
              onChange={(event) => setTenant(event.target.value)}
              hint={selectedAccount ? surfaceText("Inherited from the selected account.") : undefined} error={fieldErrors.tenant} />
          </div>
          <CephAdminUserProfileFields values={{ displayName, email, maxBuckets, opMask }}
            onChange={(field, value) => ({ displayName: setDisplayName, email: setEmail, maxBuckets: setMaxBuckets, opMask: setOpMask })[field](value)}
            maxBucketsError={fieldErrors.maxBuckets} />
        </div>
      </SettingsSection>
      <CephAdminUserFlags values={{ suspended, admin: false, system: systemFlag }} readOnlyFields={["admin"]}
        onChange={(field, value) => {
          if (field === "suspended") setSuspended(value);
          if (field === "system") setSystemFlag(value);
        }}>
        <UiCheckboxField checked={generateKey} onChange={(event) => setGenerateKey(event.target.checked)} className="settings-choice">
          {surfaceText("Generate access key")}</UiCheckboxField>
      </CephAdminUserFlags>
      <CephAdminQuotaFields title={surfaceText("User quota")} enabledLabel={surfaceText("Enable user quota")} enabled={quotaEnabled} onEnabledChange={setQuotaEnabled}
        sizeValue={quotaSize} onSizeChange={setQuotaSize} unitValue={quotaUnit} onUnitChange={setQuotaUnit}
        objectValue={quotaObjects} onObjectChange={setQuotaObjects} sizeError={fieldErrors.quotaSize} objectError={fieldErrors.quotaObjects} />
      <CephAdminUserCapsFields mode={capsMode} onModeChange={setCapsMode} value={capsText} onChange={setCapsText} />
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
