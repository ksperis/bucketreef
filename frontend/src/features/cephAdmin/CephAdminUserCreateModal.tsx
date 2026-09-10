/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import {
  CephAdminRgwUserDetail,
  createCephAdminUser,
  CreateCephAdminUserPayload,
} from "../../api/cephAdminUsers";
import { listCephAdminAccounts } from "../../api/cephAdminAccounts";
import AddS3ConnectionFromKeyModal from "../../components/AddS3ConnectionFromKeyModal";
import WorkflowPage, { WorkflowActions } from "../../components/WorkflowPage";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import { SettingsButton } from "../../components/settings/SettingsControls";
import OneTimeSecretPanel from "../../components/OneTimeSecretPanel";
import PageBanner from "../../components/PageBanner";
import UiButton from "../../components/ui/UiButton";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import { CephAdminUserProfileFields, CephAdminUserFlags, CephAdminUserCapsFields } from "./CephAdminUserFormFields";
import { parseCephAdminUserCaps, validateCephAdminUserLimits, type CephAdminUserCapsMode } from "./cephAdminUserForm";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
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

type Props = {
  endpointId: number;
  endpointUrl?: string | null;
  onClose: () => void;
  onCreated?: (detail: CephAdminRgwUserDetail) => void;
};

type AccountOption = {
  account_id: string;
  account_name?: string | null;
};

const extractError = (err: unknown): string => extractApiError(err, "Unexpected error");

export default function CephAdminUserCreateModal({ endpointId, endpointUrl, onClose, onCreated }: Props) {
  const canAddAsS3Connection = useMemo(
    () => canCreateManualPrivateConnections(readStoredUser()),
    []
  );
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
  const [adminFlag, setAdminFlag] = useState(false);
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
        adminFlag,
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
      adminFlag,
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
  const closeGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: currentSignature !== initialSignature,
    onClose,
    disabled: saving,
    zIndexClass: "z-[70]",
  });

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
          .map((item) => ({ account_id: item.account_id, account_name: item.account_name }))
          .filter((item) => item.account_id)
          .sort((a, b) => {
            const aLabel = `${a.account_name ?? ""} ${a.account_id}`.trim().toLowerCase();
            const bLabel = `${b.account_name ?? ""} ${b.account_id}`.trim().toLowerCase();
            return aLabel.localeCompare(bLabel);
          });
        setAccounts(options);
      } catch (err) {
        if (cancelled) return;
        setAccountsError(extractError(err));
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
  }, [endpointId]);

  const [validationShown, setValidationShown] = useState(false);
  const validationErrors = {
    ...validateCephAdminUserLimits({ maxBuckets, quotaEnabled, quotaSize, quotaUnit, quotaObjects }),
    ...(!uid.trim() ? { uid: "UID is required." } : {}),
    ...(selectedAccountId && tenant.trim() ? { tenant: "Tenant cannot be used when an account is selected." } : {}),
  };
  const fieldErrors = validationShown ? validationErrors : {};

  const submit = async (form: HTMLFormElement) => {
    if (saving) return;
    setValidationShown(true);
    setError(null);
    if (Object.keys(validationErrors).length > 0) {
      focusFirstInvalidField(form);
      return;
    }
    setStatus(null);
    setGeneratedKey(null);

    const normalizedUid = uid.trim();
    const normalizedAccountId = selectedAccountId.trim() || undefined;
    const normalizedTenant = tenant.trim() || undefined;
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
      admin: adminFlag,
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
    try {
      const response = await createCephAdminUser(endpointId, payload);
      onCreated?.(response.detail);
      setGeneratedKey(response.generated_key ?? null);
      setInitialSignature(currentSignature);
      setStatus(`User ${response.detail.uid} created.`);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSaving(false);
    }
  };

  const addConnectionDefaults = generatedKey
    ? buildCephConnectionDefaults(uid, generatedKey.access_key, {
        accountId: selectedAccountId,
        tenant,
      })
    : null;

  return (
    <WorkflowPage
      title="Create user"
      description="Create an RGW user with its initial quotas, capabilities and access key."
      breadcrumbs={cephAdminPageBreadcrumbs("users", { label: "Create" })}
      backLabel="Back to users"
      onBack={closeGuard.requestClose}
      width="wide"
      contentClassName="settings-compact settings-form"
    >
      <form aria-label="Create RGW user" noValidate onSubmit={(event) => { event.preventDefault(); void submit(event.currentTarget); }} className="space-y-3">
        {error && <PageBanner tone="error">{error}</PageBanner>}
        {status && <PageBanner tone="success">{status}</PageBanner>}
        {accountsError && <PageBanner tone="warning">Unable to load account list: {accountsError}</PageBanner>}
        {generatedKey && (
          <OneTimeSecretPanel
            title="Access key created"
            description="Secret is shown only once."
            values={[
              { label: "Access key", value: generatedKey.access_key, copyLabel: "Copy" },
              { label: "Secret key", value: generatedKey.secret_key, copyLabel: "Copy" },
            ]}
            actions={canAddAsS3Connection ? (
              <UiButton
                type="button"
                onClick={() => setShowAddConnectionModal(true)}
                variant="secondary"
                size="xs"
              >
                Add as S3 Connection
              </UiButton>
            ) : undefined}
          />
        )}

        <fieldset disabled={saving} className="min-w-0">
          <SettingsSection title="Identity" presentation="compact">
            <div className="settings-stack">
              <div className="settings-fields md:grid-cols-2">
                <UiSelect label="Account (optional)" value={selectedAccountId}
                  onChange={(event) => setSelectedAccountId(event.target.value)} disabled={accountsLoading}
                  fieldClassName="md:col-span-2" hint={selectedAccountId ? "The new user will be the account root." : undefined}>
                  <option value="">No account</option>
                  {accounts.map((account) => <option key={account.account_id} value={account.account_id}>
                    {account.account_name ? `${account.account_name} (${account.account_id})` : account.account_id}
                  </option>)}
                </UiSelect>
                <UiInput label="UID" required value={uid} onChange={(event) => setUid(event.target.value)} error={fieldErrors.uid} />
                <UiInput label="Tenant" value={tenant} onChange={(event) => setTenant(event.target.value)}
                  hint="Leave empty when an account is selected." error={fieldErrors.tenant} />
              </div>
              <CephAdminUserProfileFields values={{ displayName, email, maxBuckets, opMask }}
                onChange={(field, value) => ({ displayName: setDisplayName, email: setEmail, maxBuckets: setMaxBuckets, opMask: setOpMask })[field](value)}
                maxBucketsError={fieldErrors.maxBuckets} />
            </div>
          </SettingsSection>
          <CephAdminUserFlags values={{ suspended, admin: adminFlag, system: systemFlag }}
            onChange={(field, value) => ({ suspended: setSuspended, admin: setAdminFlag, system: setSystemFlag })[field](value)}>
            <UiCheckboxField checked={generateKey} onChange={(event) => setGenerateKey(event.target.checked)} className="settings-choice">
              Generate access key
            </UiCheckboxField>
          </CephAdminUserFlags>
          <CephAdminQuotaFields title="User quota" enabledLabel="Enable user quota" enabled={quotaEnabled} onEnabledChange={setQuotaEnabled}
            sizeValue={quotaSize} onSizeChange={setQuotaSize} unitValue={quotaUnit} onUnitChange={setQuotaUnit}
            objectValue={quotaObjects} onObjectChange={setQuotaObjects} sizeError={fieldErrors.quotaSize} objectError={fieldErrors.quotaObjects} />
          <CephAdminUserCapsFields mode={capsMode} onModeChange={setCapsMode} value={capsText} onChange={setCapsText} />
        </fieldset>
        <WorkflowActions>
          <SettingsButton type="button" onClick={closeGuard.requestClose} variant="secondary" disabled={saving}>Cancel</SettingsButton>
          <SettingsButton type="submit" disabled={saving}>{saving ? "Creating..." : "Create user"}</SettingsButton>
        </WorkflowActions>
      </form>

      {canAddAsS3Connection && showAddConnectionModal && generatedKey && addConnectionDefaults && (
        <AddS3ConnectionFromKeyModal
          isOpen={showAddConnectionModal}
          title="Add this key as S3 Connection"
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
          defaultOwnerType={addConnectionDefaults.owner.ownerType}
          defaultOwnerIdentifier={addConnectionDefaults.owner.ownerIdentifier}
          onClose={() => setShowAddConnectionModal(false)}
          onCreated={() => {
            setStatus("S3 connection created.");
            setError(null);
          }}
        />
      )}
      {closeGuard.confirmationDialog}
    </WorkflowPage>
  );
}
