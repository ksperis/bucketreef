/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { deleteOpenStackCloud, listAdminOpenStackClouds, saveOpenStackCloud, type OpenStackCloud, type OpenStackCloudWrite } from "../../api/openstack";
import { listStorageEndpoints, type StorageEndpoint } from "../../api/storageEndpoints";
import { listMinimalUsers, type UserSummary } from "../../api/users";
import { listMinimalGroups, type UiGroupSummary } from "../../api/groups";
import { useRecentWebAuthnStepUp } from "../../auth/useRecentWebAuthnStepUp";
import PageHeader from "../../components/PageHeader";
import UiButton from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { SettingsSwitch } from "../../components/settings/SettingsLayout";
import SettingsNavigationGuard from "../../components/settings/SettingsNavigationGuard";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { ListActions, ListActionButton } from "../../components/list/ListControls";
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
  const [pendingClose, setPendingClose] = useState(false);
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
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!draft) return;
    setBusy(true); setError(null);
    try { await runWithStepUp(() => saveOpenStackCloud(draft, editingId)); setDraft(null); await load(); }
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
    { id: "enabled", label: text("enabled"), render: (row) => <SettingsSwitch checked={row.enabled} disabled ariaLabel={text("enabled")} onChange={() => undefined} /> },
    { id: "actions", label: "", mobileRole: "actions", render: (row) => <ListActions>
      <ListActionButton onClick={() => edit(row)}>{text("edit")}</ListActionButton>
      <ListActionButton onClick={() => setPendingDelete(row)}>{text("remove")}</ListActionButton>
    </ListActions> },
  ];
  return <div className="space-y-4">
    <PageHeader title={text("title")} breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: text("title") }]} actions={draft ? [] : [{ label: text("add"), onClick: () => edit() }]} />
    {error ? <UiInlineMessage tone="error">{error}</UiInlineMessage> : null}
    {draft ? <form onSubmit={(event) => void save(event)} className="space-y-4 max-w-4xl">
      <fieldset disabled={busy} className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <UiInput label={text("name")} required maxLength={128} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          <UiInput label={text("url")} type="url" required pattern="https://.*/v3/?" value={draft.auth_url} onChange={(event) => setDraft({ ...draft, auth_url: event.target.value })} />
          <UiInput label={text("domain")} value={draft.default_domain ?? ""} onChange={(event) => setDraft({ ...draft, default_domain: event.target.value || null })} />
        </div>
        {(["enabled", "allow_password", "allow_token", "all_users"] as const).map((field) => <div className="flex items-center justify-between max-w-xl gap-3" key={field}>
          <span>{text(field === "allow_password" ? "password" : field === "allow_token" ? "token" : field === "all_users" ? "allUsers" : "enabled")}</span>
          <SettingsSwitch checked={draft[field]} ariaLabel={text(field === "allow_password" ? "password" : field === "allow_token" ? "token" : field === "all_users" ? "allUsers" : "enabled")} onChange={(value) => setDraft({ ...draft, [field]: value })} />
        </div>)}
        <fieldset className="space-y-2"><legend>{text("endpoints")}</legend>
          {endpoints.map((item) => <div key={item.id}><UiCheckboxField checked={draft.endpoint_ids.includes(item.id)} onChange={(event) => setDraft({ ...draft, endpoint_ids: toggleId(draft.endpoint_ids, item.id, event.target.checked) })}>{item.name}</UiCheckboxField></div>)}
        </fieldset>
        {!draft.all_users ? <div className="grid gap-4 md:grid-cols-2">
          <fieldset className="space-y-2 max-h-72 overflow-auto"><legend>{text("users")}</legend>{users.map((item) => <div key={item.id}>
            <UiCheckboxField checked={draft.user_ids.includes(item.id)} onChange={(event) => setDraft({ ...draft, user_ids: toggleId(draft.user_ids, item.id, event.target.checked) })}>{item.full_name ?? item.email} ({item.email})</UiCheckboxField>
          </div>)}</fieldset>
          <fieldset className="space-y-2 max-h-72 overflow-auto"><legend>{text("groups")}</legend>{groups.map((item) => <div key={item.id}>
            <UiCheckboxField checked={draft.group_ids.includes(item.id)} onChange={(event) => setDraft({ ...draft, group_ids: toggleId(draft.group_ids, item.id, event.target.checked) })}>{item.name}</UiCheckboxField>
          </div>)}</fieldset>
        </div> : null}
        <p className="ui-caption text-[var(--ui-text-muted)]">{text("trustHelp")}</p>
      </fieldset>
      <div className="flex gap-2"><UiButton type="submit" disabled={busy || !dirty || (!draft.allow_password && !draft.allow_token) || (draft.enabled && !draft.endpoint_ids.length)}>{text("save")}</UiButton>
        <UiButton variant="secondary" disabled={busy} onClick={() => dirty ? setPendingClose(true) : setDraft(null)}>{text("cancel")}</UiButton></div>
    </form> : <DataTableShell rows={clouds} columns={columns} rowKey={(row) => row.id} responsiveCards status={loading ? "loading" : error ? "error" : clouds.length ? "ready" : "empty"} loadingMessage={text("loading")} errorMessage={error ?? text("error")} emptyMessage={text("noClouds")} />}
    <SettingsNavigationGuard dirty={dirty} onDiscard={() => setDraft(null)} />
    {pendingClose ? <ConfirmActionDialog title={text("cancel")} description={text("cancel")} confirmLabel={text("confirm")} cancelLabel={text("cancel")} onConfirm={() => { setPendingClose(false); setDraft(null); }} onCancel={() => setPendingClose(false)} /> : null}
    {pendingDelete ? <ConfirmActionDialog title={text("remove")} description={text("deleteHelp")} confirmLabel={text("remove")} cancelLabel={text("cancel")} loading={busy} error={error} onConfirm={() => void remove()} onCancel={() => setPendingDelete(null)} /> : null}
    {verificationDialog}
  </div>;
}
