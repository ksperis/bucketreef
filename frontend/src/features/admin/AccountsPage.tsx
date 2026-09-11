/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import TableSortControls from "../../components/list/TableSortControls";
import { ListActions, ListActionButton } from "../../components/list/ListControls";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import UiButton from "../../components/ui/UiButton";
import {
  AccountGroupLink,
  AccountUserLink,
  S3Account,
  S3AccountSummary,
  createS3Account,
  deleteS3Account,
  fetchAccountPortalSettings,
  getS3Account,
  importS3Accounts,
  listS3Accounts,
  updateAccountPortalSettings,
  updateS3Account,
} from "../../api/accounts";
import {
  defaultAccountAccessGrant,
  getAccountAccessRequiredMessage,
  hasAccountAccessRole,
  type AccountAccessGrant,
} from "../../api/accountAccess";
import type { PortalAccountSettings } from "../../api/portalAccounts";
import { getStorageEndpoint, listStorageEndpoints, StorageEndpoint } from "../../api/storageEndpoints";
import { listMinimalGroups, type UiGroupSummary } from "../../api/groups";
import { listMinimalUsers, UserSummary } from "../../api/users";
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
import WorkflowPage, {
  WorkflowActions,
  WorkflowMetadata,
  WorkflowSection,
  workflowPageHostClass,
} from "../../components/WorkflowPage";
import WorkflowTabs from "../../components/WorkflowTabs";
import ListPageSection from "../../components/list/ListPageSection";
import PageHeader from "../../components/PageHeader";
import ToolbarSearchInput from "../../components/ToolbarSearchInput";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import PageBanner from "../../components/PageBanner";
import AccountAccessRoleSelectors, {
  AccountAccessRoleValidationMessage,
  ManagerAccountRoleSelect,
  PortalAccountRoleSelect,
} from "./AccountAccessRoleSelectors";
import ProjectSettingsEditor, { type ProjectSettingsAdapter } from "../shared/ProjectSettingsEditor";
import SettingsNavigationGuard from "../../components/settings/SettingsNavigationGuard";
import { useSettingsCloseGuard } from "../../components/settings/SettingsControls";
import StorageUsageCard from "../../components/StorageUsageCard";
import DataTableShell, {
  dataTableDefaultActionProps,
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import UiTagBadgeList from "../../components/UiTagBadgeList";
import UiTagEditor from "../../components/UiTagEditor";
import { resolveListTableStatus } from "../../components/list/listTableStatus";

import { useTagCatalog } from "../../hooks/useTagCatalog";
import { useAdminAccountStats } from "./useAdminAccountStats";
import {
  AssociationPrincipalStack,
  type AssociationPrincipalItem,
} from "./AssociationSummary";
import { AdminAccessToggleSection } from "./AdminAccessSections";
import AdminQuotaFields from "./AdminQuotaFields";
import { buildAdminQuotaSizeEditorValue } from "./adminQuotaForm";
import { AdminAssociationPickerPanel, AdminAssociationSectionHeader, adminAssociationPanelClass, adminAssociationAccountOptionRowClass, adminAssociationCheckboxClass, adminAssociationOptionLabelClass, adminAssociationTableContainerClass as associationTableContainerClass } from "./AdminAssociationPicker";
import AdminAssociationAdvancedSettings from "./AdminAssociationAdvancedSettings";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { extractApiError } from "../../utils/apiError";
import { stableSignature } from "../../utils/stableSignature";
import { nextSortState } from "../../utils/sortValues";
import { matchesExactTextCandidate, type TextMatchMode } from "../../utils/textMatch";
import { isAdminLikeRole, readStoredUser } from "../../utils/workspaces";
import { buildUiTagItems, extractUiTagLabels, normalizeUiTags, type UiTagDefinition } from "../../utils/uiTags";

type SortField = "name" | "rgw_account_id";
type EditTab = "general" | "users" | "groups" | "privileged" | "portal";
const adminSettingsSnapshot = (value: PortalAccountSettings) => ({
  ...value, project_override: value.admin_override, can_update: true,
});
const adminPortalSettingsAdapter: ProjectSettingsAdapter = {
  load: async (id) => adminSettingsSnapshot(await fetchAccountPortalSettings(Number(id))),
  save: async (id, payload) => adminSettingsSnapshot(await updateAccountPortalSettings(Number(id), payload)),
};

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
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [groups, setGroups] = useState<UiGroupSummary[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [storageEndpoints, setStorageEndpoints] = useState<StorageEndpoint[]>([]);
  const [loadingEndpoints, setLoadingEndpoints] = useState(false);
  const [endpointsLoaded, setEndpointsLoaded] = useState(false);
  const [endpointAccountsWrite, setEndpointAccountsWrite] = useState<Record<number, boolean>>({});
  const [endpointBucketsWrite, setEndpointBucketsWrite] = useState<Record<number, boolean>>({});
  const [endpointPermissionLoading, setEndpointPermissionLoading] = useState<Record<number, boolean>>({});
  const [endpointPermissionErrors, setEndpointPermissionErrors] = useState<Record<number, string | null>>({});
  const [importTenantEndpointId, setImportTenantEndpointId] = useState<string>("");
  const [importInitialSignature, setImportInitialSignature] = useState("");
  const [editingS3Account, setEditingS3Account] = useState<S3Account | null>(null);
  const [editForm, setEditForm] = useState({
    tags: [] as UiTagDefinition[],
    quota_max_size_gb: "",
    quota_max_size_unit: "GiB",
    quota_max_objects: "",
    user_links: [] as AccountUserLink[],
    group_links: [] as AccountGroupLink[],
    allow_bucket_quota_management: false,
  });
  const [editInitialSignature, setEditInitialSignature] = useState("");
  const [editTab, setEditTab] = useState<EditTab>("general");
  const [portalDirty, setPortalDirty] = useState(false);
  const [deletingS3AccountId, setDeletingS3AccountId] = useState<number | null>(null);
  const [accountToDelete, setS3AccountToDelete] = useState<S3Account | null>(null);
  const [deleteFromRgw, setDeleteFromRgw] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [groupSearch, setGroupSearch] = useState("");
  const [showUserPanel, setShowUserPanel] = useState(false);
  const [showGroupPanel, setShowGroupPanel] = useState(false);
  const [userSelections, setUserSelections] = useState<number[]>([]);
  const [groupSelections, setGroupSelections] = useState<number[]>([]);
  const [userAccountAccessChoice, setUserAccountAccessChoice] = useState<
    Record<number, AccountAccessGrant>
  >({});
  const [groupAccountAccessChoice, setGroupAccountAccessChoice] = useState<
    Record<number, AccountAccessGrant>
  >({});
  const MAX_LINK_OPTIONS = 10;
  const currentUser = useMemo(() => readStoredUser(), []);
  const isSuperAdmin = isAdminLikeRole(currentUser?.role);
  const canManagePrivilegedTargets = isAdminLikeRole(currentUser?.role);
  const editingAccountId = editingS3Account?.id ?? null;
  const editingCapabilities = editingS3Account?.storage_endpoint_capabilities ?? null;
  const editingEndpointId = editingS3Account?.storage_endpoint_id ?? null;
  const editingEndpointCanWrite = editingEndpointId ? endpointAccountsWrite[editingEndpointId] === true : false;
  const editingEndpointCanWriteBuckets = editingEndpointId ? endpointBucketsWrite[editingEndpointId] === true : false;
  const usageEnabled = Boolean(editingCapabilities?.usage);
  const adminEnabled = Boolean(editingCapabilities?.admin);
  const hasUsageIdentity = Boolean(editingS3Account?.rgw_account_id);
  const allowUsageStats = usageEnabled && hasUsageIdentity;
  const allowQuotaUpdates =
    adminEnabled &&
    editingEndpointCanWrite &&
    Boolean(editingS3Account?.rgw_account_id);
  const showGeneralTab = editTab === "general";
  const showUsersTab = editTab === "users";
  const showGroupsTab = editTab === "groups";
  const showPrivilegedTab = editTab === "privileged";
  const showPortalTab = portalEnabled && editTab === "portal";
  const {
    catalog: adminTagCatalog,
    loading: adminTagCatalogLoading,
    error: adminTagCatalogError,
  } = useTagCatalog(
    { kind: "admin", domain: "admin_managed" },
    Boolean(isSuperAdmin && (showCreateModal || editingS3Account))
  );
  const {
    stats: editingUsageStats,
    loading: editingUsageLoading,
    error: editingUsageError,
  } = useAdminAccountStats(editingAccountId, Boolean(editingAccountId && isSuperAdmin && allowUsageStats));
  const toggleUserSelection = (userId: number) => {
    setUserSelections((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };
  const toggleGroupSelection = (groupId: number) => {
    setGroupSelections((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  };

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

  const userOptions = useMemo(() => users.map((u) => ({ id: u.id, label: u.email })), [users]);
  const userLabelById = useMemo(() => {
    const map = new Map<number, string>();
    users.forEach((u) => map.set(u.id, u.email));
    return map;
  }, [users]);
  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const groupLabelById = useMemo(() => {
    const map = new Map<number, string>();
    groups.forEach((group) => map.set(group.id, group.name));
    return map;
  }, [groups]);
  const groupsById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const assignedUsers = useMemo(() => {
    return editForm.user_links.map((link) => ({
      id: link.user_id,
      label: link.user_email ?? userLabelById.get(link.user_id) ?? `User #${link.user_id}`,
      manager_role: link.manager_role,
      portal_role: link.portal_role,
      allow_manager_browser_data_access: Boolean(link.allow_manager_browser_data_access),
    }));
  }, [editForm.user_links, userLabelById]);
  const assignedGroups = useMemo(() => {
    return editForm.group_links.map((link) => ({
      id: link.group_id,
      label: link.group_name ?? groupLabelById.get(link.group_id) ?? `Group #${link.group_id}`,
      manager_role: link.manager_role,
      portal_role: link.portal_role,
      allow_manager_browser_data_access: Boolean(link.allow_manager_browser_data_access),
    }));
  }, [editForm.group_links, groupLabelById]);
  const showUserPortalRoleColumn = portalEnabled;
  const showGroupPortalRoleColumn = portalEnabled;
  const availableUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    const selectedIds = new Set(editForm.user_links.map((link) => link.user_id));
    return userOptions.filter(
      (u) => !selectedIds.has(u.id) && (!query || u.label.toLowerCase().includes(query))
    );
  }, [editForm.user_links, userOptions, userSearch]);
  const availableGroups = useMemo(() => {
    const query = groupSearch.trim().toLowerCase();
    const selectedIds = new Set(editForm.group_links.map((link) => link.group_id));
    return groups.filter(
      (group) => !selectedIds.has(group.id) && (!query || group.name.toLowerCase().includes(query))
    );
  }, [editForm.group_links, groupSearch, groups]);
  const visibleAvailableUsers = useMemo(
    () => availableUsers.slice(0, MAX_LINK_OPTIONS),
    [availableUsers]
  );
  const visibleAvailableGroups = useMemo(
    () => availableGroups.slice(0, MAX_LINK_OPTIONS),
    [availableGroups]
  );

  useEffect(() => {
    if (!portalEnabled && editTab === "portal") setEditTab("general");
  }, [editTab, portalEnabled]);

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

  const loadUsersIfNeeded = useCallback(async () => {
    if (usersLoaded || loadingUsers) return;
    setLoadingUsers(true);
    try {
      const data = await listMinimalUsers();
      setUsers(data);
      setUsersLoaded(true);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingUsers(false);
    }
  }, [loadingUsers, usersLoaded]);

  const loadGroupsIfNeeded = useCallback(async () => {
    if (groupsLoaded || loadingGroups) return;
    setLoadingGroups(true);
    try {
      const data = await listMinimalGroups();
      setGroups(data);
      setGroupsLoaded(true);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingGroups(false);
    }
  }, [groupsLoaded, loadingGroups]);

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
        setEndpointBucketsWrite((prev) => ({
          ...prev,
          [endpointId]: Boolean(endpoint.admin_ops_permissions?.buckets_write),
        }));
        setEndpointPermissionErrors((prev) => ({ ...prev, [endpointId]: null }));
      } catch (err) {
        setEndpointAccountsWrite((prev) => ({ ...prev, [endpointId]: false }));
        setEndpointBucketsWrite((prev) => ({ ...prev, [endpointId]: false }));
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

  useEffect(() => {
    if (!editingEndpointId) return;
    if (Object.prototype.hasOwnProperty.call(endpointAccountsWrite, editingEndpointId)) return;
    void fetchEndpointAccountsWritePermission(editingEndpointId);
  }, [editingEndpointId, endpointAccountsWrite, fetchEndpointAccountsWritePermission]);

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
      const user = usersById.get(link.user_id);
      return {
        id: link.user_id,
        kind: "user",
        label: link.user_full_name || user?.full_name || link.user_email || user?.email || `User #${link.user_id}`,
        email: link.user_email || user?.email,
        avatar: link.user_avatar || user?.avatar,
        manager_role: link.manager_role,
        portal_role: link.portal_role,
      };
    });
    const groupItems: AssociationPrincipalItem[] = account.group_links.map((link) => {
      const group = groupsById.get(link.group_id);
      return {
        id: link.group_id,
        kind: "group",
        label: link.group_name || group?.name || `Group #${link.group_id}`,
        avatar: link.group_avatar || group?.avatar,
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
  const accountOpenRequest = useRef(0);
  useEffect(() => () => { accountOpenRequest.current += 1; }, []);
  const closeEditS3AccountModal = () => {
    accountOpenRequest.current += 1;
    setEditingS3Account(null);
    setEditTab("general");
    setUserSearch("");
    setGroupSearch("");
    setShowUserPanel(false);
    setShowGroupPanel(false);
    setUserSelections([]);
    setGroupSelections([]);
    setUserAccountAccessChoice({});
    setGroupAccountAccessChoice({});
    setEditInitialSignature("");
    setPortalDirty(false);
  };
  const editCurrentSignature = useMemo(
    () => stableSignature({ editForm: { ...editForm, tags: normalizeUiTags(editForm.tags) } }),
    [editForm]
  );
  const editDirty = Boolean(editingS3Account && editInitialSignature && editCurrentSignature !== editInitialSignature);
  const currentEdit = useRef({ portalDirty, signature: editCurrentSignature });
  currentEdit.current = { portalDirty, signature: editCurrentSignature };
  const editCloseGuard = useSettingsCloseGuard({
    hasUnsavedChanges: editDirty || portalDirty,
    onClose: closeEditS3AccountModal,
  });
  const pendingAccount = useRef<S3Account | S3AccountSummary | null>(null);
  const accountSwitchGuard = useSettingsCloseGuard({
    hasUnsavedChanges: editDirty || portalDirty,
    onClose: () => { if (pendingAccount.current) void openEditS3Account(pendingAccount.current); },
  });
  const startEditS3Account = (account: S3Account | S3AccountSummary) => {
    pendingAccount.current = account;
    accountSwitchGuard.requestClose();
  };

  const openEditS3Account = async (account: S3Account | S3AccountSummary) => {
    const request = ++accountOpenRequest.current;
    setActionError(null);
    setActionMessage(null);
    setUserAccountAccessChoice({});
    setGroupAccountAccessChoice({});
    void loadUsersIfNeeded();
    void loadGroupsIfNeeded();
    void loadEndpointsIfNeeded();
    const detail = await loadAccountDetail(account);
    if (!detail || request !== accountOpenRequest.current) return;
    const quota = buildAdminQuotaSizeEditorValue(detail.quota_max_size_gb);
    const nextEditForm = {
      tags: normalizeUiTags(detail.tags),
      quota_max_size_gb: quota.value,
      quota_max_size_unit: quota.unit,
      quota_max_objects: detail.quota_max_objects != null ? String(detail.quota_max_objects) : "",
      allow_bucket_quota_management: Boolean(detail.allow_bucket_quota_management),
      user_links:
        detail.user_links?.map((link) => ({
          user_id: link.user_id,
          manager_role: link.manager_role,
          portal_role: link.portal_role,
          user_email: link.user_email ?? undefined,
          allow_manager_browser_data_access: Boolean(link.allow_manager_browser_data_access),
        })) ?? [],
      group_links:
        detail.group_links?.map((link) => ({
          group_id: link.group_id,
          group_name: link.group_name ?? undefined,
          manager_role: link.manager_role,
          portal_role: link.portal_role,
          allow_manager_browser_data_access: Boolean(link.allow_manager_browser_data_access),
        })) ?? [],
    };
    setEditingS3Account(detail);
    setEditForm(nextEditForm);
    setEditInitialSignature(stableSignature({ editForm: { ...nextEditForm, tags: normalizeUiTags(nextEditForm.tags) } }));
    setUserSearch("");
    setGroupSearch("");
    setShowUserPanel(false);
    setShowGroupPanel(false);
    setUserSelections([]);
    setGroupSelections([]);
    setEditTab("general");
  };

  const submitEditS3Account = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingS3Account) return;
    const invalidUserLink = editForm.user_links.some(
      (link) => !hasAccountAccessRole(link),
    );
    const invalidGroupLink = editForm.group_links.some(
      (link) => !hasAccountAccessRole(link),
    );
    if (invalidUserLink || invalidGroupLink) {
      setEditTab(invalidUserLink ? "users" : "groups");
      setActionError(getAccountAccessRequiredMessage(portalEnabled));
      setActionMessage(null);
      return;
    }
    const targetId = editingS3Account.id;
    const request = accountOpenRequest.current;
    setActionError(null);
    setActionMessage(null);
    try {
      const payload = {
        user_links: editForm.user_links,
        group_links: editForm.group_links,
        tags: normalizeUiTags(editForm.tags),
        ...(canManagePrivilegedTargets
          ? { allow_bucket_quota_management: editForm.allow_bucket_quota_management }
          : {}),
        ...(allowQuotaUpdates
          ? {
              quota_max_size_gb: editForm.quota_max_size_gb !== "" ? Number(editForm.quota_max_size_gb) : null,
              quota_max_size_unit: editForm.quota_max_size_gb !== "" ? editForm.quota_max_size_unit : null,
              quota_max_objects: editForm.quota_max_objects !== "" ? Number(editForm.quota_max_objects) : null,
            }
          : {}),
      };
      await updateS3Account(targetId, payload);
      if (request !== accountOpenRequest.current) return;
      if (!currentEdit.current.portalDirty && currentEdit.current.signature === editCurrentSignature) closeEditS3AccountModal();
      else setEditInitialSignature(editCurrentSignature);
      const completedRequest = accountOpenRequest.current;
      await fetchS3Accounts();
      if (completedRequest === accountOpenRequest.current) setActionMessage("S3Account updated");
    } catch (err) {
      if (request === accountOpenRequest.current) setActionError(extractError(err));
    }
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

      {isSuperAdmin && editingS3Account && (
        <WorkflowPage
          title={`Edit ${editingS3Account.name}`}
          description="Manage quotas, usage, UI associations, privileged access, and Portal overrides for this account."
          breadcrumbs={adminPageBreadcrumbs("accounts", { label: "Edit" })}
          backLabel="Back to accounts"
          onBack={editCloseGuard.requestClose}
          contentVariant="plain"
          width="wide"
          metaContent={
            <WorkflowMetadata
              items={[
                {
                  label: "RGW ID",
                  value: editingS3Account.rgw_account_id,
                },
                {
                  label: "Endpoint",
                  value: editingS3Account.storage_endpoint_name ?? "—",
                  title: editingS3Account.storage_endpoint_url || undefined,
                },
              ]}
            />
          }
        >
          {actionError && (
            <PageBanner tone="error" className="mb-3">
              {actionError}
            </PageBanner>
          )}
          <div className="space-y-4">
            <WorkflowTabs<EditTab>
              panelClassName={editTab === "users" || editTab === "groups" ? adminAssociationPanelClass : undefined}
              activeTab={editTab}
              onTabChange={(tab) => {
                if (tab === "users") {
                  void loadUsersIfNeeded();
                }
                if (tab === "groups") {
                  void loadGroupsIfNeeded();
                }
                setEditTab(tab);
              }}
              ariaLabel="RGW account configuration sections"
              idPrefix="admin-rgw-account-edit"
              tabs={[
                { id: "general", label: "General" },
                { id: "users", label: "Linked UI users" },
                { id: "groups", label: "Linked UI groups" },
                { id: "privileged", label: "Privileged access", visible: canManagePrivilegedTargets },
                { id: "portal", label: "Portal settings", visible: portalEnabled && isSuperAdmin },
              ]}
            >
            <form id="rgw-account-edit" onSubmit={submitEditS3Account}>
            {showGeneralTab && (
                <>
                  <WorkflowSection
                    title="Account details"
                    description="Use administrative tags to make this account easier to find and organize."
                  >
                    {adminTagCatalogError && <PageBanner tone="warning">{adminTagCatalogError}</PageBanner>}
                    <UiTagEditor
                      label="Tags"
                      tags={editForm.tags}
                      catalog={adminTagCatalog}
                      onChange={(tags) => setEditForm((prev) => ({ ...prev, tags }))}
                      placeholder="Add a tag for this account"
                      hint={adminTagCatalogLoading ? "Loading existing tag catalog..." : undefined}
                    />
                  </WorkflowSection>
                  <StorageUsageCard
                    accountName={editingS3Account.name}
                    storage={{
                      used: editingUsageStats?.total_bytes ?? null,
                      quotaBytes:
                        editingS3Account.quota_max_size_gb != null
                          ? editingS3Account.quota_max_size_gb * 1024 ** 3
                          : null,
                    }}
                    objects={{
                      used: editingUsageStats?.total_objects ?? null,
                      quota: editingS3Account.quota_max_objects ?? null,
                    }}
                    bucketOverview={editingUsageStats?.bucket_overview}
                    loading={editingUsageLoading}
                    metricsDisabled={!allowUsageStats}
                    errorMessage={editingUsageError}
                  />
                  <AdminQuotaFields
                    storageValue={editForm.quota_max_size_gb}
                    storageUnit={editForm.quota_max_size_unit}
                    objectValue={editForm.quota_max_objects}
                    disabled={!allowQuotaUpdates}
                    onStorageValueChange={(value) =>
                      setEditForm((prev) => ({ ...prev, quota_max_size_gb: value }))
                    }
                    onStorageUnitChange={(value) =>
                      setEditForm((prev) => ({ ...prev, quota_max_size_unit: value }))
                    }
                    onObjectValueChange={(value) =>
                      setEditForm((prev) => ({ ...prev, quota_max_objects: value }))
                    }
                  />
                </>
              )}
              {showUsersTab && (
                <div className="space-y-3">
                  <AdminAssociationSectionHeader
                    title="Linked UI users"
                    countLabel={`${assignedUsers.length} linked${loadingUsers ? " · loading..." : ""}`}
                    actionLabel={showUserPanel ? "Close" : "Add UI users"}
                    onAction={() => {
                      if (!showUserPanel) {
                        void loadUsersIfNeeded();
                      }
                      setShowUserPanel((prev) => !prev);
                    }}
                  />
                  <div className={associationTableContainerClass}>
                    <table className="ui-data-table">
                      <thead>
                        <tr>
                          <th className="text-left">
                            User
                          </th>
                          <th className="text-left">Manager role</th>
                          {showUserPortalRoleColumn ? (
                            <th className="text-left">
                              Portal role
                            </th>
                          ) : null}
                          <th className="w-px whitespace-nowrap text-right">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {assignedUsers.length === 0 ? (
                          <tr>
                            <td
                              colSpan={3 + Number(showUserPortalRoleColumn)}
                              className="ui-table-secondary"
                            >
                              No linked users yet.
                            </td>
                          </tr>
                        ) : (
                          assignedUsers.map((u) => {
                            const accessErrorId = `account-user-access-${u.id}-error`;
                            const invalid = !hasAccountAccessRole(u);
                            const updateAccess = (value: AccountAccessGrant) =>
                              setEditForm((prev) => ({
                                ...prev,
                                user_links: prev.user_links.map((link) =>
                                  link.user_id === u.id ? { ...link, ...value } : link
                                ),
                              }));
                            return (
                              <tr key={u.id}>
                                <td className="ui-table-primary">
                                  {u.label}
                                  <AccountAccessRoleValidationMessage
                                    id={accessErrorId}
                                    value={u}
                                    portalEnabled={portalEnabled}
                                  />
                                </td>
                                <td>
                                  <ManagerAccountRoleSelect
                                    label={u.label}
                                    portalEnabled={portalEnabled}
                                    value={u}
                                    onChange={updateAccess}
                                    showLabel={false}
                                    invalid={invalid}
                                    describedBy={invalid ? accessErrorId : undefined}
                                  />
                                </td>
                                {showUserPortalRoleColumn ? (
                                  <td>
                                    <PortalAccountRoleSelect
                                      label={u.label}
                                      portalEnabled={portalEnabled}
                                      value={u}
                                      onChange={updateAccess}
                                      showLabel={false}
                                      invalid={invalid}
                                      describedBy={invalid ? accessErrorId : undefined}
                                    />
                                  </td>
                                ) : null}
                                <td className="ui-table-actions-cell w-px text-right">
                                  {u.manager_role ? (
                                    <AdminAssociationAdvancedSettings
                                      targetLabel={u.label}
                                      associationKind="account"
                                      allowManagerBrowserDataAccess={
                                        u.allow_manager_browser_data_access
                                      }
                                      onApply={(allowed) =>
                                        setEditForm((prev) => ({
                                          ...prev,
                                          user_links: prev.user_links.map((link) =>
                                            link.user_id === u.id
                                              ? {
                                                  ...link,
                                                  allow_manager_browser_data_access: allowed,
                                                }
                                              : link,
                                          ),
                                        }))
                                      }
                                    />
                                  ) : null}
                                  <ListActionButton
                                    type="button"
                                    onClick={() =>
                                      setEditForm((prev) => ({
                                        ...prev,
                                        user_links: prev.user_links.filter(
                                          (link) => link.user_id !== u.id,
                                        ),
                                      }))
                                    }
                                     variant="danger"
                                  >
                                    Remove
                                  </ListActionButton>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                  {showUserPanel && (
                    <AdminAssociationPickerPanel
                      title="Add UI users"
                      hint="(filter by email)"
                      search={userSearch}
                      onSearchChange={setUserSearch}
                      searchAriaLabel="Search UI users"
                      loading={loadingUsers}
                      availableCount={availableUsers.length}
                      maxVisibleOptions={MAX_LINK_OPTIONS}
                      selectedCount={userSelections.length}
                      loadingLabel="Loading UI users..."
                      onCancel={() => {
                        setShowUserPanel(false);
                        setUserSelections([]);
                        setUserSearch("");
                      }}
                      onAdd={() => {
                        if (userSelections.length === 0) return;
                        const toAdd = userSelections.map((id) => ({
                          user_id: id,
                          ...(userAccountAccessChoice[id] ??
                            defaultAccountAccessGrant(portalEnabled)),
                          user_email: userLabelById.get(id) ?? undefined,
                          allow_manager_browser_data_access: false,
                        }));
                        setEditForm((prev) => ({
                          ...prev,
                          user_links: [...prev.user_links, ...toAdd],
                        }));
                        setShowUserPanel(false);
                        setUserSelections([]);
                        setUserSearch("");
                      }}
                      addDisabled={
                        userSelections.length === 0 ||
                        userSelections.some(
                          (id) =>
                            !hasAccountAccessRole(
                              userAccountAccessChoice[id] ??
                                defaultAccountAccessGrant(portalEnabled),
                            ),
                        )
                      }
                    >
                        {visibleAvailableUsers.map((u) => {
                          const isSelected = userSelections.includes(u.id);
                          const access =
                            userAccountAccessChoice[u.id] ??
                            defaultAccountAccessGrant(portalEnabled);
                          return (
                            <div
                              key={u.id}
                              className={adminAssociationAccountOptionRowClass(isSelected)}
                            >
                              <label className={adminAssociationOptionLabelClass}>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleUserSelection(u.id)}
                                  className={adminAssociationCheckboxClass}
                                />
                                <span>{u.label}</span>
                              </label>
                              <div className="flex flex-wrap items-center gap-2">
                                <AccountAccessRoleSelectors
                                  label={u.label}
                                  portalEnabled={portalEnabled}
                                  value={access}
                                  onChange={(value) =>
                                    setUserAccountAccessChoice((prev) => ({
                                      ...prev,
                                      [u.id]: value,
                                    }))
                                  }
                                />
                              </div>
                            </div>
                          );
                        })}
                    </AdminAssociationPickerPanel>
                  )}
                </div>
              )}
              {showGroupsTab && (
                <div className="space-y-3">
                  <AdminAssociationSectionHeader
                    title="Linked UI groups"
                    countLabel={`${assignedGroups.length} linked${loadingGroups ? " · loading..." : ""}`}
                    actionLabel={showGroupPanel ? "Close" : "Add UI groups"}
                    onAction={() => {
                      if (!showGroupPanel) {
                        void loadGroupsIfNeeded();
                      }
                      setShowGroupPanel((prev) => !prev);
                    }}
                  />
                  <div className={associationTableContainerClass}>
                    <table className="ui-data-table">
                      <thead>
                        <tr>
                          <th className="text-left">
                            Group
                          </th>
                          <th className="text-left">Manager role</th>
                          {showGroupPortalRoleColumn ? (
                            <th className="text-left">
                              Portal role
                            </th>
                          ) : null}
                          <th className="w-px whitespace-nowrap text-right">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {assignedGroups.length === 0 ? (
                          <tr>
                            <td
                              colSpan={3 + Number(showGroupPortalRoleColumn)}
                              className="ui-table-secondary"
                            >
                              No linked groups yet.
                            </td>
                          </tr>
                        ) : (
                          assignedGroups.map((group) => {
                            const accessErrorId = `account-group-access-${group.id}-error`;
                            const invalid = !hasAccountAccessRole(group);
                            const updateAccess = (value: AccountAccessGrant) =>
                              setEditForm((prev) => ({
                                ...prev,
                                group_links: prev.group_links.map((link) =>
                                  link.group_id === group.id ? { ...link, ...value } : link
                                ),
                              }));
                            return (
                              <tr key={group.id}>
                                <td className="ui-table-primary">
                                  {group.label}
                                  <AccountAccessRoleValidationMessage
                                    id={accessErrorId}
                                    value={group}
                                    portalEnabled={portalEnabled}
                                  />
                                </td>
                                <td>
                                  <ManagerAccountRoleSelect
                                    label={group.label}
                                    portalEnabled={portalEnabled}
                                    value={group}
                                    onChange={updateAccess}
                                    showLabel={false}
                                    invalid={invalid}
                                    describedBy={invalid ? accessErrorId : undefined}
                                  />
                                </td>
                                {showGroupPortalRoleColumn ? (
                                  <td>
                                    <PortalAccountRoleSelect
                                      label={group.label}
                                      portalEnabled={portalEnabled}
                                      value={group}
                                      onChange={updateAccess}
                                      showLabel={false}
                                      invalid={invalid}
                                      describedBy={invalid ? accessErrorId : undefined}
                                    />
                                  </td>
                                ) : null}
                                <td className="ui-table-actions-cell w-px text-right">
                                  {group.manager_role ? (
                                    <AdminAssociationAdvancedSettings
                                      targetLabel={group.label}
                                      associationKind="account"
                                      allowManagerBrowserDataAccess={
                                        group.allow_manager_browser_data_access
                                      }
                                      onApply={(allowed) =>
                                        setEditForm((prev) => ({
                                          ...prev,
                                          group_links: prev.group_links.map((link) =>
                                            link.group_id === group.id
                                              ? {
                                                  ...link,
                                                  allow_manager_browser_data_access: allowed,
                                                }
                                              : link,
                                          ),
                                        }))
                                      }
                                    />
                                  ) : null}
                                  <ListActionButton
                                    type="button"
                                    onClick={() =>
                                      setEditForm((prev) => ({
                                        ...prev,
                                        group_links: prev.group_links.filter(
                                          (link) => link.group_id !== group.id,
                                        ),
                                      }))
                                    }
                                     variant="danger"
                                  >
                                    Remove
                                  </ListActionButton>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                  {showGroupPanel && (
                    <AdminAssociationPickerPanel
                      title="Add UI groups"
                      hint="(filter by name)"
                      search={groupSearch}
                      onSearchChange={setGroupSearch}
                      searchAriaLabel="Search UI groups"
                      loading={loadingGroups}
                      availableCount={availableGroups.length}
                      maxVisibleOptions={MAX_LINK_OPTIONS}
                      selectedCount={groupSelections.length}
                      loadingLabel="Loading UI groups..."
                      onCancel={() => {
                        setShowGroupPanel(false);
                        setGroupSelections([]);
                        setGroupSearch("");
                      }}
                      onAdd={() => {
                        if (groupSelections.length === 0) return;
                        const toAdd = groupSelections.map((id) => ({
                          group_id: id,
                          group_name: groupLabelById.get(id) ?? undefined,
                          allow_manager_browser_data_access: false,
                          ...(groupAccountAccessChoice[id] ??
                            defaultAccountAccessGrant(portalEnabled)),
                        }));
                        setEditForm((prev) => ({
                          ...prev,
                          group_links: [...prev.group_links, ...toAdd],
                        }));
                        setShowGroupPanel(false);
                        setGroupSelections([]);
                        setGroupSearch("");
                      }}
                      addDisabled={
                        groupSelections.length === 0 ||
                        groupSelections.some(
                          (id) =>
                            !hasAccountAccessRole(
                              groupAccountAccessChoice[id] ??
                                defaultAccountAccessGrant(portalEnabled),
                            ),
                        )
                      }
                    >
                        {visibleAvailableGroups.map((group) => {
                          const isSelected = groupSelections.includes(group.id);
                          const access =
                            groupAccountAccessChoice[group.id] ??
                            defaultAccountAccessGrant(portalEnabled);
                          return (
                            <div
                              key={group.id}
                              className={adminAssociationAccountOptionRowClass(isSelected)}
                            >
                              <label className={adminAssociationOptionLabelClass}>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleGroupSelection(group.id)}
                                  className={adminAssociationCheckboxClass}
                                />
                                <span>{group.name}</span>
                              </label>
                              <div className="flex flex-wrap items-center gap-2">
                                <AccountAccessRoleSelectors
                                  label={group.name}
                                  portalEnabled={portalEnabled}
                                  value={access}
                                  onChange={(value) =>
                                    setGroupAccountAccessChoice((prev) => ({
                                      ...prev,
                                      [group.id]: value,
                                    }))
                                  }
                                />
                              </div>
                            </div>
                          );
                        })}
                    </AdminAssociationPickerPanel>
                  )}
                </div>
              )}
              {canManagePrivilegedTargets && showPrivilegedTab && (
                <AdminAccessToggleSection
                  title="Privileged Ceph access"
                  description="Ceph admin-API actions granted directly to this account outside the Ceph Admin workspace."
                  items={[
                    {
                      title: "Bucket quota management",
                      description: editingEndpointCanWriteBuckets
                        ? "Allow Ceph bucket quota updates for this S3 Account in Manager."
                        : "Requires buckets=write on the endpoint Admin Ops identity before this grant can be enabled.",
                      ariaLabel: "Bucket quota management",
                      checked: editForm.allow_bucket_quota_management,
                      disabled: !editForm.allow_bucket_quota_management && !editingEndpointCanWriteBuckets,
                      onChange: (checked) =>
                        setEditForm((prev) => ({
                          ...prev,
                          allow_bucket_quota_management: checked,
                        })),
                    },
                  ]}
                />
              )}
              </form>
              {portalEnabled && isSuperAdmin && (
                <div hidden={!showPortalTab}>
                  <ProjectSettingsEditor key={editingS3Account.id}
                    accountId={String(editingS3Account.id)} projectName={editingS3Account.name}
                    adapter={adminPortalSettingsAdapter} admin navigationGuard={false}
                    onDirtyChange={setPortalDirty} />
                </div>
              )}
            </WorkflowTabs>
            {!showPortalTab && <WorkflowActions>
              <UiButton variant="secondary" onClick={editCloseGuard.requestClose}>
                Cancel
              </UiButton>
              <UiButton type="submit" form="rgw-account-edit">
                Save changes
              </UiButton>
            </WorkflowActions>}
            {editCloseGuard.confirmationDialog}
            {accountSwitchGuard.confirmationDialog}
            <SettingsNavigationGuard dirty={editDirty || portalDirty} />
          </div>
        </WorkflowPage>
      )}

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
