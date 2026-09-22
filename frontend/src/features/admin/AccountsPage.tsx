/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import TableSortControls from "../../components/list/TableSortControls";
import { ListActions, ListActionButton } from "../../components/list/ListControls";
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
import { getStorageEndpoint, listStorageEndpoints, StorageEndpoint } from "../../api/storageEndpoints";
import ActiveFiltersBar from "../../components/ActiveFiltersBar";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import SettingsForm from "../../components/settings/SettingsForm";
import { SettingsDialog } from "../../components/settings/SettingsControls";
import AdminRgwEndpointField from "./AdminRgwEndpointField";
import AdminRgwCreateFields from "./AdminRgwCreateFields";
import { useAdminRgwFormValidation, rgwCreateErrors, rgwImportEntries } from "./useAdminRgwFormValidation";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiTextarea from "../../components/ui/UiTextarea";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { workflowPageHostClass } from "../../components/WorkflowPage";
import ListPageSection from "../../components/list/ListPageSection";
import PageHeader from "../../components/PageHeader";
import ToolbarSearchInput from "../../components/ToolbarSearchInput";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import PageBanner from "../../components/PageBanner";
import { useSettingsCloseGuard } from "../../components/settings/SettingsControls";
import DataTableShell, {
  dataTableDefaultActionProps,
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import UiTagBadgeList from "../../components/UiTagBadgeList";
import { resolveListTableStatus } from "../../components/list/listTableStatus";

import { useTagCatalog } from "../../hooks/useTagCatalog";
import {
  AssociationPrincipalStack,
  type AssociationPrincipalItem,
} from "./AssociationSummary";
import AdminAccountEditor from "./AdminAccountEditor";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { extractApiError } from "../../utils/apiError";
import { stableSignature } from "../../utils/stableSignature";
import { nextSortState } from "../../utils/sortValues";
import { matchesExactTextCandidate, type TextMatchMode } from "../../utils/textMatch";
import { isAdminLikeRole, readStoredUser } from "../../utils/workspaces";
import { buildUiTagItems, extractUiTagLabels, normalizeUiTags, type UiTagDefinition } from "../../utils/uiTags";

type SortField = "name" | "rgw_account_id";
export default function S3AccountsPage() {
  const { generalSettings } = useGeneralSettings();
  const portalEnabled = generalSettings.portal_enabled;
  const [accounts, setS3Accounts] = useState<S3Account[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [totalAccounts, setTotalAccounts] = useState(0);
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState<string>("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [sort, setSort] = useState<{ field: SortField; direction: "asc" | "desc" }>({
    field: "name",
    direction: "asc",
  });
  const [filter, setFilter] = useState("");
  const [quickFilterMode, setQuickFilterMode] = useState<TextMatchMode>("contains");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [form, setForm] = useState({
    name: "",
    email: "",
    tags: [] as UiTagDefinition[],
    quota_max_size_gb: "",
    quota_max_size_unit: "GiB",
    quota_max_objects: "",
    storage_endpoint_id: "",
  });
  const [createInitialSignature, setCreateInitialSignature] = useState("");
  const [storageEndpoints, setStorageEndpoints] = useState<StorageEndpoint[]>([]);
  const [loadingEndpoints, setLoadingEndpoints] = useState(false);
  const [endpointsLoaded, setEndpointsLoaded] = useState(false);
  const [endpointAccountsWrite, setEndpointAccountsWrite] = useState<Record<number, boolean>>({});
  const [endpointPermissionLoading, setEndpointPermissionLoading] = useState<Record<number, boolean>>({});
  const [endpointPermissionErrors, setEndpointPermissionErrors] = useState<Record<number, string | null>>({});
  const [importTenantEndpointId, setImportTenantEndpointId] = useState<string>("");
  const [importInitialSignature, setImportInitialSignature] = useState("");
  const [editingS3Account, setEditingS3Account] = useState<S3AccountSummary | null>(null);
  const [editorState, setEditorState] = useState({ dirty: false, busy: false });
  const [deletingS3AccountId, setDeletingS3AccountId] = useState<number | null>(null);
  const [accountToDelete, setS3AccountToDelete] = useState<S3Account | null>(null);
  const [deleteFromRgw, setDeleteFromRgw] = useState(false);
  const currentUser = useMemo(() => readStoredUser(), []);
  const isSuperAdmin = isAdminLikeRole(currentUser?.role);
  const canManagePrivilegedTargets = isAdminLikeRole(currentUser?.role);
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
    () => cephEndpoints.filter((ep) => Boolean(ep.capabilities?.account)),
    [cephEndpoints]
  );
  const defaultAccountEndpointId = useMemo(() => {
    const endpoint = accountCephEndpoints.find((candidate) => candidate.is_default) ?? accountCephEndpoints[0];
    return endpoint ? String(endpoint.id) : "";
  }, [accountCephEndpoints]);
  const buildCreateSignature = useCallback(
    (value: typeof form) =>
      stableSignature({
        form: {
          ...value,
          tags: normalizeUiTags(value.tags),
          storage_endpoint_id:
            value.storage_endpoint_id === defaultAccountEndpointId ? "" : value.storage_endpoint_id,
        },
      }),
    [defaultAccountEndpointId]
  );
  const buildImportSignature = useCallback(
    (value: { importText: string; importTenantEndpointId: string }) =>
      stableSignature({
        ...value,
        importTenantEndpointId:
          value.importTenantEndpointId === defaultAccountEndpointId ? "" : value.importTenantEndpointId,
      }),
    [defaultAccountEndpointId]
  );

  const extractError = useCallback((err: unknown) => extractApiError(err, "Unexpected error"), []);

  const fetchS3Accounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const quick = filter.trim();
      if (quick && quickFilterMode === "exact") {
        const allMatches: S3Account[] = [];
        let nextPage = 1;
        while (true) {
          const response = await listS3Accounts({
            page: nextPage,
            page_size: 200,
            search: quick,
            sort_by: sort.field,
            sort_dir: sort.direction,
            include_quota: false,
            include_rgw_details: false,
          });
          allMatches.push(...response.items);
          if (!response.has_next) break;
          nextPage += 1;
        }

        const exactMatches = allMatches.filter((account) => {
          const candidates = [
            account.name,
            account.rgw_account_id,
            ...(account.user_links ?? []).flatMap((link) => [link.user_email, link.user_full_name]),
            ...(account.group_links ?? []).map((link) => link.group_name),
            ...extractUiTagLabels(account.tags),
          ];
          return matchesExactTextCandidate(candidates, quick);
        });
        const totalExact = exactMatches.length;
        const totalPages = Math.max(1, Math.ceil(totalExact / pageSize));
        if (totalExact > 0 && page > totalPages) {
          setPage(totalPages);
          return;
        }
        const start = (page - 1) * pageSize;
        setS3Accounts(exactMatches.slice(start, start + pageSize));
        setTotalAccounts(totalExact);
      } else {
        const response = await listS3Accounts({
          page,
          page_size: pageSize,
          search: quick || undefined,
          sort_by: sort.field,
          sort_dir: sort.direction,
          include_quota: false,
          include_rgw_details: false,
        });
        const totalPages = Math.max(1, Math.ceil((response.total || 0) / pageSize));
        if (response.total > 0 && page > totalPages) {
          setPage(totalPages);
          return;
        }
        setS3Accounts(response.items);
        setTotalAccounts(response.total);
      }
    } catch (err) {
      console.error(err);
      const msg = extractError(err);
      if (msg.toLowerCase().includes("not authorized") || msg.includes("403")) {
        setError("Access restricted to super-admin.");
      } else {
        setError("Unable to load accounts.");
      }
    } finally {
      setLoading(false);
    }
  }, [extractError, filter, quickFilterMode, page, pageSize, sort.direction, sort.field]);

  const toggleSort = (field: SortField) => {
    setSort((current) => nextSortState(current, field, "desc"));
    setPage(1);
  };

  const handleFilterChange = (value: string) => {
    setFilter(value);
    setPage(1);
  };
  const clearAllFilters = () => {
    setFilter("");
    setQuickFilterMode("contains");
    setPage(1);
  };
  const toggleQuickFilterMode = () => {
    setQuickFilterMode((prev) => (prev === "contains" ? "exact" : "contains"));
    setPage(1);
  };
  const quickFilterActive = filter.trim().length > 0;

  const handlePageChange = (nextPage: number) => {
    if (nextPage === page) return;
    setPage(Math.max(1, nextPage));
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const loadEndpointsIfNeeded = useCallback(async () => {
    if (endpointsLoaded || loadingEndpoints) return;
    setLoadingEndpoints(true);
    try {
      const data = await listStorageEndpoints();
      setStorageEndpoints(data);
      setEndpointsLoaded(true);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingEndpoints(false);
    }
  }, [endpointsLoaded, loadingEndpoints]);

  useEffect(() => {
    fetchS3Accounts();
  }, [fetchS3Accounts]);

  const fetchEndpointAccountsWritePermission = useCallback(
    async (endpointId: number) => {
      if (!Number.isFinite(endpointId) || endpointId <= 0) return;
      if (endpointPermissionLoading[endpointId]) return;
      setEndpointPermissionLoading((prev) => ({ ...prev, [endpointId]: true }));
      try {
        const endpoint = await getStorageEndpoint(endpointId, { include_admin_ops_permissions: true });
        setEndpointAccountsWrite((prev) => ({
          ...prev,
          [endpointId]: Boolean(endpoint.admin_ops_permissions?.accounts_write),
        }));
        setEndpointPermissionErrors((prev) => ({ ...prev, [endpointId]: null }));
      } catch (err) {
        setEndpointAccountsWrite((prev) => ({ ...prev, [endpointId]: false }));
        setEndpointPermissionErrors((prev) => ({ ...prev, [endpointId]: extractError(err) }));
      } finally {
        setEndpointPermissionLoading((prev) => ({ ...prev, [endpointId]: false }));
      }
    },
    [endpointPermissionLoading, extractError]
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
    if (Object.prototype.hasOwnProperty.call(endpointAccountsWrite, endpointId)) return;
    void fetchEndpointAccountsWritePermission(endpointId);
  }, [showCreateModal, form.storage_endpoint_id, endpointAccountsWrite, fetchEndpointAccountsWritePermission]);

  useEffect(() => {
    if (!showImportModal) return;
    if (!importTenantEndpointId) return;
    const endpointId = Number(importTenantEndpointId);
    if (!Number.isFinite(endpointId) || endpointId <= 0) return;
    if (Object.prototype.hasOwnProperty.call(endpointAccountsWrite, endpointId)) return;
    void fetchEndpointAccountsWritePermission(endpointId);
  }, [showImportModal, importTenantEndpointId, endpointAccountsWrite, fetchEndpointAccountsWritePermission]);

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
      cellClassName: "min-w-[240px] max-w-[360px]",
      render: (account) => {
        const tagItems = buildUiTagItems(account.tags);
        return (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 flex-1 truncate">{account.name}</span>
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
      cellClassName: "min-w-[176px]",
      render: (account) => account.rgw_account_id,
    },
    {
      id: "endpoint",
      label: "Endpoint",
      cellClassName: "min-w-[160px]",
      render: (account) => (
        <span title={account.storage_endpoint_url || undefined}>
          {account.storage_endpoint_name || "—"}
        </span>
      ),
    },
    {
      id: "associations",
      label: "UI Users / Groups",
      cellClassName: "min-w-[180px] max-w-[240px] align-middle",
      render: (account) => renderAccountAssociations(account),
    },
    {
      id: "actions",
      label: "Actions",
      align: "right",
      mobileRole: "actions",
      cellClassName: "min-w-[144px]",
      render: (account) => {
        const deleteBusy = deletingS3AccountId === account.id;
        return isSuperAdmin ? (
          <ListActions>
            <ListActionButton
              type="button"
              onClick={() => startEditS3Account(account)}

              {...dataTableDefaultActionProps}
            >
              Edit
            </ListActionButton>
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
  const importEntries = rgwImportEntries(importText, "account");
  const importValidation = useAdminRgwFormValidation({importText, storage_endpoint_id: importTenantEndpointId}, {
    ...(importEntries.error ? {importText: importEntries.error} : {}),
    ...(!importTenantEndpointId ? {storage_endpoint_id: "Select a Ceph endpoint."} : {}),
  });
  const createPending = useRef(false);
  const importPending = useRef(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (createPending.current || !createValidation.validate(e.currentTarget)) return;
    if (createPermissionLoading) {
      setActionError("Checking endpoint permissions. Please wait.");
      return;
    }
    if (!createEndpointCanWrite) {
      setActionError("Selected endpoint does not allow this operation (missing accounts=write).");
      return;
    }
    createPending.current = true;
    setCreating(true);
    setActionError(null);
    setActionMessage(null);
    try {
      await createS3Account({
        name: form.name.trim(),
        email: form.email.trim() || undefined,
        tags: normalizeUiTags(form.tags),
        quota_max_size_gb: form.quota_max_size_gb ? Number(form.quota_max_size_gb) : undefined,
        quota_max_size_unit: form.quota_max_size_gb ? form.quota_max_size_unit : undefined,
        quota_max_objects: form.quota_max_objects ? Number(form.quota_max_objects) : undefined,
        storage_endpoint_id: Number(form.storage_endpoint_id),
      });
      setActionMessage("S3Account created");
      const defaultCeph =
        accountCephEndpoints.find((ep) => ep.is_default) || accountCephEndpoints[0];
      setForm({
        name: "",
        email: "",
        tags: [],
        quota_max_size_gb: "",
        quota_max_size_unit: "GiB",
        quota_max_objects: "",
        storage_endpoint_id: defaultCeph ? String(defaultCeph.id) : "",
      });
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
      await importS3Accounts(importEntries.entries.map(identifier => ({
        rgw_account_id: identifier,
        storage_endpoint_id: Number(importTenantEndpointId),
      })));
      setImportMessage("S3Accounts imported.");
      importValidation.reset();
      setImportText("");
      setImportInitialSignature(buildImportSignature({ importText: "", importTenantEndpointId }));
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
        label: link.user_full_name || link.user_email || `User #${link.user_id}`,
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
        label: link.group_name || `Group #${link.group_id}`,
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
  const createEndpointCanWrite = selectedCreateEndpointId ? endpointAccountsWrite[selectedCreateEndpointId] === true : false;
  const importEndpointCanWrite = selectedImportEndpointId ? endpointAccountsWrite[selectedImportEndpointId] === true : false;
  const createPermissionError = selectedCreateEndpointId ? endpointPermissionErrors[selectedCreateEndpointId] ?? null : null;
  const importPermissionError = selectedImportEndpointId ? endpointPermissionErrors[selectedImportEndpointId] ?? null : null;
  const createCurrentSignature = useMemo(
    () => buildCreateSignature(form),
    [buildCreateSignature, form]
  );
  const createCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: Boolean(createInitialSignature) && createCurrentSignature !== createInitialSignature,
    disabled: creating,
    onClose: () => setShowCreateModal(false),
  });
  const importCurrentSignature = useMemo(
    () => buildImportSignature({ importText, importTenantEndpointId }),
    [buildImportSignature, importTenantEndpointId, importText]
  );
  const importCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: Boolean(importInitialSignature) && importCurrentSignature !== importInitialSignature,
    disabled: importBusy,
    onClose: () => setShowImportModal(false),
  });
  const closeAccountEditor = useCallback(() => setEditingS3Account(null), []);
  const accountSaved = useCallback(async () => {
    await fetchS3Accounts();
    setActionMessage("S3Account updated");
  }, [fetchS3Accounts]);
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
      setActionMessage("S3Account deleted");
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
        title="RGW Accounts"
        description="Provision Ceph RGW accounts (tenants), quotas, and root users."
        breadcrumbs={adminPageBreadcrumbs("accounts")}
        actions={
          isSuperAdmin
            ? [
                {
                  label: "Import",
                  onClick: () => {
                    importValidation.reset();
                    setImportText("");
                    setImportError(null);
                    setImportMessage(null);
                    setImportInitialSignature(buildImportSignature({ importText: "", importTenantEndpointId }));
                    setShowImportModal(true);
                    void loadEndpointsIfNeeded();
                  },
                  variant: "ghost",
                },
                {
                  label: "Create account",
                  onClick: () => {
                    createValidation.reset();
                    setActionError(null);
                    setActionMessage(null);
                    setCreateInitialSignature(buildCreateSignature(form));
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
        <SettingsDialog title="Create an account" onClose={createCloseGuard.requestClose} closeDisabled={creating} maxWidthClass="max-w-2xl">
          <SettingsForm label="Create RGW account" presentation="dialog" busy={creating} onSubmit={handleSubmit}
            submitDisabled={createPermissionLoading || !createEndpointCanWrite}
            onCancel={createCloseGuard.requestClose} submitLabel="Create account" busyLabel="Creating...">
            <AdminRgwCreateFields kind="account" value={form} onChange={patch => setForm(current => ({...current, ...patch}))}
              errors={createValidation.errors} busy={creating}
              endpoint={{label: "Storage endpoint (Ceph) *", endpoints: accountCephEndpoints, loading: loadingEndpoints,
                operation: "accounts", permissionLoading: createPermissionLoading, permissionError: createPermissionError, canWrite: createEndpointCanWrite}}
              tags={{catalog: adminTagCatalog, loading: adminTagCatalogLoading, error: adminTagCatalogError}} />
            {actionError && <UiInlineMessage tone="error" role="alert">{actionError}</UiInlineMessage>}
          </SettingsForm>
          {createCloseGuard.confirmationDialog}
        </SettingsDialog>
      )}

      {isSuperAdmin && accountToDelete && (
        <ConfirmActionDialog
          title={`Delete ${accountToDelete.name}`}
          description="Removing this account deletes the UI entry. Optionally delete the backing RGW tenant if it no longer contains resources."
          confirmLabel="Delete account"
          processingLabel="Deleting..."
          loading={deleteModalBusy}
          error={actionError}
          warningTone="warning"
          warning={deleteModalHasResources && (
            <div className="space-y-2">
              <p>{deleteModalUnknownResources
                ? "Unable to verify linked RGW resources. RGW deletion is disabled until counts are available."
                : "This RGW tenant still has attached resources. Remove buckets, RGW users (excluding the admin user), and notification topics before deleting it from RGW."}</p>
              <p className="settings-label">
                Buckets: {accountToDelete.bucket_count ?? "unknown"} · IAM users (excl. admin):{" "}
                {accountToDelete.rgw_user_count ?? "unknown"} · RGW topics:{" "}
                {accountToDelete.rgw_topic_count ?? "unknown"}
              </p>
              {accountToDelete.rgw_user_uids && accountToDelete.rgw_user_uids.length > 0 && (
                <div>
                  <p className="settings-label">RGW users to remove:</p>
                  <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto">
                    {accountToDelete.rgw_user_uids.map((uid) => <li key={uid}>{uid}</li>)}
                  </ul>
                </div>
              )}
              {accountToDelete.rgw_topics && accountToDelete.rgw_topics.length > 0 && (
                <div>
                  <p className="settings-label">Notification topics to remove:</p>
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
                Also delete RGW tenant <code className="break-all font-mono">{accountToDelete.rgw_account_id ?? accountToDelete.id}</code>
              </span>
            </UiCheckboxField>
          }
          onCancel={closeDeleteModal}
          onConfirm={() => void confirmDeleteS3Account()}
        />
      )}

      {isSuperAdmin && showImportModal && (
        <SettingsDialog title="Import RGW accounts" onClose={importCloseGuard.requestClose} closeDisabled={importBusy} maxWidthClass="max-w-xl">
          <SettingsForm label="Import RGW accounts" presentation="dialog" busy={importBusy} onSubmit={submitImport}
            submitDisabled={importPermissionLoading || !importEndpointCanWrite}
            onCancel={importCloseGuard.requestClose} submitLabel="Import" busyLabel="Importing...">
            <div className="settings-fields settings-form">
              <p className="settings-body text-[var(--ui-text-muted)]">Enter RGW tenant IDs, one per line. The platform will ensure a root user exists and retrieve keys.</p>
              <UiTextarea label="RGW tenant IDs" name="importText" rows={6} required value={importText}
                error={importValidation.errors.importText} placeholder="RGW00000000000000001"
                onChange={event => setImportText(event.target.value)} />
              <AdminRgwEndpointField label="Ceph endpoint" value={importTenantEndpointId}
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
        account={editingS3Account} portalEnabled={portalEnabled} canManagePrivilegedTargets={canManagePrivilegedTargets}
        onClose={closeAccountEditor} onSaved={accountSaved} onStateChange={setEditorState} />}
      {accountSwitchGuard.confirmationDialog}

      <ListPageSection
        variant="page"
        mobileSort={<TableSortControls columns={accountTableColumns} sort={{ field: sort.field, direction: sort.direction, onSort: toggleSort }} />}
          title="RGW Accounts"
          countLabel={`${totalAccounts} entr${totalAccounts === 1 ? "y" : "ies"}`}
          search={
            <ToolbarSearchInput
              value={filter}
              onChange={handleFilterChange}
              placeholder="Search by name, RGW ID, user email, group, or tag"
              className="w-full sm:w-64 md:w-72"
              active={quickFilterActive}
              matchMode={quickFilterMode}
              onToggleMatchMode={toggleQuickFilterMode}
            />
          }
          secondaryContent={
            quickFilterActive ? (
              <ActiveFiltersBar
                label="Active filters summary"
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
