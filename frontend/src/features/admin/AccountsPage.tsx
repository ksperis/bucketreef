/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import TableSortControls from "../../components/list/TableSortControls";
import { ListActions, ListActionButton, ListActionLink } from "../../components/list/ListControls";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  S3Account,
  S3AccountSummary,
  createS3Account,
  deleteS3Account,
  getS3Account,
  importS3Accounts,
  listS3Accounts,
} from "../../api/accounts";
import { listStorageEndpoints } from "../../api/storageEndpoints";
import ActiveFiltersBar from "../../components/ActiveFiltersBar";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import SettingsForm from "../../components/settings/SettingsForm";
import { SettingsDialog } from "../../components/settings/SettingsControls";
import AdminRgwEndpointField from "./AdminRgwEndpointField";
import AdminRgwCreateFields from "./AdminRgwCreateFields";
import { useAdminRgwFormValidation, rgwCreateErrors, rgwAccountImportEntries } from "./useAdminRgwFormValidation";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiTextarea from "../../components/ui/UiTextarea";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { workflowPageHostClass } from "../../components/WorkflowPage";
import ListPageSection from "../../components/list/ListPageSection";
import PageHeader from "../../components/PageHeader";
import ToolbarSearchInput from "../../components/ToolbarSearchInput";
import { useAdminPageBreadcrumbs } from "./adminBreadcrumbs";
import PageBanner from "../../components/PageBanner";
import { useSettingsCloseGuard } from "../../components/settings/SettingsControls";
import DataTableShell, {
  dataTableDefaultActionProps,
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import UiTagBadgeList from "../../components/UiTagBadgeList";
import { resolveListTableStatus } from "../../components/list/listTableStatus";

import { useTagCatalog } from "../../hooks/useTagCatalog";
import useLazyListLoader from "../../hooks/useLazyListLoader";
import {
  AssociationPrincipalStack,
  type AssociationPrincipalItem,
} from "./AssociationSummary";
import AdminAccountEditor from "./AdminAccountEditor";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { useSettingsBaseline } from "../../components/settings/useSettingsDraft";
import { classifyApiError, extractApiError } from "../../utils/apiError";
import { type TextMatchMode } from "../../utils/textMatch";
import { isAdminLikeRole, readStoredUser } from "../../utils/workspaces";
import { buildUiTagItems, canonicalizeUiTags, normalizeUiTags, type UiTagDefinition } from "../../utils/uiTags";
import { buildAccessAuditHref } from "./accessAuditLink";
import { useAdminI18n } from "./adminI18n";
import useAdminEndpointAdminOpsPermissions from "./useAdminEndpointAdminOpsPermissions";
import useAdminPaginatedListState from "./useAdminPaginatedListState";
import useAdminPaginatedListController from "./useAdminPaginatedListController";

type SortField = "name" | "rgw_account_id";

const createEmptyAccountForm = (storageEndpointId = "") => ({
  name: "",
  rgw_tenant: "",
  email: "",
  tags: [] as UiTagDefinition[],
  quota_max_size_gb: "",
  quota_max_size_unit: "GiB",
  quota_max_objects: "",
  storage_endpoint_id: storageEndpointId,
});

export default function S3AccountsPage() {
  const { text: adminText } = useAdminI18n();
  const adminBreadcrumbs = useAdminPageBreadcrumbs();
  const { generalSettings } = useGeneralSettings();
  const portalEnabled = generalSettings.portal_enabled;
  const managedTenantCreationEnabled = generalSettings.allow_managed_rgw_tenant_creation;
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState<string>("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const {
    filter,
    sort,
    page,
    pageSize,
    ensurePageInRange,
    handleFilterChange,
    handleSort: toggleSort,
    handlePageChange,
    handlePageSizeChange,
    resetPage,
  } = useAdminPaginatedListState<SortField>({
    initialSort: { field: "name", direction: "asc" },
  });
  const [quickFilterMode, setQuickFilterMode] = useState<TextMatchMode>("contains");
  const [form, setForm] = useState(createEmptyAccountForm);
  const {
    items: storageEndpoints,
    loading: loadingEndpoints,
    ensure: ensureStorageEndpoints,
  } = useLazyListLoader(listStorageEndpoints, console.error);
  const [importTenantEndpointId, setImportTenantEndpointId] = useState<string>("");
  const [editingS3Account, setEditingS3Account] = useState<S3AccountSummary | null>(null);
  const [editorState, setEditorState] = useState({ dirty: false, busy: false });
  const [deletingS3AccountId, setDeletingS3AccountId] = useState<number | null>(null);
  const [accountToDelete, setS3AccountToDelete] = useState<S3Account | null>(null);
  const [deleteFromRgw, setDeleteFromRgw] = useState(false);
  const currentUser = useMemo(() => readStoredUser(), []);
  const isSuperAdmin = isAdminLikeRole(currentUser?.role);
  const canManageManagerFeatures = isAdminLikeRole(currentUser?.role);
  const {
    catalog: adminTagCatalog,
    loading: adminTagCatalogLoading,
    error: adminTagCatalogError,
  } = useTagCatalog(
    { kind: "admin", domain: "admin_managed" },
    Boolean(isSuperAdmin && showCreateModal)
  );
  const cephEndpoints = useMemo(
    () => storageEndpoints.filter((ep) => ep.provider === "ceph"),
    [storageEndpoints]
  );
  const accountCephEndpoints = useMemo(
    () => cephEndpoints.filter((ep) => Boolean(ep.capabilities.account)),
    [cephEndpoints]
  );
  const defaultAccountEndpointId = useMemo(() => {
    const endpoint = accountCephEndpoints.find((candidate) => candidate.is_default) ?? accountCephEndpoints[0];
    return endpoint ? String(endpoint.id) : "";
  }, [accountCephEndpoints]);
  const createDraft = useMemo(() => ({
    form: {
      ...form,
      tags: canonicalizeUiTags(form.tags),
      storage_endpoint_id:
        form.storage_endpoint_id === defaultAccountEndpointId ? "" : form.storage_endpoint_id,
    },
  }), [defaultAccountEndpointId, form]);
  const { accept: acceptCreateDraft, dirty: createDraftDirty } = useSettingsBaseline(
    createDraft,
    createDraft,
  );
  const importDraft = useMemo(() => ({
    importText,
    importTenantEndpointId:
      importTenantEndpointId === defaultAccountEndpointId ? "" : importTenantEndpointId,
  }), [defaultAccountEndpointId, importTenantEndpointId, importText]);
  const { accept: acceptImportDraft, dirty: importDraftDirty } = useSettingsBaseline(
    importDraft,
    importDraft,
  );

  const extractError = useCallback((err: unknown) => extractApiError(err, adminText("Unexpected error")), [adminText]);
  const {
    permissionsByEndpointId: endpointPermissions,
    loadingByEndpointId: endpointPermissionLoading,
    errorByEndpointId: endpointPermissionErrors,
    loadPermissions: loadEndpointPermissions,
  } = useAdminEndpointAdminOpsPermissions({ formatError: extractError });

  const loadAccountsPage = useCallback(() => {
    const quick = filter.trim();
    return listS3Accounts({
      page,
      page_size: pageSize,
      search: quick || undefined,
      search_exact: quickFilterMode === "exact",
      sort_by: sort.field,
      sort_dir: sort.direction,
      include_quota: false,
      include_rgw_details: false,
    });
  }, [filter, quickFilterMode, page, pageSize, sort.direction, sort.field]);
  const formatAccountsLoadError = useCallback((err: unknown) => {
    console.error(err);
    const failure = classifyApiError(err, adminText("Unable to load accounts."));
    return failure.status === 403
      ? adminText("Access restricted to administrators.")
      : adminText("Unable to load accounts.");
  }, [adminText]);
  const {
    items: accounts,
    loading,
    error,
    total: totalAccounts,
    refresh: fetchS3Accounts,
  } = useAdminPaginatedListController({
    loadPage: loadAccountsPage,
    ensurePageInRange,
    formatError: formatAccountsLoadError,
  });

  const clearAllFilters = () => {
    handleFilterChange("");
    setQuickFilterMode("contains");
  };
  const toggleQuickFilterMode = () => {
    setQuickFilterMode((prev) => (prev === "contains" ? "exact" : "contains"));
    resetPage();
  };
  const quickFilterActive = filter.trim().length > 0;

  const loadEndpointsIfNeeded = useCallback(
    () => ensureStorageEndpoints({ retryOnError: true }),
    [ensureStorageEndpoints],
  );

  useEffect(() => {
    if (storageEndpoints.length === 0) return;
    const defaultCeph =
      accountCephEndpoints.find((ep) => ep.is_default) || accountCephEndpoints[0];
    const firstCephId = defaultCeph ? String(defaultCeph.id) : "";

    setForm((prev) => ({
      ...prev,
      storage_endpoint_id: accountCephEndpoints.some(
        (endpoint) => String(endpoint.id) === prev.storage_endpoint_id
      )
        ? prev.storage_endpoint_id
        : firstCephId,
    }));
    setImportTenantEndpointId((prev) =>
      accountCephEndpoints.some((endpoint) => String(endpoint.id) === prev) ? prev : firstCephId
    );
  }, [storageEndpoints, accountCephEndpoints]);

  useEffect(() => {
    if (!showCreateModal) return;
    if (!form.storage_endpoint_id) return;
    const endpointId = Number(form.storage_endpoint_id);
    if (!Number.isFinite(endpointId) || endpointId <= 0) return;
    if (Object.prototype.hasOwnProperty.call(endpointPermissions, endpointId)) return;
    void loadEndpointPermissions(endpointId);
  }, [showCreateModal, form.storage_endpoint_id, endpointPermissions, loadEndpointPermissions]);

  useEffect(() => {
    if (!showImportModal) return;
    if (!importTenantEndpointId) return;
    const endpointId = Number(importTenantEndpointId);
    if (!Number.isFinite(endpointId) || endpointId <= 0) return;
    if (Object.prototype.hasOwnProperty.call(endpointPermissions, endpointId)) return;
    void loadEndpointPermissions(endpointId);
  }, [showImportModal, importTenantEndpointId, endpointPermissions, loadEndpointPermissions]);

  const loadAccountDetail = useCallback(
    async (account: S3Account | S3AccountSummary, options?: { includeUsage?: boolean }) => {
      try {
        const detail = await getS3Account(account.id, { includeUsage: options?.includeUsage });
        return detail;
      } catch (err) {
        setActionError(extractError(err));
        return null;
      }
    },
    [extractError]
  );

  const accountTableColumns: Array<DataTableColumn<S3Account, SortField>> = [
    {
      id: "name",
      label: "Name",
      field: "name",
      primary: true,
      cellClassName: "min-w-[280px] max-w-[420px]",
      render: (account) => {
        const tagItems = buildUiTagItems(account.tags);
        return (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <div className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="min-w-0 truncate">{account.name}</span>
              {account.rgw_tenant && (
                <span className="ui-caption shrink-0 text-[var(--ui-text-muted)]">
                  ({account.rgw_tenant})
                </span>
              )}
            </div>
            {tagItems.length > 0 && (
              <UiTagBadgeList
                items={tagItems}
                variant="listing-compact"
                layout="inline-compact"
                className="ml-auto max-w-full"
                maxVisible={4}
              />
            )}
          </div>
        );
      },
    },
    {
      id: "rgw-id",
      label: "RGW ID",
      field: "rgw_account_id",
      cellClassName: "min-w-[190px]",
      render: (account) => account.rgw_account_id,
    },
    {
      id: "endpoint",
      label: "Endpoint",
      cellClassName: "min-w-[180px]",
      render: (account) => (
        <span title={account.storage_endpoint_url || undefined}>
          {account.storage_endpoint_name || "—"}
        </span>
      ),
    },
    {
      id: "associations",
      label: "UI Users / Groups",
      cellClassName: "min-w-[200px] max-w-[260px] align-middle",
      render: (account) => renderAccountAssociations(account),
    },
    {
      id: "actions",
      label: "Actions",
      align: "right",
      mobileRole: "actions",
      cellClassName: "min-w-[232px]",
      render: (account) => {
        const deleteBusy = deletingS3AccountId === account.id;
        return isSuperAdmin ? (
          <ListActions>
            <ListActionButton
              type="button"
              onClick={() => startEditS3Account(account)}

              {...dataTableDefaultActionProps}
            >
              {adminText("Edit")}</ListActionButton>
            <ListActionLink to={buildAccessAuditHref({
              scope: "rgw_account",
              targetId: account.id,
            })}>
              {adminText("Review access")}</ListActionLink>
            <ListActionButton
              type="button"
              onClick={() => openDeleteS3AccountModal(account)}
               variant="danger"
              disabled={deleteBusy}
            >
              {deleteBusy ? "Deleting..." : "Delete"}
            </ListActionButton>
          </ListActions>
        ) : (
          <span className="ui-caption text-slate-500 dark:text-slate-400">-</span>
        );
      },
    },
  ];
  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: accounts.length,
  });

  const createValidation = useAdminRgwFormValidation(form, rgwCreateErrors(form));
  const importEntries = rgwAccountImportEntries(importText);
  const importValidation = useAdminRgwFormValidation({importText, storage_endpoint_id: importTenantEndpointId}, {
    ...(importEntries.error ? {importText: importEntries.error} : {}),
    ...(!importTenantEndpointId ? {storage_endpoint_id: adminText("Select a Ceph endpoint.")} : {}),
  });
  const createPending = useRef(false);
  const importPending = useRef(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (createPending.current || !createValidation.validate(e.currentTarget)) return;
    if (createPermissionLoading) {
      setActionError(adminText("Checking endpoint permissions. Please wait."));
      return;
    }
    if (!createEndpointCanWrite) {
      setActionError(adminText("Selected endpoint does not allow this operation (missing accounts=write)."));
      return;
    }
    createPending.current = true;
    setCreating(true);
    setActionError(null);
    setActionMessage(null);
    try {
      await createS3Account({
        name: form.name.trim(),
        rgw_tenant: managedTenantCreationEnabled ? form.rgw_tenant.trim() : "",
        email: form.email.trim() || undefined,
        tags: normalizeUiTags(form.tags),
        quota_max_size_gb: form.quota_max_size_gb ? Number(form.quota_max_size_gb) : undefined,
        quota_max_size_unit: form.quota_max_size_gb ? form.quota_max_size_unit : undefined,
        quota_max_objects: form.quota_max_objects ? Number(form.quota_max_objects) : undefined,
        storage_endpoint_id: Number(form.storage_endpoint_id),
      });
      setActionMessage(adminText("RGW account created."));
      const defaultCeph =
        accountCephEndpoints.find((ep) => ep.is_default) || accountCephEndpoints[0];
      setForm(createEmptyAccountForm(defaultCeph ? String(defaultCeph.id) : ""));
      await fetchS3Accounts();
      setShowCreateModal(false);
    } catch (err) {
      setActionError(extractError(err));
    } finally {
      createPending.current = false;
      setCreating(false);
    }
  };

  const submitImport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (importPending.current || !importValidation.validate(event.currentTarget)) return;
    if (importPermissionLoading || !importEndpointCanWrite) return;
    importPending.current = true;
    setImportBusy(true);
    setImportError(null);
    setImportMessage(null);
    try {
      await importS3Accounts(importEntries.entries.map(entry => ({
        rgw_account_id: entry.rgw_account_id.toUpperCase(),
        root_uid: entry.root_uid,
        storage_endpoint_id: Number(importTenantEndpointId),
      })));
      setImportMessage(adminText("RGW accounts imported."));
      importValidation.reset();
      setImportText("");
      acceptImportDraft({
        importText: "",
        importTenantEndpointId:
          importTenantEndpointId === defaultAccountEndpointId ? "" : importTenantEndpointId,
      });
      await fetchS3Accounts();
    } catch (err) {
      setImportError(extractError(err));
    } finally {
      importPending.current = false;
      setImportBusy(false);
    }
  };

  const renderAccountAssociations = (account: S3Account | S3AccountSummary) => {
    const userItems: AssociationPrincipalItem[] = account.user_links.map((link) => {
      return {
        id: link.user_id,
        kind: "user",
        label: link.user_full_name || link.user_email || adminText("User #{id}", { id: link.user_id }),
        email: link.user_email,
        avatar: link.user_avatar,
        manager_role: link.manager_role,
        portal_role: link.portal_role,
      };
    });
    const groupItems: AssociationPrincipalItem[] = account.group_links.map((link) => {
      return {
        id: link.group_id,
        kind: "group",
        label: link.group_name || adminText("Group #{id}", { id: link.group_id }),
        avatar: link.group_avatar,
        manager_role: link.manager_role,
        portal_role: link.portal_role,
      };
    });
    return <AssociationPrincipalStack items={[...userItems, ...groupItems]} />;
  };

  const deleteModalUnknownResources =
    accountToDelete != null &&
    (accountToDelete.bucket_count == null ||
      accountToDelete.rgw_user_count == null ||
      accountToDelete.rgw_topic_count == null);
  const deleteModalHasLinkedResources =
    accountToDelete != null &&
    ((accountToDelete.bucket_count ?? 0) > 0 ||
      (accountToDelete.rgw_user_count ?? 0) > 0 ||
      (accountToDelete.rgw_topic_count ?? 0) > 0);
  const deleteModalHasResources = deleteModalUnknownResources || deleteModalHasLinkedResources;
  const deleteModalBusy = accountToDelete ? deletingS3AccountId === accountToDelete.id : false;
  const selectedCreateEndpointId = form.storage_endpoint_id ? Number(form.storage_endpoint_id) : null;
  const selectedImportEndpointId = importTenantEndpointId ? Number(importTenantEndpointId) : null;
  const createPermissionLoading = selectedCreateEndpointId ? Boolean(endpointPermissionLoading[selectedCreateEndpointId]) : false;
  const importPermissionLoading = selectedImportEndpointId ? Boolean(endpointPermissionLoading[selectedImportEndpointId]) : false;
  const createEndpointCanWrite = selectedCreateEndpointId
    ? endpointPermissions[selectedCreateEndpointId]?.accounts_write === true
    : false;
  const importEndpointCanWrite = selectedImportEndpointId
    ? endpointPermissions[selectedImportEndpointId]?.accounts_write === true
    : false;
  const createPermissionError = selectedCreateEndpointId ? endpointPermissionErrors[selectedCreateEndpointId] ?? null : null;
  const importPermissionError = selectedImportEndpointId ? endpointPermissionErrors[selectedImportEndpointId] ?? null : null;
  const createCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: showCreateModal && createDraftDirty,
    disabled: creating,
    onClose: () => setShowCreateModal(false),
  });
  const importCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: showImportModal && importDraftDirty,
    disabled: importBusy,
    onClose: () => setShowImportModal(false),
  });
  const closeAccountEditor = useCallback(() => setEditingS3Account(null), []);
  const accountSaved = useCallback(async () => {
    await fetchS3Accounts();
    setActionMessage(adminText("RGW account updated."));
  }, [adminText, fetchS3Accounts]);
  const pendingAccount = useRef<S3AccountSummary | null>(null);
  const accountSwitchGuard = useSettingsCloseGuard({
    hasUnsavedChanges: editorState.dirty,
    disabled: editorState.busy,
    onClose: () => {
      setActionError(null);
      setActionMessage(null);
      setEditingS3Account(pendingAccount.current);
    },
  });
  const startEditS3Account = (account: S3Account | S3AccountSummary) => {
    pendingAccount.current = account;
    accountSwitchGuard.requestClose();
  };

  const openDeleteS3AccountModal = async (account: S3Account | S3AccountSummary) => {
    setActionError(null);
    setActionMessage(null);
    const detail = await loadAccountDetail(account, { includeUsage: true });
    if (!detail) return;
    setS3AccountToDelete(detail);
    setDeleteFromRgw(false);
  };

  const closeDeleteModal = () => {
    setS3AccountToDelete(null);
    setDeleteFromRgw(false);
    setActionError(null);
  };

  const confirmDeleteS3Account = async () => {
    if (!accountToDelete || deleteModalBusy) return;
    const targetId = accountToDelete.id;
    setDeletingS3AccountId(targetId);
    setActionError(null);
    setActionMessage(null);
    try {
      await deleteS3Account(targetId, { deleteRgw: deleteFromRgw });
      await fetchS3Accounts();
      setActionMessage(adminText("RGW account deleted."));
      closeDeleteModal();
    } catch (err) {
      setActionError(extractError(err));
    } finally {
      setDeletingS3AccountId(null);
    }
  };

  return (
    <div className={workflowPageHostClass(Boolean(editingS3Account))}>
      <PageHeader actionPresentation="listing"
        title={adminText("RGW Accounts")}
        description={adminText("Provision Ceph RGW accounts, quotas, and root users.")}
        breadcrumbs={adminBreadcrumbs("accounts")}
        actions={
          isSuperAdmin
            ? [
                {
                  label: adminText("Import"),
                  onClick: () => {
                    importValidation.reset();
                    setImportText("");
                    setImportError(null);
                    setImportMessage(null);
                    acceptImportDraft({
                      importText: "",
                      importTenantEndpointId:
                        importTenantEndpointId === defaultAccountEndpointId ? "" : importTenantEndpointId,
                    });
                    setShowImportModal(true);
                    void loadEndpointsIfNeeded();
                  },
                  variant: "ghost",
                },
                {
                  label: adminText("Create account"),
                  onClick: () => {
                    createValidation.reset();
                    setActionError(null);
                    setActionMessage(null);
                    acceptCreateDraft(createDraft);
                    setShowCreateModal(true);
                    void loadEndpointsIfNeeded();
                  },
                },
              ]
            : []
        }
      />

      {error && <PageBanner tone="error">{error}</PageBanner>}
      {actionMessage && <UiInlineMessage tone="success" role="status">{actionMessage}</UiInlineMessage>}

      {isSuperAdmin && showCreateModal && (
        <SettingsDialog title={adminText("Create an account")} onClose={createCloseGuard.requestClose} closeDisabled={creating} maxWidthClass="max-w-2xl">
          <SettingsForm label={adminText("Create RGW account")} presentation="dialog" busy={creating} onSubmit={handleSubmit}
            submitDisabled={createPermissionLoading || !createEndpointCanWrite}
            onCancel={createCloseGuard.requestClose} submitLabel={adminText("Create account")} busyLabel={adminText("Creating...")}>
            <AdminRgwCreateFields kind="account" value={form} onChange={patch => setForm(current => ({...current, ...patch}))}
              showTenant={managedTenantCreationEnabled}
              errors={createValidation.errors} busy={creating}
              endpoint={{label: adminText("Storage endpoint (Ceph) *"), endpoints: accountCephEndpoints, loading: loadingEndpoints,
                operation: "accounts", permissionLoading: createPermissionLoading, permissionError: createPermissionError, canWrite: createEndpointCanWrite}}
              tags={{catalog: adminTagCatalog, loading: adminTagCatalogLoading, error: adminTagCatalogError}} />
            {actionError && <UiInlineMessage tone="error" role="alert">{actionError}</UiInlineMessage>}
          </SettingsForm>
          {createCloseGuard.confirmationDialog}
        </SettingsDialog>
      )}

      {isSuperAdmin && accountToDelete && (
        <ConfirmActionDialog
          title={adminText("Delete {name}", { name: accountToDelete.name })}
          description={adminText("Removing this account deletes the UI entry. Optionally delete the backing RGW account if it no longer contains resources.")}
          confirmLabel={adminText("Delete account")}
          processingLabel={adminText("Deleting...")}
          loading={deleteModalBusy}
          error={actionError}
          warningTone="warning"
          warning={deleteModalHasResources && (
            <div className="space-y-2">
              <p>{deleteModalUnknownResources
                ? "Unable to verify linked RGW resources. RGW deletion is disabled until counts are available."
                : "This RGW account still has attached resources. Remove buckets, RGW users (excluding the admin user), and notification topics before deleting it from RGW."}</p>
              <p className="settings-label">
                {adminText("Buckets:")}{accountToDelete.bucket_count ?? "unknown"} {adminText("· IAM users (excl. admin):")}{" "}
                {accountToDelete.rgw_user_count ?? "unknown"} {adminText("· RGW topics:")}{" "}
                {accountToDelete.rgw_topic_count ?? "unknown"}
              </p>
              {accountToDelete.rgw_user_uids && accountToDelete.rgw_user_uids.length > 0 && (
                <div>
                  <p className="settings-label">{adminText("RGW users to remove:")}</p>
                  <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto">
                    {accountToDelete.rgw_user_uids.map((uid) => <li key={uid}>{uid}</li>)}
                  </ul>
                </div>
              )}
              {accountToDelete.rgw_topics && accountToDelete.rgw_topics.length > 0 && (
                <div>
                  <p className="settings-label">{adminText("Notification topics to remove:")}</p>
                  <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto">
                    {accountToDelete.rgw_topics.map((topic) => <li key={topic}>{topic}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
          options={
            <UiCheckboxField
              checked={deleteFromRgw}
              disabled={deleteModalBusy || deleteModalHasResources}
              onChange={(event) => setDeleteFromRgw(event.target.checked)}
            >
              <span className="modal-option-copy">
                {adminText("Also delete RGW account")}{" "}
                <code className="break-all font-mono">
                  {accountToDelete.rgw_account_id ?? accountToDelete.id}
                </code>
              </span>
            </UiCheckboxField>
          }
          onCancel={closeDeleteModal}
          onConfirm={() => void confirmDeleteS3Account()}
        />
      )}

      {isSuperAdmin && showImportModal && (
        <SettingsDialog title={adminText("Import RGW accounts")} onClose={importCloseGuard.requestClose} closeDisabled={importBusy} maxWidthClass="max-w-xl">
          <SettingsForm label={adminText("Import RGW accounts")} presentation="dialog" busy={importBusy} onSubmit={submitImport}
            submitDisabled={importPermissionLoading || !importEndpointCanWrite}
            onCancel={importCloseGuard.requestClose} submitLabel={adminText("Import")} busyLabel={adminText("Importing...")}>
            <div className="settings-fields settings-form">
              <p className="settings-body text-[var(--ui-text-muted)]">{adminText("Enter RGW account IDs, one per line. Optionally add an existing root UID after a space (e.g. customer01$customer01-root). The Ceph tenant is read from RGW.")}</p>
              <UiTextarea label={adminText("RGW account IDs")} name="importText" rows={6} required value={importText}
                error={importValidation.errors.importText} placeholder="RGW00000000000000001"
                onChange={event => setImportText(event.target.value)} />
              <AdminRgwEndpointField label={adminText("Ceph endpoint")} value={importTenantEndpointId}
                onChange={setImportTenantEndpointId} endpoints={accountCephEndpoints}
                error={importValidation.errors.storage_endpoint_id} loading={loadingEndpoints} operation="accounts"
                permissionLoading={importPermissionLoading} permissionError={importPermissionError} canWrite={importEndpointCanWrite} />
              {importError && <UiInlineMessage tone="error" role="alert">{importError}</UiInlineMessage>}
              {importMessage && <UiInlineMessage tone="success" role="status">{importMessage}</UiInlineMessage>}
            </div>
          </SettingsForm>
          {importCloseGuard.confirmationDialog}
        </SettingsDialog>
      )}

      {isSuperAdmin && editingS3Account && <AdminAccountEditor key={editingS3Account.id}
        account={editingS3Account} portalEnabled={portalEnabled}
        canManageManagerFeatures={canManageManagerFeatures}
        onClose={closeAccountEditor} onSaved={accountSaved} onStateChange={setEditorState} />}
      {accountSwitchGuard.confirmationDialog}

      <ListPageSection
        variant="page"
        mobileSort={<TableSortControls columns={accountTableColumns} sort={{ field: sort.field, direction: sort.direction, onSort: toggleSort }} />}
          title={adminText("RGW Accounts")}
          countLabel={adminText(totalAccounts === 1 ? "{count} entry" : "{count} entries", { count: totalAccounts })}
          search={
            <ToolbarSearchInput
              value={filter}
              onChange={handleFilterChange}
              placeholder={adminText("Search by name, RGW ID, user email, group, or tag")}
              className="w-full sm:w-64 md:w-72"
              active={quickFilterActive}
              matchMode={quickFilterMode}
              onToggleMatchMode={toggleQuickFilterMode}
            />
          }
          secondaryContent={
            quickFilterActive ? (
              <ActiveFiltersBar
                label={adminText("Active filters summary")}
                items={[
                  {
                    id: "search",
                    label: `Search ${quickFilterMode === "exact" ? "exact" : "contains"}: ${filter.trim()}`,
                  },
                ]}
                onClearAll={clearAllFilters}
              />
            ) : null
          }
      >
        <DataTableShell
          columns={accountTableColumns}
          rows={accounts}
          rowKey={(account) => account.id}
          status={tableStatus}
          loadingMessage="Loading accounts..."
          errorMessage="Unable to load accounts."
          emptyMessage="No accounts."
          sort={{ field: sort.field, direction: sort.direction, onSort: toggleSort }}
          primaryColumnId="name"
          responsiveCards
          tableClassName="ui-data-table"
          pagination={{
            page,
            pageSize,
            total: totalAccounts,
            onPageChange: handlePageChange,
            onPageSizeChange: handlePageSizeChange,
            disabled: loading,
          }}
        />
      </ListPageSection>
    </div>
  );
}
