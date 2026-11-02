/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState, type FormEvent } from "react";
import { cx, uiPanelMutedClass } from "../../components/ui/styles";
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
import PageBanner from "../../components/PageBanner";
import { SettingsButton } from "../../components/settings/SettingsControls";
import SettingsForm from "../../components/settings/SettingsForm";
import { useSettingsDraft } from "../../components/settings/useSettingsDraft";
import { useSettingsFormController } from "../../components/settings/useSettingsFormController";
import CephAdminAccountFormFields from "./CephAdminAccountFormFields";
import {
  cephAdminAccountDraftFromDetail,
  createEmptyCephAdminAccountDraft,
  parseCephAdminAccountLimits,
  validateCephAdminAccountForm,
  type CephAdminAccountDraft,
} from "./cephAdminAccountForm";
import { focusFirstInvalidField } from "../../utils/focusFirstInvalidField";
import UsageTile from "../../components/UsageTile";
import { extractApiError } from "../../utils/apiError";
import { formatBytes, formatNumber } from "../../utils/format";
import CephAdminQuotaFields from "./CephAdminQuotaFields";
import { buildCephAdminQuotaPatch } from "./quotaPatch";
import { parseOptionalNonNegativeInteger, parseQuotaBytes } from "./quotaForm";
import { useCephAdminI18n } from "./cephAdminI18n";
import DetailsDrawerNavigation, {
  guardDetailsDrawerNavigation,
  type DetailsDrawerNavigationState,
} from "../shared/DetailsDrawerNavigation";
import DetailsDrawerShell from "../shared/DetailsDrawerShell";
import CephAdminEntityMetricsPanel from "./CephAdminEntityMetricsPanel";

type Props = {
  endpointId: number;
  accountId: string;
  canViewMetrics?: boolean;
  navigation?: DetailsDrawerNavigationState;
  onClose: () => void;
  onSaved?: (detail: CephAdminRgwAccountDetail) => void;
};

type TabId = "overview" | "config" | "metrics";

export default function CephAdminAccountEditModal({
  endpointId,
  accountId,
  canViewMetrics = true,
  navigation,
  onClose,
  onSaved,
}: Props) {
  const { text: surfaceText } = useCephAdminI18n();
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
  const { draft, setDraft, accept, dirty } = useSettingsDraft<CephAdminAccountDraft>(
    () => createEmptyCephAdminAccountDraft(true)
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const payload = await getCephAdminAccountDetail(endpointId, accountId);
        if (cancelled) return;
        setDetail(payload);
        accept(cephAdminAccountDraftFromDetail(payload));
      } catch (err) {
        if (!cancelled) {
          setDetailError(extractApiError(err, "Unexpected error"));
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
  }, [accept, accountId, endpointId]);

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
          setMetricsError(extractApiError(err, "Unexpected error"));
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
  const validation = validateCephAdminAccountForm(draft.profile, draft.accountQuota, draft.bucketQuota);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    if (saving || detailLoading || !detail) return;
    setSaveError(null);
    setSaveStatus(null);
    setValidationAttempted(true);
    if (validation.invalid) {
      focusFirstInvalidField(event.currentTarget);
      return;
    }
    const parsedQuotaBytes = draft.accountQuota.enabled ? parseQuotaBytes(draft.accountQuota.size, draft.accountQuota.unit) : null;
    const parsedQuotaObjects = draft.accountQuota.enabled ? parseOptionalNonNegativeInteger(draft.accountQuota.objects) : null;
    const parsedBucketQuotaBytes = draft.bucketQuota.enabled ? parseQuotaBytes(draft.bucketQuota.size, draft.bucketQuota.unit) : null;
    const parsedBucketQuotaObjects = draft.bucketQuota.enabled ? parseOptionalNonNegativeInteger(draft.bucketQuota.objects) : null;

    setSaving(true);
    return (async () => {
      try {
        const payload: UpdateCephAdminAccountPayload = {
          account_name: draft.profile.accountName.trim() || null,
          email: draft.profile.email.trim() || null,
          ...parseCephAdminAccountLimits(draft.profile),
          ...buildCephAdminQuotaPatch(
            {
              enabled: "quota_enabled",
              maxSizeBytes: "quota_max_size_bytes",
              maxObjects: "quota_max_objects",
            },
            detail?.quota,
            {
              enabled: draft.accountQuota.enabled,
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
              enabled: draft.bucketQuota.enabled,
              maxSizeBytes: parsedBucketQuotaBytes,
              maxObjects: parsedBucketQuotaObjects,
            }
          ),
        };
        const updated = await updateCephAdminAccountConfig(endpointId, accountId, payload);
        setDetail(updated);
        accept(draft);
        setSaveStatus(surfaceText("Account configuration updated."));
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
        setSaveError(extractApiError(err, surfaceText("Unexpected error")));
      } finally {
        setSaving(false);
      }
    })();
  };
  const formController = useSettingsFormController({
    dirty: !detailLoading && dirty,
    busy: saving,
    disabled: detailLoading || !detail,
    onSubmit: submit,
    onClose,
  });

  const overviewQuota = detail?.quota ?? null;

  const overviewTab = (
    <section className="space-y-4">
      {detailLoading && <PageBanner tone="info">{surfaceText("Loading account details...")}</PageBanner>}
      {detailError && <PageBanner tone="error">{detailError}</PageBanner>}
      {detail && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <UsageTile
              label={surfaceText("Buckets")}
              used={detail.bucket_count ?? null}
              quota={detail.max_buckets ?? null}
              formatter={formatNumber}
              quotaFormatter={(value) => (value != null ? value.toLocaleString() : "-")}
              unitHint={surfaceText("buckets")}
              emptyHint={surfaceText("No bucket limit defined.")}
            />
            <UsageTile
              label={surfaceText("Users")}
              used={detail.user_count ?? null}
              quota={detail.max_users ?? null}
              formatter={formatNumber}
              quotaFormatter={(value) => (value != null ? value.toLocaleString() : "-")}
              unitHint={surfaceText("users")}
              emptyHint={surfaceText("No user limit defined.")}
            />
          </div>
          <div className={cx(uiPanelMutedClass, "px-4 py-3")}>
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{surfaceText("Name")}</dt>
                <dd className="ui-body font-semibold text-slate-800 dark:text-slate-100">{detail.account_name ?? "-"}</dd>
              </div>
              <div>
                <dt className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{surfaceText("Email")}</dt>
                <dd className="ui-body font-semibold text-slate-800 dark:text-slate-100">{detail.email ?? "-"}</dd>
              </div>
              <div>
                <dt className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {surfaceText("Quota (size)")}</dt>
                <dd className="ui-body font-semibold text-slate-800 dark:text-slate-100">
                  {overviewQuota?.max_size_bytes != null ? formatBytes(overviewQuota.max_size_bytes) : "-"}
                </dd>
              </div>
              <div>
                <dt className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {surfaceText("Quota (objects)")}</dt>
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
      label={surfaceText("RGW account configuration")}
      busy={formController.locked || detailLoading}
      disabled={!detail}
      submitDisabled={detailLoading || !detail}
      onSubmit={formController.submit}
      onCancel={formController.requestClose}
      submitLabel={surfaceText("Save configuration")}
      busyLabel={surfaceText("Saving...")}
      actions={(
        <SettingsButton type="submit" disabled={formController.locked || detailLoading || !detail} loading={formController.locked}>
          {formController.locked ? surfaceText("Saving...") : surfaceText("Save configuration")}
        </SettingsButton>
      )}
    >
      <div className="settings-compact settings-form settings-stack">
        {detailLoading && <PageBanner tone="info">{surfaceText("Loading account details...")}</PageBanner>}
        {detailError && <PageBanner tone="error">{detailError}</PageBanner>}
        {saveError && <PageBanner tone="error">{saveError}</PageBanner>}
        {saveStatus && <PageBanner tone="success">{saveStatus}</PageBanner>}
        <CephAdminAccountFormFields values={draft.profile}
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
          sizeError={validationAttempted ? validation.accountQuota.size : undefined}
          objectError={validationAttempted ? validation.accountQuota.objects : undefined}
          sizeValue={draft.accountQuota.size}
          onSizeChange={(size) => setDraft(current => ({ ...current, accountQuota: { ...current.accountQuota, size } }))}
          unitValue={draft.accountQuota.unit}
          onUnitChange={(unit) => setDraft(current => ({ ...current, accountQuota: { ...current.accountQuota, unit } }))}
          objectValue={draft.accountQuota.objects}
          onObjectChange={(objects) => setDraft(current => ({ ...current, accountQuota: { ...current.accountQuota, objects } }))}
          sizePlaceholder={surfaceText("Leave empty to clear")}
          objectPlaceholder={surfaceText("Leave empty to clear")}
        />

        <CephAdminQuotaFields
          title={surfaceText("Bucket quota")}
          enabledLabel={surfaceText("Enable bucket quota")}
          enabled={draft.bucketQuota.enabled}
          onEnabledChange={(enabled) => setDraft(current => ({ ...current, bucketQuota: { ...current.bucketQuota, enabled } }))}
          sizeError={validationAttempted ? validation.bucketQuota.size : undefined}
          objectError={validationAttempted ? validation.bucketQuota.objects : undefined}
          sizeValue={draft.bucketQuota.size}
          onSizeChange={(size) => setDraft(current => ({ ...current, bucketQuota: { ...current.bucketQuota, size } }))}
          unitValue={draft.bucketQuota.unit}
          onUnitChange={(unit) => setDraft(current => ({ ...current, bucketQuota: { ...current.bucketQuota, unit } }))}
          objectValue={draft.bucketQuota.objects}
          onObjectChange={(objects) => setDraft(current => ({ ...current, bucketQuota: { ...current.bucketQuota, objects } }))}
          sizePlaceholder={surfaceText("Leave empty to clear")}
          objectPlaceholder={surfaceText("Leave empty to clear")}
        />
      </div>
    </SettingsForm>
  );

  const metricsTab = (
    <CephAdminEntityMetricsPanel
      error={metricsError}
      loading={metricsLoading}
      metrics={metrics}
      quota={detail?.quota}
    />
  );

  const tabs = [
    { id: "overview", label: surfaceText("Overview") },
    { id: "config", label: surfaceText("Configuration") },
    ...(canViewMetrics ? [{ id: "metrics", label: surfaceText("Metrics") }] : []),
  ];
  const activeContent =
    activeTab === "config" ? configTab : activeTab === "metrics" ? metricsTab : overviewTab;
  const guardedNavigation = guardDetailsDrawerNavigation(
    navigation,
    formController.requestTransition,
  );
  const navigationActions = guardedNavigation ? (
    <DetailsDrawerNavigation
      navigation={guardedNavigation}
      labels={{
        group: surfaceText("Loaded accounts"),
        previous: surfaceText("Previous account"),
        next: surfaceText("Next account"),
      }}
    />
  ) : undefined;

  return <>
    <DetailsDrawerShell
      title={accountId}
      subtitle={
        <p className="ui-caption text-[var(--ui-text-muted)]">
          {surfaceText("RGW account settings")}
        </p>
      }
      actions={navigationActions}
      activeTab={activeTab}
      tabs={tabs}
      tabsAriaLabel={surfaceText("Account configuration sections")}
      onTabChange={(tab) => setActiveTab(tab as TabId)}
      returnFocus={navigation?.returnFocus}
      onClose={formController.requestClose}
      width="wide"
    >
      {activeContent}
    </DetailsDrawerShell>
    {formController.confirmationDialog}
    {formController.navigationGuard}
  </>;
}
