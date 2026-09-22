/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ListActions, ListBadge, ListActionButton } from "../../components/list/ListControls";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { cx, uiDataTableClass, uiPanelMutedClass, uiTableContainerClass } from "../../components/ui/styles";
import {
  CephAdminRgwUserDetail,
  UpdateCephAdminUserPayload,
  getCephAdminUserDetail,
  updateCephAdminUserConfig,
} from "../../api/cephAdminUsers";
import {
  getCephAdminUserMetrics,
  type CephAdminEntityMetrics,
} from "../../api/cephAdminMetrics";
import {
  type CephAdminRgwAccessKey,
  type CephAdminRgwGeneratedAccessKey,
  createCephAdminUserKey,
  deleteCephAdminUserKey,
  listCephAdminUserKeys,
  updateCephAdminUserKeyStatus,
} from "../../api/cephAdminUserKeys";
import AddS3ConnectionFromKeyModal from "../../components/AddS3ConnectionFromKeyModal";
import WorkflowPage from "../../components/WorkflowPage";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import { SettingsButton } from "../../components/settings/SettingsControls";
import SettingsForm from "../../components/settings/SettingsForm";
import { useSettingsFormController } from "../../components/settings/useSettingsFormController";
import OneTimeSecretPanel from "../../components/OneTimeSecretPanel";
import PageBanner from "../../components/PageBanner";
import PageTabs from "../../components/PageTabs";
import UiButton from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import { CephAdminUserProfileFields, CephAdminUserFlags, CephAdminUserCapsFields } from "./CephAdminUserFormFields";
import { parseCephAdminUserCaps, validateCephAdminUserLimits, type CephAdminUserCapsMode } from "./cephAdminUserForm";
import UsageTile from "../../components/UsageTile";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";

import { extractApiError } from "../../utils/apiError";
import { focusFirstInvalidField } from "../../utils/focusFirstInvalidField";
import { formatBytes, formatNumber } from "../../utils/format";
import { stableSignature } from "../../utils/stableSignature";
import { canCreateManualPrivateConnections, readStoredUser } from "../../utils/workspaces";
import { buildCephConnectionDefaults } from "../shared/s3ConnectionFromKey";
import CephAdminQuotaFields from "./CephAdminQuotaFields";
import { buildCephAdminQuotaPatch } from "./quotaPatch";
import { cephAdminPageBreadcrumbs } from "./cephAdminBreadcrumbs";
import { parseOptionalNonNegativeInteger, parseQuotaBytes, quotaBytesToForm, type CephAdminQuotaUnit } from "./quotaForm";

type Props = {
  endpointId: number;
  endpointUrl?: string | null;
  uid: string;
  tenant?: string | null;
  canViewMetrics?: boolean;
  onClose: () => void;
  onSaved?: (detail: CephAdminRgwUserDetail) => void;
};

type TabId = "overview" | "ceph" | "s3" | "metrics";

const extractError = (err: unknown): string => extractApiError(err, "Unexpected error");

const keyActive = (key: CephAdminRgwAccessKey): boolean => {
  if (key.is_active !== undefined && key.is_active !== null) return Boolean(key.is_active);
  const status = (key.status || "").toLowerCase();
  if (["disabled", "inactive", "suspended"].includes(status)) return false;
  if (["active", "enabled"].includes(status)) return true;
  return true;
};

const formatDate = (value?: string | null) => {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};

export default function CephAdminUserEditModal({
  endpointId,
  endpointUrl,
  uid,
  tenant,
  canViewMetrics = true,
  onClose,
  onSaved,
}: Props) {
  const keyConfirmation = useConfirmActionDialog();
  const canAddAsS3Connection = useMemo(
    () => canCreateManualPrivateConnections(readStoredUser()),
    []
  );
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [detail, setDetail] = useState<CephAdminRgwUserDetail | null>(null);
  const [keys, setKeys] = useState<CephAdminRgwAccessKey[]>([]);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [metrics, setMetrics] = useState<CephAdminEntityMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const [keysLoading, setKeysLoading] = useState(false);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [keysStatus, setKeysStatus] = useState<string | null>(null);
  const [keysBusy, setKeysBusy] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<CephAdminRgwGeneratedAccessKey | null>(null);
  const [showAddConnectionModal, setShowAddConnectionModal] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [suspended, setSuspended] = useState(false);
  const [maxBuckets, setMaxBuckets] = useState("");
  const [opMask, setOpMask] = useState("");
  const [defaultPlacement, setDefaultPlacement] = useState("");
  const [defaultStorageClass, setDefaultStorageClass] = useState("");
  const [adminFlag, setAdminFlag] = useState(false);
  const [systemFlag, setSystemFlag] = useState(false);
  const [quotaEnabled, setQuotaEnabled] = useState(true);
  const [quotaSize, setQuotaSize] = useState("");
  const [quotaUnit, setQuotaUnit] = useState<CephAdminQuotaUnit>("GiB");
  const [quotaObjects, setQuotaObjects] = useState("");
  const [capsMode, setCapsMode] = useState<CephAdminUserCapsMode>("replace");
  const [capsText, setCapsText] = useState("");
  const currentSignature = useMemo(
    () =>
      stableSignature({
        displayName,
        email,
        suspended,
        maxBuckets,
        opMask,
        defaultPlacement,
        defaultStorageClass,
        adminFlag,
        systemFlag,
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
      defaultPlacement,
      defaultStorageClass,
      displayName,
      email,
      maxBuckets,
      opMask,
      quotaEnabled,
      quotaObjects,
      quotaSize,
      quotaUnit,
      suspended,
      systemFlag,
    ]
  );
  const [initialSignature, setInitialSignature] = useState(currentSignature);

  const refreshKeys = async () => {
    setKeysLoading(true);
    setKeysError(null);
    try {
      const payload = await listCephAdminUserKeys(endpointId, uid, tenant);
      setKeys(payload);
    } catch (err) {
      setKeysError(extractError(err));
    } finally {
      setKeysLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const payload = await getCephAdminUserDetail(endpointId, uid, tenant);
        if (cancelled) return;
        setDetail(payload);
        setKeys(payload.keys ?? []);
        setDisplayName(payload.display_name ?? "");
        setEmail(payload.email ?? "");
        setSuspended(Boolean(payload.suspended));
        setMaxBuckets(payload.max_buckets != null ? String(payload.max_buckets) : "");
        setOpMask(payload.op_mask ?? "");
        setDefaultPlacement(payload.default_placement ?? "");
        setDefaultStorageClass(payload.default_storage_class ?? "");
        setAdminFlag(Boolean(payload.admin));
        setSystemFlag(Boolean(payload.system));
        const quotaConfigured = Boolean(
          payload.quota && (payload.quota.max_size_bytes != null || payload.quota.max_objects != null)
        );
        setQuotaEnabled(payload.quota?.enabled ?? quotaConfigured);
        const quotaForm = quotaBytesToForm(payload.quota?.max_size_bytes);
        setQuotaSize(quotaForm.value);
        setQuotaUnit(quotaForm.unit);
        setQuotaObjects(payload.quota?.max_objects != null ? String(payload.quota.max_objects) : "");
        setCapsText((payload.caps ?? []).join("\n"));
        setInitialSignature(
          stableSignature({
            displayName: payload.display_name ?? "",
            email: payload.email ?? "",
            suspended: Boolean(payload.suspended),
            maxBuckets: payload.max_buckets != null ? String(payload.max_buckets) : "",
            opMask: payload.op_mask ?? "",
            defaultPlacement: payload.default_placement ?? "",
            defaultStorageClass: payload.default_storage_class ?? "",
            adminFlag: Boolean(payload.admin),
            systemFlag: Boolean(payload.system),
            quotaEnabled: payload.quota?.enabled ?? quotaConfigured,
            quotaSize: quotaForm.value,
            quotaUnit: quotaForm.unit,
            quotaObjects: payload.quota?.max_objects != null ? String(payload.quota.max_objects) : "",
            capsMode: "replace",
            capsText: (payload.caps ?? []).join("\n"),
          })
        );
      } catch (err) {
        if (!cancelled) {
          setDetailError(extractError(err));
          setDetail(null);
          setKeys([]);
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [endpointId, uid, tenant]);

  useEffect(() => {
    if (!canViewMetrics || activeTab !== "metrics") return;
    let cancelled = false;
    const load = async () => {
      setMetricsLoading(true);
      setMetricsError(null);
      try {
        const payload = await getCephAdminUserMetrics(endpointId, uid, tenant);
        if (!cancelled) {
          setMetrics(payload);
        }
      } catch (err) {
        if (!cancelled) {
          setMetricsError(extractError(err));
          setMetrics(null);
        }
      } finally {
        if (!cancelled) {
          setMetricsLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [activeTab, canViewMetrics, endpointId, uid, tenant]);

  useEffect(() => {
    if (!canViewMetrics && activeTab === "metrics") {
      setActiveTab("overview");
    }
  }, [activeTab, canViewMetrics]);

  const [validationShown, setValidationShown] = useState(false);
  const validationErrors = validateCephAdminUserLimits({ maxBuckets, quotaEnabled, quotaSize, quotaUnit, quotaObjects });
  const fieldErrors = validationShown ? validationErrors : {};

  const submit = (event: FormEvent<HTMLFormElement>) => {
    if (saving || detailLoading || !detail) return;
    setValidationShown(true);
    setSaveError(null);
    setSaveStatus(null);
    if (Object.keys(validationErrors).length > 0) {
      focusFirstInvalidField(event.currentTarget);
      return;
    }
    const accountRootEnabled = Boolean(detail.account_id);
    const parsedMaxBuckets = parseOptionalNonNegativeInteger(maxBuckets);
    const parsedQuotaBytes = quotaEnabled ? parseQuotaBytes(quotaSize, quotaUnit) : null;
    const parsedQuotaObjects = quotaEnabled ? parseOptionalNonNegativeInteger(quotaObjects) : null;

    const nextDefaultPlacement = defaultPlacement.trim();
    const nextDefaultStorageClass = defaultStorageClass.trim();

    setSaving(true);
    return (async () => {
      try {
        const payload: UpdateCephAdminUserPayload = {
          display_name: displayName.trim() || null,
          email: email.trim() || null,
          suspended,
          max_buckets: parsedMaxBuckets,
          op_mask: opMask.trim() || null,
          admin: adminFlag,
          system: systemFlag,
          account_root: accountRootEnabled ? true : undefined,
          caps: {
            mode: capsMode,
            values: parseCephAdminUserCaps(capsText),
          },
          extra_params: {
            "default-placement": nextDefaultPlacement || "",
            "default-storage-class": nextDefaultStorageClass || "",
          },
          ...buildCephAdminQuotaPatch(
            {
              enabled: "quota_enabled",
              maxSizeBytes: "quota_max_size_bytes",
              maxObjects: "quota_max_objects",
            },
            detail?.quota,
            {
              enabled: quotaEnabled,
              maxSizeBytes: parsedQuotaBytes,
              maxObjects: parsedQuotaObjects,
            }
          ),
        };
        const updated = await updateCephAdminUserConfig(
          endpointId,
          uid,
          payload,
          tenant
        );
        setDetail(updated);
        setKeys(updated.keys ?? []);
        setInitialSignature(currentSignature);
        setSaveStatus("User configuration updated.");
        onSaved?.(updated);
        if (activeTab === "metrics") {
          try {
            const refreshedMetrics = await getCephAdminUserMetrics(endpointId, uid, tenant);
            setMetrics(refreshedMetrics);
            setMetricsError(null);
          } catch {
            // Metrics refresh is best effort.
          }
        }
      } catch (err) {
        setSaveError(extractError(err));
      } finally {
        setSaving(false);
      }
    })();
  };
  const formController = useSettingsFormController({
    dirty: !detailLoading && currentSignature !== initialSignature,
    busy: saving,
    disabled: detailLoading || !detail,
    onSubmit: submit,
    onClose,
  });

  const handleCreateKey = async () => {
    setKeysError(null);
    setKeysStatus(null);
    setCreatedKey(null);
    setKeysBusy("create");
    try {
      const created = await createCephAdminUserKey(endpointId, uid, tenant);
      setCreatedKey(created);
      await refreshKeys();
      setKeysStatus("Access key created.");
    } catch (err) {
      setKeysError(extractError(err));
    } finally {
      setKeysBusy(null);
    }
  };

  const handleToggleKey = async (key: CephAdminRgwAccessKey, nextActive: boolean) => {
    if (key.is_private_access_managed) return;
    const marker = `toggle:${key.access_key}`;
    setKeysBusy(marker);
    setKeysError(null);
    setKeysStatus(null);
    try {
      await updateCephAdminUserKeyStatus(endpointId, uid, key.access_key, nextActive, tenant);
      await refreshKeys();
      setKeysStatus(nextActive ? "Access key enabled." : "Access key disabled.");
    } catch (err) {
      setKeysError(extractError(err));
    } finally {
      setKeysBusy(null);
    }
  };

  const deleteKey = async (key: CephAdminRgwAccessKey) => {
    if (key.is_private_access_managed) return;
    const marker = `delete:${key.access_key}`;
    setKeysBusy(marker);
    setKeysError(null);
    setKeysStatus(null);
    try {
      await deleteCephAdminUserKey(endpointId, uid, key.access_key, tenant);
      await refreshKeys();
      setKeysStatus("Access key deleted.");
    } catch (err) {
      setKeysError(extractError(err));
    } finally {
      setKeysBusy(null);
    }
  };

  const identityLabel = useMemo(() => {
    if (tenant) return `${tenant}$${uid}`;
    return uid;
  }, [tenant, uid]);

  const handleDeleteKey = (key: CephAdminRgwAccessKey) => {
    if (key.is_private_access_managed) return;
    keyConfirmation.requestConfirmation({
      title: "Delete access key?",
      description: "Permanently remove this S3 access key from the Ceph user.",
      confirmLabel: "Delete key",
      details: [
        { label: "Ceph user", value: identityLabel },
        { label: "Access key", value: key.access_key, mono: true },
      ],
      impacts: ["Applications using this key will immediately lose access."],
      onConfirm: () => deleteKey(key),
    });
  };

  const overviewTab = (
    <section className="space-y-4">
      {detailLoading && <PageBanner tone="info">Loading user details...</PageBanner>}
      {detailError && <PageBanner tone="error">{detailError}</PageBanner>}
      {detail && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <UsageTile
              label="Buckets"
              used={metrics?.bucket_count ?? null}
              quota={detail.max_buckets ?? null}
              formatter={formatNumber}
              quotaFormatter={(value) => (value != null ? value.toLocaleString() : "-")}
              unitHint="buckets"
              emptyHint="No bucket limit defined."
            />
            <UsageTile
              label="Storage quota"
              used={metrics?.total_bytes ?? null}
              quota={detail.quota?.max_size_bytes ?? null}
              formatter={formatBytes}
              quotaFormatter={formatBytes}
              emptyHint="No storage quota defined."
            />
          </div>
          <div className={cx(uiPanelMutedClass, "px-4 py-3")}>
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Account</dt>
                <dd className="ui-body font-semibold text-slate-800 dark:text-slate-100">
                  {detail.account_name ?? detail.account_id ?? "-"}
                </dd>
              </div>
              <div>
                <dt className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Email</dt>
                <dd className="ui-body font-semibold text-slate-800 dark:text-slate-100">{detail.email ?? "-"}</dd>
              </div>
              <div>
                <dt className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Status</dt>
                <dd className="ui-body font-semibold text-slate-800 dark:text-slate-100">
                  {detail.suspended ? "Suspended" : "Active"}
                </dd>
              </div>
              <div>
                <dt className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Flags</dt>
                <dd className="ui-body font-semibold text-slate-800 dark:text-slate-100">
                  {[detail.admin ? "admin" : null, detail.system ? "system" : null, detail.account_root ? "root" : null]
                    .filter(Boolean)
                    .join(" · ") || "none"}
                </dd>
              </div>
            </dl>
          </div>
        </>
      )}
    </section>
  );

  const cephTab = (
    <SettingsForm
      label="RGW user configuration"
      busy={formController.locked || detailLoading}
      disabled={!detail}
      submitDisabled={detailLoading || !detail}
      onSubmit={formController.submit}
      onCancel={formController.requestClose}
      submitLabel="Save configuration"
      busyLabel="Saving..."
      actions={(
        <SettingsButton type="submit" disabled={formController.locked || detailLoading || !detail} loading={formController.locked}>
          {formController.locked ? "Saving..." : "Save configuration"}
        </SettingsButton>
      )}
    >
      <div className="settings-compact settings-form settings-stack">
        {detailLoading && <PageBanner tone="info">Loading user details...</PageBanner>}
        {detailError && <PageBanner tone="error">{detailError}</PageBanner>}
        {saveError && <PageBanner tone="error">{saveError}</PageBanner>}
        {saveStatus && <PageBanner tone="success">{saveStatus}</PageBanner>}
        <SettingsSection title="Profile" presentation="compact">
          <CephAdminUserProfileFields values={{ displayName, email, maxBuckets, opMask }}
            onChange={(field, value) => ({ displayName: setDisplayName, email: setEmail, maxBuckets: setMaxBuckets, opMask: setOpMask })[field](value)}
            maxBucketsError={fieldErrors.maxBuckets} maxBucketsHint="Leave empty to clear the limit.">
            <UiInput label="Default placement" value={defaultPlacement} onChange={(event) => setDefaultPlacement(event.target.value)} placeholder="e.g. default-placement" />
            <UiInput label="Default storage class" value={defaultStorageClass} onChange={(event) => setDefaultStorageClass(event.target.value)} placeholder="e.g. STANDARD" />
          </CephAdminUserProfileFields>
        </SettingsSection>
        <CephAdminUserFlags values={{ suspended, admin: adminFlag, system: systemFlag }}
          onChange={(field, value) => ({ suspended: setSuspended, admin: setAdminFlag, system: setSystemFlag })[field](value)} />
        <CephAdminQuotaFields title="User quota" enabledLabel="Enable user quota" enabled={quotaEnabled} onEnabledChange={setQuotaEnabled}
          sizeValue={quotaSize} onSizeChange={setQuotaSize} unitValue={quotaUnit} onUnitChange={setQuotaUnit}
          objectValue={quotaObjects} onObjectChange={setQuotaObjects} sizePlaceholder="Leave empty to clear" objectPlaceholder="Leave empty to clear"
          sizeError={fieldErrors.quotaSize} objectError={fieldErrors.quotaObjects} />
        <CephAdminUserCapsFields mode={capsMode} onModeChange={setCapsMode} value={capsText} onChange={setCapsText} />
      </div>
    </SettingsForm>
  );

  const s3Tab = (
    <section className="space-y-4">

      {keysError && <PageBanner tone="error">{keysError}</PageBanner>}
      {keysStatus && <PageBanner tone="success">{keysStatus}</PageBanner>}

      {createdKey && (
        <OneTimeSecretPanel
          title="Key created"
          description="Secret is shown only once."
          values={[
            { label: "Access key", value: createdKey.access_key, copyLabel: "Copy" },
            { label: "Secret key", value: createdKey.secret_key, copyLabel: "Copy" },
          ]}
          actions={canAddAsS3Connection ? (
            <SettingsButton
              type="button"
              onClick={() => setShowAddConnectionModal(true)}
              variant="secondary"
            >
              Add as S3 Connection
            </SettingsButton>
          ) : undefined}
        />
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <UiButton
          type="button"
          onClick={refreshKeys}
          disabled={keysLoading}
          variant="secondary"
          size="sm"
        >
          {keysLoading ? "Loading..." : "Refresh"}
        </UiButton>
        <UiButton
          type="button"
          onClick={handleCreateKey}
          disabled={keysBusy === "create"}
          size="sm"
        >
          {keysBusy === "create" ? "Creating..." : "New key"}
        </UiButton>
      </div>

      <div className={uiTableContainerClass}>
        <table className={uiDataTableClass}>
          <thead className="bg-slate-50 dark:bg-slate-900/50">
            <tr>
              <th className="text-left">
                Access key
              </th>
              <th className="text-left">
                Status
              </th>
              <th className="text-left">
                Created
              </th>
              <th className="text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {keys.length === 0 && (
              <tr>
                <td colSpan={4} className="ui-table-secondary">
                  No access keys for this user.
                </td>
              </tr>
            )}
            {keys.map((key) => {
              const active = keyActive(key);
              const managedPrivate = Boolean(key.is_private_access_managed);
              const toggleBusy = keysBusy === `toggle:${key.access_key}`;
              const deleteBusy = keysBusy === `delete:${key.access_key}`;
              return (
                <tr key={key.access_key}>
                  <td className="font-mono ui-table-primary">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{key.access_key}</span>
                      {managedPrivate && (
                        <ListBadge tone="neutral" title="Managed private access key">
                          Private access
                        </ListBadge>
                      )}
                    </div>
                  </td>
                  <td className="ui-table-secondary">{key.status ?? (active ? "enabled" : "disabled")}</td>
                  <td className="ui-table-secondary">{formatDate(key.created_at)}</td>
                  <td className="text-right">
                    <ListActions>
                      <ListActionButton
                        type="button"
                        onClick={() => handleToggleKey(key, !active)}
                        disabled={toggleBusy || deleteBusy || managedPrivate}
                        title={managedPrivate ? "Update the linked private connection instead" : undefined}

                      >
                        {toggleBusy ? "Saving..." : active ? "Disable" : "Enable"}
                      </ListActionButton>
                      <ListActionButton
                        type="button"
                        onClick={() => handleDeleteKey(key)}
                        disabled={toggleBusy || deleteBusy || managedPrivate}
                        title={managedPrivate ? "Delete the linked private connection instead" : undefined}
                         variant="danger"
                      >
                        {deleteBusy ? "Deleting..." : "Delete"}
                      </ListActionButton>
                    </ListActions>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );

  const metricsTab = (
    <section className="space-y-4">

      {metricsLoading && <PageBanner tone="info">Loading metrics...</PageBanner>}
      {metricsError && <PageBanner tone="error">{metricsError}</PageBanner>}
      {metrics && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <UsageTile
              label="Storage"
              used={metrics.total_bytes ?? null}
              quota={detail?.quota?.max_size_bytes ?? null}
              formatter={formatBytes}
              quotaFormatter={formatBytes}
              emptyHint="No storage quota defined."
            />
            <UsageTile
              label="Objects"
              used={metrics.total_objects ?? null}
              quota={detail?.quota?.max_objects ?? null}
              formatter={formatNumber}
              quotaFormatter={(value) => (value != null ? value.toLocaleString() : "-")}
              unitHint="objects"
              emptyHint="No object quota defined."
            />
          </div>
          <div className={cx(uiPanelMutedClass, "px-4 py-3")}>
            <div className="flex items-center justify-between gap-2">
              <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Top buckets by usage</p>
              <p className="ui-caption text-slate-500 dark:text-slate-400">{metrics.bucket_count} bucket(s)</p>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className={uiDataTableClass}>
                <thead className="bg-slate-100/80 dark:bg-slate-900/60">
                  <tr>
                    <th className="text-left">
                      Bucket
                    </th>
                    <th className="text-right">
                      Used
                    </th>
                    <th className="text-right">
                      Objects
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {metrics.bucket_usage.length === 0 && (
                    <tr>
                      <td colSpan={3} className="ui-table-secondary">
                        No bucket usage data available.
                      </td>
                    </tr>
                  )}
                  {metrics.bucket_usage.slice(0, 50).map((entry) => (
                    <tr key={entry.name}>
                      <td className="ui-table-primary">{entry.name}</td>
                      <td className="text-right ui-table-secondary">
                        {formatBytes(entry.used_bytes)}
                      </td>
                      <td className="text-right ui-table-secondary">
                        {formatNumber(entry.object_count)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );

  const tabs = [
    { id: "overview", label: "Overview", content: overviewTab },
    { id: "ceph", label: "Ceph Admin", content: cephTab },
    { id: "s3", label: "Key Management", content: s3Tab },
    ...(canViewMetrics ? [{ id: "metrics", label: "Metrics", content: metricsTab }] : []),
  ];
  const addConnectionDefaults = useMemo(() => {
    if (!createdKey) return null;
    return buildCephConnectionDefaults(uid, createdKey.access_key, {
      accountId: detail?.account_id,
      tenant,
    });
  }, [createdKey, detail?.account_id, tenant, uid]);

  return <>
    <WorkflowPage
      title={`Configure user · ${identityLabel}`}
      description="Manage this RGW user’s configuration, access keys, capabilities and metrics."
      breadcrumbs={cephAdminPageBreadcrumbs("users", { label: identityLabel })}
      backLabel="Back to users"
      onBack={formController.requestClose}
      backDisabled={formController.locked}
      contentClassName="min-w-0"
      contentVariant="plain"
    >
      <PageTabs
        tabs={tabs}
        activeTab={activeTab}
        onChange={(tab) => setActiveTab(tab as TabId)}
        variant="line"
        ariaLabel="User configuration sections"
        idPrefix="ceph-admin-user-editor"
      />
      {canAddAsS3Connection && showAddConnectionModal && createdKey && addConnectionDefaults && (
        <AddS3ConnectionFromKeyModal
          isOpen={showAddConnectionModal}
          title="Add this key as S3 Connection"
          zIndexClass="z-[60]"
          lockEndpoint
          accessKeyId={createdKey.access_key}
          secretAccessKey={createdKey.secret_key}
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
            setKeysStatus("S3 connection created.");
            setKeysError(null);
          }}
        />
      )}
      {keyConfirmation.confirmationDialog}
    </WorkflowPage>
    {formController.confirmationDialog}
    {formController.navigationGuard}
  </>;
}
