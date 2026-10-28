/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  activateOpenStackContext, connectOpenStack, disconnectOpenStack, listOpenStackClouds,
  listOpenStackConnections, listOpenStackKeys, listOpenStackProjects,
  type OpenStackConnection, type OpenStackProject, type OpenStackPublicCloud,
} from "../../api/openstack";
import UiButton from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { ListActions, ListActionButton } from "../../components/list/ListControls";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { notifyExecutionContextsRefresh } from "../../utils/executionContextRefresh";
import { useOpenStackI18n } from "./openstackMessages";

export default function OpenStackConnectionsPage() {
  const { text, errorText } = useOpenStackI18n();
  const navigate = useNavigate();
  const { generalSettings, runtimeSurfaces } = useGeneralSettings();
  const [clouds, setClouds] = useState<OpenStackPublicCloud[]>([]);
  const [connections, setConnections] = useState<OpenStackConnection[]>([]);
  const [cloudId, setCloudId] = useState("");
  const [method, setMethod] = useState<"password" | "token">("password");
  const [username, setUsername] = useState("");
  const [useUserId, setUseUserId] = useState(false);
  const [domain, setDomain] = useState("");
  const [domainIsId, setDomainIsId] = useState(false);
  const [secret, setSecret] = useState("");
  const [selected, setSelected] = useState<OpenStackConnection | null>(null);
  const [projects, setProjects] = useState<OpenStackProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [endpointId, setEndpointId] = useState("");
  const [keys, setKeys] = useState<string[]>([]);
  const [key, setKey] = useState("");
  const [keysLoading, setKeysLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingForget, setPendingForget] = useState<OpenStackConnection | null>(null);
  const cloud = clouds.find((item) => item.id === Number(cloudId));
  const selectedCloud = clouds.find((item) => item.id === selected?.cloud_id);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [available, saved] = await Promise.all([listOpenStackClouds(), listOpenStackConnections()]);
      setClouds(available); setConnections(saved);
    } catch (failure) { setError(errorText(failure)); }
    finally { setLoading(false); }
  }, [errorText]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!selected || !projectId) { setKeys([]); setKey(""); return; }
    let cancelled = false;
    setKeysLoading(true); setKeys([]); setKey(""); setError(null);
    listOpenStackKeys(selected.id, projectId).then((items) => {
      if (!cancelled) { setKeys(items); if (items.length === 1) setKey(items[0]); }
    }).catch((failure) => { if (!cancelled) setError(errorText(failure)); })
      .finally(() => { if (!cancelled) setKeysLoading(false); });
    return () => { cancelled = true; };
  }, [selected, projectId, errorText]);

  const chooseCloud = (id: string) => {
    const next = clouds.find((item) => item.id === Number(id));
    setCloudId(id); setMethod(next?.allow_password ? "password" : "token");
    setDomain(next?.default_domain ?? ""); setDomainIsId(false); setSecret(""); setSelected(null); setProjects([]); setProjectId("");
  };
  const selectConnection = async (connection: OpenStackConnection) => {
    setSelected(connection); setProjects([]); setProjectId(""); setError(null);
    const endpoints = clouds.find((item) => item.id === connection.cloud_id)?.endpoints ?? [];
    setEndpointId(endpoints.length === 1 ? String(endpoints[0].id) : "");
    const items = await listOpenStackProjects(connection.id);
    setProjects(items); if (items.length === 1) setProjectId(items[0].id);
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await action(); } catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  };
  const authenticate = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      try {
        const connection = await connectOpenStack({ cloud_id: Number(cloudId), method,
          ...(method === "token" ? { token: secret } : {
            ...(useUserId ? { user_id: username } : { username }), password: secret, domain, domain_is_id: domainIsId,
          }),
        });
        await load(); await selectConnection(connection);
      } finally { setSecret(""); }
    });
  };
  const open = (workspace: "browser" | "manager") => void run(async () => {
    if (!selected) return;
    const ctx = await activateOpenStackContext(selected.id, projectId, Number(endpointId), key || undefined);
    notifyExecutionContextsRefresh();
    navigate(`/${workspace}?ctx=${encodeURIComponent(ctx)}`);
  });
  const disconnect = (connection: OpenStackConnection, forget = false) => void run(async () => {
    await disconnectOpenStack(connection.id, forget);
    if (selected?.id === connection.id) { setSelected(null); setProjects([]); setProjectId(""); }
    notifyExecutionContextsRefresh(); await load(); setPendingForget(null);
  });
  const columns: DataTableColumn<OpenStackConnection>[] = [
    { id: "cloud", label: text("cloud"), primary: true, render: (row) => row.cloud_name },
    { id: "identity", label: text("identity"), render: (row) => <span title={row.keystone_user_id}>{row.display_name}</span> },
    { id: "status", label: text("connected"), render: (row) => row.connected ? text("connected") : text("disconnected") },
    { id: "actions", label: "", mobileRole: "actions", render: (row) => <ListActions>
      <ListActionButton disabled={busy} onClick={() => {
        if (row.connected) void run(() => selectConnection(row));
        else { chooseCloud(String(row.cloud_id)); setUsername(row.keystone_user_id); setUseUserId(true); }
      }}>{row.connected ? text("choose") : text("reconnect")}</ListActionButton>
      {row.connected ? <ListActionButton disabled={busy} onClick={() => disconnect(row)}>{text("disconnect")}</ListActionButton> : null}
      <ListActionButton disabled={busy} onClick={() => setPendingForget(row)}>{text("forget")}</ListActionButton>
    </ListActions> },
  ];
  return <section className="space-y-4" aria-label={text("title")}>
    <p>{text("intro")}</p><p className="ui-caption text-[var(--ui-text-muted)]">{text("sessionHelp")}</p>
    {error ? <UiInlineMessage tone="error">{error}</UiInlineMessage> : null}
    {loading ? <p role="status">{text("loading")}</p> : null}
    {!loading && !clouds.length ? <p>{text("noClouds")}</p> : null}
    {connections.length ? <DataTableShell rows={connections} columns={columns} rowKey={(row) => row.id} responsiveCards status="ready" loadingMessage={text("loading")} errorMessage={text("error")} emptyMessage={text("noClouds")} /> : null}
    {clouds.length ? <form onSubmit={authenticate} className="space-y-3 max-w-3xl">
      <fieldset disabled={busy} className="grid gap-3 md:grid-cols-2">
        <UiSelect label={text("cloud")} required value={cloudId} onChange={(event) => chooseCloud(event.target.value)}>
          <option value="">{text("choose")}</option>{clouds.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </UiSelect>
        {cloud ? <>
          <UiSelect label={text("method")} value={method} onChange={(event) => { setMethod(event.target.value as "password" | "token"); setSecret(""); }}>
            {cloud.allow_password ? <option value="password">{text("password")}</option> : null}
            {cloud.allow_token ? <option value="token">{text("token")}</option> : null}
          </UiSelect>
          {method === "password" ? <>
            <UiInput label={text("username")} autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} />
            <UiCheckboxField checked={useUserId} onChange={(event) => setUseUserId(event.target.checked)}>{text("userId")}</UiCheckboxField>
            {!useUserId ? <><UiInput label={text("domain")} required value={domain} onChange={(event) => setDomain(event.target.value)} />
              <UiCheckboxField checked={domainIsId} onChange={(event) => setDomainIsId(event.target.checked)}>{text("domainId")}</UiCheckboxField></> : null}
          </> : null}
          <UiInput label={text(method)} type="password" autoComplete={method === "password" ? "current-password" : "off"} required value={secret} onChange={(event) => setSecret(event.target.value)} />
        </> : null}
      </fieldset>
      <UiButton type="submit" disabled={busy || !cloud}>{text("connect")}</UiButton>
    </form> : null}
    {selected ? <section className="space-y-3 max-w-3xl" aria-label={text("project")}>
      <h3>{selected.cloud_name} / {selected.display_name}</h3>
      {!busy && !projects.length ? <p>{text("noProjects")}</p> : null}
      <div className="grid gap-3 md:grid-cols-2">
        <UiSelect label={text("project")} disabled={busy} value={projectId} onChange={(event) => setProjectId(event.target.value)}>
          <option value="">{text("choose")}</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.id})</option>)}
        </UiSelect>
        <UiSelect label={text("endpoint")} disabled={busy} value={endpointId} onChange={(event) => setEndpointId(event.target.value)}>
          <option value="">{text("choose")}</option>{selectedCloud?.endpoints.map((item) => <option key={item.id} value={item.id}>{item.name}{item.region ? ` (${item.region})` : ""}</option>)}
        </UiSelect>
        {keys.length > 1 ? <UiSelect label={text("key")} value={key} onChange={(event) => setKey(event.target.value)} disabled={busy}>
          <option value="">{text("choose")}</option>{keys.map((item) => <option key={item} value={item}>{item}</option>)}
        </UiSelect> : null}
      </div>
      {keysLoading ? <p role="status">{text("loading")}</p> : null}
      {projectId && !keysLoading && !keys.length && !error ? <UiInlineMessage tone="warning">{text("noKeys")}</UiInlineMessage> : null}
      <div className="flex flex-wrap gap-2">
        {runtimeSurfaces.browser && generalSettings.browser_enabled && generalSettings.browser_root_enabled ? <UiButton disabled={busy || keysLoading || !projectId || !endpointId || !key} onClick={() => open("browser")}>{text("browser")}</UiButton> : null}
        {runtimeSurfaces.manager && generalSettings.manager_enabled ? <UiButton disabled={busy || keysLoading || !projectId || !endpointId || !key} onClick={() => open("manager")}>{text("manager")}</UiButton> : null}
        <UiButton variant="secondary" disabled={busy} onClick={() => void run(() => selectConnection(selected))}>{text("refresh")}</UiButton>
      </div>
    </section> : null}
    {pendingForget ? <ConfirmActionDialog loading={busy} error={error} title={text("forget")} description={text("deleteHelp")} confirmLabel={text("confirm")} cancelLabel={text("cancel")} onCancel={() => setPendingForget(null)} onConfirm={() => disconnect(pendingForget, true)} /> : null}
  </section>;
}
