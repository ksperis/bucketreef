/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ListActions, ListBadge, ListActionButton } from "../../components/list/ListControls";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  CreatedS3UserAccessKey,
  S3User,
  S3UserAccessKey,
  createS3UserKey,
  deleteS3UserKey,
  getS3User,
  listS3UserKeys,
  rotateS3UserKeys,
  updateS3UserKeyStatus,
} from "../../api/s3Users";
import OneTimeSecretPanel from "../../components/OneTimeSecretPanel";
import PageShell from "../../components/PageShell";
import { useAdminPageBreadcrumbs } from "./adminBreadcrumbs";
import PageBanner from "../../components/PageBanner";
import ListPageSection from "../../components/list/ListPageSection";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";

import { cx } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";
import { useAdminI18n } from "./adminI18n";

export default function S3UserKeysPage() {
  const { intlLocale, text: adminText } = useAdminI18n();
  const adminBreadcrumbs = useAdminPageBreadcrumbs();
  const { userId } = useParams<{ userId: string }>();
  const numericUserId = userId ? Number(userId) : NaN;
  const [user, setUser] = useState<S3User | null>(null);
  const [keys, setKeys] = useState<S3UserAccessKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<CreatedS3UserAccessKey | null>(null);
  const keyConfirmation = useConfirmActionDialog();

  const formatDate = (value?: string | null) => {
    if (!value) return "-";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString(intlLocale);
  };

  const loadUser = useCallback(async () => {
    if (!Number.isFinite(numericUserId)) return;
    try {
      const data = await getS3User(numericUserId);
      setUser(data);
    } catch (err) {
      setError(extractApiError(err, adminText("Unexpected error")));
    }
  }, [adminText, numericUserId]);

  const loadKeys = useCallback(async () => {
    if (!Number.isFinite(numericUserId)) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listS3UserKeys(numericUserId);
      setKeys(data);
    } catch (err) {
      setError(extractApiError(err, adminText("Unexpected error")));
    } finally {
      setLoading(false);
    }
  }, [adminText, numericUserId]);

  useEffect(() => {
    if (!Number.isFinite(numericUserId)) {
      setError(adminText("Invalid user id."));
      return;
    }
    loadUser();
    loadKeys();
  }, [adminText, loadKeys, loadUser, numericUserId]);

  const handleCreateKey = async () => {
    if (!Number.isFinite(numericUserId)) return;
    setBusy("create");
    setError(null);
    setActionMessage(null);
    try {
      const key = await createS3UserKey(numericUserId);
      setCreatedKey(key);
      await loadKeys();
      setActionMessage(adminText("Access key created."));
    } catch (err) {
      setError(extractApiError(err, adminText("Unexpected error")));
    } finally {
      setBusy(null);
    }
  };

  const deleteKey = async (accessKeyId: string) => {
    if (!Number.isFinite(numericUserId)) return;
    setBusy(`delete:${accessKeyId}`);
    setError(null);
    setActionMessage(null);
    try {
      await deleteS3UserKey(numericUserId, accessKeyId);
      await loadKeys();
      setActionMessage(adminText("Access key deleted."));
    } catch (err) {
      setError(extractApiError(err, adminText("Unexpected error")));
    } finally {
      setBusy(null);
    }
  };

  const toggleKey = async (accessKeyId: string, nextActive: boolean) => {
    if (!Number.isFinite(numericUserId)) return;
    setBusy(`toggle:${accessKeyId}`);
    setError(null);
    setActionMessage(null);
    try {
      await updateS3UserKeyStatus(numericUserId, accessKeyId, nextActive);
      await loadKeys();
      setActionMessage(adminText(nextActive ? "Access key enabled." : "Access key disabled."));
    } catch (err) {
      setError(extractApiError(err, adminText("Unexpected error")));
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
        { label: adminText("User"), value: pageTitle },
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
        { label: adminText("User"), value: pageTitle },
        { label: adminText("Access key"), value: accessKeyId, mono: true },
      ],
      impacts: [adminText("Applications using this key will lose access until the key is enabled again.")],
      onConfirm: () => toggleKey(accessKeyId, false),
    });
  };

  const handleRotateUiKey = async () => {
    if (!Number.isFinite(numericUserId)) return;
    setBusy("rotate");
    setError(null);
    setActionMessage(null);
    try {
      await rotateS3UserKeys(numericUserId);
      await Promise.all([loadUser(), loadKeys()]);
      setActionMessage(adminText("Interface key rotated."));
    } catch (err) {
      setError(extractApiError(err, adminText("Unexpected error")));
    } finally {
      setBusy(null);
    }
  };

  const pageTitle = useMemo(() => {
    if (user?.name) return user.name;
    if (userId) return adminText("User #{id}", { id: userId });
    return adminText("User");
  }, [adminText, user?.name, userId]);

  const interfaceKey = keys.find((k) => k.is_ui_managed);
  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: keys.length,
  });
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
    { id: "created", label: adminText("Created on"), render: (key) => formatDate(key.created_at) },
    {
      id: "usage",
      label: adminText("Usage"),
      render: (key) =>
        key.is_ui_managed ? (
          <ListBadge tone="neutral">
            {adminText("Interface key")}</ListBadge>
        ) : (
          <span className="ui-caption text-slate-500 dark:text-slate-400">{adminText("Custom")}</span>
        ),
    },
    {
      id: "actions",
      label: adminText("Actions"),
      align: "right",
      mobileRole: "actions",
      render: (key) =>
        key.is_ui_managed ? (
          <ListActionButton
            type="button"
            onClick={handleRotateUiKey}
            disabled={busy === "rotate"}
          >
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

  if (!userId || Number.isNaN(numericUserId)) {
    return (
      <PageShell actionPresentation="listing"
        title={adminText("User access keys")}
        description={adminText("Manage RGW keys for the selected user.")}
        breadcrumbs={adminBreadcrumbs("rgw-users", { label: adminText("Access keys") })}
      >
        <PageBanner tone="error">{adminText("Invalid user id provided.")}</PageBanner>
      </PageShell>
    );
  }

  return (
    <PageShell actionPresentation="listing"
      title={adminText("User access keys")}
      description={
        <>
          {adminText("Manage keys for")}<span className="font-semibold text-slate-700 dark:text-slate-100">{pageTitle}</span>.
        </>
      }
      breadcrumbs={adminBreadcrumbs("rgw-users", { label: pageTitle }, { label: adminText("Access keys") })}
      actions={[
        { label: adminText("← Back to users"), to: "/admin/s3-users", variant: "ghost" },
        {
          label: adminText(busy === "create" ? "Creating..." : "New key"),
          onClick: handleCreateKey,
          variant: "primary",
        },
      ]}
    >

      {interfaceKey && (
        <PageBanner tone="info">
          {adminText("The interface key is reserved for the console. Delete other keys as needed, and rotate the interface key instead of deleting it.")}</PageBanner>
      )}

      {error && <PageBanner tone="error">{error}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}

      {createdKey && createdKey.secret_access_key && (
        <OneTimeSecretPanel
          title={adminText("Key created for {name}", { name: pageTitle })}
          description={adminText("The secret is shown only once.")}
          badge={adminText("Copy these values now")}
          values={[
            { label: adminText("Access key"), value: createdKey.access_key_id, copyLabel: adminText("Copy") },
            { label: adminText("Secret key"), value: createdKey.secret_access_key, copyLabel: adminText("Copy") },
          ]}
        />
      )}

      <ListPageSection variant="page"
        title={adminText("Keys")}
        countLabel={adminText(keys.length === 1 ? "{count} key" : "{count} keys", { count: keys.length })}
      >
        <DataTableShell
          responsiveCards
          columns={keyTableColumns}
          rows={keys}
          rowKey={(key) => key.access_key_id}
          rowClassName={(key) =>
            cx("hover:bg-slate-50 dark:hover:bg-slate-800/50", !key.is_active && "bg-slate-50/70 dark:bg-slate-900/40")
          }
          status={tableStatus}
          loadingMessage={adminText("Loading keys...")}
          errorMessage={adminText("Unable to load keys.")}
          emptyMessage={adminText("No keys for this user.")}
          tableLayout="fixed"
        />
      </ListPageSection>
      {keyConfirmation.confirmationDialog}
    </PageShell>
  );
}
