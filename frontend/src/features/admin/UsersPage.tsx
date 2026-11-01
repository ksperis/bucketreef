/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CreateUserPayload,
  type LdapImportSearchItem,
  UpdateUserPayload,
  User,
  type UiRole,
  createUser,
  deleteUser,
  deleteUserAvatar,
  importLdapUser,
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
import AdminUserLdapImportFields, { type UserCreationSource } from "./AdminUserLdapImportFields";
import SettingsNavigationGuard from "../../components/settings/SettingsNavigationGuard";
import { useProfileI18n } from "../shared/profileMessages";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";

import { extractApiError } from "../../utils/apiError";
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
import useAdminPaginatedListState from "./useAdminPaginatedListState";
import useAdminUserLdapImport from "./useAdminUserLdapImport";

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
  const openStackEnabled = generalSettings.openstack_enabled;
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
    openStackClouds,
    openStackCloudsLoading,
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
    allow_multisite_endpoint_switching: false,
    manager_tool_access: { ...DEFAULT_MANAGER_TOOL_ACCESS },
    browser_advanced_features_enabled: false,
  });
  const [form, setForm] = useState<CreateUserPayload>(() => createFormTemplate());
  const [createInitialSignature, setCreateInitialSignature] = useState(() =>
    JSON.stringify({
      editor: emptyAdminUserEditorSignature(createFormTemplate()),
      identity: { source: "local", provider_id: "", directory_dn: null },
    })
  );
  const [createModalTab, setCreateModalTab] = useState<UserModalTab>("general");
  const createAssociations = useAdminUserAssociationEditorState();
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState<UpdateUserPayload>({});
  const [editInitialSignature, setEditInitialSignature] = useState(() =>
    emptyAdminUserEditorSignature({})
  );
  const [editModalTab, setEditModalTab] = useState<UserModalTab>("general");
  const editAssociations = useAdminUserAssociationEditorState();
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
  const [createSource, setCreateSource] = useState<UserCreationSource>("local");
  const {
    providers: ldapProviders,
    providersLoading: ldapProvidersLoading,
    providerId: ldapProviderId,
    query: ldapQuery,
    searchLoading: ldapSearchLoading,
    searchError: ldapSearchError,
    items: ldapSearchItems,
    truncated: ldapSearchTruncated,
    searchPerformed: ldapSearchPerformed,
    selectedEntry: selectedLdapEntry,
    ensureProviders: ensureLdapProviders,
    changeProvider: handleLdapProviderChange,
    changeQuery: handleLdapQueryChange,
    clearResults: clearLdapResults,
    search: handleLdapSearch,
    select: selectLdapEntry,
    reset: resetLdapImport,
  } = useAdminUserLdapImport();
  const [createRoleHelpOpen, setCreateRoleHelpOpen] = useState(false);
  const [editRoleHelpOpen, setEditRoleHelpOpen] = useState(false);
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
  } = useAdminPaginatedListState<AdminUsersSortField>({
    initialFilter: principalEditRequest?.search ?? "",
    initialSort: { field: "name", direction: "asc" },
  });
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
  const openStackOptions = useMemo(
    () => openStackClouds.map((cloud) => ({ id: cloud.id, label: cloud.name })),
    [openStackClouds],
  );
  const openStackLabelById = useMemo(
    () => new Map(openStackClouds.map((cloud) => [cloud.id, cloud.name] as const)),
    [openStackClouds],
  );
  const availableCreateS3Accounts = useMemo(() => {
    const query = createAssociations.accounts.picker.search.trim().toLowerCase();
    const selectedIds = new Set(createAssociations.accounts.selected.map((a) => Number(a.id)));
    return accountOptions.filter(
      (a) => !selectedIds.has(Number(a.id)) && (!query || a.label.toLowerCase().includes(query))
    );
  }, [accountOptions, createAssociations.accounts.picker.search, createAssociations.accounts.selected]);
  const availableEditS3Accounts = useMemo(() => {
    const query = editAssociations.accounts.picker.search.trim().toLowerCase();
    const selectedIds = new Set(editAssociations.accounts.selected.map((a) => Number(a.id)));
    return accountOptions.filter(
      (a) => !selectedIds.has(Number(a.id)) && (!query || a.label.toLowerCase().includes(query))
    );
  }, [accountOptions, editAssociations.accounts.picker.search, editAssociations.accounts.selected]);
  const availableCreateS3Users = useMemo(() => {
    const query = createAssociations.s3Users.picker.search.trim().toLowerCase();
    return s3UserOptions.filter(
      (opt) => !createAssociations.s3Users.selected.some((link) => link.s3_user_id === opt.id) && (!query || opt.label.toLowerCase().includes(query))
    );
  }, [s3UserOptions, createAssociations.s3Users.selected, createAssociations.s3Users.picker.search]);
  const availableCreateS3Connections = useMemo(() => {
    const query = createAssociations.connections.picker.search.trim().toLowerCase();
    return s3SharedConnectionOptions.filter(
      (opt) =>
        !createAssociations.connections.selected.includes(opt.id) && (!query || opt.label.toLowerCase().includes(query))
    );
  }, [s3SharedConnectionOptions, createAssociations.connections.selected, createAssociations.connections.picker.search]);
  const availableEditS3Users = useMemo(() => {
    const query = editAssociations.s3Users.picker.search.trim().toLowerCase();
    return s3UserOptions.filter(
      (opt) => !editAssociations.s3Users.selected.some((link) => link.s3_user_id === opt.id) && (!query || opt.label.toLowerCase().includes(query))
    );
  }, [s3UserOptions, editAssociations.s3Users.selected, editAssociations.s3Users.picker.search]);
  const availableEditS3Connections = useMemo(() => {
    const query = editAssociations.connections.picker.search.trim().toLowerCase();
    return s3SharedConnectionOptions.filter(
      (opt) =>
        !editAssociations.connections.selected.includes(opt.id) &&
        (!query || opt.label.toLowerCase().includes(query))
    );
  }, [s3SharedConnectionOptions, editAssociations.connections.selected, editAssociations.connections.picker.search]);
  const availableCreateOpenStackClouds = useMemo(() => {
    const query = createAssociations.openStack.picker.search.trim().toLowerCase();
    return openStackOptions.filter(
      (option) =>
        !createAssociations.openStack.selected.includes(option.id) &&
        (!query || option.label.toLowerCase().includes(query)),
    );
  }, [createAssociations.openStack.picker.search, createAssociations.openStack.selected, openStackOptions]);
  const availableEditOpenStackClouds = useMemo(() => {
    const query = editAssociations.openStack.picker.search.trim().toLowerCase();
    return openStackOptions.filter(
      (option) =>
        !editAssociations.openStack.selected.includes(option.id) &&
        (!query || option.label.toLowerCase().includes(query)),
    );
  }, [editAssociations.openStack.picker.search, editAssociations.openStack.selected, openStackOptions]);
  const visibleCreateGroups = useMemo(() => {
    const query = createAssociations.groups.picker.search.trim().toLowerCase();
    return groups.filter(
      (group) =>
        !group.system_key &&
        !createAssociations.groups.selected.includes(group.id) &&
        (!query || group.name.toLowerCase().includes(query))
    );
  }, [createAssociations.groups.picker.search, createAssociations.groups.selected, groups]);
  const visibleEditGroups = useMemo(() => {
    const query = editAssociations.groups.picker.search.trim().toLowerCase();
    return groups.filter(
      (group) =>
        !group.system_key &&
        !editAssociations.groups.selected.includes(group.id) &&
        (!query || group.name.toLowerCase().includes(query))
    );
  }, [editAssociations.groups.picker.search, editAssociations.groups.selected, groups]);
  const limitedOptions = <T,>(options: T[]) => options.slice(0, MAX_VISIBLE_OPTIONS);
  const visibleCreateS3Accounts = limitedOptions(availableCreateS3Accounts);
  const visibleEditS3Accounts = limitedOptions(availableEditS3Accounts);
  const visibleCreateS3Users = limitedOptions(availableCreateS3Users);
  const visibleCreateS3Connections = limitedOptions(availableCreateS3Connections);
  const visibleEditS3Users = limitedOptions(availableEditS3Users);
  const visibleEditS3Connections = limitedOptions(availableEditS3Connections);
  const visibleCreateOpenStackClouds = limitedOptions(availableCreateOpenStackClouds);
  const visibleEditOpenStackClouds = limitedOptions(availableEditOpenStackClouds);
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
      if (!ensurePageInRange(response.total)) return;
      setUsers(response.items);
      setTotalUsers(response.total);
    } catch (err) {
      setError(extractApiError(err, textRef.current("loadError")));
    } finally {
      setLoading(false);
    }
  }, [ensurePageInRange, filter, page, pageSize, sort.direction, sort.field]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    if (showCreateModal) void ensureLdapProviders();
  }, [ensureLdapProviders, showCreateModal]);

  useEffect(() => {
    if ((showCreateModal && createModalTab === "groups") || (showEditModal && editModalTab === "groups")) {
      void ensureGroups({ retryOnError: true });
    }
  }, [createModalTab, editModalTab, ensureGroups, showCreateModal, showEditModal]);

  const emptyCreateSignature = () =>
    JSON.stringify({
      editor: emptyAdminUserEditorSignature(createFormTemplate()),
      identity: { source: "local", provider_id: "", directory_dn: null },
    });

  const createCurrentSignature = useMemo(
    () =>
      JSON.stringify({
        editor: adminUserEditorSignature({
          form,
          selectedAccounts: createAssociations.accounts.selected,
          selectedS3Users: createAssociations.s3Users.selected,
          selectedS3Connections: createAssociations.connections.selected,
          selectedOpenStackClouds: createAssociations.openStack.selected,
          selectedGroups: createAssociations.groups.selected,
          pendingAccountSelections: createAssociations.accounts.picker.selections,
          pendingS3UserSelections: createAssociations.s3Users.picker.selections,
          pendingConnectionSelections: createAssociations.connections.picker.selections,
          pendingOpenStackSelections: createAssociations.openStack.picker.selections,
          pendingGroupSelections: createAssociations.groups.picker.selections,
          accountAccessChoice: createAssociations.accounts.accessChoice,
        }),
        identity: {
          source: createSource,
          provider_id: createSource === "ldap" ? ldapProviderId : "",
          directory_dn: createSource === "ldap" ? selectedLdapEntry?.directory_dn ?? null : null,
        },
      }),
    [
      createAssociations.accounts.accessChoice,
      createAssociations.accounts.picker.selections,
      createAssociations.connections.picker.selections,
      createAssociations.openStack.picker.selections,
      createAssociations.groups.picker.selections,
      createAssociations.s3Users.picker.selections,
      createAssociations.accounts.selected,
      createAssociations.connections.selected,
      createAssociations.openStack.selected,
      createAssociations.groups.selected,
      createAssociations.s3Users.selected,
      createSource,
      form,
      ldapProviderId,
      selectedLdapEntry?.directory_dn,
    ]
  );

  const resetCreateModalState = () => {
    setCreateAttempted(false);
    setForm(createFormTemplate());
    setCreateSource("local");
    resetLdapImport();
    createAssociations.reset();
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
        selectedAccounts: editAssociations.accounts.selected,
        selectedS3Users: editAssociations.s3Users.selected,
        selectedS3Connections: editAssociations.connections.selected,
        selectedOpenStackClouds: editAssociations.openStack.selected,
        selectedGroups: editAssociations.groups.selected,
        pendingAccountSelections: editAssociations.accounts.picker.selections,
        pendingS3UserSelections: editAssociations.s3Users.picker.selections,
        pendingConnectionSelections: editAssociations.connections.picker.selections,
        pendingOpenStackSelections: editAssociations.openStack.picker.selections,
        pendingGroupSelections: editAssociations.groups.picker.selections,
        accountAccessChoice: editAssociations.accounts.accessChoice,
      }),
    [
      editAssociations.accounts.accessChoice,
      editAssociations.accounts.picker.selections,
      editAssociations.connections.picker.selections,
      editAssociations.openStack.picker.selections,
      editAssociations.groups.picker.selections,
      editForm,
      editAssociations.s3Users.picker.selections,
      editAssociations.accounts.selected,
      editAssociations.connections.selected,
      editAssociations.openStack.selected,
      editAssociations.groups.selected,
      editAssociations.s3Users.selected,
    ]
  );

  const closeEditModal = () => {
    setShowEditModal(false);
    setEditingUser(null);
    editAssociations.reset();
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

  const handleCreateSourceChange = (source: UserCreationSource) => {
    setCreateSource(source);
    setCreateAttempted(false);
    clearLdapResults();
    if (source === "ldap") {
      setForm((current) => ({ ...current, password: "" }));
      void ensureLdapProviders();
    } else {
      handleLdapQueryChange("");
    }
  };

  const handleSelectLdapEntry = (item: LdapImportSearchItem) => {
    selectLdapEntry(item);
    setCreateAttempted(false);
    setActionError(null);
    setForm((current) => ({
      ...current,
      email: item.email ?? "",
      full_name: item.full_name ?? "",
      password: "",
    }));
  };

  const handleExistingLdapIdentity = async (
    item: LdapImportSearchItem,
    action: "link" | "restore",
  ) => {
    const target = action === "link" ? item.email_match_user : item.linked_user;
    if (!target || savingRef.current) return;
    setActionError(null);
    setActionMessage(null);
    savingRef.current = true;
    setCreating(true);
    try {
      await runWithStepUp(() =>
        importLdapUser({
          selection_token: item.selection_token,
          action,
          target_user_id: target.id,
        })
      );
      setActionMessage(text(action === "link" ? "ldapIdentityLinked" : "ldapIdentityRestored"));
      resetCreateModalState();
      await fetchUsers();
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

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (savingRef.current) return;
    setActionError(null);
    setActionMessage(null);
    if (createSource === "ldap" && !selectedLdapEntry) {
      setCreateAttempted(true);
      setCreateModalTab("general");
      setActionError(text("selectLdapEntryRequired"));
      return;
    }
    const errors = userIdentityErrors(
      form,
      true,
      adminUserText,
      createSource === "local",
    );
    setCreateAttempted(true);
    if (Object.keys(errors).length) {
      setCreateModalTab("general");
      focusIdentityError("create-user", errors);
      return;
    }
    if (createAssociations.accounts.selected.some((entry) => !hasAccountAccessRole(entry))) {
      setCreateModalTab("associations");
      createAssociations.setTab("accounts");
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
      allow_multisite_endpoint_switching: createTargetSupportsManagerTools
        ? Boolean(form.allow_multisite_endpoint_switching)
        : false,
      manager_tool_access: createTargetSupportsManagerTools
        ? normalizeManagerToolAccess(form.manager_tool_access)
        : { ...DEFAULT_MANAGER_TOOL_ACCESS },
      browser_advanced_features_enabled: Boolean(form.browser_advanced_features_enabled),
      account_links: createAssociations.accounts.selected.map((entry) => ({
        account_id: Number(entry.id),
        manager_role: entry.manager_role,
        portal_role: entry.portal_role,
        allow_manager_browser_data_access: entry.allow_manager_browser_data_access,
      })),
      s3_user_links: createAssociations.s3Users.selected,
      s3_connection_ids: createAssociations.connections.selected,
      group_ids: createAssociations.groups.selected,
      ...(openStackEnabled ? { openstack_cloud_ids: createAssociations.openStack.selected } : {}),
    };
    savingRef.current = true;
    setCreating(true);
    try {
      if (createSource === "ldap" && selectedLdapEntry) {
        await runWithStepUp(() =>
          importLdapUser({
            selection_token: selectedLdapEntry.selection_token,
            action: "create",
            create: {
              email: payload.email,
              full_name: payload.full_name,
              role: payload.role,
              can_access_ceph_admin: payload.can_access_ceph_admin,
              can_access_storage_ops: payload.can_access_storage_ops,
              can_create_manual_private_connections: payload.can_create_manual_private_connections,
              can_provision_managed_private_connections: payload.can_provision_managed_private_connections,
              allow_multisite_endpoint_switching: payload.allow_multisite_endpoint_switching,
              manager_tool_access: payload.manager_tool_access,
              browser_advanced_features_enabled: payload.browser_advanced_features_enabled,
              account_links: payload.account_links,
              s3_user_links: payload.s3_user_links,
              s3_connection_ids: payload.s3_connection_ids,
              group_ids: payload.group_ids,
              openstack_cloud_ids: payload.openstack_cloud_ids,
            },
          })
        );
      } else {
        await runWithStepUp(() => createUser(payload));
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
      allow_multisite_endpoint_switching:
        roleSupportsOperationalAccess(role)
          ? Boolean(user.allow_multisite_endpoint_switching)
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
    const nextSelectedOpenStackClouds = (user.openstack_cloud_details ?? []).map((cloud) => Number(cloud.id));
    const nextSelectedGroups = (user.group_details ?? []).map((group) => Number(group.id));
    const hasAccounts = selectedAccounts.length > 0;
    const hasS3Users = nextSelectedS3Users.length > 0;
    const hasConnections = nextSelectedS3Connections.length > 0;
    const hasOpenStack = nextSelectedOpenStackClouds.length > 0;
    const initialAssociationsTab: AssociationTab = hasAccounts
      ? "accounts"
      : hasS3Users
        ? "s3_users"
        : hasConnections
          ? "connections"
          : hasOpenStack
            ? "openstack"
          : "accounts";
    editAssociations.reset({
      selectedS3Accounts: selectedAccounts,
      selectedS3Users: nextSelectedS3Users,
      selectedS3Connections: nextSelectedS3Connections,
      selectedOpenStackClouds: nextSelectedOpenStackClouds,
      selectedGroups: nextSelectedGroups,
      associationsTab: initialAssociationsTab,
    });
    setEditInitialSignature(
      adminUserEditorSignature({
        form: nextEditForm,
        selectedAccounts,
        selectedS3Users: nextSelectedS3Users,
        selectedS3Connections: nextSelectedS3Connections,
        selectedOpenStackClouds: nextSelectedOpenStackClouds,
        selectedGroups: nextSelectedGroups,
        pendingAccountSelections: [],
        pendingS3UserSelections: [],
        pendingConnectionSelections: [],
        pendingOpenStackSelections: [],
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
    if (editAssociations.accounts.selected.some((entry) => !hasAccountAccessRole(entry))) {
      setEditModalTab("associations");
      editAssociations.setTab("accounts");
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
      payload.allow_multisite_endpoint_switching = nextRoleSupportsConnectionPermissions
        ? Boolean(
            editForm.allow_multisite_endpoint_switching ??
              editingUser.allow_multisite_endpoint_switching
          )
        : false;
      payload.manager_tool_access =
        roleSupportsOperationalAccess(nextRole)
          ? normalizeManagerToolAccess(editForm.manager_tool_access ?? editingUser.manager_tool_access)
          : { ...DEFAULT_MANAGER_TOOL_ACCESS };
      payload.browser_advanced_features_enabled = Boolean(
        editForm.browser_advanced_features_enabled ?? editingUser.browser_advanced_features_enabled
      );
      payload.account_links = editAssociations.accounts.selected.map((entry) => ({
        account_id: Number(entry.id),
        manager_role: entry.manager_role,
        portal_role: entry.portal_role,
        allow_manager_browser_data_access: entry.allow_manager_browser_data_access,
      }));
      payload.group_ids = editAssociations.groups.selected;
      payload.s3_user_links = editAssociations.s3Users.selected;
      payload.s3_connection_ids = editAssociations.connections.selected;
      if (openStackEnabled) payload.openstack_cloud_ids = editAssociations.openStack.selected;
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
        allow_multisite_endpoint_switching: Boolean(updatedUser.allow_multisite_endpoint_switching),
        manager_tool_access: normalizeManagerToolAccess(updatedUser.manager_tool_access),
        browser_advanced_features_enabled: Boolean(updatedUser.browser_advanced_features_enabled),
      };
      setEditingUser(updatedUser);
      setEditForm(savedForm);
      editAssociations.clearPendingSelections();
      setEditInitialSignature(adminUserEditorSignature({
        form: savedForm,
        selectedAccounts: editAssociations.accounts.selected,
        selectedS3Users: editAssociations.s3Users.selected,
        selectedS3Connections: editAssociations.connections.selected,
        selectedOpenStackClouds: editAssociations.openStack.selected,
        selectedGroups: editAssociations.groups.selected,
        pendingAccountSelections: [],
        pendingS3UserSelections: [],
        pendingConnectionSelections: [],
        pendingOpenStackSelections: [],
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
              <>
                <AdminUserLdapImportFields
                  source={createSource}
                  onSourceChange={handleCreateSourceChange}
                  providers={ldapProviders}
                  providersLoading={ldapProvidersLoading}
                  providerId={ldapProviderId}
                  onProviderChange={handleLdapProviderChange}
                  query={ldapQuery}
                  onQueryChange={handleLdapQueryChange}
                  onSearch={() => void handleLdapSearch()}
                  searchLoading={ldapSearchLoading}
                  searchError={ldapSearchError}
                  items={ldapSearchItems}
                  truncated={ldapSearchTruncated}
                  searchPerformed={ldapSearchPerformed}
                  selected={selectedLdapEntry}
                  onSelect={handleSelectLdapEntry}
                  onLinkExisting={(item) => void handleExistingLdapIdentity(item, "link")}
                  onRestore={(item) => void handleExistingLdapIdentity(item, "restore")}
                  busy={creating}
                  text={text}
                />
                <AdminUserIdentityFields
                  idPrefix="create-user"
                  values={{ ...form, role: createRoleValue }}
                  creating
                  requiresPassword={createSource === "local"}
                  errors={
                    createAttempted
                      ? userIdentityErrors(form, true, adminUserText, createSource === "local")
                      : {}
                  }
                  onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
                  canAssignAdmin={currentIsSuperAdmin}
                  helpOpen={createRoleHelpOpen}
                  onToggleHelp={() => setCreateRoleHelpOpen((open) => !open)}
                  onRoleChange={(value) => setForm((current) => ({ ...current, ...roleAccessPatch(value, current) }))}
                />
              </>
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
                activeTab={createAssociations.tab}
                onTabChange={(nextTab) => {
                  const tabChanged = nextTab !== createAssociations.tab;
                  createAssociations.setTab(nextTab);
                  createAssociations.accounts.picker.setOpen(false);
                  createAssociations.s3Users.picker.setOpen(false);
                  createAssociations.connections.picker.setOpen(false);
                  createAssociations.openStack.picker.setOpen(false);
                  if (tabChanged) {
                    void ensureAssociationOptionsForTab(nextTab, { retryOnError: true });
                  }
                }}
                maxVisibleOptions={MAX_VISIBLE_OPTIONS}
                showPortalRole={showPortalRole}
                accounts={{
                  selected: createAssociations.accounts.selected,
                  setSelected: createAssociations.accounts.setSelected,
                  optionsById: accountOptionsById,
                  available: availableCreateS3Accounts,
                  visible: visibleCreateS3Accounts,
                  search: createAssociations.accounts.picker.search,
                  setSearch: createAssociations.accounts.picker.setSearch,
                  loading: s3AccountsLoading,
                  showPanel: createAssociations.accounts.picker.open,
                  setShowPanel: createAssociations.accounts.picker.setOpen,
                  selections: createAssociations.accounts.picker.selections,
                  setSelections: createAssociations.accounts.picker.setSelections,
                  accountAccessChoice: createAssociations.accounts.accessChoice,
                  setAccountAccessChoice: createAssociations.accounts.setAccessChoice,
                  toggleSelection: createAssociations.accounts.picker.toggleSelection,
                }}
                s3Users={{
                  selected: createAssociations.s3Users.selected,
                  setSelected: createAssociations.s3Users.setSelected,
                  labelById: s3UserLabelById,
                  available: availableCreateS3Users,
                  visible: visibleCreateS3Users,
                  search: createAssociations.s3Users.picker.search,
                  setSearch: createAssociations.s3Users.picker.setSearch,
                  loading: s3UsersLoading,
                  showPanel: createAssociations.s3Users.picker.open,
                  setShowPanel: createAssociations.s3Users.picker.setOpen,
                  selections: createAssociations.s3Users.picker.selections,
                  setSelections: createAssociations.s3Users.picker.setSelections,
                  toggleSelection: createAssociations.s3Users.picker.toggleSelection,
                }}
                connections={{
                  selected: createAssociations.connections.selected,
                  setSelected: createAssociations.connections.setSelected,
                  labelById: s3ConnectionLabelById,
                  available: availableCreateS3Connections,
                  visible: visibleCreateS3Connections,
                  search: createAssociations.connections.picker.search,
                  setSearch: createAssociations.connections.picker.setSearch,
                  loading: s3ConnectionsLoading,
                  showPanel: createAssociations.connections.picker.open,
                  setShowPanel: createAssociations.connections.picker.setOpen,
                  selections: createAssociations.connections.picker.selections,
                  setSelections: createAssociations.connections.picker.setSelections,
                  toggleSelection: createAssociations.connections.picker.toggleSelection,
                }}
                openstack={openStackEnabled ? {
                  selected: createAssociations.openStack.selected,
                  setSelected: createAssociations.openStack.setSelected,
                  labelById: openStackLabelById,
                  available: availableCreateOpenStackClouds,
                  visible: visibleCreateOpenStackClouds,
                  search: createAssociations.openStack.picker.search,
                  setSearch: createAssociations.openStack.picker.setSearch,
                  loading: openStackCloudsLoading,
                  showPanel: createAssociations.openStack.picker.open,
                  setShowPanel: createAssociations.openStack.picker.setOpen,
                  selections: createAssociations.openStack.picker.selections,
                  setSelections: createAssociations.openStack.picker.setSelections,
                  toggleSelection: createAssociations.openStack.picker.toggleSelection,
                } : undefined}
              />
            )}

            {createModalTab === "groups" && (
              <UserGroupsSelector
                groups={groups}
                groupsLoaded={groupsLoaded}
                groupsLoading={groupsLoading}
                maxVisibleOptions={MAX_VISIBLE_OPTIONS}
                selectedIds={createAssociations.groups.selected}
                setSelectedIds={createAssociations.groups.setSelected}
                search={createAssociations.groups.picker.search}
                setSearch={createAssociations.groups.picker.setSearch}
                visibleGroups={visibleCreateGroups}
                showPanel={createAssociations.groups.picker.open}
                setShowPanel={createAssociations.groups.picker.setOpen}
                selections={createAssociations.groups.picker.selections}
                setSelections={createAssociations.groups.picker.setSelections}
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
                inheritedMultisiteSwitching={Boolean(
                  editingUser.effective_access?.allow_multisite_endpoint_switching
                  && !editingUser.allow_multisite_endpoint_switching
                )}
                text={text}
                onChange={(patch) =>
                  setEditForm((current) => ({ ...current, ...patch }))
                }
              />
            )}

            {editModalTab === "associations" && (
              <UserAssociationsTabs
                activeTab={editAssociations.tab}
                onTabChange={(nextTab) => {
                  const tabChanged = nextTab !== editAssociations.tab;
                  editAssociations.setTab(nextTab);
                  editAssociations.accounts.picker.setOpen(false);
                  editAssociations.s3Users.picker.setOpen(false);
                  editAssociations.connections.picker.setOpen(false);
                  editAssociations.openStack.picker.setOpen(false);
                  if (tabChanged) {
                    void ensureAssociationOptionsForTab(nextTab, { retryOnError: true });
                  }
                }}
                maxVisibleOptions={MAX_VISIBLE_OPTIONS}
                showPortalRole={showPortalRole}
                accounts={{
                  selected: editAssociations.accounts.selected,
                  setSelected: editAssociations.accounts.setSelected,
                  optionsById: accountOptionsById,
                  available: availableEditS3Accounts,
                  visible: visibleEditS3Accounts,
                  search: editAssociations.accounts.picker.search,
                  setSearch: editAssociations.accounts.picker.setSearch,
                  loading: s3AccountsLoading,
                  showPanel: editAssociations.accounts.picker.open,
                  setShowPanel: editAssociations.accounts.picker.setOpen,
                  selections: editAssociations.accounts.picker.selections,
                  setSelections: editAssociations.accounts.picker.setSelections,
                  accountAccessChoice: editAssociations.accounts.accessChoice,
                  setAccountAccessChoice: editAssociations.accounts.setAccessChoice,
                  toggleSelection: editAssociations.accounts.picker.toggleSelection,
                }}
                s3Users={{
                  selected: editAssociations.s3Users.selected,
                  setSelected: editAssociations.s3Users.setSelected,
                  labelById: s3UserLabelById,
                  available: availableEditS3Users,
                  visible: visibleEditS3Users,
                  search: editAssociations.s3Users.picker.search,
                  setSearch: editAssociations.s3Users.picker.setSearch,
                  loading: s3UsersLoading,
                  showPanel: editAssociations.s3Users.picker.open,
                  setShowPanel: editAssociations.s3Users.picker.setOpen,
                  selections: editAssociations.s3Users.picker.selections,
                  setSelections: editAssociations.s3Users.picker.setSelections,
                  toggleSelection: editAssociations.s3Users.picker.toggleSelection,
                }}
                connections={{
                  selected: editAssociations.connections.selected,
                  setSelected: editAssociations.connections.setSelected,
                  labelById: s3ConnectionLabelById,
                  available: availableEditS3Connections,
                  visible: visibleEditS3Connections,
                  search: editAssociations.connections.picker.search,
                  setSearch: editAssociations.connections.picker.setSearch,
                  loading: s3ConnectionsLoading,
                  showPanel: editAssociations.connections.picker.open,
                  setShowPanel: editAssociations.connections.picker.setOpen,
                  selections: editAssociations.connections.picker.selections,
                  setSelections: editAssociations.connections.picker.setSelections,
                  toggleSelection: editAssociations.connections.picker.toggleSelection,
                }}
                openstack={openStackEnabled ? {
                  selected: editAssociations.openStack.selected,
                  setSelected: editAssociations.openStack.setSelected,
                  labelById: openStackLabelById,
                  available: availableEditOpenStackClouds,
                  visible: visibleEditOpenStackClouds,
                  search: editAssociations.openStack.picker.search,
                  setSearch: editAssociations.openStack.picker.setSearch,
                  loading: openStackCloudsLoading,
                  showPanel: editAssociations.openStack.picker.open,
                  setShowPanel: editAssociations.openStack.picker.setOpen,
                  selections: editAssociations.openStack.picker.selections,
                  setSelections: editAssociations.openStack.picker.setSelections,
                  toggleSelection: editAssociations.openStack.picker.toggleSelection,
                } : undefined}
              />
            )}

            {editModalTab === "groups" && (
              <UserGroupsSelector
                groups={groups}
                groupsLoaded={groupsLoaded}
                groupsLoading={groupsLoading}
                maxVisibleOptions={MAX_VISIBLE_OPTIONS}
                selectedIds={editAssociations.groups.selected}
                setSelectedIds={editAssociations.groups.setSelected}
                search={editAssociations.groups.picker.search}
                setSearch={editAssociations.groups.picker.setSearch}
                visibleGroups={visibleEditGroups}
                showPanel={editAssociations.groups.picker.open}
                setShowPanel={editAssociations.groups.picker.setOpen}
                selections={editAssociations.groups.picker.selections}
                setSelections={editAssociations.groups.picker.setSelections}
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
