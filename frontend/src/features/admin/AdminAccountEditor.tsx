/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import FeatureOverrideField from "../../components/settings/FeatureOverrideField";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { getS3Account, updateS3Account, fetchAccountPortalSettings, updateAccountPortalSettings, type S3Account, type S3AccountSummary } from "../../api/accounts";
import { hasAccountAccessRole, getAccountAccessRequiredMessage } from "../../api/accountAccess";
import { getStorageEndpoint, type StorageEndpoint } from "../../api/storageEndpoints";
import type { PortalAccountSettings } from "../../api/portalAccounts";
import WorkflowPage, { WorkflowMetadata } from "../../components/WorkflowPage";
import WorkflowTabs from "../../components/WorkflowTabs";
import InlineSummary from "../../components/InlineSummary";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import SettingsForm from "../../components/settings/SettingsForm";
import { SettingsButton, SettingsPersistentEditActions } from "../../components/settings/SettingsControls";
import { useSettingsDraft } from "../../components/settings/useSettingsDraft";
import { useSettingsRemoteDraft } from "../../components/settings/useSettingsRemoteDraft";
import { useSettingsFormController } from "../../components/settings/useSettingsFormController";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiTagEditor from "../../components/UiTagEditor";
import UsageTile from "../../components/UsageTile";
import { useTagCatalog } from "../../hooks/useTagCatalog";
import { extractApiError } from "../../utils/apiError";
import { focusFirstInvalidField } from "../../utils/focusFirstInvalidField";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import ProjectSettingsEditor, { type ProjectSettingsAdapter } from "../shared/ProjectSettingsEditor";
import { useAdminPageBreadcrumbs } from "./adminBreadcrumbs";
import { useAdminAccountStats } from "./useAdminAccountStats";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { adminAssociationPanelClass } from "./AdminAssociationPicker";
import AdminQuotaFields from "./AdminQuotaFields";
import { adminQuotaErrors } from "./useAdminRgwFormValidation";
import { adminAccountForm, adminAccountPayload, accountQuotaChanged, type AdminAccountForm } from "./adminAccountForm";
import AdminAccountAssociations, { accountUserAssociations, accountGroupAssociations } from "./AdminAccountAssociations";
import { useAdminI18n } from "./adminI18n";

type EditTab = "general" | "users" | "groups" | "manager" | "portal";
type EditorState = { dirty: boolean; busy: boolean };
type Props = {
  account: S3Account | S3AccountSummary;
  portalEnabled: boolean;
  canManageManagerFeatures: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onStateChange: (state: EditorState) => void;
};
const settingsSnapshot = (value: PortalAccountSettings) => ({ ...value, project_override: value.admin_override, can_update: true });
const portalAdapter: ProjectSettingsAdapter = {
  load: async id => settingsSnapshot(await fetchAccountPortalSettings(Number(id))),
  save: async (id, payload) => settingsSnapshot(await updateAccountPortalSettings(Number(id), payload)),
};
/** Mount by account ID so a late read or save cannot replace another account's draft. */
export default function AdminAccountEditor(props: Props) {
  const { text: adminText } = useAdminI18n();
  const adminBreadcrumbs = useAdminPageBreadcrumbs();
  const load = useCallback(() => getS3Account(props.account.id), [props.account.id]);
  const remote = useSettingsRemoteDraft<S3Account | null>(
    () => null,
    load,
    adminText("Unable to load account configuration."),
  );
  if (remote.draft && !remote.loading && !remote.loadError) return <LoadedAccountEditor {...props} account={remote.draft} />;
  return <WorkflowPage title={adminText("Edit {name}", { name: props.account.name })}
    description={adminText("Manage quotas, usage, UI associations, Manager features, and Portal overrides for this account.")}
    breadcrumbs={adminBreadcrumbs("accounts", { label: adminText("Edit") })} onBack={props.onClose} backLabel={adminText("Back to accounts")}
    width="wide" contentVariant="plain" contentClassName="settings-compact settings-form">
    {remote.loading ? <p role="status">{adminText("Loading account configuration...")}</p> : <UiInlineMessage tone="error" role="alert">
      {remote.loadError} <SettingsButton variant="secondary" onClick={remote.retry}>{adminText("Retry")}</SettingsButton>
    </UiInlineMessage>}
  </WorkflowPage>;
}

function LoadedAccountEditor({ account, portalEnabled, canManageManagerFeatures, onClose, onSaved, onStateChange }: Props & { account: S3Account }) {
  const { intlLocale, text: adminText } = useAdminI18n();
  const adminBreadcrumbs = useAdminPageBreadcrumbs();
  const form = useSettingsDraft(() => adminAccountForm(account));
  const [tab, setTab] = useState<EditTab>("general");
  const [portalDirty, setPortalDirty] = useState(false);
  const [portalBusy, setPortalBusy] = useState(false);
  const [userPending, setUserPending] = useState(false);
  const [groupPending, setGroupPending] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const loadPermissions = useCallback(() => getStorageEndpoint(account.storage_endpoint_id, { include_admin_ops_permissions: true }), [account.storage_endpoint_id]);
  const permissions = useSettingsRemoteDraft<StorageEndpoint | null>(
    () => null,
    loadPermissions,
    adminText("Unable to check endpoint permissions."),
  );
  const allowQuotaUpdates = Boolean(account.storage_endpoint_capabilities?.admin && account.rgw_account_id && permissions.draft?.admin_ops_permissions?.accounts_write);
  const { generalSettings } = useGeneralSettings();
  const allowBucketQuotas = Boolean(permissions.draft?.admin_ops_permissions?.buckets_write);
  const usageEnabled = Boolean(account.storage_endpoint_capabilities?.usage && account.rgw_account_id);
  const usage = useAdminAccountStats(account.id, usageEnabled);
  const tags = useTagCatalog({ kind: "admin", domain: "admin_managed" }, true);
  const quotaErrors = allowQuotaUpdates ? adminQuotaErrors(form.draft) : {};
  const update = <K extends keyof AdminAccountForm>(key: K, value: AdminAccountForm[K]) => {
    form.setDraft(current => ({ ...current, [key]: value }));
    setSaved(false);
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    setAttempted(true);
    setError(null);
    setSaved(false);
    const invalidUsers = form.draft.user_links.some(link => !hasAccountAccessRole(link));
    const invalidGroups = form.draft.group_links.some(link => !hasAccountAccessRole(link));
    if (invalidUsers || invalidGroups || userPending || groupPending) {
      setTab(invalidUsers || userPending ? "users" : "groups");
      setError(invalidUsers || invalidGroups
        ? adminText(getAccountAccessRequiredMessage(portalEnabled))
        : adminText("Add the selected UI {kind}, or cancel their selection, before saving.", {
            kind: adminText(userPending ? "users" : "groups"),
          }));
      focusFirstInvalidField(event.currentTarget);
      return;
    }
    if (Object.values(quotaErrors).some(Boolean)) {
      setTab("general");
      focusFirstInvalidField(event.currentTarget);
      return;
    }
    if (accountQuotaChanged(form.draft, form.baseline) && !allowQuotaUpdates) {
      setTab("general");
      setError(adminText("Quota changes require verified accounts=write permission on this endpoint."));
      return;
    }
    const snapshot = form.draft;
    try {
      await updateS3Account(account.id, adminAccountPayload(snapshot, form.baseline, allowQuotaUpdates, canManageManagerFeatures));
      if (!active.current) return;
      form.accept(snapshot);
      setSaved(true);
      await onSaved();
    } catch (cause) {
      if (active.current) setError(extractApiError(cause, adminText("Unable to save account configuration.")));
    }
  };
  const dirty = form.dirty || portalDirty || userPending || groupPending;
  const saveableDirty = form.dirty || userPending || groupPending;
  const controller = useSettingsFormController({ dirty, busy: portalBusy, disabled: !saveableDirty, onSubmit: save, onClose });
  useEffect(() => {
    onStateChange({ dirty, busy: controller.locked });
    return () => onStateChange({ dirty: false, busy: false });
  }, [dirty, controller.locked, onStateChange]);
  useEffect(() => { if (!portalEnabled && tab === "portal") setTab("general"); }, [portalEnabled, tab]);

  return <>
    <WorkflowPage title={adminText("Edit {name}", { name: account.name })}
      description={adminText("Manage quotas, usage, UI associations, Manager features, and Portal overrides for this account.")}
      breadcrumbs={adminBreadcrumbs("accounts", { label: adminText("Edit") })} onBack={controller.requestClose} backDisabled={controller.locked}
      backLabel={adminText("Back to accounts")} width="wide" contentVariant="plain" contentClassName="settings-compact settings-form"
      metaContent={<WorkflowMetadata items={[
        { label: adminText("RGW ID"), value: account.rgw_account_id },
        { label: adminText("Ceph tenant"), value: account.rgw_tenant || adminText("Default") },
        { label: adminText("Endpoint"), value: account.storage_endpoint_name ?? "—", title: account.storage_endpoint_url },
      ]} />}>
      <WorkflowTabs<EditTab> activeTab={tab} onTabChange={next => { if (!controller.locked) setTab(next); }}
        ariaLabel={adminText("RGW account configuration sections")} idPrefix="admin-rgw-account-edit" panelClassName="mt-3 min-w-0"
        tabs={[{ id: "general", label: adminText("General") }, { id: "users", label: adminText("Linked UI users") }, { id: "groups", label: adminText("Linked UI groups") },
          { id: "manager", label: adminText("Manager features"), visible: canManageManagerFeatures }, { id: "portal", label: adminText("Portal settings"), visible: portalEnabled }]
          .map(item => ({ ...item, id: item.id as EditTab, disabled: controller.locked }))}>
        <div hidden={tab === "portal"}>
          <SettingsForm label={adminText("Edit RGW account")} formRef={formRef} onSubmit={controller.submit} busy={controller.locked}
            submitDisabled={!saveableDirty} onCancel={controller.requestClose} submitLabel={adminText("Save changes")} busyLabel={adminText("Saving...")}
            actions={<SettingsPersistentEditActions dirty={dirty} busy={controller.locked} disabled={!saveableDirty}
              onCancel={controller.requestClose} saveLabel={adminText("Save changes")} savingLabel={adminText("Saving...")}
              cancelLabel={controller.labels.cancel} doneLabel={controller.labels.done} />}>
            {error && <UiInlineMessage tone="error" role="alert">{error}</UiInlineMessage>}
            {saved && <UiInlineMessage tone="success" role="status">{adminText("Account settings saved.")}{portalDirty ? adminText(" Portal changes remain unsaved.") : ""}</UiInlineMessage>}
            <div hidden={tab !== "general"}><div className="settings-stack">
              <SettingsSection title={adminText("Account details")} description={adminText("Use administrative tags to make this account easier to find and organize.")} presentation="compact">
                {tags.error && <UiInlineMessage tone="warning">{tags.error}</UiInlineMessage>}
                <UiTagEditor label={adminText("Tags")} tags={form.draft.tags} catalog={tags.catalog} disabled={controller.locked}
                  onChange={value => update("tags", value)} placeholder={adminText("Add a tag for this account")} hint={tags.loading ? adminText("Loading existing tag catalog...") : undefined} />
              </SettingsSection>
              <SettingsSection title={adminText("Usage")} description={adminText("Observed storage use and the currently saved limits.")} presentation="compact">
                {!usageEnabled ? <UiInlineMessage tone="info">{adminText("Storage metrics are not available for this account.")}</UiInlineMessage>
                  : usage.loading ? <p role="status">{adminText("Loading storage usage...")}</p>
                    : usage.error ? <UiInlineMessage tone="error">{usage.error} <SettingsButton variant="secondary" onClick={() => void usage.reload()}>{adminText("Retry usage")}</SettingsButton></UiInlineMessage>
                      : <>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <UsageTile
                            label={adminText("Storage")}
                            used={usage.stats?.total_bytes ?? null}
                            quota={account.quota_max_size_gb != null ? account.quota_max_size_gb * 1024 ** 3 : null}
                            formatter={formatBytes}
                            quotaFormatter={formatBytes}
                            emptyHint={adminText("No storage quota defined.")}
                          />
                          <UsageTile
                            label={adminText("Objects")}
                            used={usage.stats?.total_objects ?? null}
                            quota={account.quota_max_objects ?? null}
                            formatter={formatCompactNumber}
                            quotaFormatter={value => value != null ? value.toLocaleString(intlLocale) : "-"}
                            unitHint={adminText("objects")}
                            emptyHint={adminText("No object quota defined.")}
                          />
                        </div>
                        {usage.stats?.bucket_overview && <InlineSummary items={[
                          { label: adminText("Active buckets"), value: `${usage.stats.bucket_overview.non_empty_buckets}/${usage.stats.bucket_overview.bucket_count}` },
                          { label: adminText("Empty buckets"), value: String(usage.stats.bucket_overview.empty_buckets) },
                          { label: adminText("Average size"), value: usage.stats.bucket_overview.avg_bucket_size_bytes == null ? "—" : formatBytes(usage.stats.bucket_overview.avg_bucket_size_bytes) },
                          { label: adminText("Average objects"), value: usage.stats.bucket_overview.avg_objects_per_bucket == null ? "—" : formatCompactNumber(usage.stats.bucket_overview.avg_objects_per_bucket) },
                        ]} />}
                      </>}
              </SettingsSection>
              <SettingsSection title={adminText("Services and monitoring")} description={adminText("Account-specific overrides for shared project services.")} presentation="compact">
                <FeatureOverrideField title={adminText("Bucket composition statistics")} value={form.draft.allow_bucket_usage_stats}
                  policy={generalSettings.project_feature_policies.bucket_usage_stats} disabled={controller.locked}
                  triState
                  help={adminText("Shared project capability used by both Manager and Portal.")}
                  onChange={value => update("allow_bucket_usage_stats", value)} />
                <FeatureOverrideField title={adminText("Automatic bucket composition collection")} value={form.draft.allow_bucket_usage_stats_collection}
                  policy={generalSettings.project_collection_policies.bucket_usage_stats} disabled={controller.locked}
                  triState
                  help={adminText("Controls scheduled refreshes for this account. Bucket composition statistics must also be enabled.")}
                  onChange={value => update("allow_bucket_usage_stats_collection", value)} />
              </SettingsSection>
              {permissions.loading ? <p role="status">{adminText("Checking endpoint permissions...")}</p> : permissions.loadError ? <UiInlineMessage tone="error" role="alert">
                {permissions.loadError} <SettingsButton variant="secondary" onClick={permissions.retry}>{adminText("Retry permissions")}</SettingsButton>
              </UiInlineMessage> : !allowQuotaUpdates && <UiInlineMessage tone="info">{adminText("Quota editing requires Admin Ops support and accounts=write on the endpoint.")}</UiInlineMessage>}
              <AdminQuotaFields compact storageValue={form.draft.quota_max_size_gb} storageUnit={form.draft.quota_max_size_unit}
                objectValue={form.draft.quota_max_objects} disabled={!allowQuotaUpdates} errors={attempted ? quotaErrors : {}}
                onStorageValueChange={value => update("quota_max_size_gb", value)} onStorageUnitChange={value => update("quota_max_size_unit", value)}
                onObjectValueChange={value => update("quota_max_objects", value)} />
            </div></div>
            <div hidden={tab !== "users"} className={adminAssociationPanelClass}>
              <AdminAccountAssociations adapter={accountUserAssociations} links={form.draft.user_links} onChange={value => update("user_links", value)}
                portalEnabled={portalEnabled} disabled={controller.locked} onPendingChange={setUserPending} />
            </div>
            <div hidden={tab !== "groups"} className={adminAssociationPanelClass}>
              <AdminAccountAssociations adapter={accountGroupAssociations} links={form.draft.group_links} onChange={value => update("group_links", value)}
                portalEnabled={portalEnabled} disabled={controller.locked} onPendingChange={setGroupPending} />
            </div>
            {canManageManagerFeatures && <div hidden={tab !== "manager"}><div className="settings-stack">
              <SettingsSection presentation="compact" title={adminText("Usage and metrics")}>
                <FeatureOverrideField title={adminText("RGW traffic and usage metrics")} value={form.draft.allow_rgw_usage_metrics}
                  policy={generalSettings.manager_feature_policies.rgw_usage_metrics} disabled={controller.locked}
                  triState
                  help={adminText("Controls traffic and usage metrics for this RGW Account. Endpoint capabilities and supervision credentials still apply.")}
                  onChange={value => update("allow_rgw_usage_metrics", value)} />
              </SettingsSection>
              <SettingsSection presentation="compact" title={adminText("Access-key extensions")}>
                <FeatureOverrideField title={adminText("Access-key names and notes")} value={form.draft.allow_access_key_metadata}
                  policy={generalSettings.manager_feature_policies.access_key_metadata} disabled={controller.locked}
                  triState
                  help={adminText("Optional. Name and notes are stored in BucketReef.")} onChange={value => update("allow_access_key_metadata", value)} />
                <FeatureOverrideField title={adminText("Access-key expiration")} value={form.draft.allow_access_key_expiration}
                  policy={generalSettings.manager_feature_policies.access_key_expiration} disabled={controller.locked}
                  triState
                  help={adminText("Schedules provider-side key disabling. Requires scheduled jobs; recorded expirations remain scheduled after opt-out.")}
                  onChange={value => update("allow_access_key_expiration", value)} />
              </SettingsSection>
              <SettingsSection presentation="compact" title={adminText("Activity history")}>
                <FeatureOverrideField title={adminText("Manager activity history")} value={form.draft.allow_activity_history}
                  policy={generalSettings.manager_feature_policies.activity_history} disabled={controller.locked}
                  triState
                  help={adminText("Shows account-scoped Manager control and configuration actions. It does not include S3 object access logs.")}
                  onChange={value => update("allow_activity_history", value)} />
              </SettingsSection>
              <SettingsSection presentation="compact" title={adminText("Privileged Ceph operations")}>
                <FeatureOverrideField title={adminText("Bucket quota management")} value={form.draft.allow_bucket_quota_management}
                  policy={generalSettings.manager_feature_policies.bucket_quota_management} disabled={controller.locked}
                  triState
                  unavailable={!allowBucketQuotas ? adminText("Endpoint permission required") : undefined}
                  help={adminText("Requires buckets=write on the endpoint Admin Ops identity. Storage authorization remains required.")}
                  onChange={value => update("allow_bucket_quota_management", value)} />
              </SettingsSection>
            </div></div>}
          </SettingsForm>
        </div>
        {portalEnabled && <div hidden={tab !== "portal"}>
          <ProjectSettingsEditor accountId={String(account.id)} projectName={account.name} adapter={portalAdapter} admin navigationGuard={false}
            disabled={controller.locked} onDirtyChange={setPortalDirty} onBusyChange={setPortalBusy} />
        </div>}
      </WorkflowTabs>
    </WorkflowPage>
    {controller.confirmationDialog}
    {controller.navigationGuard}
  </>;
}
