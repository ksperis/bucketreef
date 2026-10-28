/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  connectOpenStack,
  disconnectOpenStack,
  listOpenStackClouds,
  listOpenStackConnections,
  type OpenStackConnection,
  type OpenStackPublicCloud,
} from "../../api/openstack";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import ModalActions from "../../components/ModalActions";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
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
import { ProfileButton, ProfileDialog } from "./ProfileControls";
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
  const cloud = clouds.find((item) => item.id === Number(cloudId));
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
          {!row.connected ? (
            <ListActionButton
              disabled={busy || connectBusy}
              onClick={() => openConnectDialog(row)}
            >
              {text("reconnect")}
            </ListActionButton>
          ) : null}
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
