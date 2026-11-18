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
import { adminLimitErrors, useAdminRgwFormValidation, rgwCreateErrors, rgwImportEntries } from "./useAdminRgwFormValidation";
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
import { isAdminLikeRole, readStoredUser } from "../../utils/workspaces";
import { adminAssociationPanelClass } from "./AdminAssociationPicker";
import type { AdminRgwUserAccessAssociationsState } from "./AdminRgwUserAccessAssociationsPanel";
import AdminRgwUserUiAccess from "./AdminRgwUserUiAccess";
import type { AdminPrincipalPresentation } from "./AdminPrincipalIdentity";
import AdminQuotaFields from "./AdminQuotaFields";
import AdminManagerFeatureOverrides from "./AdminManagerFeatureOverrides";
import { useAdminS3UserStats } from "./useAdminS3UserStats";
import { useAdminI18n } from "./adminI18n";
import AdminS3UsersList, { type AdminS3UsersSortField } from "./AdminS3UsersList";
import AdminS3UserKeysPanel from "./AdminS3UserKeysPanel";
import useAdminPaginatedListState from "./useAdminPaginatedListState";
import useAdminPaginatedListController from "./useAdminPaginatedListController";
import useAdminAssociationPickerState from "./useAdminAssociationPickerState";
import useAdminEndpointAdminOpsPermissions from "./useAdminEndpointAdminOpsPermissions";
import useAdminPrincipalCatalogs from "./useAdminPrincipalCatalogs";
import {
  adminS3UserForm,
  adminS3UserPayload,
  buildCreateS3UserDraft,
  buildEditS3UserDraft,
  buildImportS3UserDraft,
  emptyAdminS3UserForm,
} from "./adminS3UserForm";
import { adminRgwUserCreatePayload, emptyAdminRgwUserCreateForm } from "./adminRgwCreateForm";
import {
  s3UserGroupLinkAdapter,
  s3UserUserLinkAdapter,
} from "./adminRgwUserAccessAssociationModel";
import {
  deriveAdminAssociationOptions,
  MAX_VISIBLE_ASSOCIATION_OPTIONS,
} from "./adminAssociationOptions";

type EditTab = "general" | "ui_access" | "keys" | "settings" | "manager";

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
  const [createForm, setCreateForm] = useState(emptyAdminRgwUserCreateForm);
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
  const [editDetailLoading, setEditDetailLoading] = useState(false);
  const [editAttempted, setEditAttempted] = useState(false);
  const [editTab, setEditTab] = useState<EditTab>("general");
  const editFormRef = useRef<HTMLFormElement>(null);
  const editingUserIdRef = useRef<number | null>(null);
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
  const showEditUiAccessTab = editTab === "ui_access";
  const showEditKeysTab = editTab === "keys";
  const showEditSettingsTab = editTab === "settings";
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
    () => {
      const labels = new Map<number, string>();
      editingUser?.user_links.forEach((user) =>
        labels.set(user.user_id, user.user_email ?? `User #${user.user_id}`),
      );
      portalUserOptions.forEach((user) => labels.set(user.id, user.label));
      return labels;
    },
    [editingUser, portalUserOptions],
  );
  const groupLabelById = useMemo(
    () => {
      const labels = new Map<number, string>();
      editingUser?.group_links.forEach((group) =>
        labels.set(group.group_id, group.group_name ?? `Group #${group.group_id}`),
      );
      groupOptions.forEach((group) => labels.set(group.id, group.label));
      return labels;
    },
    [editingUser, groupOptions],
  );
  const portalUserPrincipalById = useMemo(() => {
    const principals = new Map<number, AdminPrincipalPresentation>();
    editingUser?.user_links.forEach((user) => {
      const fallback = user.user_email ?? `User #${user.user_id}`;
      principals.set(user.user_id, {
        kind: "user",
        email: user.user_email,
        fullName: user.user_full_name,
        avatar: user.user_avatar,
        fallback,
      });
    });
    portalUsers.forEach((user) => principals.set(user.id, {
      kind: "user",
      email: user.email,
      fullName: user.full_name,
      avatar: user.avatar,
      fallback: user.email,
    }));
    return principals;
  }, [editingUser, portalUsers]);
  const groupPrincipalById = useMemo(() => {
    const principals = new Map<number, AdminPrincipalPresentation>();
    editingUser?.group_links.forEach((group) => {
      const fallback = group.group_name ?? `Group #${group.group_id}`;
      principals.set(group.group_id, {
        kind: "group",
        name: group.group_name,
        description: group.group_description,
        avatar: group.group_avatar,
        fallback,
      });
    });
    uiGroups.forEach((group) => principals.set(group.id, {
      kind: "group",
      name: group.name,
      description: group.description,
      avatar: group.avatar,
      fallback: group.name,
    }));
    return principals;
  }, [editingUser, uiGroups]);
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
    adapter: s3UserUserLinkAdapter,
    labelById: portalUserLabelById,
    principalById: portalUserPrincipalById,
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
    adapter: s3UserGroupLinkAdapter,
    labelById: groupLabelById,
    principalById: groupPrincipalById,
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
  const allowUserLimitUpdates = allowUserQuotaUpdates;
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

  const loadEditDetail = async (userId: number) => {
    setEditDetailLoading(true);
    try {
      const detail = await getS3User(userId, { include_quota: true });
      if (editingUserIdRef.current !== userId) return;
      setEditingUser(detail);
      setEditForm(adminS3UserForm(detail));
    } catch (cause) {
      if (editingUserIdRef.current !== userId) return;
      setEditError(extractApiError(cause, adminText("Unable to load RGW user configuration.")));
    } finally {
      if (editingUserIdRef.current === userId) setEditDetailLoading(false);
    }
  };

  const openEditModal = (user: S3User) => {
    void loadPortalUsersIfNeeded();
    void loadGroupsIfNeeded();
    void loadEndpointsIfNeeded();
    const nextEditForm = adminS3UserForm(user);
    editingUserIdRef.current = user.id;
    setEditingUser(user);
    setEditForm(nextEditForm);
    setEditError(null);
    setEditAttempted(false);
    setEditTab("general");
    portalUserPicker.reset();
    groupPicker.reset();
    void loadEditDetail(user.id);
  };

  const editLimitErrors = adminLimitErrors(editForm, [["max_buckets", "Max buckets"]] as const);

  const submitEdit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingUser) return;
    setEditAttempted(true);
    if (Object.values(editLimitErrors).some(Boolean)) {
      setEditTab("settings");
      window.requestAnimationFrame(() => {
        editFormRef.current?.querySelector<HTMLElement>('[data-rgw-limits] [aria-invalid="true"]:not(:disabled)')?.focus();
      });
      return;
    }
    setEditBusy(true);
    setEditError(null);
    try {
      const payload = adminS3UserPayload(
        editForm,
        adminS3UserForm(editingUser),
        allowUserQuotaUpdates,
        allowUserLimitUpdates,
        canManageManagerFeatures,
      );
      const updatedUser = await updateS3User(editingUser.id, payload);
      const savedForm = adminS3UserForm(updatedUser);
      setEditingUser(updatedUser);
      setEditForm(savedForm);
      setEditAttempted(false);
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
      await createS3User(adminRgwUserCreatePayload(createForm, managedTenantCreationEnabled));
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
    editingUserIdRef.current = null;
    setEditingUser(null);
    setEditDetailLoading(false);
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
                if (editBusy || editDetailLoading) return;
                setEditTab(tab);
              }}
              ariaLabel={adminText("RGW user configuration sections")}
              idPrefix="admin-rgw-user-edit"
              tabs={[
                { id: "general", label: adminText("General") },
                { id: "ui_access", label: adminText("User access") },
                { id: "keys", label: adminText("Keys") },
                { id: "settings", label: adminText("Settings") },
                { id: "manager", label: adminText("Manager features"), visible: canManageManagerFeatures },
              ].map((item) => ({ ...item, id: item.id as EditTab, disabled: editBusy || editDetailLoading }))}
            >
              {showEditKeysTab ? (
                <AdminS3UserKeysPanel user={editingUser} />
              ) : (
                <SettingsForm
                  label={adminText("Edit RGW user")}
                  formRef={editFormRef}
                  busy={editBusy}
                  disabled={editDetailLoading}
                  onSubmit={submitEdit}
                  onCancel={editCloseGuard.requestClose}
                  submitLabel={adminText("Save changes")}
                  busyLabel={adminText("Saving...")}
                  actions={<SettingsPersistentEditActions dirty={editDirty} busy={editBusy} disabled={editDetailLoading}
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
                  </div>
                )}

            {showEditUiAccessTab && (
              <div className={adminAssociationPanelClass}>
                <AdminRgwUserUiAccess
                  users={editUserAssociationState}
                  groups={editGroupAssociationState}
                  maxVisibleOptions={MAX_VISIBLE_ASSOCIATION_OPTIONS}
                  ensureUsers={() => void loadPortalUsersIfNeeded()}
                  ensureGroups={() => void loadGroupsIfNeeded()}
                />
              </div>
            )}

            {showEditSettingsTab && (
              <div className="settings-stack">
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
                <SettingsSection title={adminText("Limits")} description={adminText("Leave empty to clear a limit.")} presentation="compact">
                  <div className="settings-fields" data-rgw-limits>
                    <UiInput name="max_buckets" label={adminText("Max buckets")} type="number" min={0} step={1}
                      value={editForm.max_buckets} disabled={editBusy || editDetailLoading || !allowUserLimitUpdates}
                      error={editAttempted ? editLimitErrors.max_buckets : undefined}
                      onChange={event => setEditForm(prev => ({ ...prev, max_buckets: event.target.value }))} />
                  </div>
                </SettingsSection>
                {editPermissionLoading ? <p role="status">{adminText("Checking endpoint permissions...")}</p>
                  : editPermissionError ? <UiInlineMessage tone="error" role="alert">
                    {editPermissionError} <SettingsButton variant="secondary" onClick={() => editingEndpointId && void loadEndpointPermissions(editingEndpointId)}>{adminText("Retry permissions")}</SettingsButton>
                  </UiInlineMessage>
                    : !allowUserLimitUpdates && <UiInlineMessage tone="info">{adminText("Limit editing requires Admin Ops support and users=write on the endpoint.")}</UiInlineMessage>}
              </div>
            )}

            {showEditManagerTab && (
              <AdminManagerFeatureOverrides
                resource="user"
                value={editForm}
                disabled={editBusy}
                bucketQuotaAvailable={editingEndpointCanWriteBuckets}
                onChange={(key, value) => setEditForm((current) => ({ ...current, [key]: value }))}
              />
            )}
                </SettingsForm>
              )}
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
