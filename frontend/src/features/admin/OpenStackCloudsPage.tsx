/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { deleteOpenStackCloud, listAdminOpenStackClouds, saveOpenStackCloud, type OpenStackCloud, type OpenStackCloudWrite } from "../../api/openstack";
import { listStorageEndpoints, type StorageEndpoint } from "../../api/storageEndpoints";
import { listMinimalUsers, type UserSummary } from "../../api/users";
import { listMinimalGroups, type UiGroupSummary } from "../../api/groups";
import { useRecentWebAuthnStepUp } from "../../auth/useRecentWebAuthnStepUp";
import PageHeader from "../../components/PageHeader";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { SettingsInput } from "../../components/settings/SettingsControls";
import { SettingsChoiceRow, SettingsItem, SettingsSection, SettingsSwitch } from "../../components/settings/SettingsLayout";
import SettingsWorkflowForm from "../../components/settings/SettingsWorkflowForm";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { ListActions, ListActionButton, ListBadge } from "../../components/list/ListControls";
import { extractApiError } from "../../utils/apiError";
import { useOpenStackI18n } from "../shared/openstackMessages";

const emptyCloud = (): OpenStackCloudWrite => ({ name: "", auth_url: "", enabled: false, allow_password: true, allow_token: true, default_domain: null, all_users: false, endpoint_ids: [], user_ids: [], group_ids: [] });
const toggleId = (values: number[], id: number, checked: boolean) => checked ? [...values.filter((value) => value !== id), id] : values.filter((value) => value !== id);

export default function OpenStackCloudsPage() {
  const { text } = useOpenStackI18n();
  const { runWithStepUp, verificationDialog } = useRecentWebAuthnStepUp();
  const [clouds, setClouds] = useState<OpenStackCloud[]>([]);
  const [endpoints, setEndpoints] = useState<StorageEndpoint[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [groups, setGroups] = useState<UiGroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<OpenStackCloudWrite | null>(null);
  const [initial, setInitial] = useState("");
  const [editingId, setEditingId] = useState<number | undefined>();
  const [pendingDelete, setPendingDelete] = useState<OpenStackCloud | null>(null);
  const dirty = draft !== null && JSON.stringify(draft) !== initial;
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [items, eps, people, teams] = await Promise.all([listAdminOpenStackClouds(), listStorageEndpoints(), listMinimalUsers(), listMinimalGroups()]);
      setClouds(items); setEndpoints(eps); setUsers(people); setGroups(teams);
    } catch (failure) { setError(extractApiError(failure, text("error"))); }
    finally { setLoading(false); }
  }, [text]);
  useEffect(() => { void load(); }, [load]);
  const edit = (cloud?: OpenStackCloud) => {
    const next = cloud ? { ...cloud } : emptyCloud();
    if ("id" in next) delete (next as Partial<OpenStackCloud>).id;
    setDraft(next); setInitial(JSON.stringify(next)); setEditingId(cloud?.id); setError(null);
  };
  const closeEditor = () => {
    setDraft(null);
    setInitial("");
    setEditingId(undefined);
    setError(null);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!draft) return;
    setBusy(true); setError(null);
    try { await runWithStepUp(() => saveOpenStackCloud(draft, editingId)); closeEditor(); await load(); }
    catch (failure) { setError(extractApiError(failure, text("error"))); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!pendingDelete) return;
    setBusy(true); setError(null);
    try { await runWithStepUp(() => deleteOpenStackCloud(pendingDelete.id)); setPendingDelete(null); await load(); }
    catch (failure) { setError(extractApiError(failure, text("error"))); }
    finally { setBusy(false); }
  };
  const columns: DataTableColumn<OpenStackCloud>[] = [
    { id: "name", label: text("name"), primary: true, render: (row) => row.name },
    { id: "url", label: text("url"), render: (row) => row.auth_url },
    { id: "enabled", label: text("enabled"), render: (row) => <ListBadge tone={row.enabled ? "success" : "neutral"}>{text(row.enabled ? "enabled" : "disabled")}</ListBadge> },
    { id: "actions", label: "", mobileRole: "actions", render: (row) => <ListActions>
      <ListActionButton onClick={() => edit(row)}>{text("edit")}</ListActionButton>
      <ListActionButton onClick={() => setPendingDelete(row)}>{text("remove")}</ListActionButton>
    </ListActions> },
  ];
  if (draft) {
    const invalidAuthentication = !draft.allow_password && !draft.allow_token;
    const missingEndpoint = draft.enabled && draft.endpoint_ids.length === 0;
    const title = editingId == null ? text("addTitle") : `${text("editTitle")} · ${draft.name || text("title")}`;
    return <>
      <SettingsWorkflowForm
        title={title}
        description={text("configurationIntro")}
        formLabel={text("configurationLabel")}
        breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: text("title"), to: "/admin/openstack" }, { label: editingId == null ? text("add") : text("edit") }]}
        backLabel={text("backToClouds")}
        contentVariant="plain"
        width="wide"
        dirty={dirty}
        persistentEdit={editingId != null}
        busy={busy}
        disabled={!dirty || invalidAuthentication || missingEndpoint}
        error={error}
        submitLabel={text("save")}
        busyLabel={text("saving")}
        onSubmit={save}
        onClose={closeEditor}
      >
        <SettingsSection title={text("generalSection")} description={text("generalDescription")} presentation="compact">
          <div className="settings-fields sm:grid-cols-2">
            <SettingsInput label={text("name")} required maxLength={128} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            <SettingsInput label={text("url")} type="url" required pattern="https://.*/v3/?" value={draft.auth_url} onChange={(event) => setDraft({ ...draft, auth_url: event.target.value })} />
            <SettingsInput label={text("domain")} value={draft.default_domain ?? ""} onChange={(event) => setDraft({ ...draft, default_domain: event.target.value || null })} />
          </div>
        </SettingsSection>

        <SettingsSection title={text("authenticationSection")} description={text("authenticationDescription")} presentation="compact">
          <div className="settings-fields">
            <SettingsItem compact title={text("enabled")} description={text("enabledDescription")}
              action={<SettingsSwitch checked={draft.enabled} ariaLabel={text("enabled")} onChange={(value) => setDraft({ ...draft, enabled: value })} />} />
            <SettingsItem compact title={text("password")} description={text("passwordDescription")}
              action={<SettingsSwitch checked={draft.allow_password} ariaLabel={text("password")} onChange={(value) => setDraft({ ...draft, allow_password: value })} />} />
            <SettingsItem compact title={text("token")} description={text("tokenDescription")}
              action={<SettingsSwitch checked={draft.allow_token} ariaLabel={text("token")} onChange={(value) => setDraft({ ...draft, allow_token: value })} />} />
            {invalidAuthentication ? <UiInlineMessage tone="warning">{text("authenticationRequired")}</UiInlineMessage> : null}
          </div>
        </SettingsSection>

        <SettingsSection title={text("accessSection")} description={text("accessDescription")} presentation="compact">
          <div className="settings-fields">
            <SettingsItem compact title={text("allUsers")} description={text("allUsersDescription")}
              action={<SettingsSwitch checked={draft.all_users} ariaLabel={text("allUsers")} onChange={(value) => setDraft({ ...draft, all_users: value })} />} />
            <fieldset className="min-w-0">
              <legend className="settings-label mb-1">{text("endpoints")}</legend>
              <p className="settings-description mb-1">{text("endpointsDescription")}</p>
              {endpoints.map((item) => <SettingsChoiceRow key={item.id} title={item.name}
                checked={draft.endpoint_ids.includes(item.id)}
                onChange={(checked) => setDraft({ ...draft, endpoint_ids: toggleId(draft.endpoint_ids, item.id, checked) })} />)}
            </fieldset>
            {missingEndpoint ? <UiInlineMessage tone="warning">{text("endpointRequired")}</UiInlineMessage> : null}
            {!draft.all_users ? <div className="grid gap-4 md:grid-cols-2">
              <fieldset className="min-w-0 max-h-72 overflow-y-auto pr-1">
                <legend className="settings-label mb-1">{text("users")}</legend>
                {users.map((item) => <SettingsChoiceRow key={item.id} title={item.full_name ?? item.email}
                  description={item.full_name ? item.email : undefined} checked={draft.user_ids.includes(item.id)}
                  onChange={(checked) => setDraft({ ...draft, user_ids: toggleId(draft.user_ids, item.id, checked) })} />)}
              </fieldset>
              <fieldset className="min-w-0 max-h-72 overflow-y-auto pr-1">
                <legend className="settings-label mb-1">{text("groups")}</legend>
                {groups.map((item) => <SettingsChoiceRow key={item.id} title={item.name} checked={draft.group_ids.includes(item.id)}
                  onChange={(checked) => setDraft({ ...draft, group_ids: toggleId(draft.group_ids, item.id, checked) })} />)}
              </fieldset>
            </div> : null}
          </div>
        </SettingsSection>

        <UiInlineMessage tone="info">{text("trustHelp")}</UiInlineMessage>
      </SettingsWorkflowForm>
      {verificationDialog}
    </>;
  }
  return <div className="space-y-4">
    <PageHeader title={text("title")} breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: text("title") }]} actions={[{ label: text("add"), onClick: () => edit() }]} />
    {error ? <UiInlineMessage tone="error">{error}</UiInlineMessage> : null}
    <DataTableShell rows={clouds} columns={columns} rowKey={(row) => row.id} responsiveCards status={loading ? "loading" : error ? "error" : clouds.length ? "ready" : "empty"} loadingMessage={text("loading")} errorMessage={error ?? text("error")} emptyMessage={text("noClouds")} />
    {pendingDelete ? <ConfirmActionDialog title={text("remove")} description={text("deleteHelp")} confirmLabel={text("remove")} cancelLabel={text("cancel")} loading={busy} error={error} onConfirm={() => void remove()} onCancel={() => setPendingDelete(null)} /> : null}
    {verificationDialog}
  </div>;
}
