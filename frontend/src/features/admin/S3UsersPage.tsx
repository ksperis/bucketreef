/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import FeatureOverrideField from "../../components/settings/FeatureOverrideField";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  S3User,
  type S3UserGroupLinkInput,
  type S3UserUserLinkInput,
  createS3User,
  deleteS3User,
  getS3User,
  getS3UserWithBuckets,
  importS3Users,
  listS3Users,
  updateS3User,
} from "../../api/s3Users";
import { listStorageEndpoints } from "../../api/storageEndpoints";
import PageHeader from "../../components/PageHeader";
import { useAdminPageBreadcrumbs } from "./adminBreadcrumbs";
import SettingsForm from "../../components/settings/SettingsForm";
import { SettingsButton, SettingsDialog, SettingsPersistentEditActions } from "../../components/settings/SettingsControls";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import AdminRgwEndpointField from "./AdminRgwEndpointField";
import AdminRgwCreateFields from "./AdminRgwCreateFields";
import { useAdminRgwFormValidation, rgwCreateErrors, rgwImportEntries } from "./useAdminRgwFormValidation";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import WorkflowPage, {
  WorkflowMetadata,
  workflowPageHostClass,
} from "../../components/WorkflowPage";
import WorkflowTabs from "../../components/WorkflowTabs";
import PageBanner from "../../components/PageBanner";
import InlineSummary from "../../components/InlineSummary";
import UiTagEditor from "../../components/UiTagEditor";
import UsageTile from "../../components/UsageTile";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiInput from "../../components/ui/UiInput";
import UiTextarea from "../../components/ui/UiTextarea";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";

import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { equalSettings, useSettingsBaseline } from "../../components/settings/useSettingsDraft";
import { useTagCatalog } from "../../hooks/useTagCatalog";
import useLazyListLoader from "../../hooks/useLazyListLoader";
import { extractApiError } from "../../utils/apiError";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import { type TextMatchMode } from "../../utils/textMatch";
import { canonicalizeUiTags, normalizeUiTags, type UiTagDefinition } from "../../utils/uiTags";
import { isAdminLikeRole, readStoredUser } from "../../utils/workspaces";
import { adminAssociationPanelClass } from "./AdminAssociationPicker";
import AdminRgwUserAccessAssociationsPanel, {
  type AdminRgwUserAccessAssociationsState,
} from "./AdminRgwUserAccessAssociationsPanel";
import AdminQuotaFields from "./AdminQuotaFields";
import { buildAdminQuotaSizeEditorValue } from "./adminQuotaForm";
import { useAdminS3UserStats } from "./useAdminS3UserStats";
import { useAdminI18n } from "./adminI18n";
import AdminS3UsersList, { type AdminS3UsersSortField } from "./AdminS3UsersList";
import useAdminPaginatedListState from "./useAdminPaginatedListState";
import useAdminPaginatedListController from "./useAdminPaginatedListController";
import useAdminAssociationPickerState from "./useAdminAssociationPickerState";
import useAdminEndpointAdminOpsPermissions from "./useAdminEndpointAdminOpsPermissions";
import useAdminPrincipalCatalogs from "./useAdminPrincipalCatalogs";
import { adminS3UserForm, adminS3UserPayload, emptyAdminS3UserForm } from "./adminS3UserForm";
import {
  deriveAdminAssociationOptions,
  MAX_VISIBLE_ASSOCIATION_OPTIONS,
} from "./adminAssociationOptions";

type EditTab = "general" | "users" | "groups" | "manager";

const buildS3UserFormDraft = <T extends { tags: UiTagDefinition[] }>(form: T) => ({
  ...form,
  tags: canonicalizeUiTags(form.tags),
});

const buildCreateS3UserDraft = <T extends { tags: UiTagDefinition[]; storage_endpoint_id: string }>(
  form: T,
  defaultEndpointId: string,
) => ({
  createForm: {
    ...buildS3UserFormDraft(form),
    storage_endpoint_id:
      form.storage_endpoint_id === defaultEndpointId ? "" : form.storage_endpoint_id,
  },
});

const buildImportS3UserDraft = (
  importText: string,
  importEndpointId: string,
  defaultEndpointId: string,
) => ({
  importText,
  importEndpointId: importEndpointId === defaultEndpointId ? "" : importEndpointId,
});

const buildEditS3UserDraft = <T extends { tags: UiTagDefinition[] }>(form: T) => ({
  editForm: buildS3UserFormDraft(form),
});

export default function S3UsersPage() {
  const { intlLocale, text: adminText } = useAdminI18n();
  const adminBreadcrumbs = useAdminPageBreadcrumbs();
  const { generalSettings } = useGeneralSettings();
  const managedTenantCreationEnabled = generalSettings.allow_managed_rgw_tenant_creation;
  const {
    users: portalUsers,
    groups: uiGroups,
    usersLoading: portalUsersLoading,
    groupsLoading: uiGroupsLoading,
    loadUsers: loadPortalUsersIfNeeded,
    loadGroups: loadGroupsIfNeeded,
    usersPagination,
    groupsPagination,
  } = useAdminPrincipalCatalogs();
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
  } = useAdminPaginatedListState<AdminS3UsersSortField>({
    initialSort: { field: "name", direction: "asc" },
  });
  const [quickFilterMode, setQuickFilterMode] = useState<TextMatchMode>("contains");
  const {
    items: storageEndpoints,
    loading: loadingEndpoints,
    ensure: ensureStorageEndpoints,
  } = useLazyListLoader(listStorageEndpoints);
  const formatEndpointPermissionError = useCallback(
    (error: unknown) => extractApiError(error, adminText("Unexpected error")),
    [adminText]
  );
  const {
    permissionsByEndpointId: endpointPermissions,
    loadingByEndpointId: endpointPermissionLoading,
    errorByEndpointId: endpointPermissionErrors,
    loadPermissions: loadEndpointPermissions,
  } = useAdminEndpointAdminOpsPermissions({ formatError: formatEndpointPermissionError });

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "",
    uid: "",
    rgw_tenant: "",
    email: "",
    tags: [] as UiTagDefinition[],
    quota_max_size_gb: "",
    quota_max_size_unit: "GiB",
    quota_max_objects: "",
    storage_endpoint_id: "",
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importEndpointId, setImportEndpointId] = useState("");

  const [editingUser, setEditingUser] = useState<S3User | null>(null);
  const [editForm, setEditForm] = useState(emptyAdminS3UserForm);
  const [editError, setEditError] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editTab, setEditTab] = useState<EditTab>("general");
  const portalUserPicker = useAdminAssociationPickerState();
  const groupPicker = useAdminAssociationPickerState();
  const [deleteBusyId, setDeleteBusyId] = useState<number | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const [userToDelete, setUserToDelete] = useState<S3User | null>(null);
  const [deleteFromRgw, setDeleteFromRgw] = useState(false);
  const [deleteModalError, setDeleteModalError] = useState<string | null>(null);
  const deleteModalBucketCountUnknown = userToDelete != null && userToDelete.bucket_count == null;
  const deleteModalHasResources = userToDelete != null && (userToDelete.bucket_count ?? 0) > 0;
  const deleteModalBlocksRgwDeletion = deleteModalBucketCountUnknown || deleteModalHasResources;
  const editingUserId = editingUser?.id ?? null;
  const {
    stats: editingUsageStats,
    loading: editingUsageLoading,
    error: editingUsageError,
    reload: editingUsageReload,
  } = useAdminS3UserStats(editingUserId, Boolean(editingUserId));
  const showEditGeneralTab = editTab === "general";
  const showEditUsersTab = editTab === "users";
  const showEditGroupsTab = editTab === "groups";
  const currentUser = useMemo(() => readStoredUser(), []);
  const canManageManagerFeatures = isAdminLikeRole(currentUser?.role);
  const showEditManagerTab = canManageManagerFeatures && editTab === "manager";
  const {
    catalog: adminTagCatalog,
    loading: adminTagCatalogLoading,
    error: adminTagCatalogError,
  } = useTagCatalog(
    { kind: "admin", domain: "admin_managed" },
    Boolean(showCreateModal || editingUser)
  );

  const loadUsersPage = useCallback(() => {
    const quick = filter.trim();
    return listS3Users({
      page,
      page_size: pageSize,
      search: quick || undefined,
      search_exact: quickFilterMode === "exact",
      sort_by: sort.field,
      sort_dir: sort.direction,
      include_quota: false,
    });
  }, [filter, quickFilterMode, page, pageSize, sort.direction, sort.field]);
  const formatUsersLoadError = useCallback(
    (loadError: unknown) => extractApiError(loadError, adminText("Unexpected error")),
    [adminText],
  );
  const {
    items: users,
    loading,
    error,
    total: totalUsers,
    refresh: fetchUsers,
  } = useAdminPaginatedListController({
    loadPage: loadUsersPage,
    ensurePageInRange,
    formatError: formatUsersLoadError,
  });

  const loadEndpointsIfNeeded = useCallback(
    () => ensureStorageEndpoints({ retryOnError: true }),
    [ensureStorageEndpoints],
  );

  const hasLinkedPortalUsers = useMemo(
    () => users.some((user) => (user.user_links?.length ?? 0) > 0),
    [users]
  );

  useEffect(() => {
    if (!hasLinkedPortalUsers) return;
    void loadPortalUsersIfNeeded();
  }, [hasLinkedPortalUsers, loadPortalUsersIfNeeded]);

  useEffect(() => {
    const setSearch = usersPagination.setSearch;
    setSearch(portalUserPicker.search);
  }, [portalUserPicker.search, usersPagination.setSearch]);

  useEffect(() => {
    const setSearch = groupsPagination.setSearch;
    setSearch(groupPicker.search);
  }, [groupPicker.search, groupsPagination.setSearch]);

  const portalUserOptions = useMemo(() => portalUsers.map((u) => ({ id: u.id, label: u.email })), [portalUsers]);
  const groupOptions = useMemo(
    () => uiGroups.map((group) => ({ id: group.id, label: group.name })),
    [uiGroups],
  );
  const portalUserLabelById = useMemo(
    () => new Map(portalUserOptions.map((option) => [option.id, option.label] as const)),
    [portalUserOptions],
  );
  const groupLabelById = useMemo(
    () => new Map(groupOptions.map((option) => [option.id, option.label] as const)),
    [groupOptions],
  );
  const { available: availablePortalUsers, visible: visiblePortalUsers } = useMemo(
    () =>
      deriveAdminAssociationOptions({
        items: portalUserOptions,
        selectedIds: new Set(editForm.user_links.map((link) => link.user_id)),
        search: portalUserPicker.search,
        getId: (option) => option.id,
        getLabel: (option) => option.label,
      }, usersPagination.pageSize),
    [editForm.user_links, portalUserOptions, portalUserPicker.search, usersPagination.pageSize],
  );
  const { available: availableGroups, visible: visibleGroups } = useMemo(
    () =>
      deriveAdminAssociationOptions({
        items: groupOptions,
        selectedIds: new Set(editForm.group_links.map((link) => link.group_id)),
        search: groupPicker.search,
        getId: (option) => option.id,
        getLabel: (option) => option.label,
      }, groupsPagination.pageSize),
    [editForm.group_links, groupOptions, groupPicker.search, groupsPagination.pageSize],
  );
  const editUserAssociationState: AdminRgwUserAccessAssociationsState<S3UserUserLinkInput> = {
    selected: editForm.user_links,
    setSelected: (value) =>
      setEditForm((current) => ({
        ...current,
        user_links:
          typeof value === "function"
            ? value(current.user_links)
            : value,
      })),
    getId: (link) => link.user_id,
    createLink: (id) => ({
      user_id: id,
      allow_manager_browser_data_access: false,
    }),
    withAccess: (link, allowed) => ({
      ...link,
      allow_manager_browser_data_access: allowed,
    }),
    labelById: portalUserLabelById,
    available: availablePortalUsers,
    visible: visiblePortalUsers,
    search: portalUserPicker.search,
    setSearch: portalUserPicker.setSearch,
    loading: portalUsersLoading,
    showPanel: portalUserPicker.open,
    setShowPanel: portalUserPicker.setOpen,
    selections: portalUserPicker.selections,
    setSelections: portalUserPicker.setSelections,
    toggleSelection: portalUserPicker.toggleSelection,
    pagination: {
      page: usersPagination.page,
      pageSize: usersPagination.pageSize,
      total: usersPagination.total,
      onPageChange: usersPagination.setPage,
      onPageSizeChange: usersPagination.setPageSize,
    },
  };
  const editGroupAssociationState: AdminRgwUserAccessAssociationsState<S3UserGroupLinkInput> = {
    selected: editForm.group_links,
    setSelected: (value) =>
      setEditForm((current) => ({
        ...current,
        group_links:
          typeof value === "function"
            ? value(current.group_links)
            : value,
      })),
    getId: (link) => link.group_id,
    createLink: (id) => ({
      group_id: id,
      allow_manager_browser_data_access: false,
    }),
    withAccess: (link, allowed) => ({
      ...link,
      allow_manager_browser_data_access: allowed,
    }),
    labelById: groupLabelById,
    available: availableGroups,
    visible: visibleGroups,
    search: groupPicker.search,
    setSearch: groupPicker.setSearch,
    loading: uiGroupsLoading,
    showPanel: groupPicker.open,
    setShowPanel: (value) =>
      groupPicker.setOpen((current) => {
        const next = typeof value === "function" ? value(current) : value;
        if (next && !current) {
          void loadGroupsIfNeeded();
        }
        return next;
      }),
    selections: groupPicker.selections,
    setSelections: groupPicker.setSelections,
    toggleSelection: groupPicker.toggleSelection,
    pagination: {
      page: groupsPagination.page,
      pageSize: groupsPagination.pageSize,
      total: groupsPagination.total,
      onPageChange: groupsPagination.setPage,
      onPageSizeChange: groupsPagination.setPageSize,
    },
  };
  const cephEndpoints = useMemo(() => storageEndpoints.filter((ep) => ep.provider === "ceph"), [storageEndpoints]);
  const adminCephEndpoints = useMemo(
    () => cephEndpoints.filter((ep) => Boolean(ep.capabilities.admin)),
    [cephEndpoints]
  );
  const defaultAdminCephEndpointId = useMemo(() => {
    const endpoint = adminCephEndpoints.find((candidate) => candidate.is_default) ?? adminCephEndpoints[0];
    return endpoint ? String(endpoint.id) : "";
  }, [adminCephEndpoints]);
  const editingEndpointId = editingUser?.storage_endpoint_id ?? null;
  const allowUserQuotaUpdates = editingEndpointId
    ? endpointPermissions[editingEndpointId]?.users_write === true
    : false;
  const editingEndpointCanWriteBuckets = editingEndpointId
    ? endpointPermissions[editingEndpointId]?.buckets_write === true
    : false;
  const editPermissionLoading = editingEndpointId ? Boolean(endpointPermissionLoading[editingEndpointId]) : false;
  const editPermissionError = editingEndpointId ? endpointPermissionErrors[editingEndpointId] ?? null : null;

  useEffect(() => {
    setCreateForm((prev) => ({
      ...prev,
      storage_endpoint_id: adminCephEndpoints.some((endpoint) => String(endpoint.id) === prev.storage_endpoint_id)
        ? prev.storage_endpoint_id
        : defaultAdminCephEndpointId,
    }));
    setImportEndpointId((prev) =>
      adminCephEndpoints.some((endpoint) => String(endpoint.id) === prev) ? prev : defaultAdminCephEndpointId
    );
  }, [adminCephEndpoints, defaultAdminCephEndpointId]);

  useEffect(() => {
    if (!showCreateModal) return;
    if (!createForm.storage_endpoint_id) return;
    const endpointId = Number(createForm.storage_endpoint_id);
    if (!Number.isFinite(endpointId) || endpointId <= 0) return;
    if (Object.prototype.hasOwnProperty.call(endpointPermissions, endpointId)) return;
    void loadEndpointPermissions(endpointId);
  }, [showCreateModal, createForm.storage_endpoint_id, endpointPermissions, loadEndpointPermissions]);

  useEffect(() => {
    if (!showImportModal) return;
    if (!importEndpointId) return;
    const endpointId = Number(importEndpointId);
    if (!Number.isFinite(endpointId) || endpointId <= 0) return;
    if (Object.prototype.hasOwnProperty.call(endpointPermissions, endpointId)) return;
    void loadEndpointPermissions(endpointId);
  }, [showImportModal, importEndpointId, endpointPermissions, loadEndpointPermissions]);

  useEffect(() => {
    if (!editingEndpointId) return;
    if (Object.prototype.hasOwnProperty.call(endpointPermissions, editingEndpointId)) return;
    void loadEndpointPermissions(editingEndpointId);
  }, [editingEndpointId, endpointPermissions, loadEndpointPermissions]);

  const loadEditQuota = async (userId: number) => {
    try {
      const detail = await getS3User(userId, { include_quota: true });
      setEditingUser((prev) => (prev && prev.id === userId ? { ...prev, ...detail } : prev));
      setEditForm((prev) => {
        if (prev.quota_max_size_gb !== "" || prev.quota_max_objects !== "") {
          return prev;
        }
        const quota = buildAdminQuotaSizeEditorValue(detail.quota_max_size_gb);
        return {
          ...prev,
          quota_max_size_gb: quota.value,
          quota_max_size_unit: quota.unit,
          quota_max_objects: detail.quota_max_objects != null ? String(detail.quota_max_objects) : "",
        };
      });
    } catch {
      // Quota is optional for editing; ignore load failures.
    }
  };

  const openEditModal = (user: S3User) => {
    void loadPortalUsersIfNeeded();
    void loadGroupsIfNeeded();
    void loadEndpointsIfNeeded();
    const nextEditForm = adminS3UserForm(user);
    setEditingUser(user);
    setEditForm(nextEditForm);
    setEditError(null);
    setEditTab("general");
    portalUserPicker.reset();
    groupPicker.reset();
    if (user.quota_max_size_gb == null && user.quota_max_objects == null) {
      void loadEditQuota(user.id);
    }
  };

  const submitEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setEditBusy(true);
    setEditError(null);
    try {
      const payload = adminS3UserPayload(editForm, allowUserQuotaUpdates, canManageManagerFeatures);
      const updatedUser = await updateS3User(editingUser.id, payload);
      const savedForm = adminS3UserForm(updatedUser);
      setEditingUser(updatedUser);
      setEditForm(savedForm);
      portalUserPicker.setSelections([]);
      groupPicker.setSelections([]);
      await fetchUsers();
      setActionMessage(adminText("User updated."));
    } catch (err) {
      setEditError(extractApiError(err, adminText("Unexpected error")));
    } finally {
      setEditBusy(false);
    }
  };

  const createValidation = useAdminRgwFormValidation(createForm, rgwCreateErrors(createForm, "user"));
  const importEntries = rgwImportEntries(importText, "user", managedTenantCreationEnabled);
  const importValidation = useAdminRgwFormValidation({importText, storage_endpoint_id: importEndpointId}, {
    ...(importEntries.error ? {importText: importEntries.error} : {}),
    ...(!importEndpointId ? {storage_endpoint_id: adminText("Select a Ceph endpoint.")} : {}),
  });
  const createPending = useRef(false);
  const importPending = useRef(false);

  const submitCreate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (createPending.current || !createValidation.validate(e.currentTarget)) return;
    if (createPermissionLoading) {
      setCreateError(adminText("Checking endpoint permissions. Please wait."));
      return;
    }
    if (!createEndpointCanWrite) {
      setCreateError(adminText("Selected endpoint does not allow this operation (missing users=write)."));
      return;
    }
    createPending.current = true;
    setCreating(true);
    setCreateError(null);
    try {
      await createS3User({
        name: createForm.name.trim(),
        uid: createForm.uid.trim() || undefined,
        rgw_tenant: managedTenantCreationEnabled ? createForm.rgw_tenant.trim() : "",
        email: createForm.email.trim() || undefined,
        tags: normalizeUiTags(createForm.tags),
        quota_max_size_gb: createForm.quota_max_size_gb ? Number(createForm.quota_max_size_gb) : undefined,
        quota_max_size_unit: createForm.quota_max_size_gb ? createForm.quota_max_size_unit : undefined,
        quota_max_objects: createForm.quota_max_objects ? Number(createForm.quota_max_objects) : undefined,
        storage_endpoint_id: Number(createForm.storage_endpoint_id),
      });
      setShowCreateModal(false);
      setCreateForm((prev) => ({
        ...prev,
        name: "",
        uid: "",
        rgw_tenant: "",
        email: "",
        tags: [],
        quota_max_size_gb: "",
        quota_max_objects: "",
      }));
      setActionMessage(adminText("User created."));
      await fetchUsers();
    } catch (err) {
      setCreateError(extractApiError(err, adminText("Unexpected error")));
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
      await importS3Users(importEntries.entries.map(identifier => ({
        uid: identifier,
        storage_endpoint_id: Number(importEndpointId),
      })));
      setImportMessage(adminText("RGW users imported."));
      importValidation.reset();
      setImportText("");
      acceptImportDraft(buildImportS3UserDraft("", importEndpointId, defaultAdminCephEndpointId));
      await fetchUsers();
    } catch (err) {
      setImportError(extractApiError(err, adminText("Unexpected error")));
    } finally {
      importPending.current = false;
      setImportBusy(false);
    }
  };

  const startDeleteUser = async (user: S3User) => {
    setDeleteModalError(null);
    setActionMessage(null);
    try {
      const detail = await getS3UserWithBuckets(user.id);
      setUserToDelete(detail);
      setDeleteFromRgw(false);
    } catch (err) {
      setUserToDelete(user);
      setDeleteFromRgw(false);
      setDeleteModalError(extractApiError(err, adminText("Unexpected error")));
    }
  };

  const closeDeleteModal = () => {
    if (deleteModalBusy) {
      return;
    }
    setUserToDelete(null);
    setDeleteFromRgw(false);
    setDeleteModalError(null);
  };

  const deleteModalBusy = userToDelete ? deleteBusyId === userToDelete.id : false;
  const selectedCreateEndpointId = createForm.storage_endpoint_id ? Number(createForm.storage_endpoint_id) : null;
  const selectedImportEndpointId = importEndpointId ? Number(importEndpointId) : null;
  const createPermissionLoading = selectedCreateEndpointId ? Boolean(endpointPermissionLoading[selectedCreateEndpointId]) : false;
  const importPermissionLoading = selectedImportEndpointId ? Boolean(endpointPermissionLoading[selectedImportEndpointId]) : false;
  const createEndpointCanWrite = selectedCreateEndpointId
    ? endpointPermissions[selectedCreateEndpointId]?.users_write === true
    : false;
  const importEndpointCanWrite = selectedImportEndpointId
    ? endpointPermissions[selectedImportEndpointId]?.users_write === true
    : false;
  const createPermissionError = selectedCreateEndpointId ? endpointPermissionErrors[selectedCreateEndpointId] ?? null : null;
  const importPermissionError = selectedImportEndpointId ? endpointPermissionErrors[selectedImportEndpointId] ?? null : null;
  const createDraft = useMemo(
    () => buildCreateS3UserDraft(createForm, defaultAdminCephEndpointId),
    [createForm, defaultAdminCephEndpointId],
  );
  const { accept: acceptCreateDraft, dirty: createDraftDirty } = useSettingsBaseline(
    createDraft,
    createDraft,
  );
  const createCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: showCreateModal && createDraftDirty,
    disabled: creating,
    onClose: () => setShowCreateModal(false),
  });
  const importDraft = useMemo(
    () => buildImportS3UserDraft(importText, importEndpointId, defaultAdminCephEndpointId),
    [defaultAdminCephEndpointId, importEndpointId, importText],
  );
  const { accept: acceptImportDraft, dirty: importDraftDirty } = useSettingsBaseline(
    importDraft,
    importDraft,
  );
  const importCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: showImportModal && importDraftDirty,
    disabled: importBusy,
    onClose: () => setShowImportModal(false),
  });
  const closeEditModal = () => {
    setEditingUser(null);
    setEditTab("general");
    portalUserPicker.reset();
    groupPicker.reset();
  };
  const editDraft = useMemo(
    () => buildEditS3UserDraft(editForm),
    [editForm],
  );
  const editBaseline = useMemo(
    () => editingUser ? buildEditS3UserDraft(adminS3UserForm(editingUser)) : null,
    [editingUser],
  );
  const editDirty = Boolean(editingUser && !equalSettings(editBaseline, editDraft));
  const editCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: editDirty,
    disabled: editBusy,
    onClose: closeEditModal,
  });
  const confirmDeleteUser = async () => {
    if (!userToDelete || deleteModalBusy) return;
    setDeleteBusyId(userToDelete.id);
    setDeleteModalError(null);
    setActionMessage(null);
    try {
      await deleteS3User(userToDelete.id, { deleteRgw: deleteFromRgw });
      await fetchUsers();
      setActionMessage(`Deleted ${userToDelete.name}.`);
      setUserToDelete(null);
      setDeleteFromRgw(false);
    } catch (err) {
      setDeleteModalError(extractApiError(err, adminText("Unexpected error")));
    } finally {
      setDeleteBusyId(null);
    }
  };

  return (
    <div className={workflowPageHostClass(Boolean(editingUser))}>
      <PageHeader actionPresentation="listing"
        title={adminText("RGW Users")}
        description={adminText("Manage standalone RGW users for direct access to Manager.")}
        breadcrumbs={adminBreadcrumbs("rgw-users")}
        actions={[
          {
            label: "Import",
            onClick: () => {
              importValidation.reset();
              setImportError(null);
              setImportMessage(null);
              acceptImportDraft(importDraft);
              setShowImportModal(true);
              void loadEndpointsIfNeeded();
            },
            variant: "ghost",
          },
          {
            label: "Create user",
            onClick: () => {
              createValidation.reset();
              setCreateError(null);
              acceptCreateDraft(createDraft);
              setShowCreateModal(true);
              void loadEndpointsIfNeeded();
            },
          },
        ]}
      />

      {error && <PageBanner tone="error">{error}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}

      <AdminS3UsersList
        users={users}
        loading={loading}
        error={error}
        filter={filter}
        quickFilterMode={quickFilterMode}
        sort={sort}
        page={page}
        pageSize={pageSize}
        total={totalUsers}
        deleteBusyId={deleteBusyId}
        onFilterChange={handleFilterChange}
        onQuickFilterModeChange={(mode) => {
          setQuickFilterMode(mode);
          resetPage();
        }}
        onSort={toggleSort}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
        onEdit={openEditModal}
        onDelete={startDeleteUser}
      />

      {showCreateModal && (
        <SettingsDialog title={adminText("Create user")} onClose={createCloseGuard.requestClose} closeDisabled={creating} maxWidthClass="max-w-2xl">
          <SettingsForm label={adminText("Create RGW user")} presentation="dialog" busy={creating} onSubmit={submitCreate}
            submitDisabled={createPermissionLoading || !createEndpointCanWrite}
            onCancel={createCloseGuard.requestClose} submitLabel={adminText("Create user")} busyLabel={adminText("Creating...")}>
            <AdminRgwCreateFields kind="user" value={createForm} onChange={patch => setCreateForm(current => ({...current, ...patch}))}
              showTenant={managedTenantCreationEnabled}
              errors={createValidation.errors} busy={creating}
              endpoint={{label: adminText("Ceph endpoint *"), endpoints: adminCephEndpoints, loading: loadingEndpoints,
                operation: "users", permissionLoading: createPermissionLoading, permissionError: createPermissionError, canWrite: createEndpointCanWrite}}
              tags={{catalog: adminTagCatalog, loading: adminTagCatalogLoading, error: adminTagCatalogError}} />
            {createError && <UiInlineMessage tone="error" role="alert">{createError}</UiInlineMessage>}
          </SettingsForm>
          {createCloseGuard.confirmationDialog}
        </SettingsDialog>
      )}

      {showImportModal && (
        <SettingsDialog title={adminText("Import RGW users")} onClose={importCloseGuard.requestClose} closeDisabled={importBusy} maxWidthClass="max-w-xl">
          <SettingsForm label={adminText("Import RGW users")} presentation="dialog" busy={importBusy} onSubmit={submitImport}
            submitDisabled={importPermissionLoading || !importEndpointCanWrite}
            onCancel={importCloseGuard.requestClose} submitLabel={adminText("Import")} busyLabel={adminText("Importing...")}>
            <div className="settings-fields settings-form">
              <p className="settings-body text-[var(--ui-text-muted)]">{adminText(managedTenantCreationEnabled
                ? "Enter RGW user IDs, one per line. Use tenant$uid for an explicit tenant, or uid for the default tenant. The platform creates a dedicated access key."
                : "Enter RGW user IDs, one per line, for the default tenant. Enable Managed RGW tenant creation to import tenant-qualified users. The platform creates a dedicated access key.")}</p>
              <UiTextarea label={adminText("RGW user IDs")} name="importText" rows={6} required value={importText}
                error={importValidation.errors.importText} placeholder="user-alpha"
                onChange={event => setImportText(event.target.value)} />
              <AdminRgwEndpointField label={adminText("Ceph endpoint *")} value={importEndpointId}
                onChange={setImportEndpointId} endpoints={adminCephEndpoints}
                error={importValidation.errors.storage_endpoint_id} loading={loadingEndpoints} operation="users"
                permissionLoading={importPermissionLoading} permissionError={importPermissionError} canWrite={importEndpointCanWrite} />
              {importError && <UiInlineMessage tone="error" role="alert">{importError}</UiInlineMessage>}
              {importMessage && <UiInlineMessage tone="success" role="status">{importMessage}</UiInlineMessage>}
            </div>
          </SettingsForm>
          {importCloseGuard.confirmationDialog}
        </SettingsDialog>
      )}

      {editingUser && (
        <WorkflowPage
          title={adminText("Edit {name}", { name: editingUser.name })}
          description={adminText("Manage quotas, usage, UI associations, and Manager features for this RGW user.")}
          breadcrumbs={adminBreadcrumbs("rgw-users", { label: adminText("Edit") })}
          backLabel={adminText("Back to RGW users")}
          onBack={editCloseGuard.requestClose}
          contentVariant="plain"
          width="wide"
          contentClassName="settings-compact settings-form"
          metaContent={
            <WorkflowMetadata
              items={[
                {
                  label: adminText("UID"),
                  value: editingUser.rgw_user_uid,
                },
                { label: adminText("Ceph tenant"), value: editingUser.rgw_tenant || adminText("Default") },
                {
                  label: adminText("Endpoint"),
                  value: editingUser.storage_endpoint_name,
                  title: editingUser.storage_endpoint_url,
                },
              ]}
            />
          }
        >
          {actionMessage && <PageBanner tone="success" className="mb-3">{actionMessage}</PageBanner>}
          <WorkflowTabs<EditTab>
              panelClassName="mt-3 min-w-0"
              activeTab={editTab}
              onTabChange={(tab) => {
                if (editBusy) return;
                if (tab === "users") {
                  void loadPortalUsersIfNeeded();
                }
                if (tab === "groups") {
                  void loadGroupsIfNeeded();
                }
                setEditTab(tab);
              }}
              ariaLabel={adminText("RGW user configuration sections")}
              idPrefix="admin-rgw-user-edit"
              tabs={[
                { id: "general", label: adminText("General") },
                { id: "users", label: adminText("Linked UI users") },
                { id: "groups", label: adminText("Linked UI groups") },
                { id: "manager", label: adminText("Manager features"), visible: canManageManagerFeatures },
              ].map((item) => ({ ...item, id: item.id as EditTab, disabled: editBusy }))}
            >
              <SettingsForm
                label={adminText("Edit RGW user")}
                busy={editBusy}
                onSubmit={submitEdit}
                onCancel={editCloseGuard.requestClose}
                submitLabel={adminText("Save changes")}
                busyLabel={adminText("Saving...")}
                actions={<SettingsPersistentEditActions dirty={editDirty} busy={editBusy}
                  onCancel={editCloseGuard.requestClose} saveLabel={adminText("Save changes")} savingLabel={adminText("Saving...")} />}
              >
                {editError && <UiInlineMessage tone="error" role="alert">{editError}</UiInlineMessage>}
                {showEditGeneralTab && (
                  <div className="settings-stack">
                    <SettingsSection
                      title={adminText("User details")}
                      description={adminText("Update the display information and administrative tags for this RGW user.")}
                      presentation="compact"
                    >
                      <div className="settings-fields sm:grid-cols-2">
                    <UiInput
                      label={adminText("Display name")}
                      value={editForm.name}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                    />
                    <UiInput
                      label={adminText("Email")}
                      type="email"
                      value={editForm.email}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))}
                    />
                    <div className="sm:col-span-2">
                      {adminTagCatalogError && <UiInlineMessage tone="warning">{adminTagCatalogError}</UiInlineMessage>}
                      <UiTagEditor
                        label={adminText("Tags")}
                        tags={editForm.tags}
                        catalog={adminTagCatalog}
                        onChange={(tags) => setEditForm((prev) => ({ ...prev, tags }))}
                        placeholder={adminText("Add a tag for this RGW user")}
                        hint={adminTagCatalogLoading ? adminText("Loading existing tag catalog...") : undefined}
                      />
                    </div>
                      </div>
                    </SettingsSection>
                    <SettingsSection title={adminText("Usage")} description={adminText("Observed storage use and the currently saved limits.")} presentation="compact">
                      {editingUsageLoading ? <p role="status">{adminText("Loading storage usage...")}</p>
                        : editingUsageError ? <UiInlineMessage tone="error">{editingUsageError} <SettingsButton variant="secondary" onClick={() => void editingUsageReload()}>{adminText("Retry usage")}</SettingsButton></UiInlineMessage>
                          : <>
                            <div className="grid gap-2 sm:grid-cols-2">
                              <UsageTile
                                label={adminText("Storage")}
                                used={editingUsageStats?.total_bytes ?? null}
                                quota={editingUser.quota_max_size_gb != null ? editingUser.quota_max_size_gb * 1024 ** 3 : null}
                                formatter={formatBytes}
                                quotaFormatter={formatBytes}
                                emptyHint={adminText("No storage quota defined.")}
                              />
                              <UsageTile
                                label={adminText("Objects")}
                                used={editingUsageStats?.total_objects ?? null}
                                quota={editingUser.quota_max_objects ?? null}
                                formatter={formatCompactNumber}
                                quotaFormatter={value => value != null ? value.toLocaleString(intlLocale) : "-"}
                                unitHint={adminText("objects")}
                                emptyHint={adminText("No object quota defined.")}
                              />
                            </div>
                            {editingUsageStats?.bucket_overview && <InlineSummary items={[
                              { label: adminText("Active buckets"), value: `${editingUsageStats.bucket_overview.non_empty_buckets}/${editingUsageStats.bucket_overview.bucket_count}` },
                              { label: adminText("Empty buckets"), value: String(editingUsageStats.bucket_overview.empty_buckets) },
                              { label: adminText("Average size"), value: editingUsageStats.bucket_overview.avg_bucket_size_bytes == null ? "—" : formatBytes(editingUsageStats.bucket_overview.avg_bucket_size_bytes) },
                              { label: adminText("Average objects"), value: editingUsageStats.bucket_overview.avg_objects_per_bucket == null ? "—" : formatCompactNumber(editingUsageStats.bucket_overview.avg_objects_per_bucket) },
                            ]} />}
                          </>}
                    </SettingsSection>
                <AdminQuotaFields
                  compact
                  storageValue={editForm.quota_max_size_gb}
                  storageUnit={editForm.quota_max_size_unit}
                  objectValue={editForm.quota_max_objects}
                  disabled={!allowUserQuotaUpdates}
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
                    {editPermissionLoading ? <p role="status">{adminText("Checking endpoint permissions...")}</p>
                      : editPermissionError ? <UiInlineMessage tone="error" role="alert">
                        {editPermissionError} <SettingsButton variant="secondary" onClick={() => editingEndpointId && void loadEndpointPermissions(editingEndpointId)}>{adminText("Retry permissions")}</SettingsButton>
                      </UiInlineMessage>
                        : !allowUserQuotaUpdates && <UiInlineMessage tone="info">{adminText("Quota editing requires Admin Ops support and users=write on the endpoint.")}</UiInlineMessage>}
                    <SettingsSection title={adminText("Services and monitoring")} description={adminText("RGW User-specific overrides for shared Manager services.")} presentation="compact">
                      <FeatureOverrideField title={adminText("Bucket composition statistics")} value={editForm.allow_bucket_usage_stats}
                        policy={generalSettings.project_feature_policies.bucket_usage_stats} disabled={editBusy}
                        triState
                        description={adminText("Controls bucket composition statistics for this RGW User in Manager.")}
                        onChange={value => setEditForm(prev => ({ ...prev, allow_bucket_usage_stats: value }))} />
                      <FeatureOverrideField title={adminText("Automatic bucket composition collection")} value={editForm.allow_bucket_usage_stats_collection}
                        policy={generalSettings.project_collection_policies.bucket_usage_stats} disabled={editBusy}
                        triState
                        description={adminText("Controls scheduled refreshes for this RGW User. Bucket composition statistics must also be enabled.")}
                        onChange={value => setEditForm(prev => ({ ...prev, allow_bucket_usage_stats_collection: value }))} />
                    </SettingsSection>
                  </div>
                )}

            {showEditUsersTab && (
              <div className={adminAssociationPanelClass}>
                <AdminRgwUserAccessAssociationsPanel
                  state={editUserAssociationState}
                  maxVisibleOptions={MAX_VISIBLE_ASSOCIATION_OPTIONS}
                  primaryLabel={adminText("User")}
                  actionsLabel={adminText("Actions")}
                  removeLabel={adminText("Remove")}
                  loadingMessage="Loading UI users..."
                  emptyMessage={adminText("No linked users yet.")}
                  pickerTitle={adminText("Add UI users")}
                  searchHint={adminText("(filter by email)")}
                  fallbackLabel={(id) => `User #${id}`}
                  searchAriaLabel="Search UI users"
                  section={{
                    title: adminText("Linked UI users"),
                    countLabel: adminText("{count} linked", { count: editForm.user_links.length }),
                    actionLabel: adminText(portalUserPicker.open ? "Close" : "Add UI users"),
                  }}
                />
              </div>
            )}

            {showEditGroupsTab && (
              <div className={adminAssociationPanelClass}>
                <AdminRgwUserAccessAssociationsPanel
                  state={editGroupAssociationState}
                  maxVisibleOptions={MAX_VISIBLE_ASSOCIATION_OPTIONS}
                  primaryLabel={adminText("Group")}
                  actionsLabel={adminText("Actions")}
                  removeLabel={adminText("Remove")}
                  loadingMessage="Loading UI groups..."
                  emptyMessage={adminText("No linked groups yet.")}
                  pickerTitle={adminText("Add UI groups")}
                  searchHint={adminText("(filter by name)")}
                  fallbackLabel={(id) => `Group #${id}`}
                  searchAriaLabel="Search UI groups"
                  section={{
                    title: adminText("Linked UI groups"),
                    countLabel: `${editForm.group_links.length} linked${uiGroupsLoading ? " · loading..." : ""}`,
                    actionLabel: adminText(groupPicker.open ? "Close" : "Add UI groups"),
                  }}
                />
              </div>
            )}

            {showEditManagerTab && (
              <div className="settings-stack">
                <SettingsSection presentation="compact" title={adminText("Usage and metrics")}>
                  <FeatureOverrideField title={adminText("RGW traffic and usage metrics")} value={editForm.allow_rgw_usage_metrics}
                    policy={generalSettings.manager_feature_policies.rgw_usage_metrics} disabled={editBusy}
                    triState
                    description={adminText("Controls traffic and usage metrics for this RGW User. Endpoint capabilities and supervision credentials still apply.")}
                    onChange={value => setEditForm(prev => ({ ...prev, allow_rgw_usage_metrics: value }))} />
                  <FeatureOverrideField title={adminText("Cost estimation")} value={editForm.allow_cost_estimation}
                    policy={generalSettings.manager_feature_policies.cost_estimation} disabled={editBusy}
                    triState
                    description={adminText("Controls the Cost tab for this RGW User in Manager Usage & Metrics.")}
                    onChange={value => setEditForm(prev => ({ ...prev, allow_cost_estimation: value }))} />
                </SettingsSection>
                <SettingsSection presentation="compact" title={adminText("Access-key extensions")}>
                  <FeatureOverrideField title={adminText("Access-key names and notes")} value={editForm.allow_access_key_metadata}
                    policy={generalSettings.manager_feature_policies.access_key_metadata} disabled={editBusy}
                    triState
                    description={adminText("Name and notes are stored in BucketReef.")} onChange={value => setEditForm(prev => ({ ...prev, allow_access_key_metadata: value }))} />
                  <FeatureOverrideField title={adminText("Access-key expiration")} value={editForm.allow_access_key_expiration}
                    policy={generalSettings.manager_feature_policies.access_key_expiration} disabled={editBusy}
                    triState
                    help={adminText("Requires Ceph, key management and scheduled jobs. Existing expirations remain scheduled.")} onChange={value => setEditForm(prev => ({ ...prev, allow_access_key_expiration: value }))} />
                </SettingsSection>
                <SettingsSection presentation="compact" title={adminText("Activity history")}>
                  <FeatureOverrideField title={adminText("Manager activity history")} value={editForm.allow_activity_history}
                    policy={generalSettings.manager_feature_policies.activity_history} disabled={editBusy}
                    triState
                    description={adminText("Shows RGW User Manager control and configuration actions. It does not include S3 object access logs.")}
                    onChange={value => setEditForm(prev => ({ ...prev, allow_activity_history: value }))} />
                </SettingsSection>
                <SettingsSection presentation="compact" title={adminText("RGW multisite")}>
                  <FeatureOverrideField title={adminText("Endpoint switching")} value={editForm.allow_multisite_endpoint_switching}
                    policy={generalSettings.manager_feature_policies.rgw_multisite_endpoint_switching} disabled={editBusy}
                    triState
                    help={adminText("Grants endpoint switching for this RGW User when the destination is in the same realm and zonegroup. UI User and UI Group grants remain additive.")}
                    onChange={value => setEditForm(prev => ({ ...prev, allow_multisite_endpoint_switching: value }))} />
                </SettingsSection>
                <SettingsSection presentation="compact" title={adminText("Privileged Ceph operations")}>
                  <FeatureOverrideField title={adminText("Bucket quota management")} value={editForm.allow_bucket_quota_management}
                    policy={generalSettings.manager_feature_policies.bucket_quota_management} disabled={editBusy}
                    triState
                    unavailable={!editingEndpointCanWriteBuckets ? adminText("Endpoint permission required") : undefined}
                    description={adminText("Requires buckets=write on the endpoint Admin Ops identity.")} onChange={value => setEditForm(prev => ({ ...prev, allow_bucket_quota_management: value }))} />
                  <FeatureOverrideField title={adminText("Ceph S3 User keys")} value={editForm.allow_access_key_management}
                    policy={generalSettings.manager_feature_policies.ceph_s3_user_keys} disabled={editBusy}
                    triState
                    description={adminText("Manages RGW User keys in Manager; storage and endpoint permissions remain required.")} onChange={value => setEditForm(prev => ({ ...prev, allow_access_key_management: value }))} />
                  <FeatureOverrideField title={adminText("Managed private connection provisioning")} value={editForm.allow_managed_private_connection_provisioning}
                    policy={generalSettings.manager_feature_policies.managed_private_connection_provisioning} disabled={editBusy}
                    triState
                    help={adminText("Requires an eligible UI user and compatible endpoint. Generated secrets remain managed by BucketReef.")} onChange={value => setEditForm(prev => ({ ...prev, allow_managed_private_connection_provisioning: value }))} />
                </SettingsSection>
              </div>
            )}
              </SettingsForm>
          </WorkflowTabs>
          {editCloseGuard.confirmationDialog}
        </WorkflowPage>
      )}

      {userToDelete && (
        <ConfirmActionDialog
          title={`Delete ${userToDelete.name}`}
          description={adminText("This removes the standalone RGW user from the UI and deletes the access key used by this interface. You can also delete the underlying RGW user once it no longer owns buckets.")}
          confirmLabel={adminText("Delete user")}
          processingLabel="Deleting..."
          loading={deleteModalBusy}
          error={deleteModalError}
          warningTone="warning"
          warning={deleteModalBlocksRgwDeletion && (
            <div className="space-y-2">
              <p>{adminText(deleteModalBucketCountUnknown
                ? "Bucket ownership could not be verified. RGW deletion is unavailable, but you can still remove this user from BucketReef."
                : "This RGW user still has linked resources. Remove owned buckets before deleting it from RGW.")}</p>
              <p className="settings-label">{adminText("Buckets:")}{userToDelete.bucket_count ?? "unknown"}</p>
            </div>
          )}
          options={
            <UiCheckboxField
              checked={deleteFromRgw}
              disabled={deleteModalBusy || deleteModalBlocksRgwDeletion}
              onChange={(event) => setDeleteFromRgw(event.target.checked)}
            >
              <span className="modal-option-copy">
                {adminText("Also delete RGW user")} <code className="break-all font-mono">{userToDelete.rgw_user_uid}</code>
              </span>
            </UiCheckboxField>
          }
          onCancel={closeDeleteModal}
          onConfirm={() => void confirmDeleteUser()}
        />
      )}

    </div>
  );
}
