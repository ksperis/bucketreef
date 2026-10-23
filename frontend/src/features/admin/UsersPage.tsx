/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CreateUserPayload,
  UpdateUserPayload,
  User,
  type UiRole,
  createUser,
  deleteUser,
  deleteUserAvatar,
  listUsers,
  updateUser,
  uploadUserAvatar,
} from "../../api/users";
import {
  isRecentWebAuthnVerificationCancelled,
  useRecentWebAuthnStepUp,
} from "../../auth/useRecentWebAuthnStepUp";
import {
  getAccountAccessRequiredMessage,
  hasAccountAccessRole,
} from "../../api/accountAccess";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import WorkflowPage, {
  WorkflowMetadata,
  workflowPageHostClass,
} from "../../components/WorkflowPage";
import WorkflowTabs from "../../components/WorkflowTabs";
import PageHeader from "../../components/PageHeader";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import AdminUserPlatformAccessPanel from "./AdminUserPlatformAccessPanel";
import AdminUsersList, { type AdminUsersSortField } from "./AdminUsersList";
import {
  DEFAULT_MANAGER_TOOL_ACCESS,
  normalizeManagerToolAccess,
  roleSupportsOperationalAccess,
} from "./adminAccessConfig";
import PageBanner from "../../components/PageBanner";
import SettingsForm from "../../components/settings/SettingsForm";
import { SettingsButton, SettingsPersistentEditActions, useSettingsCloseGuard } from "../../components/settings/SettingsControls";
import AdminUserIdentityFields, { userIdentityErrors, type UserIdentityErrors } from "./AdminUserIdentityFields";
import SettingsNavigationGuard from "../../components/settings/SettingsNavigationGuard";
import { useProfileI18n } from "../shared/profileMessages";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";

import { extractApiError } from "../../utils/apiError";
import { pageCount } from "../../utils/pagination";
import { isAdminLikeRole, isSuperAdminRole, readStoredUser, setSessionUserCache } from "../../utils/workspaces";
import {
  clearAdminPrincipalEditRequest,
  readAdminPrincipalEditRequest,
} from "./adminPrincipalEditLink";
import UserAssociationsTabs, { type AssociationTab } from "./UserAssociationsTabs";
import { adminAssociationPanelClass } from "./AdminAssociationPicker";
import UserGroupsSelector from "./UserGroupsSelector";
import UserAuthenticationPanel from "./UserAuthenticationPanel";
import AdminUserProfilePanel from "./AdminUserProfilePanel";
import useAdminUserAssociationOptions from "./useAdminUserAssociationOptions";
import { adminUserEditorSignature, emptyAdminUserEditorSignature } from "./adminUserEditorSignature";
import { useUsersI18n } from "./usersMessage";
import { useAdminUserI18n } from "./adminUserMessage";
import useAdminUserAssociationEditorState from "./useAdminUserAssociationEditorState";

type UserModalTab = "general" | "authentication" | "associations" | "groups" | "access";

function focusIdentityError(prefix: string, errors: UserIdentityErrors) {
  const field = errors.email ? "email" : "password";
  requestAnimationFrame(() => document.getElementById(`${prefix}-${field}`)?.focus());
}

export default function UsersPage() {
  const { locale, text } = useUsersI18n();
  const { text: adminUserText } = useAdminUserI18n();
  const { text: adminProfileText } = useProfileI18n();
  const textRef = useRef(text);
  textRef.current = text;
  const userWorkflowTabs: Array<{ id: UserModalTab; label: string }> = [
    { id: "general", label: text("general") },
    { id: "groups", label: text("groups") },
    { id: "associations", label: text("associations") },
    { id: "access", label: text("platformAccess") },
  ];
  const editUserWorkflowTabs: Array<{ id: UserModalTab; label: string }> = [
    { id: "general", label: adminProfileText("preferencesTab") },
    { id: "authentication", label: adminProfileText("security") },
    ...userWorkflowTabs.filter((tab) => tab.id !== "general"),
  ];
  const closeLabel = locale === "en" ? undefined : text("close");
  const usersBreadcrumbs = (action?: string) =>
    adminPageBreadcrumbs("users", ...(action ? [{ label: action }] : [])).map((breadcrumb, index) => ({
      ...breadcrumb,
      label: index === 0 ? text("adminBreadcrumb") : index === 1 ? text("uiUsers") : breadcrumb.label,
    }));
  const discardLabels = {
    title: text("discardTitle"),
    description: text("unsavedChanges"),
    cancelLabel: text("keepEditing"),
    confirmLabel: text("discardChanges"),
    closeLabel,
  };
  const stepUpLabels = useMemo(() => ({
    title: text("verifyPasskey"),
    description: text("verifyDescription"),
    cancel: text("cancel"),
    close: closeLabel,
    cancelled: text("verificationCancelled"),
    failure: (error: unknown) => extractApiError(error, text("verificationFailed")),
  }), [closeLabel, text]);
  const MAX_VISIBLE_OPTIONS = 10;
  const { generalSettings } = useGeneralSettings();
  const { runWithStepUp, verificationDialog } = useRecentWebAuthnStepUp(stepUpLabels);
  const currentUser = useMemo(() => readStoredUser(), []);
  const currentUserId = currentUser?.id != null ? Number(currentUser.id) : null;
  const currentIsAdminLike = isAdminLikeRole(currentUser?.role);
  const currentIsSuperAdmin = isSuperAdminRole(currentUser?.role);
  const cephAdminFeatureEnabled = generalSettings.ceph_admin_enabled;
  const showPortalRole = Boolean(generalSettings.portal_enabled);
  const principalEditRequest = useMemo(
    () => readAdminPrincipalEditRequest(typeof window === "undefined" ? "" : window.location.search),
    [],
  );
  const requestedEditHandledRef = useRef(false);
  const startEditRef = useRef<(user: User) => void>(() => undefined);
  const [users, setUsers] = useState<User[]>([]);
  const {
    accounts,
    s3AccountsLoaded,
    s3AccountsLoading,
    refreshS3Accounts,
    ensureS3Accounts,
    s3Users,
    s3UsersLoading,
    s3Connections,
    s3ConnectionsLoading,
    groups,
    groupsLoaded,
    groupsLoading,
    ensureGroups,
    ensureAssociationOptionsForTab,
  } = useAdminUserAssociationOptions();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const createFormTemplate = (): CreateUserPayload => ({
    email: "",
    full_name: "",
    password: "",
    role: "ui_user",
    can_access_ceph_admin: false,
    can_access_storage_ops: false,
    can_create_manual_private_connections: false,
    can_provision_managed_private_connections: false,
    manager_tool_access: { ...DEFAULT_MANAGER_TOOL_ACCESS },
    browser_advanced_features_enabled: false,
  });
  const [form, setForm] = useState<CreateUserPayload>(() => createFormTemplate());
  const [createInitialSignature, setCreateInitialSignature] = useState(() =>
    emptyAdminUserEditorSignature(createFormTemplate())
  );
  const [createModalTab, setCreateModalTab] = useState<UserModalTab>("general");
  const {
    selectedS3Accounts: createSelectedS3Accounts,
    setSelectedS3Accounts: setCreateSelectedS3Accounts,
    selectedS3Users: createSelectedS3Users,
    setSelectedS3Users: setCreateSelectedS3Users,
    selectedS3Connections: createSelectedS3Connections,
    setSelectedS3Connections: setCreateSelectedS3Connections,
    selectedGroups: createSelectedGroups,
    setSelectedGroups: setCreateSelectedGroups,
    accountAccessChoice: createAccountAccessChoice,
    setAccountAccessChoice: setCreateAccountAccessChoice,
    s3AccountSearch: createS3AccountSearch,
    setS3AccountSearch: setCreateS3AccountSearch,
    s3Search: createS3Search,
    setS3Search: setCreateS3Search,
    connectionSearch: createConnectionSearch,
    setConnectionSearch: setCreateConnectionSearch,
    groupSearch: createGroupSearch,
    setGroupSearch: setCreateGroupSearch,
    associationsTab: createAssociationsTab,
    setAssociationsTab: setCreateAssociationsTab,
    showAccountPanel: showCreateAccountPanel,
    setShowAccountPanel: setShowCreateAccountPanel,
    accountSelections: createAccountSelections,
    setAccountSelections: setCreateAccountSelections,
    showS3UserPanel: showCreateS3UserPanel,
    setShowS3UserPanel: setShowCreateS3UserPanel,
    s3UserSelections: createS3UserSelections,
    setS3UserSelections: setCreateS3UserSelections,
    showConnectionPanel: showCreateConnectionPanel,
    setShowConnectionPanel: setShowCreateConnectionPanel,
    connectionSelections: createConnectionSelections,
    setConnectionSelections: setCreateConnectionSelections,
    showGroupPanel: showCreateGroupPanel,
    setShowGroupPanel: setShowCreateGroupPanel,
    groupSelections: createGroupSelections,
    setGroupSelections: setCreateGroupSelections,
    reset: resetCreateAssociations,
    toggleAccountSelection: toggleCreateAccountSelection,
    toggleS3UserSelection: toggleCreateS3UserSelection,
    toggleConnectionSelection: toggleCreateConnectionSelection,
  } = useAdminUserAssociationEditorState();
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState<UpdateUserPayload>({});
  const [editInitialSignature, setEditInitialSignature] = useState(() =>
    emptyAdminUserEditorSignature({})
  );
  const [editModalTab, setEditModalTab] = useState<UserModalTab>("general");
  const {
    selectedS3Accounts: editSelectedS3Accounts,
    setSelectedS3Accounts: setEditSelectedS3Accounts,
    selectedS3Users: editSelectedS3Users,
    setSelectedS3Users: setEditSelectedS3Users,
    selectedS3Connections: editSelectedS3Connections,
    setSelectedS3Connections: setEditSelectedS3Connections,
    selectedGroups: editSelectedGroups,
    setSelectedGroups: setEditSelectedGroups,
    accountAccessChoice: editAccountAccessChoice,
    setAccountAccessChoice: setEditAccountAccessChoice,
    s3AccountSearch: editS3AccountSearch,
    setS3AccountSearch: setEditS3AccountSearch,
    s3Search: editS3Search,
    setS3Search: setEditS3Search,
    connectionSearch: editConnectionSearch,
    setConnectionSearch: setEditConnectionSearch,
    groupSearch: editGroupSearch,
    setGroupSearch: setEditGroupSearch,
    associationsTab: editAssociationsTab,
    setAssociationsTab: setEditAssociationsTab,
    showAccountPanel: showEditAccountPanel,
    setShowAccountPanel: setShowEditAccountPanel,
    accountSelections: editAccountSelections,
    setAccountSelections: setEditAccountSelections,
    showS3UserPanel: showEditS3UserPanel,
    setShowS3UserPanel: setShowEditS3UserPanel,
    s3UserSelections: editS3UserSelections,
    setS3UserSelections: setEditS3UserSelections,
    showConnectionPanel: showEditConnectionPanel,
    setShowConnectionPanel: setShowEditConnectionPanel,
    connectionSelections: editConnectionSelections,
    setConnectionSelections: setEditConnectionSelections,
    showGroupPanel: showEditGroupPanel,
    setShowGroupPanel: setShowEditGroupPanel,
    groupSelections: editGroupSelections,
    setGroupSelections: setEditGroupSelections,
    clearPendingSelections: clearEditPendingAssociationSelections,
    reset: resetEditAssociations,
    toggleAccountSelection: toggleEditAccountSelection,
    toggleS3UserSelection: toggleEditS3UserSelection,
    toggleConnectionSelection: toggleEditConnectionSelection,
  } = useAdminUserAssociationEditorState();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [authenticationBusy, setAuthenticationBusy] = useState(false);
  const [authenticationDirty, setAuthenticationDirty] = useState(false);
  const [avatarDirty, setAvatarDirty] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const savingRef = useRef(false);
  const [createAttempted, setCreateAttempted] = useState(false);
  const [editAttempted, setEditAttempted] = useState(false);
  const [pendingDeleteUser, setPendingDeleteUser] = useState<User | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [createRoleHelpOpen, setCreateRoleHelpOpen] = useState(false);
  const [editRoleHelpOpen, setEditRoleHelpOpen] = useState(false);
  const [filter, setFilter] = useState(principalEditRequest?.search ?? "");
  const [sort, setSort] = useState<{ field: AdminUsersSortField; direction: "asc" | "desc" }>({
    field: "name",
    direction: "asc",
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalUsers, setTotalUsers] = useState(0);
  const accountOptions = useMemo(() => accounts.map((a) => ({ id: a.id, label: a.name })), [accounts]);
  const accountOptionsById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account] as const)),
    [accounts],
  );
  const s3UserOptions = useMemo(() => s3Users.map((u) => ({ id: u.id, label: u.name })), [s3Users]);
  const s3UserLabelById = useMemo(() => {
    const map = new Map<number, string>();
    s3Users.forEach((u) => map.set(u.id, u.name));
    return map;
  }, [s3Users]);
  const s3ConnectionOptions = useMemo(
    () => s3Connections.map((conn) => ({ id: conn.id, label: conn.name })),
    [s3Connections]
  );
  const s3SharedConnectionOptions = s3ConnectionOptions;
  const s3ConnectionLabelById = useMemo(() => {
    const map = new Map<number, string>();
    s3Connections.forEach((conn) => map.set(conn.id, conn.name));
    return map;
  }, [s3Connections]);
  const availableCreateS3Accounts = useMemo(() => {
    const query = createS3AccountSearch.trim().toLowerCase();
    const selectedIds = new Set(createSelectedS3Accounts.map((a) => Number(a.id)));
    return accountOptions.filter(
      (a) => !selectedIds.has(Number(a.id)) && (!query || a.label.toLowerCase().includes(query))
    );
  }, [accountOptions, createS3AccountSearch, createSelectedS3Accounts]);
  const availableEditS3Accounts = useMemo(() => {
    const query = editS3AccountSearch.trim().toLowerCase();
    const selectedIds = new Set(editSelectedS3Accounts.map((a) => Number(a.id)));
    return accountOptions.filter(
      (a) => !selectedIds.has(Number(a.id)) && (!query || a.label.toLowerCase().includes(query))
    );
  }, [accountOptions, editS3AccountSearch, editSelectedS3Accounts]);
  const availableCreateS3Users = useMemo(() => {
    const query = createS3Search.trim().toLowerCase();
    return s3UserOptions.filter(
      (opt) => !createSelectedS3Users.some((link) => link.s3_user_id === opt.id) && (!query || opt.label.toLowerCase().includes(query))
    );
  }, [s3UserOptions, createSelectedS3Users, createS3Search]);
  const availableCreateS3Connections = useMemo(() => {
    const query = createConnectionSearch.trim().toLowerCase();
    return s3SharedConnectionOptions.filter(
      (opt) =>
        !createSelectedS3Connections.includes(opt.id) && (!query || opt.label.toLowerCase().includes(query))
    );
  }, [s3SharedConnectionOptions, createSelectedS3Connections, createConnectionSearch]);
  const availableEditS3Users = useMemo(() => {
    const query = editS3Search.trim().toLowerCase();
    return s3UserOptions.filter(
      (opt) => !editSelectedS3Users.some((link) => link.s3_user_id === opt.id) && (!query || opt.label.toLowerCase().includes(query))
    );
  }, [s3UserOptions, editSelectedS3Users, editS3Search]);
  const availableEditS3Connections = useMemo(() => {
    const query = editConnectionSearch.trim().toLowerCase();
    return s3SharedConnectionOptions.filter(
      (opt) =>
        !editSelectedS3Connections.includes(opt.id) &&
        (!query || opt.label.toLowerCase().includes(query))
    );
  }, [s3SharedConnectionOptions, editSelectedS3Connections, editConnectionSearch]);
  const visibleCreateGroups = useMemo(() => {
    const query = createGroupSearch.trim().toLowerCase();
    return groups.filter(
      (group) => !createSelectedGroups.includes(group.id) && (!query || group.name.toLowerCase().includes(query))
    );
  }, [createGroupSearch, createSelectedGroups, groups]);
  const visibleEditGroups = useMemo(() => {
    const query = editGroupSearch.trim().toLowerCase();
    return groups.filter(
      (group) => !editSelectedGroups.includes(group.id) && (!query || group.name.toLowerCase().includes(query))
    );
  }, [editGroupSearch, editSelectedGroups, groups]);
  const limitedOptions = <T,>(options: T[]) => options.slice(0, MAX_VISIBLE_OPTIONS);
  const visibleCreateS3Accounts = limitedOptions(availableCreateS3Accounts);
  const visibleEditS3Accounts = limitedOptions(availableEditS3Accounts);
  const visibleCreateS3Users = limitedOptions(availableCreateS3Users);
  const visibleCreateS3Connections = limitedOptions(availableCreateS3Connections);
  const visibleEditS3Users = limitedOptions(availableEditS3Users);
  const visibleEditS3Connections = limitedOptions(availableEditS3Connections);
  const displayUiRole = (role: UiRole) => {
    if (role === "ui_superadmin") return text("superadmin");
    if (role === "ui_admin") return text("admin");
    if (role === "ui_user") return text("user");
    return text("noAccess");
  };
  const editRoleValue = editForm.role ?? editingUser?.role ?? "ui_user";
  const createRoleValue = form.role ?? "ui_user";
  const createTargetSupportsCephAdmin = isAdminLikeRole(createRoleValue);
  const createTargetSupportsStorageOps = roleSupportsOperationalAccess(createRoleValue);
  const editTargetSupportsCephAdmin = isAdminLikeRole(editRoleValue);
  const editTargetSupportsStorageOps = roleSupportsOperationalAccess(editRoleValue);
  const editTargetSupportsManagerTools = editTargetSupportsStorageOps;
  const createTargetSupportsManagerTools = createTargetSupportsStorageOps;
  const createCanGrantCephAdmin = currentIsSuperAdmin && createTargetSupportsCephAdmin;
  const createCanGrantStorageOps = currentIsAdminLike && createTargetSupportsStorageOps;
  const editCanGrantCephAdmin = currentIsSuperAdmin && editTargetSupportsCephAdmin;
  const editCanGrantStorageOps = currentIsAdminLike && editTargetSupportsStorageOps;

  const toggleSort = (field: AdminUsersSortField) => {
    setSort((prev) => {
      if (prev.field === field) {
        return { field, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { field, direction: "desc" };
    });
    setPage(1);
  };

  const handleFilterChange = (value: string) => {
    setFilter(value);
    setPage(1);
  };

  const handlePageChange = (nextPage: number) => {
    if (nextPage === page) return;
    setPage(Math.max(1, nextPage));
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const searchValue = filter.trim();
      const response = await listUsers({
        page,
        page_size: pageSize,
        search: searchValue || undefined,
        sort_by: sort.field,
        sort_dir: sort.direction,
      });
      const totalPages = pageCount(response.total || 0, pageSize);
      if (response.total > 0 && page > totalPages) {
        setPage(totalPages);
        return;
      }
      setUsers(response.items);
      setTotalUsers(response.total);
    } catch (err) {
      setError(extractApiError(err, textRef.current("loadError")));
    } finally {
      setLoading(false);
    }
  }, [filter, page, pageSize, sort.direction, sort.field]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    if ((showCreateModal && createModalTab === "groups") || (showEditModal && editModalTab === "groups")) {
      void ensureGroups({ retryOnError: true });
    }
  }, [createModalTab, editModalTab, ensureGroups, showCreateModal, showEditModal]);

  const emptyCreateSignature = () => emptyAdminUserEditorSignature(createFormTemplate());

  const createCurrentSignature = useMemo(
    () =>
      adminUserEditorSignature({
        form,
        selectedAccounts: createSelectedS3Accounts,
        selectedS3Users: createSelectedS3Users,
        selectedS3Connections: createSelectedS3Connections,
        selectedGroups: createSelectedGroups,
        pendingAccountSelections: createAccountSelections,
        pendingS3UserSelections: createS3UserSelections,
        pendingConnectionSelections: createConnectionSelections,
        pendingGroupSelections: createGroupSelections,
        accountAccessChoice: createAccountAccessChoice,
      }),
    [
      createAccountAccessChoice,
      createAccountSelections,
      createConnectionSelections,
      createGroupSelections,
      createS3UserSelections,
      createSelectedS3Accounts,
      createSelectedS3Connections,
      createSelectedGroups,
      createSelectedS3Users,
      form,
    ]
  );

  const resetCreateModalState = () => {
    setCreateAttempted(false);
    setForm(createFormTemplate());
    resetCreateAssociations();
    setCreateModalTab("general");
    setCreateRoleHelpOpen(false);
    setCreateInitialSignature(emptyCreateSignature());
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setActionError(null);
    resetCreateModalState();
  };

  const editCurrentSignature = useMemo(
    () =>
      adminUserEditorSignature({
        form: editForm,
        selectedAccounts: editSelectedS3Accounts,
        selectedS3Users: editSelectedS3Users,
        selectedS3Connections: editSelectedS3Connections,
        selectedGroups: editSelectedGroups,
        pendingAccountSelections: editAccountSelections,
        pendingS3UserSelections: editS3UserSelections,
        pendingConnectionSelections: editConnectionSelections,
        pendingGroupSelections: editGroupSelections,
        accountAccessChoice: editAccountAccessChoice,
      }),
    [
      editAccountAccessChoice,
      editAccountSelections,
      editConnectionSelections,
      editGroupSelections,
      editForm,
      editS3UserSelections,
      editSelectedS3Accounts,
      editSelectedS3Connections,
      editSelectedGroups,
      editSelectedS3Users,
    ]
  );

  const closeEditModal = () => {
    setShowEditModal(false);
    setEditingUser(null);
    resetEditAssociations();
    setEditModalTab("general");
    setEditForm({});
    setEditRoleHelpOpen(false);
    setEditInitialSignature(emptyAdminUserEditorSignature({}));
    clearAdminPrincipalEditRequest();
  };

  const roleAccessPatch = (role: UiRole, current: UpdateUserPayload) => {
    const supportsCephAdmin = isAdminLikeRole(role);
    const supportsStorageOps = roleSupportsOperationalAccess(role);
    return {
      role,
      can_access_ceph_admin: currentIsSuperAdmin && supportsCephAdmin ? Boolean(current.can_access_ceph_admin) : false,
      can_access_storage_ops: currentIsAdminLike && supportsStorageOps ? Boolean(current.can_access_storage_ops) : false,
      can_create_manual_private_connections: supportsStorageOps ? Boolean(current.can_create_manual_private_connections) : false,
      can_provision_managed_private_connections: supportsStorageOps ? Boolean(current.can_provision_managed_private_connections) : false,
    };
  };

  const createDirty = showCreateModal && createCurrentSignature !== createInitialSignature;
  const editMainDirty = showEditModal && editCurrentSignature !== editInitialSignature;
  const editDirty = showEditModal && (editMainDirty || authenticationDirty || avatarDirty);
  const createCloseGuard = useSettingsCloseGuard({
    hasUnsavedChanges: createDirty,
    ...discardLabels,
    onClose: closeCreateModal,
    disabled: creating,
  });

  const editCloseGuard = useSettingsCloseGuard({
    hasUnsavedChanges: editDirty,
    ...discardLabels,
    onClose: closeEditModal,
    disabled: authenticationBusy || avatarBusy || (editingUser ? busyId === editingUser.id : false),
  });

  const pendingEditTab = useRef<UserModalTab>("general");
  const editTabGuard = useSettingsCloseGuard({
    hasUnsavedChanges: authenticationDirty || avatarDirty,
    ...discardLabels,
    disabled: authenticationBusy || avatarBusy,
    onClose: () => setEditModalTab(pendingEditTab.current),
  });

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (savingRef.current) return;
    setActionError(null);
    setActionMessage(null);
    const errors = userIdentityErrors(form, true, adminUserText);
    setCreateAttempted(true);
    if (Object.keys(errors).length) {
      setCreateModalTab("general");
      focusIdentityError("create-user", errors);
      return;
    }
    if (createSelectedS3Accounts.some((entry) => !hasAccountAccessRole(entry))) {
      setCreateModalTab("associations");
      setCreateAssociationsTab("accounts");
      setActionError(getAccountAccessRequiredMessage(showPortalRole));
      return;
    }
    const role = form.role ?? "ui_user";
    const payload: CreateUserPayload = {
      email: form.email,
      full_name: form.full_name?.trim() || null,
      password: form.password,
      role,
      can_access_ceph_admin:
        currentIsSuperAdmin && isAdminLikeRole(role)
          ? Boolean(form.can_access_ceph_admin)
          : false,
      can_access_storage_ops:
        currentIsAdminLike && roleSupportsOperationalAccess(role)
          ? Boolean(form.can_access_storage_ops)
          : false,
      can_create_manual_private_connections: createTargetSupportsManagerTools
        ? Boolean(form.can_create_manual_private_connections)
        : false,
      can_provision_managed_private_connections: createTargetSupportsManagerTools
        ? Boolean(form.can_provision_managed_private_connections)
        : false,
      manager_tool_access: createTargetSupportsManagerTools
        ? normalizeManagerToolAccess(form.manager_tool_access)
        : { ...DEFAULT_MANAGER_TOOL_ACCESS },
      browser_advanced_features_enabled: Boolean(form.browser_advanced_features_enabled),
      group_ids: createSelectedGroups,
    };
    savingRef.current = true;
    setCreating(true);
    try {
      const created = await runWithStepUp(() => createUser(payload));
      if (created?.id) {
        const associationsPayload: UpdateUserPayload = {
          account_links: createSelectedS3Accounts.map((entry) => ({
            account_id: Number(entry.id),
            manager_role: entry.manager_role,
            portal_role: entry.portal_role,
            allow_manager_browser_data_access: entry.allow_manager_browser_data_access,
          })),
        };
        if (createSelectedS3Users.length > 0) {
          associationsPayload.s3_user_links = createSelectedS3Users;
        }
        if (createSelectedS3Connections.length > 0) {
          associationsPayload.s3_connection_ids = createSelectedS3Connections;
        }
        if (Object.keys(associationsPayload).length > 0) {
          await runWithStepUp(() => updateUser(created.id, associationsPayload));
        }
      }
      setActionMessage(text("userCreated"));
      resetCreateModalState();
      await fetchUsers();
      if (s3AccountsLoaded) {
        await refreshS3Accounts();
      }
      setShowCreateModal(false);
    } catch (err) {
      if (!isRecentWebAuthnVerificationCancelled(err)) {
        setActionError(extractApiError(err, text("unexpectedError")));
      }
    } finally {
      savingRef.current = false;
      setCreating(false);
    }
  };

  const startEdit = (user: User) => {
    if (!currentIsSuperAdmin && isAdminLikeRole(user.role)) {
      setActionError(text("standardUsersOnly"));
      return;
    }
    const role = user.role;
    const nextEditForm = {
      email: user.email,
      full_name: user.full_name ?? "",
      ui_language: user.ui_language ?? null,
      quota_alerts_enabled: user.quota_alerts_enabled !== false,
      quota_alerts_global_watch: Boolean(user.quota_alerts_global_watch),
      role,
      can_access_ceph_admin:
        isAdminLikeRole(role)
          ? Boolean(user.can_access_ceph_admin)
          : false,
      can_access_storage_ops:
        roleSupportsOperationalAccess(role)
          ? Boolean(user.can_access_storage_ops)
          : false,
      can_create_manual_private_connections:
        roleSupportsOperationalAccess(role)
          ? Boolean(user.can_create_manual_private_connections)
          : false,
      can_provision_managed_private_connections:
        roleSupportsOperationalAccess(role)
          ? Boolean(user.can_provision_managed_private_connections)
          : false,
      manager_tool_access: normalizeManagerToolAccess(user.manager_tool_access),
      browser_advanced_features_enabled: Boolean(user.browser_advanced_features_enabled),
    };
    setEditAttempted(false);
    setEditingUser(user);
    setEditForm(nextEditForm);
    const selectedAccounts = (user.account_links ?? []).map((link) => ({
      id: Number(link.account_id),
      manager_role: link.manager_role,
      portal_role: link.portal_role,
      allow_manager_browser_data_access: link.allow_manager_browser_data_access,
    }));
    const nextSelectedS3Users = (user.s3_user_links ?? []).map((link) => ({
      s3_user_id: Number(link.s3_user_id),
      allow_manager_browser_data_access: link.allow_manager_browser_data_access,
    }));
    const nextSelectedS3Connections = (user.s3_connection_details ?? []).map((connection) => Number(connection.id));
    const nextSelectedGroups = (user.group_details ?? []).map((group) => Number(group.id));
    const hasAccounts = selectedAccounts.length > 0;
    const hasS3Users = nextSelectedS3Users.length > 0;
    const hasConnections = nextSelectedS3Connections.length > 0;
    const initialAssociationsTab: AssociationTab = hasAccounts
      ? "accounts"
      : hasS3Users
        ? "s3_users"
        : hasConnections
          ? "connections"
          : "accounts";
    resetEditAssociations({
      selectedS3Accounts: selectedAccounts,
      selectedS3Users: nextSelectedS3Users,
      selectedS3Connections: nextSelectedS3Connections,
      selectedGroups: nextSelectedGroups,
      associationsTab: initialAssociationsTab,
    });
    setEditInitialSignature(
      adminUserEditorSignature({
        form: nextEditForm,
        selectedAccounts,
        selectedS3Users: nextSelectedS3Users,
        selectedS3Connections: nextSelectedS3Connections,
        selectedGroups: nextSelectedGroups,
        pendingAccountSelections: [],
        pendingS3UserSelections: [],
        pendingConnectionSelections: [],
        pendingGroupSelections: [],
        accountAccessChoice: {},
      })
    );
    setEditModalTab("general");
    setEditRoleHelpOpen(false);
    setActionError(null);
    setActionMessage(null);
    setShowEditModal(true);
    void ensureAssociationOptionsForTab(initialAssociationsTab, { retryOnError: true });
  };

  startEditRef.current = startEdit;
  useEffect(() => {
    if (!principalEditRequest || requestedEditHandledRef.current) return;
    const requestedUser = users.find((user) => user.id === principalEditRequest.id);
    if (!requestedUser) return;
    requestedEditHandledRef.current = true;
    startEditRef.current(requestedUser);
  }, [principalEditRequest, users]);

  const submitEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingUser || savingRef.current || avatarBusy || editModalTab === "authentication") return;
    setActionError(null);
    setActionMessage(null);
    const errors = userIdentityErrors(editForm, false, adminUserText);
    setEditAttempted(true);
    if (Object.keys(errors).length) {
      setEditModalTab("general");
      focusIdentityError("edit-user", errors);
      return;
    }
    if (editSelectedS3Accounts.some((entry) => !hasAccountAccessRole(entry))) {
      setEditModalTab("associations");
      setEditAssociationsTab("accounts");
      setActionError(getAccountAccessRequiredMessage(showPortalRole));
      return;
    }
    savingRef.current = true;
    setBusyId(editingUser.id);
    try {
      const payload: UpdateUserPayload = {};
      const nextRole = editForm.role ?? editingUser.role;
      if (editForm.email) {
        payload.email = editForm.email;
      }
      payload.full_name = editForm.full_name?.trim() || null;
      payload.ui_language = editForm.ui_language ?? null;
      payload.quota_alerts_enabled = editForm.quota_alerts_enabled !== false;
      payload.quota_alerts_global_watch = isAdminLikeRole(nextRole) && Boolean(editForm.quota_alerts_global_watch);
      if (editForm.role) {
        payload.role = nextRole;
      }
      payload.can_access_ceph_admin =
        currentIsSuperAdmin && isAdminLikeRole(nextRole)
          ? Boolean(editForm.can_access_ceph_admin ?? editingUser.can_access_ceph_admin)
          : false;
      payload.can_access_storage_ops =
        currentIsAdminLike && roleSupportsOperationalAccess(nextRole)
          ? Boolean(editForm.can_access_storage_ops ?? editingUser.can_access_storage_ops)
          : false;
      const nextRoleSupportsConnectionPermissions = roleSupportsOperationalAccess(nextRole);
      payload.can_create_manual_private_connections = nextRoleSupportsConnectionPermissions
        ? Boolean(
            editForm.can_create_manual_private_connections ??
              editingUser.can_create_manual_private_connections
          )
        : false;
      payload.can_provision_managed_private_connections = nextRoleSupportsConnectionPermissions
        ? Boolean(
            editForm.can_provision_managed_private_connections ??
              editingUser.can_provision_managed_private_connections
          )
        : false;
      payload.manager_tool_access =
        roleSupportsOperationalAccess(nextRole)
          ? normalizeManagerToolAccess(editForm.manager_tool_access ?? editingUser.manager_tool_access)
          : { ...DEFAULT_MANAGER_TOOL_ACCESS };
      payload.browser_advanced_features_enabled = Boolean(
        editForm.browser_advanced_features_enabled ?? editingUser.browser_advanced_features_enabled
      );
      payload.account_links = editSelectedS3Accounts.map((entry) => ({
        account_id: Number(entry.id),
        manager_role: entry.manager_role,
        portal_role: entry.portal_role,
        allow_manager_browser_data_access: entry.allow_manager_browser_data_access,
      }));
      payload.group_ids = editSelectedGroups;
      payload.s3_user_links = editSelectedS3Users;
      payload.s3_connection_ids = editSelectedS3Connections;
      const updatedUser = await runWithStepUp(() => updateUser(editingUser.id, payload));
      if (currentUserId !== null && currentUserId === editingUser.id && typeof window !== "undefined") {
        setSessionUserCache({ ...(readStoredUser() ?? {}), ...updatedUser });
      }
      const savedForm: UpdateUserPayload = {
        ...editForm,
        email: updatedUser.email,
        full_name: updatedUser.full_name ?? "",
        ui_language: updatedUser.ui_language ?? null,
        quota_alerts_enabled: updatedUser.quota_alerts_enabled !== false,
        quota_alerts_global_watch: Boolean(updatedUser.quota_alerts_global_watch),
        role: updatedUser.role,
        can_access_ceph_admin: Boolean(updatedUser.can_access_ceph_admin),
        can_access_storage_ops: Boolean(updatedUser.can_access_storage_ops),
        can_create_manual_private_connections: Boolean(updatedUser.can_create_manual_private_connections),
        can_provision_managed_private_connections: Boolean(updatedUser.can_provision_managed_private_connections),
        manager_tool_access: normalizeManagerToolAccess(updatedUser.manager_tool_access),
        browser_advanced_features_enabled: Boolean(updatedUser.browser_advanced_features_enabled),
      };
      setEditingUser(updatedUser);
      setEditForm(savedForm);
      clearEditPendingAssociationSelections();
      setEditInitialSignature(adminUserEditorSignature({
        form: savedForm,
        selectedAccounts: editSelectedS3Accounts,
        selectedS3Users: editSelectedS3Users,
        selectedS3Connections: editSelectedS3Connections,
        selectedGroups: editSelectedGroups,
        pendingAccountSelections: [],
        pendingS3UserSelections: [],
        pendingConnectionSelections: [],
        pendingGroupSelections: [],
        accountAccessChoice: {},
      }));
      setActionMessage(text("userUpdated"));
      await fetchUsers();
      if (s3AccountsLoaded) {
        await refreshS3Accounts();
      }
    } catch (err) {
      if (!isRecentWebAuthnVerificationCancelled(err)) {
        setActionError(extractApiError(err, text("unexpectedError")));
      }
    } finally {
      savingRef.current = false;
      setBusyId(null);
    }
  };

  const handleDeleteRequest = (user: User) => {
    const userId = user.id;
    if (currentUserId !== null && userId === currentUserId) {
      setActionError(text("cannotDeleteSelf"));
      setActionMessage(null);
      return;
    }
    setPendingDeleteUser(user);
  };

  const handleDeleteConfirm = async () => {
    if (!pendingDeleteUser) return;
    const userId = pendingDeleteUser.id;
    setBusyId(userId);
    setActionError(null);
    setActionMessage(null);
    try {
      await runWithStepUp(() => deleteUser(userId));
      setActionMessage(text("userDeleted"));
      await fetchUsers();
      setPendingDeleteUser(null);
    } catch (err) {
      if (!isRecentWebAuthnVerificationCancelled(err)) {
        setActionError(extractApiError(err, text("unexpectedError")));
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className={workflowPageHostClass(showCreateModal || (Boolean(editingUser) && showEditModal))}>
      <SettingsNavigationGuard {...discardLabels} dirty={createDirty || editDirty} onDiscard={() => {
        if (showCreateModal) closeCreateModal();
        if (showEditModal) closeEditModal();
      }} />
      <PageHeader actionPresentation="listing"
        title={text("uiUsers")}
        description={text("description")}
        breadcrumbs={usersBreadcrumbs()}
        actions={[
          {
            label: text("createUser"),
            onClick: () => {
              resetCreateModalState();
              setShowCreateModal(true);
              void ensureS3Accounts({ retryOnError: true });
            },
          },
        ]}
      />
      {actionError && <PageBanner tone="error">{actionError}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}

      {showCreateModal && (
        <WorkflowPage
          title={text("createUser")}
          description={text("createDescription")}
          breadcrumbs={usersBreadcrumbs(text("create"))}
          backLabel={text("backToUsers")}
          onBack={createCloseGuard.requestClose}
          backDisabled={creating}
          contentClassName="settings-compact settings-form"
          contentVariant="plain"
          width="wide"
        >
          {actionError && (
            <PageBanner tone="error" className="mb-3">
              {actionError}
            </PageBanner>
          )}
          {actionMessage && (
            <PageBanner tone="success" className="mb-3">
              {actionMessage}
            </PageBanner>
          )}
          <SettingsForm label={text("createUiUser")} busy={creating} onSubmit={handleCreate}
            onCancel={createCloseGuard.requestClose} submitLabel={text("create")} busyLabel={text("creating")}
            actions={<>
              <SettingsButton variant="secondary" disabled={creating} onClick={createCloseGuard.requestClose}>{text("cancel")}</SettingsButton>
              <SettingsButton type="submit" disabled={creating}>{text(creating ? "creating" : "create")}</SettingsButton>
            </>}>
            <WorkflowTabs<UserModalTab>
              panelClassName={createModalTab === "groups" || createModalTab === "associations" ? adminAssociationPanelClass : undefined}
              activeTab={createModalTab}
              onTabChange={setCreateModalTab}
              ariaLabel={text("creationSections")}
              idPrefix="admin-user-create"
              tabs={userWorkflowTabs}
            >

            {createModalTab === "general" && (
              <AdminUserIdentityFields
                idPrefix="create-user"
                values={{ ...form, role: createRoleValue }}
                creating
                errors={createAttempted ? userIdentityErrors(form, true, adminUserText) : {}}
                onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
                canAssignAdmin={currentIsSuperAdmin}
                helpOpen={createRoleHelpOpen}
                onToggleHelp={() => setCreateRoleHelpOpen((open) => !open)}
                onRoleChange={(value) => setForm((current) => ({ ...current, ...roleAccessPatch(value, current) }))}
              />
            )}

            {createModalTab === "access" && (
              <AdminUserPlatformAccessPanel
                value={form}
                canGrantCephAdmin={createCanGrantCephAdmin}
                canGrantStorageOps={createCanGrantStorageOps}
                supportsManagerTools={createTargetSupportsManagerTools}
                managerFeaturePolicies={generalSettings.manager_feature_policies}
                text={text}
                onChange={(patch) =>
                  setForm((current) => ({ ...current, ...patch }))
                }
              />
            )}

            {createModalTab === "associations" && (
              <UserAssociationsTabs
                activeTab={createAssociationsTab}
                onTabChange={(nextTab) => {
                  const tabChanged = nextTab !== createAssociationsTab;
                  setCreateAssociationsTab(nextTab);
                  setShowCreateAccountPanel(false);
                  setShowCreateS3UserPanel(false);
                  setShowCreateConnectionPanel(false);
                  if (tabChanged) {
                    void ensureAssociationOptionsForTab(nextTab, { retryOnError: true });
                  }
                }}
                maxVisibleOptions={MAX_VISIBLE_OPTIONS}
                showPortalRole={showPortalRole}
                accounts={{
                  selected: createSelectedS3Accounts,
                  setSelected: setCreateSelectedS3Accounts,
                  optionsById: accountOptionsById,
                  available: availableCreateS3Accounts,
                  visible: visibleCreateS3Accounts,
                  search: createS3AccountSearch,
                  setSearch: setCreateS3AccountSearch,
                  loading: s3AccountsLoading,
                  showPanel: showCreateAccountPanel,
                  setShowPanel: setShowCreateAccountPanel,
                  selections: createAccountSelections,
                  setSelections: setCreateAccountSelections,
                  accountAccessChoice: createAccountAccessChoice,
                  setAccountAccessChoice: setCreateAccountAccessChoice,
                  toggleSelection: toggleCreateAccountSelection,
                }}
                s3Users={{
                  selected: createSelectedS3Users,
                  setSelected: setCreateSelectedS3Users,
                  labelById: s3UserLabelById,
                  available: availableCreateS3Users,
                  visible: visibleCreateS3Users,
                  search: createS3Search,
                  setSearch: setCreateS3Search,
                  loading: s3UsersLoading,
                  showPanel: showCreateS3UserPanel,
                  setShowPanel: setShowCreateS3UserPanel,
                  selections: createS3UserSelections,
                  setSelections: setCreateS3UserSelections,
                  toggleSelection: toggleCreateS3UserSelection,
                }}
                connections={{
                  selected: createSelectedS3Connections,
                  setSelected: setCreateSelectedS3Connections,
                  labelById: s3ConnectionLabelById,
                  available: availableCreateS3Connections,
                  visible: visibleCreateS3Connections,
                  search: createConnectionSearch,
                  setSearch: setCreateConnectionSearch,
                  loading: s3ConnectionsLoading,
                  showPanel: showCreateConnectionPanel,
                  setShowPanel: setShowCreateConnectionPanel,
                  selections: createConnectionSelections,
                  setSelections: setCreateConnectionSelections,
                  toggleSelection: toggleCreateConnectionSelection,
                }}
              />
            )}

            {createModalTab === "groups" && (
              <UserGroupsSelector
                groups={groups}
                groupsLoaded={groupsLoaded}
                groupsLoading={groupsLoading}
                maxVisibleOptions={MAX_VISIBLE_OPTIONS}
                selectedIds={createSelectedGroups}
                setSelectedIds={setCreateSelectedGroups}
                search={createGroupSearch}
                setSearch={setCreateGroupSearch}
                visibleGroups={visibleCreateGroups}
                showPanel={showCreateGroupPanel}
                setShowPanel={setShowCreateGroupPanel}
                selections={createGroupSelections}
                setSelections={setCreateGroupSelections}
              />
            )}
            </WorkflowTabs>

          </SettingsForm>
          {createCloseGuard.confirmationDialog}
        </WorkflowPage>
      )}

      <AdminUsersList
        users={users}
        accountOptionsById={accountOptionsById}
        locale={locale}
        text={text}
        roleLabel={displayUiRole}
        cephAdminFeatureEnabled={cephAdminFeatureEnabled}
        currentUserId={currentUserId}
        currentIsSuperAdmin={currentIsSuperAdmin}
        busyId={busyId}
        loading={loading}
        error={error}
        totalUsers={totalUsers}
        filter={filter}
        onFilterChange={handleFilterChange}
        sort={sort}
        onSort={toggleSort}
        page={page}
        pageSize={pageSize}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
        onEdit={startEdit}
        onDelete={handleDeleteRequest}
      />

      {pendingDeleteUser && (
        <ConfirmActionDialog
          title={text("deleteUiUser")}
          description={text("deleteDescription")}
          confirmLabel={text("deleteUser")}
          cancelLabel={text("cancel")}
          processingLabel={text("processing")}
          impactLabel={text("impact")}
          closeLabel={closeLabel}
          details={[
            { label: text("user"), value: pendingDeleteUser.email, mono: true },
            { label: text("role"), value: displayUiRole(pendingDeleteUser.role) },
          ]}
          impacts={[
            text("immediateAccessLoss"),
            text("associationsRemain"),
          ]}
          loading={busyId === pendingDeleteUser.id}
          onCancel={() => setPendingDeleteUser(null)}
          onConfirm={() => void handleDeleteConfirm()}
        />
      )}

      {editingUser && showEditModal && (
        <WorkflowPage
          title={text("editUser")}
          description={text("editDescription")}
          breadcrumbs={usersBreadcrumbs(text("edit"))}
          backLabel={text("backToUsers")}
          onBack={editCloseGuard.requestClose}
          backDisabled={busyId === editingUser.id || authenticationBusy || avatarBusy}
          contentClassName="settings-compact settings-form"
          contentVariant="plain"
          width="wide"
          metaContent={<WorkflowMetadata items={[{ label: text("identity"), value: editingUser.email }]} />}
        >
          {actionError && (
            <PageBanner tone="error" className="mb-3">
              {actionError}
            </PageBanner>
          )}
          {actionMessage && (
            <PageBanner tone="success" className="mb-3">
              {actionMessage}
            </PageBanner>
          )}
          <SettingsForm label={text("editUiUser")} busy={busyId === editingUser.id || avatarBusy} onSubmit={submitEdit}
            onCancel={editCloseGuard.requestClose} submitLabel={text("save")} busyLabel={text("saving")}
            actions={editModalTab === "authentication" ? (
              <SettingsButton variant="secondary" disabled={authenticationBusy} onClick={editCloseGuard.requestClose}>{text("done")}</SettingsButton>
            ) : <SettingsPersistentEditActions dirty={editDirty} busy={busyId === editingUser.id || avatarBusy}
              disabled={!editMainDirty} onCancel={editCloseGuard.requestClose} saveLabel={text("save")}
              savingLabel={text("saving")} cancelLabel={text("cancel")} doneLabel={text("done")} />}>
            <WorkflowTabs<UserModalTab>
              panelClassName={editModalTab === "groups" || editModalTab === "associations" ? adminAssociationPanelClass : undefined}
              activeTab={editModalTab}
              onTabChange={(tab) => {
                if (tab === editModalTab) return;
                pendingEditTab.current = tab;
                editTabGuard.requestClose();
              }}
              ariaLabel={text("configurationSections")}
              idPrefix="admin-user-edit"
              tabs={editUserWorkflowTabs.map((tab) => ({ ...tab, disabled: authenticationBusy || avatarBusy }))}
            >

            {editModalTab === "general" && (
              <AdminUserProfilePanel
                user={editingUser}
                values={editForm}
                role={editRoleValue}
                errors={editAttempted ? userIdentityErrors(editForm, false, adminUserText) : {}}
                canAssignAdmin={currentIsSuperAdmin}
                roleHelpOpen={editRoleHelpOpen}
                busy={busyId === editingUser.id || avatarBusy}
                text={adminProfileText}
                onChange={(patch) => setEditForm((current) => ({ ...current, ...patch }))}
                onToggleRoleHelp={() => setEditRoleHelpOpen((open) => !open)}
                onRoleChange={(value) => setEditForm((current) => ({ ...current, ...roleAccessPatch(value, current) }))}
                onAvatarDirtyChange={setAvatarDirty}
                onAvatarBusyChange={setAvatarBusy}
                onAvatarSave={async (draft) => {
                  const updated = draft.file && draft.preference === "uploaded" ? await uploadUserAvatar(editingUser.id, draft.file)
                    : draft.remove ? await deleteUserAvatar(editingUser.id) : await updateUser(editingUser.id, { avatar_preference: draft.preference });
                  setEditingUser(current => current ? { ...current, avatar: updated.avatar } : current);
                  setUsers(current => current.map(user => user.id === editingUser.id ? { ...user, avatar: updated.avatar } : user));
                  if (currentUserId === editingUser.id) setSessionUserCache({ ...(readStoredUser() ?? {}), avatar: updated.avatar });
                  setActionMessage(adminProfileText("imageSaved"));
                }}
              />
            )}

            {editModalTab === "authentication" && (
              <UserAuthenticationPanel
                key={editingUser.id}
                userId={editingUser.id}
                onBusyChange={setAuthenticationBusy}
                onDirtyChange={setAuthenticationDirty}
                canMutate={currentUserId === null || currentUserId !== editingUser.id}
              />
            )}

            {editModalTab === "access" && (
              <AdminUserPlatformAccessPanel
                value={{
                  ...editForm,
                  manager_tool_access:
                    editForm.manager_tool_access ?? editingUser.manager_tool_access,
                  browser_advanced_features_enabled:
                    editForm.browser_advanced_features_enabled ??
                    editingUser.browser_advanced_features_enabled,
                }}
                canGrantCephAdmin={editCanGrantCephAdmin}
                canGrantStorageOps={editCanGrantStorageOps}
                supportsManagerTools={editTargetSupportsManagerTools}
                managerFeaturePolicies={generalSettings.manager_feature_policies}
                inheritedManagerToolAccess={
                  editingUser.effective_access?.group_manager_tool_access
                }
                inheritedManagedProvisioning={Boolean(
                  editingUser.effective_access
                    ?.group_can_provision_managed_private_connections,
                )}
                text={text}
                onChange={(patch) =>
                  setEditForm((current) => ({ ...current, ...patch }))
                }
              />
            )}

            {editModalTab === "associations" && (
              <UserAssociationsTabs
                activeTab={editAssociationsTab}
                onTabChange={(nextTab) => {
                  const tabChanged = nextTab !== editAssociationsTab;
                  setEditAssociationsTab(nextTab);
                  setShowEditAccountPanel(false);
                  setShowEditS3UserPanel(false);
                  setShowEditConnectionPanel(false);
                  if (tabChanged) {
                    void ensureAssociationOptionsForTab(nextTab, { retryOnError: true });
                  }
                }}
                maxVisibleOptions={MAX_VISIBLE_OPTIONS}
                showPortalRole={showPortalRole}
                accounts={{
                  selected: editSelectedS3Accounts,
                  setSelected: setEditSelectedS3Accounts,
                  optionsById: accountOptionsById,
                  available: availableEditS3Accounts,
                  visible: visibleEditS3Accounts,
                  search: editS3AccountSearch,
                  setSearch: setEditS3AccountSearch,
                  loading: s3AccountsLoading,
                  showPanel: showEditAccountPanel,
                  setShowPanel: setShowEditAccountPanel,
                  selections: editAccountSelections,
                  setSelections: setEditAccountSelections,
                  accountAccessChoice: editAccountAccessChoice,
                  setAccountAccessChoice: setEditAccountAccessChoice,
                  toggleSelection: toggleEditAccountSelection,
                }}
                s3Users={{
                  selected: editSelectedS3Users,
                  setSelected: setEditSelectedS3Users,
                  labelById: s3UserLabelById,
                  available: availableEditS3Users,
                  visible: visibleEditS3Users,
                  search: editS3Search,
                  setSearch: setEditS3Search,
                  loading: s3UsersLoading,
                  showPanel: showEditS3UserPanel,
                  setShowPanel: setShowEditS3UserPanel,
                  selections: editS3UserSelections,
                  setSelections: setEditS3UserSelections,
                  toggleSelection: toggleEditS3UserSelection,
                }}
                connections={{
                  selected: editSelectedS3Connections,
                  setSelected: setEditSelectedS3Connections,
                  labelById: s3ConnectionLabelById,
                  available: availableEditS3Connections,
                  visible: visibleEditS3Connections,
                  search: editConnectionSearch,
                  setSearch: setEditConnectionSearch,
                  loading: s3ConnectionsLoading,
                  showPanel: showEditConnectionPanel,
                  setShowPanel: setShowEditConnectionPanel,
                  selections: editConnectionSelections,
                  setSelections: setEditConnectionSelections,
                  toggleSelection: toggleEditConnectionSelection,
                }}
              />
            )}

            {editModalTab === "groups" && (
              <UserGroupsSelector
                groups={groups}
                groupsLoaded={groupsLoaded}
                groupsLoading={groupsLoading}
                maxVisibleOptions={MAX_VISIBLE_OPTIONS}
                selectedIds={editSelectedGroups}
                setSelectedIds={setEditSelectedGroups}
                search={editGroupSearch}
                setSearch={setEditGroupSearch}
                visibleGroups={visibleEditGroups}
                showPanel={showEditGroupPanel}
                setShowPanel={setShowEditGroupPanel}
                selections={editGroupSelections}
                setSelections={setEditGroupSelections}
              />
            )}

            </WorkflowTabs>

          </SettingsForm>
          {editCloseGuard.confirmationDialog}
          {editTabGuard.confirmationDialog}
        </WorkflowPage>
      )}
      {verificationDialog}
    </div>
  );
}
