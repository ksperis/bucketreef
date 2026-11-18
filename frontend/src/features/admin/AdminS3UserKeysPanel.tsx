/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";

import {
  type CreatedS3UserAccessKey,
  type S3User,
  type S3UserAccessKey,
  createS3UserKey,
  deleteS3UserKey,
  listS3UserKeys,
  rotateS3UserKeys,
  updateS3UserKeyStatus,
} from "../../api/s3Users";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { ListActionButton, ListActions, ListBadge } from "../../components/list/ListControls";
import ListPageSection from "../../components/list/ListPageSection";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import OneTimeSecretPanel from "../../components/OneTimeSecretPanel";
import PageBanner from "../../components/PageBanner";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";
import { cx } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { formatLocalDateTime } from "../../utils/dateTime";
import { useAdminI18n } from "./adminI18n";
import useAdminResourceController from "./useAdminResourceController";

type AdminS3UserKeysPanelProps = {
  user: S3User;
};

export default function AdminS3UserKeysPanel({ user }: AdminS3UserKeysPanelProps) {
  const { intlLocale, text: adminText } = useAdminI18n();
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<CreatedS3UserAccessKey | null>(null);
  const keyConfirmation = useConfirmActionDialog();

  const formatLoadError = useCallback(
    (error: unknown) => extractApiError(error, adminText("Unexpected error")),
    [adminText],
  );
  const loadKeysResource = useCallback(() => listS3UserKeys(user.id), [user.id]);
  const {
    resource: keys,
    loading,
    error: keysLoadError,
    setError: setKeysLoadError,
    refresh: loadKeys,
  } = useAdminResourceController<S3UserAccessKey[]>({
    loadResource: loadKeysResource,
    initialResource: [],
    formatError: formatLoadError,
  });
  const error = actionError ?? keysLoadError;

  const clearErrors = () => {
    setActionError(null);
    setKeysLoadError(null);
  };

  const handleCreateKey = async () => {
    setBusy("create");
    clearErrors();
    setActionMessage(null);
    try {
      const key = await createS3UserKey(user.id);
      setCreatedKey(key);
      await loadKeys();
      setActionMessage(adminText("Access key created."));
    } catch (err) {
      setActionError(extractApiError(err, adminText("Unexpected error")));
    } finally {
      setBusy(null);
    }
  };

  const deleteKey = async (accessKeyId: string) => {
    setBusy(`delete:${accessKeyId}`);
    clearErrors();
    setActionMessage(null);
    try {
      await deleteS3UserKey(user.id, accessKeyId);
      await loadKeys();
      setActionMessage(adminText("Access key deleted."));
    } catch (err) {
      setActionError(extractApiError(err, adminText("Unexpected error")));
    } finally {
      setBusy(null);
    }
  };

  const toggleKey = async (accessKeyId: string, nextActive: boolean) => {
    setBusy(`toggle:${accessKeyId}`);
    clearErrors();
    setActionMessage(null);
    try {
      await updateS3UserKeyStatus(user.id, accessKeyId, nextActive);
      await loadKeys();
      setActionMessage(adminText(nextActive ? "Access key enabled." : "Access key disabled."));
    } catch (err) {
      setActionError(extractApiError(err, adminText("Unexpected error")));
    } finally {
      setBusy(null);
    }
  };

  const handleDeleteKey = (accessKeyId: string) => {
    keyConfirmation.requestConfirmation({
      title: adminText("Delete access key?"),
      description: adminText("Permanently remove this RGW access key from the selected user."),
      confirmLabel: adminText("Delete key"),
      details: [
        { label: adminText("User"), value: user.name },
        { label: adminText("Access key"), value: accessKeyId, mono: true },
      ],
      impacts: [adminText("Applications using this key will immediately lose access.")],
      onConfirm: () => deleteKey(accessKeyId),
    });
  };

  const handleToggleKey = (accessKeyId: string, nextActive: boolean) => {
    if (nextActive) {
      void toggleKey(accessKeyId, true);
      return;
    }
    keyConfirmation.requestConfirmation({
      title: adminText("Disable access key?"),
      description: adminText("Temporarily prevent this RGW access key from authenticating."),
      confirmLabel: adminText("Disable key"),
      details: [
        { label: adminText("User"), value: user.name },
        { label: adminText("Access key"), value: accessKeyId, mono: true },
      ],
      impacts: [adminText("Applications using this key will lose access until the key is enabled again.")],
      onConfirm: () => toggleKey(accessKeyId, false),
    });
  };

  const handleRotateUiKey = async () => {
    setBusy("rotate");
    clearErrors();
    setActionMessage(null);
    try {
      await rotateS3UserKeys(user.id);
      await loadKeys();
      setActionMessage(adminText("Interface key rotated."));
    } catch (err) {
      setActionError(extractApiError(err, adminText("Unexpected error")));
    } finally {
      setBusy(null);
    }
  };

  const interfaceKey = keys.find((key) => key.is_ui_managed);
  const tableStatus = resolveListTableStatus({ loading, error, rowCount: keys.length });
  const keyTableColumns: Array<DataTableColumn<S3UserAccessKey>> = [
    {
      id: "access-key",
      label: adminText("Access key"),
      primary: true,
      mobileRole: "primary",
      cellClassName: "font-mono",
      render: (key) => key.access_key_id,
    },
    {
      id: "status",
      label: adminText("Status"),
      cellClassName: "text-slate-700 dark:text-slate-200",
      render: (key) => adminText(key.is_active ? "Active" : "Disabled"),
    },
    { id: "created", label: adminText("Created on"), render: (key) => formatLocalDateTime(key.created_at, intlLocale) },
    {
      id: "usage",
      label: adminText("Usage"),
      render: (key) => key.is_ui_managed ? (
        <ListBadge tone="neutral">{adminText("Interface key")}</ListBadge>
      ) : (
        <span className="ui-caption text-slate-500 dark:text-slate-400">{adminText("Custom")}</span>
      ),
    },
    {
      id: "actions",
      label: adminText("Actions"),
      align: "right",
      mobileRole: "actions",
      render: (key) => key.is_ui_managed ? (
        <ListActionButton type="button" onClick={handleRotateUiKey} disabled={Boolean(busy)}>
          {adminText(busy === "rotate" ? "Rotating..." : "Rotate")}
        </ListActionButton>
      ) : (
        <ListActions>
          <ListActionButton
            type="button"
            onClick={() => handleToggleKey(key.access_key_id, !key.is_active)}
            disabled={Boolean(busy)}
          >
            {adminText(busy === `toggle:${key.access_key_id}` ? "Saving..." : key.is_active ? "Disable" : "Enable")}
          </ListActionButton>
          <ListActionButton
            type="button"
            onClick={() => handleDeleteKey(key.access_key_id)}
            variant="danger"
            disabled={Boolean(busy)}
          >
            {adminText(busy === `delete:${key.access_key_id}` ? "Deleting..." : "Delete")}
          </ListActionButton>
        </ListActions>
      ),
    },
  ];

  return (
    <div className="settings-stack">
      {interfaceKey && (
        <PageBanner tone="info">
          {adminText("The interface key is reserved for the console. Delete other keys as needed, and rotate the interface key instead of deleting it.")}
        </PageBanner>
      )}
      {error && tableStatus !== "error" && <PageBanner tone="error">{error}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {createdKey?.secret_access_key && (
        <OneTimeSecretPanel
          title={adminText("Key created for {name}", { name: user.name })}
          description={adminText("The secret is shown only once.")}
          badge={adminText("Copy these values now")}
          values={[
            { label: adminText("Access key"), value: createdKey.access_key_id, copyLabel: adminText("Copy") },
            { label: adminText("Secret key"), value: createdKey.secret_access_key, copyLabel: adminText("Copy") },
          ]}
        />
      )}
      <ListPageSection
        variant="page"
        title={adminText("Keys")}
        actions={(
          <ListActionButton type="button" variant="primary" onClick={handleCreateKey} disabled={Boolean(busy)}>
            {adminText(busy === "create" ? "Creating..." : "New key")}
          </ListActionButton>
        )}
        countLabel={adminText(keys.length === 1 ? "{count} key" : "{count} keys", { count: keys.length })}
      >
        <DataTableShell
          responsiveCards
          columns={keyTableColumns}
          rows={keys}
          rowKey={(key) => key.access_key_id}
          rowClassName={(key) => cx(
            "hover:bg-slate-50 dark:hover:bg-slate-800/50",
            !key.is_active && "bg-slate-50/70 dark:bg-slate-900/40",
          )}
          status={tableStatus}
          loadingMessage={adminText("Loading keys...")}
          errorMessage={error ?? adminText("Unable to load keys.")}
          emptyMessage={adminText("No keys for this user.")}
          tableLayout="fixed"
        />
      </ListPageSection>
      {keyConfirmation.confirmationDialog}
    </div>
  );
}
