/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  connectOpenStack,
  createOpenStackPrivateConnection,
  disconnectOpenStack,
  getOpenStackProjectAccess,
  listOpenStackClouds,
  listOpenStackConnections,
  listOpenStackProjects,
  type OpenStackConnection,
  type OpenStackProject,
  type OpenStackProjectAccess,
  type OpenStackPublicCloud,
} from "../../api/openstack";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import ModalActions from "../../components/ModalActions";
import DataTableShell, {
  dataTableDefaultActionProps,
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import { ListActions, ListActionButton } from "../../components/list/ListControls";
import ListPageSection from "../../components/list/ListPageSection";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import {
  SettingsInput,
  SettingsSelect,
} from "../../components/settings/SettingsControls";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { notifyExecutionContextsRefresh } from "../../utils/executionContextRefresh";
import { canCreateManualPrivateConnections, readStoredUser } from "../../utils/workspaces";
import { ProfileButton, ProfileDialog } from "./ProfileControls";
import S3ConnectionAccessFields from "./S3ConnectionAccessFields";
import { useOpenStackI18n } from "./openstackMessages";

export default function OpenStackConnectionsPage() {
  const { text, errorText } = useOpenStackI18n();
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
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingForget, setPendingForget] = useState<OpenStackConnection | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [projects, setProjects] = useState<OpenStackProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [importProject, setImportProject] = useState<OpenStackProject | null>(null);
  const [projectAccess, setProjectAccess] = useState<OpenStackProjectAccess | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [connectionName, setConnectionName] = useState("");
  const [targetId, setTargetId] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [accessManager, setAccessManager] = useState(false);
  const [accessBrowser, setAccessBrowser] = useState(true);
  const cloud = clouds.find((item) => item.id === Number(cloudId));
  const selectedConnection = connections.find((item) => item.id === selectedConnectionId) ?? null;
  const canCreatePrivateConnection = canCreateManualPrivateConnections(readStoredUser());
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
        await connectOpenStack({
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
        notifyExecutionContextsRefresh();
      } catch (failure) {
        setConnectError(errorText(failure));
      } finally {
        setSecret("");
        setConnectBusy(false);
      }
    })();
  };

  const disconnect = (connection: OpenStackConnection, forget = false) =>
    void run(async () => {
      await disconnectOpenStack(connection.id, forget);
      if (selectedConnectionId === connection.id) {
        setSelectedConnectionId(null);
        setProjects([]);
        setProjectsError(null);
      }
      notifyExecutionContextsRefresh();
      await load();
      setPendingForget(null);
    });

  const selectConnection = (connection: OpenStackConnection) => {
    if (!connection.connected || projectsLoading) return;
    setSelectedConnectionId(connection.id);
    setProjects([]);
    setProjectsError(null);
    setImportSuccess(null);
    setProjectsLoading(true);
    void listOpenStackProjects(connection.id)
      .then(setProjects)
      .catch((failure) => setProjectsError(errorText(failure)))
      .finally(() => setProjectsLoading(false));
  };

  const closeImportDialog = () => {
    if (importBusy) return;
    setImportProject(null);
    setProjectAccess(null);
    setImportError(null);
  };

  const openImportDialog = (project: OpenStackProject) => {
    if (!selectedConnection || !canCreatePrivateConnection || importLoading) return;
    setImportProject(project);
    setProjectAccess(null);
    setImportError(null);
    setConnectionName(project.project_name);
    setTargetId("");
    setAccessKey("");
    setAccessManager(false);
    setAccessBrowser(true);
    setImportLoading(true);
    void getOpenStackProjectAccess(selectedConnection.id, project.project_id)
      .then((access) => {
        setProjectAccess(access);
        const allowedTargets = access.targets.filter((target) => target.allowed);
        setTargetId(allowedTargets.length === 1 ? allowedTargets[0].target_id : "");
        setAccessKey(access.access_keys.length === 1 ? access.access_keys[0] : "");
      })
      .catch((failure) => setImportError(errorText(failure)))
      .finally(() => setImportLoading(false));
  };

  const createPrivateConnection = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedConnection || !importProject || importBusy || !targetId || !connectionName.trim()) return;
    if (!accessManager && !accessBrowser) {
      setImportError(text("workspaceAccessRequired"));
      return;
    }
    setImportBusy(true);
    setImportError(null);
    void createOpenStackPrivateConnection(selectedConnection.id, importProject.project_id, {
      connection_name: connectionName.trim(),
      target_id: targetId,
      ...(accessKey ? { access_key: accessKey } : {}),
      access_manager: accessManager,
      access_browser: accessBrowser,
    })
      .then(() => {
        setImportProject(null);
        setProjectAccess(null);
        setImportSuccess(text("privateConnectionCreated"));
        notifyExecutionContextsRefresh();
      })
      .catch((failure) => setImportError(errorText(failure)))
      .finally(() => setImportBusy(false));
  };

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
      label: text("actions"),
      align: "right",
      mobileRole: "actions",
      render: (row) => (
        <ListActions>
          {!row.connected ? (
            <ListActionButton
              disabled={busy || connectBusy}
              onClick={() => openConnectDialog(row)}
            >
              {text("reconnect")}
            </ListActionButton>
          ) : null}
          {row.connected ? (
            <>
              <ListActionButton
                {...dataTableDefaultActionProps}
                disabled={busy || connectBusy || projectsLoading}
                onClick={() => selectConnection(row)}
              >
                {text("viewProjects")}
              </ListActionButton>
              <ListActionButton disabled={busy || connectBusy} onClick={() => disconnect(row)}>
                {text("disconnect")}
              </ListActionButton>
            </>
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

  const projectColumns: DataTableColumn<OpenStackProject>[] = [
    {
      id: "project",
      label: text("project"),
      primary: true,
      render: (row) => row.project_name,
    },
    {
      id: "domain",
      label: text("domainLabel"),
      render: (row) => row.project_domain_id || "—",
    },
    {
      id: "actions",
      label: text("actions"),
      align: "right",
      mobileRole: "actions",
      render: (row) => (
        <ListActions>
          <ListActionButton
            disabled={!canCreatePrivateConnection || importLoading || importBusy}
            title={!canCreatePrivateConnection ? text("privateConnectionPermission") : undefined}
            onClick={() => openImportDialog(row)}
          >
            {text("addPrivateConnection")}
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
          rowClassName="ui-current-item"
          rowAttributes={(row) => ({
            "data-viewed": selectedConnectionId === row.id || undefined,
          })}
          responsiveCards
          status={tableStatus}
          loadingMessage={text("loading")}
          errorMessage={error ?? text("error")}
          emptyMessage={text("noConnections")}
        />
      </ListPageSection>

      {selectedConnection ? (
        <ListPageSection
          variant="section"
          title={`${text("projects")} — ${selectedConnection.cloud_name} / ${selectedConnection.display_name}`}
          description={text("projectListHelp")}
          actions={
            <ListActionButton
              onClick={() => selectConnection(selectedConnection)}
              loading={projectsLoading}
            >
              {text("refresh")}
            </ListActionButton>
          }
        >
          {importSuccess ? <UiInlineMessage tone="success">{importSuccess}</UiInlineMessage> : null}
          {!canCreatePrivateConnection ? (
            <UiInlineMessage tone="info">{text("privateConnectionPermission")}</UiInlineMessage>
          ) : null}
          <DataTableShell
            rows={projects}
            columns={projectColumns}
            rowKey={(row) => row.project_id}
            responsiveCards
            status={resolveListTableStatus({
              loading: projectsLoading,
              error: projectsError,
              rowCount: projects.length,
            })}
            loadingMessage={text("loading")}
            errorMessage={projectsError ?? text("error")}
            emptyMessage={text("noProjects")}
          />
        </ListPageSection>
      ) : null}

      <p className="settings-description">{text("sessionHelp")}</p>

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

      {importProject && selectedConnection ? (
        <ProfileDialog
          title={text("privateConnectionTitle")}
          onClose={closeImportDialog}
          closeDisabled={importBusy}
          closeOnBackdropClick={!importBusy}
          closeOnEscape={!importBusy}
          maxWidthClass="max-w-xl"
        >
          <form
            aria-label={text("privateConnectionTitle")}
            className="settings-form settings-stack"
            onSubmit={createPrivateConnection}
          >
            <p className="settings-description">{text("privateConnectionHelp")}</p>
            {importError ? <UiInlineMessage tone="error">{importError}</UiInlineMessage> : null}
            {importLoading ? <UiInlineMessage tone="info">{text("loading")}</UiInlineMessage> : null}
            {!importLoading && projectAccess?.targets.length === 0 ? (
              <UiInlineMessage tone="info">{text("noRegions")}</UiInlineMessage>
            ) : null}
            {!importLoading && projectAccess?.access_keys.length === 0 ? (
              <UiInlineMessage tone="info">{text("noKeys")}</UiInlineMessage>
            ) : null}
            <fieldset disabled={importBusy || importLoading} className="settings-fields">
              <SettingsInput
                label={text("connectionName")}
                required
                value={connectionName}
                onChange={(event) => {
                  setConnectionName(event.target.value);
                  setImportError(null);
                }}
              />
              <SettingsSelect
                label={text("endpoint")}
                required
                value={targetId}
                onChange={(event) => {
                  setTargetId(event.target.value);
                  setImportError(null);
                }}
              >
                <option value="">{text("choose")}</option>
                {projectAccess?.targets.map((target) => (
                  <option key={target.target_id} value={target.target_id} disabled={!target.allowed}>
                    {target.region_id}{target.allowed ? "" : ` — ${text("unmanagedRegion")}`}
                  </option>
                ))}
              </SettingsSelect>
              <SettingsSelect
                label={text("key")}
                required={Boolean(projectAccess && projectAccess.access_keys.length > 1)}
                value={accessKey}
                onChange={(event) => {
                  setAccessKey(event.target.value);
                  setImportError(null);
                }}
              >
                <option value="">{text("choose")}</option>
                {projectAccess?.access_keys.map((key) => (
                  <option key={key} value={key}>{key}</option>
                ))}
              </SettingsSelect>
              <S3ConnectionAccessFields
                accessManager={accessManager}
                accessBrowser={accessBrowser}
                onAccessManagerChange={(checked) => {
                  setAccessManager(checked);
                  setImportError(null);
                }}
                onAccessBrowserChange={(checked) => {
                  setAccessBrowser(checked);
                  setImportError(null);
                }}
                title={text("workspaceAccess")}
                hint={text("workspaceAccessHelp")}
                error={!accessManager && !accessBrowser ? text("workspaceAccessRequired") : undefined}
              />
            </fieldset>
            <ModalActions>
              <ProfileButton
                type="button"
                variant="secondary"
                disabled={importBusy}
                onClick={closeImportDialog}
              >
                {text("cancel")}
              </ProfileButton>
              <ProfileButton
                type="submit"
                disabled={
                  importBusy
                  || importLoading
                  || !connectionName.trim()
                  || !targetId
                  || !projectAccess?.access_keys.length
                  || (!accessKey && projectAccess.access_keys.length > 1)
                  || (!accessManager && !accessBrowser)
                }
              >
                {text(importBusy ? "creatingPrivateConnection" : "addPrivateConnection")}
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
