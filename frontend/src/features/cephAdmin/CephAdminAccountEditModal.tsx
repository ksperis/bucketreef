/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { cx, uiDataTableClass, uiPanelMutedClass } from "../../components/ui/styles";
import {
  CephAdminRgwAccountDetail,
  UpdateCephAdminAccountPayload,
  getCephAdminAccountDetail,
  updateCephAdminAccountConfig,
} from "../../api/cephAdminAccounts";
import {
  getCephAdminAccountMetrics,
  type CephAdminEntityMetrics,
} from "../../api/cephAdminMetrics";
import WorkflowPage from "../../components/WorkflowPage";
import PageBanner from "../../components/PageBanner";
import PageTabs from "../../components/PageTabs";
import { SettingsButton } from "../../components/settings/SettingsControls";
import SettingsForm from "../../components/settings/SettingsForm";
import { useSettingsFormController } from "../../components/settings/useSettingsFormController";
import CephAdminAccountFormFields from "./CephAdminAccountFormFields";
import { parseCephAdminAccountLimits, validateCephAdminAccountForm } from "./cephAdminAccountForm";
import { focusFirstInvalidField } from "../../utils/focusFirstInvalidField";
import UsageTile from "../../components/UsageTile";
import { extractApiError } from "../../utils/apiError";
import { formatBytes, formatNumber } from "../../utils/format";
import { stableSignature } from "../../utils/stableSignature";
import CephAdminQuotaFields from "./CephAdminQuotaFields";
import { buildCephAdminQuotaPatch } from "./quotaPatch";
import { cephAdminPageBreadcrumbs } from "./cephAdminBreadcrumbs";
import { parseOptionalNonNegativeInteger, parseQuotaBytes, quotaBytesToForm, type CephAdminQuotaUnit } from "./quotaForm";

type Props = {
  endpointId: number;
  accountId: string;
  canViewMetrics?: boolean;
  onClose: () => void;
  onSaved?: (detail: CephAdminRgwAccountDetail) => void;
};

type TabId = "overview" | "config" | "metrics";

const extractError = (err: unknown): string => extractApiError(err, "Unexpected error");

export default function CephAdminAccountEditModal({
  endpointId,
  accountId,
  canViewMetrics = true,
  onClose,
  onSaved,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [detail, setDetail] = useState<CephAdminRgwAccountDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<CephAdminEntityMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const [accountName, setAccountName] = useState("");
  const [email, setEmail] = useState("");
  const [maxUsers, setMaxUsers] = useState("");
  const [maxBuckets, setMaxBuckets] = useState("");
  const [maxRoles, setMaxRoles] = useState("");
  const [maxGroups, setMaxGroups] = useState("");
  const [maxAccessKeys, setMaxAccessKeys] = useState("");
  const [quotaEnabled, setQuotaEnabled] = useState(true);
  const [quotaSize, setQuotaSize] = useState("");
  const [quotaUnit, setQuotaUnit] = useState<CephAdminQuotaUnit>("GiB");
  const [quotaObjects, setQuotaObjects] = useState("");
  const [bucketQuotaEnabled, setBucketQuotaEnabled] = useState(true);
  const [bucketQuotaSize, setBucketQuotaSize] = useState("");
  const [bucketQuotaUnit, setBucketQuotaUnit] = useState<CephAdminQuotaUnit>("GiB");
  const [bucketQuotaObjects, setBucketQuotaObjects] = useState("");
  const currentSignature = useMemo(
    () =>
      stableSignature({
        accountName,
        email,
        maxUsers,
        maxBuckets,
        maxRoles,
        maxGroups,
        maxAccessKeys,
        quotaEnabled,
        quotaSize,
        quotaUnit,
        quotaObjects,
        bucketQuotaEnabled,
        bucketQuotaSize,
        bucketQuotaUnit,
        bucketQuotaObjects,
      }),
    [
      accountName,
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
      quotaEnabled,
      quotaObjects,
      quotaSize,
      quotaUnit,
    ]
  );
  const [initialSignature, setInitialSignature] = useState(currentSignature);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const payload = await getCephAdminAccountDetail(endpointId, accountId);
        if (cancelled) return;
        setDetail(payload);
        setAccountName(payload.account_name ?? "");
        setEmail(payload.email ?? "");
        setMaxUsers(payload.max_users != null ? String(payload.max_users) : "");
        setMaxBuckets(payload.max_buckets != null ? String(payload.max_buckets) : "");
        setMaxRoles(payload.max_roles != null ? String(payload.max_roles) : "");
        setMaxGroups(payload.max_groups != null ? String(payload.max_groups) : "");
        setMaxAccessKeys(payload.max_access_keys != null ? String(payload.max_access_keys) : "");
        const quotaConfigured = Boolean(
          payload.quota && (payload.quota.max_size_bytes != null || payload.quota.max_objects != null)
        );
        setQuotaEnabled(payload.quota?.enabled ?? quotaConfigured);
        const quotaForm = quotaBytesToForm(payload.quota?.max_size_bytes);
        setQuotaSize(quotaForm.value);
        setQuotaUnit(quotaForm.unit);
        setQuotaObjects(payload.quota?.max_objects != null ? String(payload.quota.max_objects) : "");
        const bucketQuotaConfigured = Boolean(
          payload.bucket_quota && (payload.bucket_quota.max_size_bytes != null || payload.bucket_quota.max_objects != null)
        );
        setBucketQuotaEnabled(payload.bucket_quota?.enabled ?? bucketQuotaConfigured);
        const bucketQuotaForm = quotaBytesToForm(payload.bucket_quota?.max_size_bytes);
        setBucketQuotaSize(bucketQuotaForm.value);
        setBucketQuotaUnit(bucketQuotaForm.unit);
        setBucketQuotaObjects(payload.bucket_quota?.max_objects != null ? String(payload.bucket_quota.max_objects) : "");
        setInitialSignature(
          stableSignature({
            accountName: payload.account_name ?? "",
            email: payload.email ?? "",
            maxUsers: payload.max_users != null ? String(payload.max_users) : "",
            maxBuckets: payload.max_buckets != null ? String(payload.max_buckets) : "",
            maxRoles: payload.max_roles != null ? String(payload.max_roles) : "",
            maxGroups: payload.max_groups != null ? String(payload.max_groups) : "",
            maxAccessKeys: payload.max_access_keys != null ? String(payload.max_access_keys) : "",
            quotaEnabled: payload.quota?.enabled ?? quotaConfigured,
            quotaSize: quotaForm.value,
            quotaUnit: quotaForm.unit,
            quotaObjects: payload.quota?.max_objects != null ? String(payload.quota.max_objects) : "",
            bucketQuotaEnabled: payload.bucket_quota?.enabled ?? bucketQuotaConfigured,
            bucketQuotaSize: bucketQuotaForm.value,
            bucketQuotaUnit: bucketQuotaForm.unit,
            bucketQuotaObjects: payload.bucket_quota?.max_objects != null ? String(payload.bucket_quota.max_objects) : "",
          })
        );
      } catch (err) {
        if (!cancelled) {
          setDetailError(extractError(err));
          setDetail(null);
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
  }, [accountId, endpointId]);

  useEffect(() => {
    if (!canViewMetrics || activeTab !== "metrics") return;
    let cancelled = false;
    const load = async () => {
      setMetricsLoading(true);
      setMetricsError(null);
      try {
        const payload = await getCephAdminAccountMetrics(endpointId, accountId);
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
  }, [activeTab, canViewMetrics, endpointId, accountId]);

  useEffect(() => {
    if (!canViewMetrics && activeTab === "metrics") {
      setActiveTab("overview");
    }
  }, [activeTab, canViewMetrics]);

  const [validationAttempted, setValidationAttempted] = useState(false);
  const profileValues = { accountName, email, maxUsers, maxBuckets, maxRoles, maxGroups, maxAccessKeys };
  const validation = validateCephAdminAccountForm(profileValues,
    { enabled: quotaEnabled, size: quotaSize, unit: quotaUnit, objects: quotaObjects },
    { enabled: bucketQuotaEnabled, size: bucketQuotaSize, unit: bucketQuotaUnit, objects: bucketQuotaObjects });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    if (saving || detailLoading || !detail) return;
    setSaveError(null);
    setSaveStatus(null);
    setValidationAttempted(true);
    if (validation.invalid) {
      focusFirstInvalidField(event.currentTarget);
      return;
    }
    const parsedQuotaBytes = quotaEnabled ? parseQuotaBytes(quotaSize, quotaUnit) : null;
    const parsedQuotaObjects = quotaEnabled ? parseOptionalNonNegativeInteger(quotaObjects) : null;
    const parsedBucketQuotaBytes = bucketQuotaEnabled ? parseQuotaBytes(bucketQuotaSize, bucketQuotaUnit) : null;
    const parsedBucketQuotaObjects = bucketQuotaEnabled ? parseOptionalNonNegativeInteger(bucketQuotaObjects) : null;

    setSaving(true);
    return (async () => {
      try {
        const payload: UpdateCephAdminAccountPayload = {
          account_name: accountName.trim() || null,
          email: email.trim() || null,
          ...parseCephAdminAccountLimits(profileValues),
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
          ...buildCephAdminQuotaPatch(
            {
              enabled: "bucket_quota_enabled",
              maxSizeBytes: "bucket_quota_max_size_bytes",
              maxObjects: "bucket_quota_max_objects",
            },
            detail?.bucket_quota,
            {
              enabled: bucketQuotaEnabled,
              maxSizeBytes: parsedBucketQuotaBytes,
              maxObjects: parsedBucketQuotaObjects,
            }
          ),
        };
        const updated = await updateCephAdminAccountConfig(endpointId, accountId, payload);
        setDetail(updated);
        setInitialSignature(currentSignature);
        setSaveStatus("Account configuration updated.");
        onSaved?.(updated);
        if (activeTab === "metrics") {
          try {
            const refreshedMetrics = await getCephAdminAccountMetrics(endpointId, accountId);
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

  const overviewQuota = detail?.quota ?? null;

  const overviewTab = (
    <section className="space-y-4">
      {detailLoading && <PageBanner tone="info">Loading account details...</PageBanner>}
      {detailError && <PageBanner tone="error">{detailError}</PageBanner>}
      {detail && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <UsageTile
              label="Buckets"
              used={detail.bucket_count ?? null}
              quota={detail.max_buckets ?? null}
              formatter={formatNumber}
              quotaFormatter={(value) => (value != null ? value.toLocaleString() : "-")}
              unitHint="buckets"
              emptyHint="No bucket limit defined."
            />
            <UsageTile
              label="Users"
              used={detail.user_count ?? null}
              quota={detail.max_users ?? null}
              formatter={formatNumber}
              quotaFormatter={(value) => (value != null ? value.toLocaleString() : "-")}
              unitHint="users"
              emptyHint="No user limit defined."
            />
          </div>
          <div className={cx(uiPanelMutedClass, "px-4 py-3")}>
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Name</dt>
                <dd className="ui-body font-semibold text-slate-800 dark:text-slate-100">{detail.account_name ?? "-"}</dd>
              </div>
              <div>
                <dt className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Email</dt>
                <dd className="ui-body font-semibold text-slate-800 dark:text-slate-100">{detail.email ?? "-"}</dd>
              </div>
              <div>
                <dt className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Quota (size)
                </dt>
                <dd className="ui-body font-semibold text-slate-800 dark:text-slate-100">
                  {overviewQuota?.max_size_bytes != null ? formatBytes(overviewQuota.max_size_bytes) : "-"}
                </dd>
              </div>
              <div>
                <dt className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Quota (objects)
                </dt>
                <dd className="ui-body font-semibold text-slate-800 dark:text-slate-100">
                  {overviewQuota?.max_objects != null ? formatNumber(overviewQuota.max_objects) : "-"}
                </dd>
              </div>
            </dl>
          </div>
        </>
      )}
    </section>
  );

  const configTab = (
    <SettingsForm
      label="RGW account configuration"
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
        {detailLoading && <PageBanner tone="info">Loading account details...</PageBanner>}
        {detailError && <PageBanner tone="error">{detailError}</PageBanner>}
        {saveError && <PageBanner tone="error">{saveError}</PageBanner>}
        {saveStatus && <PageBanner tone="success">{saveStatus}</PageBanner>}
        <CephAdminAccountFormFields values={profileValues}
          errors={validationAttempted ? validation.profile : undefined}
          onChange={(field, value) => ({ accountName: setAccountName, email: setEmail,
            maxBuckets: setMaxBuckets, maxUsers: setMaxUsers, maxRoles: setMaxRoles,
            maxGroups: setMaxGroups, maxAccessKeys: setMaxAccessKeys })[field](value)} />

        <CephAdminQuotaFields
          title="Account quota"
          enabledLabel="Enable account quota"
          enabled={quotaEnabled}
          onEnabledChange={setQuotaEnabled}
          sizeError={validationAttempted ? validation.accountQuota.size : undefined}
          objectError={validationAttempted ? validation.accountQuota.objects : undefined}
          sizeValue={quotaSize}
          onSizeChange={setQuotaSize}
          unitValue={quotaUnit}
          onUnitChange={setQuotaUnit}
          objectValue={quotaObjects}
          onObjectChange={setQuotaObjects}
          sizePlaceholder="Leave empty to clear"
          objectPlaceholder="Leave empty to clear"
        />

        <CephAdminQuotaFields
          title="Bucket quota"
          enabledLabel="Enable bucket quota"
          enabled={bucketQuotaEnabled}
          onEnabledChange={setBucketQuotaEnabled}
          sizeError={validationAttempted ? validation.bucketQuota.size : undefined}
          objectError={validationAttempted ? validation.bucketQuota.objects : undefined}
          sizeValue={bucketQuotaSize}
          onSizeChange={setBucketQuotaSize}
          unitValue={bucketQuotaUnit}
          onUnitChange={setBucketQuotaUnit}
          objectValue={bucketQuotaObjects}
          onObjectChange={setBucketQuotaObjects}
          sizePlaceholder="Leave empty to clear"
          objectPlaceholder="Leave empty to clear"
        />
      </div>
    </SettingsForm>
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
    { id: "config", label: "Configuration", content: configTab },
    ...(canViewMetrics ? [{ id: "metrics", label: "Metrics", content: metricsTab }] : []),
  ];

  return <>
    <WorkflowPage
      title={`Configure account · ${accountId}`}
      description="Review configuration, quotas and metrics without nested dialog scrolling."
      breadcrumbs={cephAdminPageBreadcrumbs("accounts", { label: accountId })}
      backLabel="Back to accounts"
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
        ariaLabel="Account configuration sections"
        idPrefix="ceph-admin-account-editor"
      />
    </WorkflowPage>
    {formController.confirmationDialog}
    {formController.navigationGuard}
  </>;
}
