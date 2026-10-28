/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  activateOpenStackContext,
  connectOpenStack,
  disconnectOpenStack,
  listOpenStackClouds,
  listOpenStackConnections,
  listOpenStackKeys,
  listOpenStackProjects,
  type OpenStackConnection,
  type OpenStackProject,
  type OpenStackPublicCloud,
} from "../../api/openstack";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import ModalActions from "../../components/ModalActions";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { ListActions, ListActionButton } from "../../components/list/ListControls";
import ListPageSection from "../../components/list/ListPageSection";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import {
  SettingsInput,
  SettingsSelect,
} from "../../components/settings/SettingsControls";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { notifyExecutionContextsRefresh } from "../../utils/executionContextRefresh";
import { ProfileButton, ProfileDialog } from "./ProfileControls";
import { useOpenStackI18n } from "./openstackMessages";

export default function OpenStackConnectionsPage() {
  const { text, errorText } = useOpenStackI18n();
  const navigate = useNavigate();
  const { generalSettings, runtimeSurfaces } = useGeneralSettings();
  const cloudSelectRef = useRef<HTMLSelectElement>(null);
  const [clouds, setClouds] = useState<OpenStackPublicCloud[]>([]);
  const [connections, setConnections] = useState<OpenStackConnection[]>([]);
  const [cloudId, setCloudId] = useState("");
  const [method, setMethod] = useState<"password" | "token">("password");
  const [username, setUsername] = useState("");
  const [useUserId, setUseUserId] = useState(false);
  const [domain, setDomain] = useState("");
  const [domainIsId, setDomainIsId] = useState(false);
  const [secret, setSecret] = useState("");
  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
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
  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: connections.length,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [available, saved] = await Promise.all([
        listOpenStackClouds(),
        listOpenStackConnections(),
      ]);
      setClouds(available);
      setConnections(saved);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setLoading(false);
    }
  }, [errorText]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selected || !projectId) {
      setKeys([]);
      setKey("");
      return;
    }
    let cancelled = false;
    setKeysLoading(true);
    setKeys([]);
    setKey("");
    setError(null);
    listOpenStackKeys(selected.id, projectId)
      .then((items) => {
        if (!cancelled) {
          setKeys(items);
          if (items.length === 1) setKey(items[0]);
        }
      })
      .catch((failure) => {
        if (!cancelled) setError(errorText(failure));
      })
      .finally(() => {
        if (!cancelled) setKeysLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, projectId, errorText]);

  const chooseCloud = (id: string) => {
    const next = clouds.find((item) => item.id === Number(id));
    setCloudId(id);
    setMethod(next?.allow_password ? "password" : "token");
    setDomain(next?.default_domain ?? "");
    setDomainIsId(false);
    setSecret("");
    setConnectError(null);
  };

  const openConnectDialog = (connection?: OpenStackConnection) => {
    setConnectError(null);
    setSecret("");
    if (connection) {
      const nextCloud = clouds.find((item) => item.id === connection.cloud_id);
      setCloudId(String(connection.cloud_id));
      setMethod(nextCloud?.allow_password ? "password" : "token");
      setUsername(connection.keystone_user_id);
      setUseUserId(true);
      setDomain(nextCloud?.default_domain ?? "");
      setDomainIsId(false);
    } else {
      setCloudId("");
      setMethod("password");
      setUsername("");
      setUseUserId(false);
      setDomain("");
      setDomainIsId(false);
    }
    setShowConnectDialog(true);
  };

  const closeConnectDialog = () => {
    if (connectBusy) return;
    setShowConnectDialog(false);
    setSecret("");
    setConnectError(null);
  };

  const selectConnection = async (connection: OpenStackConnection) => {
    setSelected(connection);
    setProjects([]);
    setProjectId("");
    setError(null);
    const endpoints = clouds.find((item) => item.id === connection.cloud_id)?.endpoints ?? [];
    setEndpointId(endpoints.length === 1 ? String(endpoints[0].id) : "");
    const items = await listOpenStackProjects(connection.id);
    setProjects(items);
    if (items.length === 1) setProjectId(items[0].id);
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  const authenticate = (event: FormEvent) => {
    event.preventDefault();
    if (!cloud || connectBusy) return;
    setConnectBusy(true);
    setConnectError(null);
    void (async () => {
      try {
        const connection = await connectOpenStack({
          cloud_id: Number(cloudId),
          method,
          ...(method === "token"
            ? { token: secret }
            : {
                ...(useUserId ? { user_id: username } : { username }),
                password: secret,
                domain,
                domain_is_id: domainIsId,
              }),
        });
        setShowConnectDialog(false);
        setSecret("");
        await load();
        try {
          await selectConnection(connection);
        } catch (failure) {
          setError(errorText(failure));
        }
      } catch (failure) {
        setConnectError(errorText(failure));
      } finally {
        setSecret("");
        setConnectBusy(false);
      }
    })();
  };

  const open = (workspace: "browser" | "manager") =>
    void run(async () => {
      if (!selected) return;
      const ctx = await activateOpenStackContext(
        selected.id,
        projectId,
        Number(endpointId),
        key || undefined,
      );
      notifyExecutionContextsRefresh();
      navigate(`/${workspace}?ctx=${encodeURIComponent(ctx)}`);
    });

  const disconnect = (connection: OpenStackConnection, forget = false) =>
    void run(async () => {
      await disconnectOpenStack(connection.id, forget);
      if (selected?.id === connection.id) {
        setSelected(null);
        setProjects([]);
        setProjectId("");
      }
      notifyExecutionContextsRefresh();
      await load();
      setPendingForget(null);
    });

  const columns: DataTableColumn<OpenStackConnection>[] = [
    {
      id: "cloud",
      label: text("cloud"),
      primary: true,
      render: (row) => row.cloud_name,
    },
    {
      id: "identity",
      label: text("identity"),
      render: (row) => <span title={row.keystone_user_id}>{row.display_name}</span>,
    },
    {
      id: "status",
      label: text("connected"),
      render: (row) => (row.connected ? text("connected") : text("disconnected")),
    },
    {
      id: "actions",
      label: "",
      mobileRole: "actions",
      render: (row) => (
        <ListActions>
          <ListActionButton
            disabled={busy || connectBusy}
            onClick={() => {
              if (row.connected) void run(() => selectConnection(row));
              else openConnectDialog(row);
            }}
          >
            {row.connected ? text("choose") : text("reconnect")}
          </ListActionButton>
          {row.connected ? (
            <ListActionButton disabled={busy || connectBusy} onClick={() => disconnect(row)}>
              {text("disconnect")}
            </ListActionButton>
          ) : null}
          <ListActionButton
            disabled={busy || connectBusy}
            onClick={() => setPendingForget(row)}
          >
            {text("forget")}
          </ListActionButton>
        </ListActions>
      ),
    },
  ];

  return (
    <section className="settings-compact space-y-4" aria-label={text("title")}>
      {error && connections.length > 0 ? (
        <UiInlineMessage tone="error">{error}</UiInlineMessage>
      ) : null}
      {!loading && !clouds.length ? (
        <UiInlineMessage tone="info">{text("noClouds")}</UiInlineMessage>
      ) : null}

      <ListPageSection
        variant="section"
        title={text("connections")}
        description={text("intro")}
        countLabel={`${connections.length} ${text(
          connections.length === 1 ? "connectionSingular" : "connectionPlural",
        )}`}
        actions={
          <ListActionButton onClick={() => void load()} loading={loading}>
            {text("refresh")}
          </ListActionButton>
        }
        headingActions={
          <ListActionButton
            variant="primary"
            disabled={loading || !clouds.length}
            onClick={() => openConnectDialog()}
          >
            {text("connectCloud")}
          </ListActionButton>
        }
      >
        <DataTableShell
          rows={connections}
          columns={columns}
          rowKey={(row) => row.id}
          responsiveCards
          status={tableStatus}
          loadingMessage={text("loading")}
          errorMessage={error ?? text("error")}
          emptyMessage={text("noConnections")}
        />
      </ListPageSection>

      <p className="settings-description">{text("sessionHelp")}</p>

      {selected ? (
        <SettingsSection
          presentation="compact"
          title={text("projectAccess")}
          description={`${selected.cloud_name} · ${selected.display_name}`}
        >
          <div className="settings-stack">
            {!busy && !projects.length ? <p className="settings-body">{text("noProjects")}</p> : null}
            <div className="settings-fields sm:grid-cols-2">
              <SettingsSelect
                label={text("project")}
                disabled={busy}
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
              >
                <option value="">{text("choose")}</option>
                {projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.id})
                  </option>
                ))}
              </SettingsSelect>
              <SettingsSelect
                label={text("endpoint")}
                disabled={busy}
                value={endpointId}
                onChange={(event) => setEndpointId(event.target.value)}
              >
                <option value="">{text("choose")}</option>
                {selectedCloud?.endpoints.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.region ? ` (${item.region})` : ""}
                  </option>
                ))}
              </SettingsSelect>
              {keys.length > 1 ? (
                <SettingsSelect
                  label={text("key")}
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                  disabled={busy}
                >
                  <option value="">{text("choose")}</option>
                  {keys.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </SettingsSelect>
              ) : null}
            </div>
            {keysLoading ? <p role="status" className="settings-description">{text("loading")}</p> : null}
            {projectId && !keysLoading && !keys.length && !error ? (
              <UiInlineMessage tone="warning">{text("noKeys")}</UiInlineMessage>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {runtimeSurfaces.browser &&
              generalSettings.browser_enabled &&
              generalSettings.browser_root_enabled ? (
                <ProfileButton
                  disabled={busy || keysLoading || !projectId || !endpointId || !key}
                  onClick={() => open("browser")}
                >
                  {text("browser")}
                </ProfileButton>
              ) : null}
              {runtimeSurfaces.manager && generalSettings.manager_enabled ? (
                <ProfileButton
                  disabled={busy || keysLoading || !projectId || !endpointId || !key}
                  onClick={() => open("manager")}
                >
                  {text("manager")}
                </ProfileButton>
              ) : null}
              <ProfileButton
                variant="secondary"
                disabled={busy}
                onClick={() => void run(() => selectConnection(selected))}
              >
                {text("refresh")}
              </ProfileButton>
            </div>
          </div>
        </SettingsSection>
      ) : null}

      {showConnectDialog ? (
        <ProfileDialog
          title={text("connectTitle")}
          onClose={closeConnectDialog}
          closeDisabled={connectBusy}
          closeOnBackdropClick={!connectBusy}
          closeOnEscape={!connectBusy}
          initialFocusRef={cloudSelectRef}
          maxWidthClass="max-w-xl"
        >
          <form
            aria-label={text("connectTitle")}
            className="settings-form settings-stack"
            onSubmit={authenticate}
          >
            <p className="settings-description">{text("sessionHelp")}</p>
            {connectError ? <UiInlineMessage tone="error">{connectError}</UiInlineMessage> : null}
            <fieldset disabled={connectBusy} className="settings-fields">
              <div className="settings-fields sm:grid-cols-2">
                <SettingsSelect
                  ref={cloudSelectRef}
                  label={text("cloud")}
                  required
                  value={cloudId}
                  onChange={(event) => chooseCloud(event.target.value)}
                >
                  <option value="">{text("choose")}</option>
                  {clouds.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </SettingsSelect>
                {cloud ? (
                  <SettingsSelect
                    label={text("method")}
                    value={method}
                    onChange={(event) => {
                      setMethod(event.target.value as "password" | "token");
                      setSecret("");
                      setConnectError(null);
                    }}
                  >
                    {cloud.allow_password ? <option value="password">{text("password")}</option> : null}
                    {cloud.allow_token ? <option value="token">{text("token")}</option> : null}
                  </SettingsSelect>
                ) : null}
                {cloud && method === "password" ? (
                  <>
                    <SettingsInput
                      label={text("username")}
                      autoComplete="username"
                      required
                      value={username}
                      onChange={(event) => {
                        setUsername(event.target.value);
                        setConnectError(null);
                      }}
                    />
                    <UiCheckboxField
                      className="settings-choice settings-description"
                      checked={useUserId}
                      onChange={(event) => setUseUserId(event.target.checked)}
                    >
                      {text("userId")}
                    </UiCheckboxField>
                    {!useUserId ? (
                      <>
                        <SettingsInput
                          label={text("domain")}
                          required
                          value={domain}
                          onChange={(event) => {
                            setDomain(event.target.value);
                            setConnectError(null);
                          }}
                        />
                        <UiCheckboxField
                          className="settings-choice settings-description"
                          checked={domainIsId}
                          onChange={(event) => setDomainIsId(event.target.checked)}
                        >
                          {text("domainId")}
                        </UiCheckboxField>
                      </>
                    ) : null}
                  </>
                ) : null}
                {cloud ? (
                  <SettingsInput
                    fieldClassName="sm:col-span-2"
                    label={text(method)}
                    type="password"
                    autoComplete={method === "password" ? "current-password" : "off"}
                    required
                    value={secret}
                    onChange={(event) => {
                      setSecret(event.target.value);
                      setConnectError(null);
                    }}
                  />
                ) : null}
              </div>
            </fieldset>
            <ModalActions>
              <ProfileButton
                type="button"
                variant="secondary"
                disabled={connectBusy}
                onClick={closeConnectDialog}
              >
                {text("cancel")}
              </ProfileButton>
              <ProfileButton type="submit" disabled={connectBusy || !cloud}>
                {text(connectBusy ? "connecting" : "connect")}
              </ProfileButton>
            </ModalActions>
          </form>
        </ProfileDialog>
      ) : null}

      {pendingForget ? (
        <ConfirmActionDialog
          loading={busy}
          error={error}
          title={text("forget")}
          description={text("deleteHelp")}
          confirmLabel={text("confirm")}
          cancelLabel={text("cancel")}
          onCancel={() => setPendingForget(null)}
          onConfirm={() => disconnect(pendingForget, true)}
        />
      ) : null}
    </section>
  );
}
