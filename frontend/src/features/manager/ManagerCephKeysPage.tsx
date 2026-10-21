/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import UiInput from "../../components/ui/UiInput";
import { ListActions, ListBadge, ListActionButton } from "../../components/list/ListControls";
import { useCallback, useEffect, useState } from "react";
import type { AccessKeyMetadataInput } from "../../api/accessKeyContracts";

import {
  createManagerCephAccessKey,
  deleteManagerCephAccessKey,
  listManagerCephAccessKeys,
  ManagerCephAccessKey,
  ManagerCephGeneratedAccessKey,
  updateManagerCephAccessKeyMetadata,
  updateManagerCephAccessKeyStatus,
} from "../../api/managerCephKeys";
import ListPageSection from "../../components/list/ListPageSection";
import OneTimeSecretPanel from "../../components/OneTimeSecretPanel";
import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import PageShell from "../../components/PageShell";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";

import { cx } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { formatLocalDateTime } from "../../utils/dateTime";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";
import { useExecutionContext } from "./ExecutionContextProvider";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import CreateManagedPrivateAccessModal from "./CreateManagedPrivateAccessModal";
import AccessKeyMetadataDialog from "./AccessKeyMetadataDialog";
import AccessKeyExpirationStatus, { accessKeyExpirationIsPast } from "./AccessKeyExpirationStatus";
import { useManagerI18n } from "./managerI18n";

function parseError(err: unknown): string {
  return extractApiError(err, "Unexpected error");
}

export default function ManagerCephKeysPage() {
  const { text } = useManagerI18n();
  const {
    hasExecutionContext,
    contextIdForApi,
    selectedContextName,
    selectedContextKind,
    managerCephKeysEnabled,
    managerAccessKeyMetadataEnabled,
    managerAccessKeyExpirationEnabled,
    managerPrivateAccessEnabled,
    accessMode,
  } = useExecutionContext();

  const [keys, setKeys] = useState<ManagerCephAccessKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<ManagerCephGeneratedAccessKey | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [keyFilter, setKeyFilter] = useState("");
  const [showPrivateAccessModal, setShowPrivateAccessModal] = useState(false);
  const [metadataDialog, setMetadataDialog] = useState<{ mode: "create" | "edit"; key?: ManagerCephAccessKey } | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const keyConfirmation = useConfirmActionDialog();

  const isS3UserContext = selectedContextKind === "s3_user";
  const canManageCephKeys = Boolean(hasExecutionContext && isS3UserContext && managerCephKeysEnabled);
  const canProvisionManagedPrivateAccess = Boolean(
    hasExecutionContext && isS3UserContext && managerPrivateAccessEnabled
  );

  const loadKeys = useCallback(async () => {
    if (!canManageCephKeys) {
      setKeys([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await listManagerCephAccessKeys(contextIdForApi);
      setKeys(data);
    } catch (err) {
      setError(parseError(err));
      setKeys([]);
    } finally {
      setLoading(false);
    }
  }, [contextIdForApi, canManageCephKeys]);

  useEffect(() => {
    setCreatedKey(null);
    setActionMessage(null);
    void loadKeys();
  }, [accessMode, loadKeys]);

  const createKey = async (metadata?: AccessKeyMetadataInput) => {
    if (!canManageCephKeys) return;
    setBusy("create");
    setError(null);
    setActionMessage(null);
    try {
      const key = metadata
        ? await createManagerCephAccessKey(contextIdForApi, metadata)
        : await createManagerCephAccessKey(contextIdForApi);
      setCreatedKey(key);
      setActionMessage(text("Access key created"));
      await loadKeys();
      setMetadataDialog(null);
      setMetadataError(null);
    } catch (err) {
      const message = parseError(err);
      if (metadataDialog) setMetadataError(message);
      else setError(message);
    } finally {
      setBusy(null);
    }
  };

  const handleCreateKey = () => {
    if (managerAccessKeyMetadataEnabled || managerAccessKeyExpirationEnabled) {
      setMetadataError(null);
      setMetadataDialog({ mode: "create" });
      return;
    }
    void createKey();
  };

  const saveMetadata = async (metadata: AccessKeyMetadataInput) => {
    if (!canManageCephKeys || metadataDialog?.mode !== "edit" || !metadataDialog.key) return;
    const key = metadataDialog.key;
    setBusy(`metadata:${key.access_key_id}`);
    setMetadataError(null);
    try {
      await updateManagerCephAccessKeyMetadata(contextIdForApi, key.access_key_id, metadata);
      await loadKeys();
      setMetadataDialog(null);
      setActionMessage(text("Access-key details updated"));
    } catch (err) {
      setMetadataError(parseError(err));
    } finally {
      setBusy(null);
    }
  };

  const toggleKey = async (key: ManagerCephAccessKey) => {
    if (!canManageCephKeys || key.is_ui_managed) return;
    const currentlyActive = key.is_active;
    setBusy(`toggle:${key.access_key_id}`);
    setError(null);
    setActionMessage(null);
    try {
      await updateManagerCephAccessKeyStatus(contextIdForApi, key.access_key_id, !currentlyActive);
      setActionMessage(text(currentlyActive ? "Access key disabled" : "Access key enabled"));
      await loadKeys();
    } catch (err) {
      setError(parseError(err));
    } finally {
      setBusy(null);
    }
  };

  const deleteKey = async (key: ManagerCephAccessKey) => {
    if (!canManageCephKeys || key.is_ui_managed) return;
    setBusy(`delete:${key.access_key_id}`);
    setError(null);
    setActionMessage(null);
    try {
      await deleteManagerCephAccessKey(contextIdForApi, key.access_key_id);
      setActionMessage(text("Access key deleted"));
      await loadKeys();
    } catch (err) {
      setError(parseError(err));
    } finally {
      setBusy(null);
    }
  };

  const handleToggleKey = (key: ManagerCephAccessKey) => {
    if (!key.is_active) {
      void toggleKey(key);
      return;
    }
    keyConfirmation.requestConfirmation({
      title: text("Disable Ceph access key?"),
      description: text("Temporarily prevent this RGW access key from authenticating."),
      confirmLabel: text("Disable key"),
      cancelLabel: text("Cancel"),
      processingLabel: text("Processing..."),
      impactLabel: text("Impact"),
      closeLabel: text("Close modal"),
      details: [{ label: text("Access key"), value: key.access_key_id, mono: true }],
      impacts: [text("Applications using this key will lose access until the key is enabled again.")],
      onConfirm: () => toggleKey(key),
    });
  };

  const handleDeleteKey = (key: ManagerCephAccessKey) => {
    keyConfirmation.requestConfirmation({
      title: text("Delete Ceph access key?"),
      description: text("Permanently remove this RGW access key from the current S3 User context."),
      confirmLabel: text("Delete key"),
      cancelLabel: text("Cancel"),
      processingLabel: text("Processing..."),
      impactLabel: text("Impact"),
      closeLabel: text("Close modal"),
      details: [
        { label: text("Context"), value: selectedContextName || "Current S3 User" },
        { label: text("Access key"), value: key.access_key_id, mono: true },
      ],
      impacts: [text("Applications using this key will immediately lose access.")],
      onConfirm: () => deleteKey(key),
    });
  };

  const filteredKeys = keys.filter((key) => {
    const needle = keyFilter.trim().toLowerCase();
    if (!needle) return true;
    const statusLabel = key.is_active ? "active" : "inactive";
    return key.access_key_id.toLowerCase().includes(needle)
      || statusLabel.includes(needle)
      || Boolean(key.name?.toLowerCase().includes(needle))
      || Boolean(key.notes?.toLowerCase().includes(needle));
  });
  const tableStatus = resolveListTableStatus({ loading, error, rowCount: filteredKeys.length });
  const showExpirationColumn = Boolean(
    managerAccessKeyExpirationEnabled || keys.some((key) => key.expires_at)
  );
  const keyTableColumns: Array<DataTableColumn<ManagerCephAccessKey>> = [
    {
      id: "access-key",
      label: text("Access key"),
      primary: true,
      mobileRole: "primary",
      cellClassName: "font-mono",
      render: (key) => {
        const managedPrivate = Boolean(key.is_private_access_managed);
        const locked = Boolean(key.is_ui_managed || managedPrivate);
        return (
          <div className="flex flex-wrap items-center gap-2">
            <span>{key.access_key_id}</span>
            {locked && (
              <ListBadge
                tone="neutral" className="shrink-0"
                title={managedPrivate ? text("Managed private access key") : text("BucketReef interface key (locked)")}
              >
                {text(managedPrivate ? "Private access" : "Interface key")}
              </ListBadge>
            )}
          </div>
        );
      },
    },
    ...(managerAccessKeyMetadataEnabled ? [{
      id: "details",
      label: text("Name / notes"),
      render: (key: ManagerCephAccessKey) => (
        <div className="min-w-0">
          <div className="font-medium text-[var(--ui-text)]">{key.name || "—"}</div>
          {key.notes && <div className="mt-0.5 line-clamp-2 text-sm text-[var(--ui-text-muted)]">{key.notes}</div>}
        </div>
      ),
    } satisfies DataTableColumn<ManagerCephAccessKey>] : []),
    {
      id: "status",
      label: text("Status"),
      cellClassName: "text-slate-700 dark:text-slate-200",
      render: (key) => text(key.is_active ? "Active" : "Inactive"),
    },
    ...(showExpirationColumn ? [{
      id: "expiration",
      label: text("Expiration"),
      render: (key: ManagerCephAccessKey) => (
        <AccessKeyExpirationStatus
          expiresAt={key.expires_at}
          state={key.expiration_state}
          error={key.expiration_last_error}
        />
      ),
    } satisfies DataTableColumn<ManagerCephAccessKey>] : []),
    { id: "created", label: text("Created on"), render: (key) => formatLocalDateTime(key.created_at) },
    {
      id: "actions",
      label: text("Actions"),
      align: "right",
      mobileRole: "actions",
      render: (key) => {
        const active = key.is_active;
        const managedPrivate = Boolean(key.is_private_access_managed);
        const locked = Boolean(key.is_ui_managed || managedPrivate);
        const expirationPast = accessKeyExpirationIsPast(key.expires_at);
        const canEditDetails = Boolean(managerAccessKeyMetadataEnabled || (managerAccessKeyExpirationEnabled && !locked));
        return (
          <ListActions>
            {canEditDetails && (
              <ListActionButton
                type="button"
                onClick={() => {
                  setMetadataError(null);
                  setMetadataDialog({ mode: "edit", key });
                }}
                disabled={Boolean(busy)}
              >
                {text(busy === `metadata:${key.access_key_id}` ? "Saving..." : "Edit details")}
              </ListActionButton>
            )}
            <ListActionButton
              type="button"
              onClick={() => handleToggleKey(key)}
              disabled={Boolean(busy) || locked || (!active && expirationPast)}
              title={locked
                ? (managedPrivate ? text("Update the linked private connection instead") : text("Interface key is locked"))
                : (!active && expirationPast)
                  ? text("Remove or move the expired access-key expiration before enabling this key")
                  : undefined}
            >
              {text(busy === `toggle:${key.access_key_id}` ? "Saving..." : active ? "Disable" : "Enable")}
            </ListActionButton>
            <ListActionButton
              type="button"
              onClick={() => handleDeleteKey(key)}
               variant="danger"
              disabled={Boolean(busy) || locked}
              title={locked ? (managedPrivate ? text("Delete the linked private connection instead") : text("Interface key is locked")) : undefined}
            >
              {text(busy === `delete:${key.access_key_id}` ? "Deleting..." : "Delete")}
            </ListActionButton>
          </ListActions>
        );
      },
    },
  ];

  return (
    <PageShell actionPresentation="listing"
      title={text("Ceph access keys")}
      description={text("Manage Ceph RGW access keys and provision private access for this S3 User context.")}
      breadcrumbs={managerPageBreadcrumbs(text, "ceph-keys")}
      actions={[
        ...(canManageCephKeys
          ? [
              {
                label: text(busy === "create" ? "Creating..." : "New key"),
                onClick: handleCreateKey,
                variant: "primary" as const,
              },
            ]
          : []),
        ...(canProvisionManagedPrivateAccess
          ? [
              {
                label: text("Create my private access"),
                onClick: () => setShowPrivateAccessModal(true),
                variant: canManageCephKeys ? ("secondary" as const) : ("primary" as const),
              },
            ]
          : []),
      ]}
    >
      {error && <PageBanner tone="error">{text(error)}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}

      {createdKey && (
        <OneTimeSecretPanel
          title={text("Access key created")}
          description={text("The secret is shown only once.")}
          badge="Copy these values now"
          values={[
            { label: text("Access key"), value: createdKey.access_key_id, copyLabel: text("Copy") },
            { label: text("Secret key"), value: createdKey.secret_access_key, copyLabel: text("Copy") },
          ]}
        />
      )}

      {!hasExecutionContext ? (
        <PageEmptyState
          title={text("Select a context before managing Ceph access keys")}
          description={text("Ceph access keys are scoped to the active execution context. Choose a managed S3 user context before opening key inventory.")}
          primaryAction={{ label: text("Open dashboard"), to: "/manager" }}
          tone="warning"
        />
      ) : !isS3UserContext ? (
        <PageEmptyState
          title={text("Ceph access keys are available only for managed S3 user contexts")}
          description={text("Switch to a managed S3 user execution context to create, enable, disable, or delete RGW access keys.")}
          primaryAction={{ label: text("Open buckets"), to: "/manager/buckets" }}
          tone="warning"
        />
      ) : managerCephKeysEnabled === null ? (
        <PageBanner tone="info">{text("Loading context capabilities…")}</PageBanner>
      ) : !managerCephKeysEnabled ? (
        <PageEmptyState
          title={text("Ceph key inventory is unavailable for this context")}
          description={
            canProvisionManagedPrivateAccess
              ? text("Manual RGW key management is unavailable. Managed private access remains available from the page action.")
              : text("The selected context does not expose RGW access-key management. Check the user tool access, feature toggle, endpoint provider, admin feature, and Ceph admin credentials.")
          }
          primaryAction={{ label: text("Open buckets"), to: "/manager/buckets" }}
          tone="warning"
        />
      ) : (
        <ListPageSection variant="page"
          title={text("Keys")}
          secondaryContent={<p>{text("BucketReef interface keys and managed private-access keys are locked; delete a managed key through its private connection.")}</p>}
          countLabel={text(filteredKeys.length === 1 ? "{count} result" : "{count} results", { count: filteredKeys.length })}
          search={
            <UiInput aria-label={text("Search")} size="compact"
              type="search"
              value={keyFilter}
              onChange={(event) => setKeyFilter(event.target.value)}
              placeholder={managerAccessKeyMetadataEnabled ? text("Search by key, name, notes or status") : text("Search by access key or status")}
            />
          }
        >
          <DataTableShell
            responsiveCards
            columns={keyTableColumns}
            rows={filteredKeys}
            rowKey={(key) => key.access_key_id}
            rowClassName={(key) =>
              cx("hover:bg-slate-50 dark:hover:bg-slate-800/50", !key.is_active && "bg-slate-50/70 dark:bg-slate-900/40")
            }
            status={tableStatus}
            loadingMessage={text("Loading keys...")}
            errorMessage={text("Unable to load keys.")}
            emptyMessage={text("No keys.")}
          />
        </ListPageSection>
      )}
      {keyConfirmation.confirmationDialog}
      {metadataDialog && (
        <AccessKeyMetadataDialog
          mode={metadataDialog.mode}
          initial={metadataDialog.key ? {
            name: metadataDialog.key.name,
            notes: metadataDialog.key.notes,
            expires_at: metadataDialog.key.expires_at,
          } : undefined}
          metadataEnabled={Boolean(managerAccessKeyMetadataEnabled)}
          expirationEnabled={Boolean(
            managerAccessKeyExpirationEnabled
            && !metadataDialog.key?.is_ui_managed
            && !metadataDialog.key?.is_private_access_managed
          )}
          expirationLockedReason={metadataDialog.key?.expires_at && (metadataDialog.key.is_ui_managed || metadataDialog.key.is_private_access_managed)
            ? "This key is managed by BucketReef. Its expiration cannot be changed from the generic key inventory."
            : undefined}
          busy={busy === "create" || busy?.startsWith("metadata:") === true}
          error={metadataError}
          onClose={() => {
            if (busy) return;
            setMetadataDialog(null);
            setMetadataError(null);
          }}
          onSubmit={metadataDialog.mode === "create" ? createKey : saveMetadata}
        />
      )}
      {canProvisionManagedPrivateAccess && showPrivateAccessModal && (
        <CreateManagedPrivateAccessModal
          variant="rgw_user"
          contextId={contextIdForApi}
          contextName={selectedContextName}
          onClose={() => setShowPrivateAccessModal(false)}
          onCreated={(name) => {
            setActionMessage(`Private connection ${name} created without exposing its secret.`);
            setError(null);
            void loadKeys();
          }}
        />
      )}
    </PageShell>
  );
}
