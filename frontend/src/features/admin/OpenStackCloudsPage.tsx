/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useState, type FormEvent } from "react";
import { deleteOpenStackCloud, listAdminOpenStackClouds, saveOpenStackCloud, type OpenStackCloud, type OpenStackCloudWrite } from "../../api/openstack";
import { useRecentWebAuthnStepUp } from "../../auth/useRecentWebAuthnStepUp";
import PageHeader from "../../components/PageHeader";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { SettingsInput } from "../../components/settings/SettingsControls";
import { SettingsItem, SettingsSection, SettingsSwitch } from "../../components/settings/SettingsLayout";
import SettingsWorkflowForm from "../../components/settings/SettingsWorkflowForm";
import { useSettingsDraft } from "../../components/settings/useSettingsDraft";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import ListPageSection from "../../components/list/ListPageSection";
import { ListActions, ListActionButton, ListBadge } from "../../components/list/ListControls";
import { extractApiError } from "../../utils/apiError";
import { useOpenStackI18n } from "../shared/openstackMessages";
import useAdminListController from "./useAdminListController";

const emptyCloud = (): OpenStackCloudWrite => ({ name: "", auth_url: "", enabled: false, allow_password: true, allow_token: true, managed_endpoints_only: false, default_domain: null });

export default function OpenStackCloudsPage() {
  const { text } = useOpenStackI18n();
  const { runWithStepUp, verificationDialog } = useRecentWebAuthnStepUp();
  const [busy, setBusy] = useState(false);
  const { draft, setDraft, accept: acceptDraft, dirty } =
    useSettingsDraft<OpenStackCloudWrite | null>(null);
  const [editingId, setEditingId] = useState<number | undefined>();
  const [pendingDelete, setPendingDelete] = useState<OpenStackCloud | null>(null);
  const formatLoadError = useCallback((failure: unknown) => {
    return extractApiError(failure, text("error"));
  }, [text]);
  const {
    items: clouds,
    loading,
    error,
    setError,
    refresh: load,
  } = useAdminListController<OpenStackCloud>({
    loadItems: listAdminOpenStackClouds,
    formatError: formatLoadError,
  });
  const edit = (cloud?: OpenStackCloud) => {
    const next = cloud ? { ...cloud } : emptyCloud();
    if ("id" in next) delete (next as Partial<OpenStackCloud>).id;
    acceptDraft(next);
    setEditingId(cloud?.id);
    setError(null);
  };
  const closeEditor = () => {
    acceptDraft(null);
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
        disabled={!dirty || invalidAuthentication}
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
            <SettingsItem compact title={text("managedEndpointsOnly")} description={text("managedEndpointsOnlyDescription")}
              action={<SettingsSwitch checked={draft.managed_endpoints_only} ariaLabel={text("managedEndpointsOnly")} onChange={(value) => setDraft({ ...draft, managed_endpoints_only: value })} />} />
            <UiInlineMessage tone="info">{text("endpointsDescription")}</UiInlineMessage>
            <UiInlineMessage tone="info">{text("authorizationManagedElsewhere")}</UiInlineMessage>
          </div>
        </SettingsSection>

        <UiInlineMessage tone="info">{text("trustHelp")}</UiInlineMessage>
      </SettingsWorkflowForm>
      {verificationDialog}
    </>;
  }
  return <div className="space-y-4">
    <PageHeader actionPresentation="listing" title={text("title")} breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: text("title") }]} actions={[{ label: text("add"), onClick: () => edit() }]} />
    {error ? <UiInlineMessage tone="error">{error}</UiInlineMessage> : null}
    <ListPageSection variant="page" title={text("title")}>
      <DataTableShell rows={clouds} columns={columns} rowKey={(row) => row.id} responsiveCards status={loading ? "loading" : error ? "error" : clouds.length ? "ready" : "empty"} loadingMessage={text("loading")} errorMessage={error ?? text("error")} emptyMessage={text("noClouds")} />
    </ListPageSection>
    {pendingDelete ? <ConfirmActionDialog title={text("remove")} description={text("deleteHelp")} confirmLabel={text("remove")} cancelLabel={text("cancel")} loading={busy} error={error} onConfirm={() => void remove()} onCancel={() => setPendingDelete(null)} /> : null}
    {verificationDialog}
  </div>;
}
