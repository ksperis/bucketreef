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
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import PageBanner from "../../components/PageBanner";
import ListPageSection from "../../components/list/ListPageSection";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";

import { cx } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";

export default function S3UserKeysPage() {
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

  const extractError = (err: unknown): string => extractApiError(err, "Unexpected error");

  const formatDate = (value?: string | null) => {
    if (!value) return "-";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
  };

  const loadUser = useCallback(async () => {
    if (!Number.isFinite(numericUserId)) return;
    try {
      const data = await getS3User(numericUserId);
      setUser(data);
    } catch (err) {
      setError(extractError(err));
    }
  }, [numericUserId]);

  const loadKeys = useCallback(async () => {
    if (!Number.isFinite(numericUserId)) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listS3UserKeys(numericUserId);
      setKeys(data);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  }, [numericUserId]);

  useEffect(() => {
    if (!Number.isFinite(numericUserId)) {
      setError("Invalid user id.");
      return;
    }
    loadUser();
    loadKeys();
  }, [loadKeys, loadUser, numericUserId]);

  const handleCreateKey = async () => {
    if (!Number.isFinite(numericUserId)) return;
    setBusy("create");
    setError(null);
    setActionMessage(null);
    try {
      const key = await createS3UserKey(numericUserId);
      setCreatedKey(key);
      await loadKeys();
      setActionMessage("Access key created.");
    } catch (err) {
      setError(extractError(err));
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
      setActionMessage("Access key deleted.");
    } catch (err) {
      setError(extractError(err));
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
      setActionMessage(nextActive ? "Access key enabled." : "Access key disabled.");
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  };

  const handleDeleteKey = (accessKeyId: string) => {
    keyConfirmation.requestConfirmation({
      title: "Delete access key?",
      description: "Permanently remove this RGW access key from the selected user.",
      confirmLabel: "Delete key",
      details: [
        { label: "User", value: pageTitle },
        { label: "Access key", value: accessKeyId, mono: true },
      ],
      impacts: ["Applications using this key will immediately lose access."],
      onConfirm: () => deleteKey(accessKeyId),
    });
  };

  const handleToggleKey = (accessKeyId: string, nextActive: boolean) => {
    if (nextActive) {
      void toggleKey(accessKeyId, true);
      return;
    }
    keyConfirmation.requestConfirmation({
      title: "Disable access key?",
      description: "Temporarily prevent this RGW access key from authenticating.",
      confirmLabel: "Disable key",
      details: [
        { label: "User", value: pageTitle },
        { label: "Access key", value: accessKeyId, mono: true },
      ],
      impacts: ["Applications using this key will lose access until the key is enabled again."],
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
      setActionMessage("Interface key rotated.");
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  };

  const pageTitle = useMemo(() => {
    if (user?.name) return user.name;
    if (userId) return `User #${userId}`;
    return "User";
  }, [user?.name, userId]);

  const interfaceKey = keys.find((k) => k.is_ui_managed);
  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: keys.length,
  });
  const keyTableColumns: Array<DataTableColumn<S3UserAccessKey>> = [
    {
      id: "access-key",
      label: "Access key",
      primary: true,
      mobileRole: "primary",
      cellClassName: "font-mono",
      render: (key) => key.access_key_id,
    },
    {
      id: "status",
      label: "Status",
      cellClassName: "text-slate-700 dark:text-slate-200",
      render: (key) => (key.is_active ? "Active" : "Disabled"),
    },
    { id: "created", label: "Created on", render: (key) => formatDate(key.created_at) },
    {
      id: "usage",
      label: "Usage",
      render: (key) =>
        key.is_ui_managed ? (
          <ListBadge tone="neutral">
            Interface key
          </ListBadge>
        ) : (
          <span className="ui-caption text-slate-500 dark:text-slate-400">Custom</span>
        ),
    },
    {
      id: "actions",
      label: "Actions",
      align: "right",
      mobileRole: "actions",
      render: (key) =>
        key.is_ui_managed ? (
          <ListActionButton
            type="button"
            onClick={handleRotateUiKey}
            disabled={busy === "rotate"}
          >
            {busy === "rotate" ? "Rotating..." : "Rotate"}
          </ListActionButton>
        ) : (
          <ListActions>
            <ListActionButton
              type="button"
              onClick={() => handleToggleKey(key.access_key_id, !key.is_active)}
              disabled={Boolean(busy)}
            >
              {busy === `toggle:${key.access_key_id}` ? "Saving..." : key.is_active ? "Disable" : "Enable"}
            </ListActionButton>
            <ListActionButton
              type="button"
              onClick={() => handleDeleteKey(key.access_key_id)}
               variant="danger"
              disabled={Boolean(busy)}
            >
              {busy === `delete:${key.access_key_id}` ? "Deleting..." : "Delete"}
            </ListActionButton>
          </ListActions>
        ),
    },
  ];

  if (!userId || Number.isNaN(numericUserId)) {
    return (
      <PageShell actionPresentation="listing"
        title="User access keys"
        description="Manage RGW keys for the selected user."
        breadcrumbs={adminPageBreadcrumbs("rgw-users", { label: "Access keys" })}
      >
        <PageBanner tone="error">Invalid user id provided.</PageBanner>
      </PageShell>
    );
  }

  return (
    <PageShell actionPresentation="listing"
      title="User access keys"
      description={
        <>
          Manage keys for <span className="font-semibold text-slate-700 dark:text-slate-100">{pageTitle}</span>.
        </>
      }
      breadcrumbs={adminPageBreadcrumbs("rgw-users", { label: pageTitle }, { label: "Access keys" })}
      actions={[
        { label: "← Back to users", to: "/admin/s3-users", variant: "ghost" },
        {
          label: busy === "create" ? "Creating..." : "New key",
          onClick: handleCreateKey,
          variant: "primary",
        },
      ]}
    >

      {interfaceKey && (
        <PageBanner tone="info">
          The interface key is reserved for the console. Delete other keys as needed, and rotate the interface key instead of deleting it.
        </PageBanner>
      )}

      {error && <PageBanner tone="error">{error}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}

      {createdKey && createdKey.secret_access_key && (
        <OneTimeSecretPanel
          title={`Key created for ${pageTitle}`}
          description="The secret is shown only once."
          badge="Copy these values now"
          values={[
            { label: "Access key", value: createdKey.access_key_id, copyLabel: "Copy" },
            { label: "Secret key", value: createdKey.secret_access_key, copyLabel: "Copy" },
          ]}
        />
      )}

      <ListPageSection variant="page"
        title="Keys"
        countLabel={`${keys.length} key${keys.length === 1 ? "" : "s"}`}
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
          loadingMessage="Loading keys..."
          errorMessage="Unable to load keys."
          emptyMessage="No keys for this user."
          tableLayout="fixed"
        />
      </ListPageSection>
      {keyConfirmation.confirmationDialog}
    </PageShell>
  );
}
