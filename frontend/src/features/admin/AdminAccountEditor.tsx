/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
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
import { SettingsButton } from "../../components/settings/SettingsControls";
import { useSettingsDraft } from "../../components/settings/useSettingsDraft";
import { useSettingsRemoteDraft } from "../../components/settings/useSettingsRemoteDraft";
import { useSettingsFormController } from "../../components/settings/useSettingsFormController";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiTagEditor from "../../components/UiTagEditor";
import { useTagCatalog } from "../../hooks/useTagCatalog";
import { extractApiError } from "../../utils/apiError";
import { focusFirstInvalidField } from "../../utils/focusFirstInvalidField";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import ProjectSettingsEditor, { type ProjectSettingsAdapter } from "../shared/ProjectSettingsEditor";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import { useAdminAccountStats } from "./useAdminAccountStats";
import { AdminAccessToggleSection } from "./AdminAccessSections";
import { adminAssociationPanelClass } from "./AdminAssociationPicker";
import AdminQuotaFields from "./AdminQuotaFields";
import { adminQuotaErrors } from "./useAdminRgwFormValidation";
import { adminAccountForm, adminAccountPayload, accountQuotaChanged, type AdminAccountForm } from "./adminAccountForm";
import AdminAccountAssociations, { accountUserAssociations, accountGroupAssociations } from "./AdminAccountAssociations";

type EditTab = "general" | "users" | "groups" | "privileged" | "portal";
type EditorState = { dirty: boolean; busy: boolean };
type Props = {
  account: S3Account | S3AccountSummary;
  portalEnabled: boolean;
  canManagePrivilegedTargets: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onStateChange: (state: EditorState) => void;
};
const settingsSnapshot = (value: PortalAccountSettings) => ({ ...value, project_override: value.admin_override, can_update: true });
const portalAdapter: ProjectSettingsAdapter = {
  load: async id => settingsSnapshot(await fetchAccountPortalSettings(Number(id))),
  save: async (id, payload) => settingsSnapshot(await updateAccountPortalSettings(Number(id), payload)),
};
const pageDescription = "Manage quotas, usage, UI associations, privileged access, and Portal overrides for this account.";

/** Mount by account ID so a late read or save cannot replace another account's draft. */
export default function AdminAccountEditor(props: Props) {
  const load = useCallback(() => getS3Account(props.account.id), [props.account.id]);
  const remote = useSettingsRemoteDraft<S3Account | null>(() => null, load, "Unable to load account configuration.");
  if (remote.draft && !remote.loading && !remote.loadError) return <LoadedAccountEditor {...props} account={remote.draft} />;
  return <WorkflowPage title={`Edit ${props.account.name}`} description={pageDescription}
    breadcrumbs={adminPageBreadcrumbs("accounts", { label: "Edit" })} onBack={props.onClose} backLabel="Back to accounts"
    width="wide" contentVariant="plain" contentClassName="settings-compact settings-form">
    {remote.loading ? <p role="status">Loading account configuration...</p> : <UiInlineMessage tone="error" role="alert">
      {remote.loadError} <SettingsButton variant="secondary" onClick={remote.retry}>Retry</SettingsButton>
    </UiInlineMessage>}
  </WorkflowPage>;
}

function LoadedAccountEditor({ account, portalEnabled, canManagePrivilegedTargets, onClose, onSaved, onStateChange }: Props & { account: S3Account }) {
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
  const permissions = useSettingsRemoteDraft<StorageEndpoint | null>(() => null, loadPermissions, "Unable to check endpoint permissions.");
  const allowQuotaUpdates = Boolean(account.storage_endpoint_capabilities?.admin && account.rgw_account_id && permissions.draft?.admin_ops_permissions?.accounts_write);
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
      setError(invalidUsers || invalidGroups ? getAccountAccessRequiredMessage(portalEnabled)
        : `Add the selected UI ${userPending ? "users" : "groups"}, or cancel their selection, before saving.`);
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
      setError("Quota changes require verified accounts=write permission on this endpoint.");
      return;
    }
    const snapshot = form.draft;
    try {
      await updateS3Account(account.id, adminAccountPayload(snapshot, form.baseline, allowQuotaUpdates, canManagePrivilegedTargets));
      if (!active.current) return;
      form.accept(snapshot);
      setSaved(true);
      await onSaved();
      if (active.current && !portalDirty) onClose();
    } catch (cause) {
      if (active.current) setError(extractApiError(cause, "Unable to save account configuration."));
    }
  };
  const dirty = form.dirty || portalDirty || userPending || groupPending;
  const controller = useSettingsFormController({ dirty, busy: portalBusy, disabled: !form.dirty && !userPending && !groupPending, onSubmit: save, onClose });
  useEffect(() => {
    onStateChange({ dirty, busy: controller.locked });
    return () => onStateChange({ dirty: false, busy: false });
  }, [dirty, controller.locked, onStateChange]);
  useEffect(() => { if (!portalEnabled && tab === "portal") setTab("general"); }, [portalEnabled, tab]);

  return <>
    <WorkflowPage title={`Edit ${account.name}`} description={pageDescription}
      breadcrumbs={adminPageBreadcrumbs("accounts", { label: "Edit" })} onBack={controller.requestClose} backDisabled={controller.locked}
      backLabel="Back to accounts" width="wide" contentVariant="plain" contentClassName="settings-compact settings-form"
      metaContent={<WorkflowMetadata items={[{ label: "RGW ID", value: account.rgw_account_id }, { label: "Endpoint", value: account.storage_endpoint_name ?? "—", title: account.storage_endpoint_url }]} />}>
      <WorkflowTabs<EditTab> activeTab={tab} onTabChange={next => { if (!controller.locked) setTab(next); }}
        ariaLabel="RGW account configuration sections" idPrefix="admin-rgw-account-edit" panelClassName="mt-3 min-w-0"
        tabs={[{ id: "general", label: "General" }, { id: "users", label: "Linked UI users" }, { id: "groups", label: "Linked UI groups" },
          { id: "privileged", label: "Privileged access", visible: canManagePrivilegedTargets }, { id: "portal", label: "Portal settings", visible: portalEnabled }]
          .map(item => ({ ...item, id: item.id as EditTab, disabled: controller.locked }))}>
        <div hidden={tab === "portal"}>
          <SettingsForm label="Edit RGW account" formRef={formRef} onSubmit={controller.submit} busy={controller.locked}
            submitDisabled={!form.dirty && !userPending && !groupPending} onCancel={controller.requestClose} submitLabel="Save changes" busyLabel="Saving...">
            {error && <UiInlineMessage tone="error" role="alert">{error}</UiInlineMessage>}
            {saved && <UiInlineMessage tone="success" role="status">Account settings saved. Portal changes remain unsaved.</UiInlineMessage>}
            <div hidden={tab !== "general"}><div className="settings-stack">
              <SettingsSection title="Account details" description="Use administrative tags to make this account easier to find and organize." presentation="compact">
                {tags.error && <UiInlineMessage tone="warning">{tags.error}</UiInlineMessage>}
                <UiTagEditor label="Tags" tags={form.draft.tags} catalog={tags.catalog} disabled={controller.locked}
                  onChange={value => update("tags", value)} placeholder="Add a tag for this account" hint={tags.loading ? "Loading existing tag catalog..." : undefined} />
              </SettingsSection>
              <SettingsSection title="Usage" description="Observed storage use and the currently saved limits." presentation="compact">
                {!usageEnabled ? <UiInlineMessage tone="info">Storage metrics are not available for this account.</UiInlineMessage>
                  : usage.loading ? <p role="status">Loading storage usage...</p>
                    : usage.error ? <UiInlineMessage tone="error">{usage.error} <SettingsButton variant="secondary" onClick={() => void usage.reload()}>Retry usage</SettingsButton></UiInlineMessage>
                      : <InlineSummary items={[
                        { label: "Storage", value: usage.stats?.total_bytes == null ? "—" : formatBytes(usage.stats.total_bytes) },
                        { label: "Objects", value: usage.stats?.total_objects == null ? "—" : formatCompactNumber(usage.stats.total_objects) },
                        ...(usage.stats?.bucket_overview ? [
                          { label: "Active buckets", value: `${usage.stats.bucket_overview.non_empty_buckets}/${usage.stats.bucket_overview.bucket_count}` },
                          { label: "Empty buckets", value: String(usage.stats.bucket_overview.empty_buckets) },
                          { label: "Average size", value: usage.stats.bucket_overview.avg_bucket_size_bytes == null ? "—" : formatBytes(usage.stats.bucket_overview.avg_bucket_size_bytes) },
                          { label: "Average objects", value: usage.stats.bucket_overview.avg_objects_per_bucket == null ? "—" : formatCompactNumber(usage.stats.bucket_overview.avg_objects_per_bucket) },
                        ] : []),
                      ]} />}
                <InlineSummary items={[
                  { label: "Saved storage limit", value: form.baseline.quota_max_size_gb === "" ? "No limit" : `${form.baseline.quota_max_size_gb} ${form.baseline.quota_max_size_unit}` },
                  { label: "Saved object limit", value: form.baseline.quota_max_objects === "" ? "No limit" : form.baseline.quota_max_objects },
                ]} />
              </SettingsSection>
              {permissions.loading ? <p role="status">Checking endpoint permissions...</p> : permissions.loadError ? <UiInlineMessage tone="error" role="alert">
                {permissions.loadError} <SettingsButton variant="secondary" onClick={permissions.retry}>Retry permissions</SettingsButton>
              </UiInlineMessage> : !allowQuotaUpdates && <UiInlineMessage tone="info">Quota editing requires Admin Ops support and accounts=write on the endpoint.</UiInlineMessage>}
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
            {canManagePrivilegedTargets && <div hidden={tab !== "privileged"}>
              <AdminAccessToggleSection title="Privileged Ceph access" description="Ceph admin-API actions granted directly to this account outside the Ceph Admin workspace."
                items={[{ title: "Bucket quota management", ariaLabel: "Bucket quota management", checked: form.draft.allow_bucket_quota_management,
                  disabled: !form.draft.allow_bucket_quota_management && !allowBucketQuotas,
                  description: allowBucketQuotas ? "Allow Ceph bucket quota updates for this S3 Account in Manager."
                    : "Requires buckets=write on the endpoint Admin Ops identity before this grant can be enabled.",
                  onChange: value => update("allow_bucket_quota_management", value) }]} />
            </div>}
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
