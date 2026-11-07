/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CreateUserPayload,
  type AdminUserSortBy,
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
import AdminUsersList from "./AdminUsersList";
import {
  roleSupportsOperationalAccess,
} from "./adminAccessConfig";
import PageBanner from "../../components/PageBanner";
import SettingsForm from "../../components/settings/SettingsForm";
import { SettingsButton, SettingsPersistentEditActions, useSettingsCloseGuard } from "../../components/settings/SettingsControls";
import { useSettingsBaseline } from "../../components/settings/useSettingsDraft";
import AdminUserIdentityFields, { userIdentityErrors, type UserIdentityErrors } from "./AdminUserIdentityFields";
import AdminUserLdapImportFields, { type UserCreationSource } from "./AdminUserLdapImportFields";
import SettingsNavigationGuard from "../../components/settings/SettingsNavigationGuard";
import { useProfileI18n } from "../shared/profileMessages";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";

import { extractApiError } from "../../utils/apiError";
import { isAdminLikeRole, isSuperAdminRole, readStoredUser, setSessionUserCache } from "../../utils/workspaces";
import {
  clearAdminPrincipalEditRequest,
} from "./adminPrincipalEditLink";
import {
  useAdminPrincipalEditRequest,
  useOpenRequestedAdminPrincipal,
} from "./useAdminPrincipalEditRequest";
import { adminAssociationPanelClass } from "./AdminAssociationPicker";
import UserAuthenticationPanel from "./UserAuthenticationPanel";
import AdminUserProfilePanel from "./AdminUserProfilePanel";
import AdminUserAssociationEditorPanels, {
  type AdminUserAssociationEditorResources,
} from "./AdminUserAssociationEditorPanels";
import useAdminUserAssociationOptions from "./useAdminUserAssociationOptions";
import {
  buildAdminUserCreateDraft,
  buildAdminUserEditorDraft,
  emptyAdminUserCreateDraft,
  emptyAdminUserEditorDraft,
} from "./adminUserEditorDraft";
import { useUsersI18n } from "./usersMessage";
import { useAdminUserI18n } from "./adminUserMessage";
import useAdminUserAssociationEditorState from "./useAdminUserAssociationEditorState";
import useAdminUserAssociationDerivedOptions from "./useAdminUserAssociationDerivedOptions";
import type { StorageAssociationTab } from "./useAdminStorageAssociationEditorState";
import useAdminPaginatedListState from "./useAdminPaginatedListState";
import useAdminPaginatedListController from "./useAdminPaginatedListController";
import useAdminUserLdapImport from "./useAdminUserLdapImport";
import {
  adminUserCreatePayload,
  adminUserEditForm,
  adminUserLdapCreatePayload,
  adminUserRoleAccessPatch,
  adminUserUpdatePayload,
  emptyAdminUserCreateForm,
  type AdminUserAssociationSelection,
} from "./adminUserForm";

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
  const { generalSettings } = useGeneralSettings();
  const { runWithStepUp, verificationDialog } = useRecentWebAuthnStepUp(stepUpLabels);
  const currentUser = useMemo(() => readStoredUser(), []);
  const currentUserId = currentUser?.id != null ? Number(currentUser.id) : null;
  const currentIsAdminLike = isAdminLikeRole(currentUser?.role);
  const currentIsSuperAdmin = isSuperAdminRole(currentUser?.role);
  const cephAdminFeatureEnabled = generalSettings.ceph_admin_enabled;
  const openStackEnabled = generalSettings.openstack_enabled;
  const showPortalRole = Boolean(generalSettings.portal_enabled);
  const principalEditRequest = useAdminPrincipalEditRequest();
  const {
    accounts,
    s3AccountsLoaded,
    s3AccountsLoading,
    refreshS3Accounts,
    ensureS3Accounts,
    s3AccountsCatalog,
    s3Users,
    s3UsersLoading,
    s3UsersCatalog,
    s3Connections,
    s3ConnectionsLoading,
    s3ConnectionsCatalog,
    groups,
    groupsLoaded,
    groupsLoading,
    ensureGroups,
    groupsCatalog,
    openStackClouds,
    openStackCloudsLoading,
    openStackCloudsCatalog,
    ensureAssociationOptionsForTab,
    resetAssociationOptionSearches,
  } = useAdminUserAssociationOptions();
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [form, setForm] = useState<CreateUserPayload>(emptyAdminUserCreateForm);
  const [createModalTab, setCreateModalTab] = useState<UserModalTab>("general");
  const createAssociations = useAdminUserAssociationEditorState();
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState<UpdateUserPayload>({});
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
  } = useAdminPaginatedListState<AdminUserSortBy>({
    initialFilter: principalEditRequest?.search ?? "",
    initialSort: { field: "name", direction: "asc" },
  });
  const loadUsersPage = useCallback(() => {
    const searchValue = filter.trim();
    return listUsers({
      page,
      page_size: pageSize,
      search: searchValue || undefined,
      sort_by: sort.field,
      sort_dir: sort.direction,
    });
  }, [filter, page, pageSize, sort.direction, sort.field]);
  const formatUsersLoadError = useCallback(
    (loadError: unknown) => extractApiError(loadError, textRef.current("loadError")),
    [],
  );
  const {
    items: users,
    loading,
    error,
    total: totalUsers,
    refresh: fetchUsers,
    updateItem: updateUserInList,
  } = useAdminPaginatedListController({
    loadPage: loadUsersPage,
    ensurePageInRange,
    formatError: formatUsersLoadError,
  });
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
  const associationOptionSources = useMemo(() => ({
    accountOptions,
    s3UserOptions,
    s3ConnectionOptions: s3SharedConnectionOptions,
    openStackOptions,
    groups,
  }), [accountOptions, groups, openStackOptions, s3SharedConnectionOptions, s3UserOptions]);
  const createAssociationOptions = useAdminUserAssociationDerivedOptions(
    createAssociations,
    associationOptionSources,
  );
  const editAssociationOptions = useAdminUserAssociationDerivedOptions(
    editAssociations,
    associationOptionSources,
  );
  const associationEditorResources: AdminUserAssociationEditorResources = {
    accountOptionsById,
    s3UserLabelById,
    s3ConnectionLabelById,
    openStackLabelById,
    groups,
    groupsLoaded,
    groupsLoading,
    s3AccountsLoading,
    s3UsersLoading,
    s3ConnectionsLoading,
    openStackCloudsLoading,
    accountCatalog: s3AccountsCatalog,
    s3UserCatalog: s3UsersCatalog,
    s3ConnectionCatalog: s3ConnectionsCatalog,
    openStackCatalog: openStackCloudsCatalog,
    groupCatalog: groupsCatalog,
    showPortalRole,
    openStackEnabled,
    ensureAssociationOptionsForTab,
  };
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

  useEffect(() => {
    if (showCreateModal) void ensureLdapProviders();
  }, [ensureLdapProviders, showCreateModal]);

  useEffect(() => {
    if ((showCreateModal && createModalTab === "groups") || (showEditModal && editModalTab === "groups")) {
      void ensureGroups({ retryOnError: true });
    }
  }, [createModalTab, editModalTab, ensureGroups, showCreateModal, showEditModal]);

  const createDraft = useMemo(
    () =>
      buildAdminUserCreateDraft({
        editor: buildAdminUserEditorDraft({
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
        source: createSource,
        providerId: ldapProviderId,
        directoryDn: selectedLdapEntry?.directory_dn,
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
  const { accept: acceptCreateDraft, dirty: createDraftDirty } = useSettingsBaseline(
    createDraft,
    () => emptyAdminUserCreateDraft(emptyAdminUserCreateForm()),
  );

  const resetCreateModalState = () => {
    setCreateAttempted(false);
    setForm(emptyAdminUserCreateForm());
    setCreateSource("local");
    resetLdapImport();
    createAssociations.reset();
    resetAssociationOptionSearches();
    setCreateModalTab("general");
    setCreateRoleHelpOpen(false);
    acceptCreateDraft(emptyAdminUserCreateDraft(emptyAdminUserCreateForm()));
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setActionError(null);
    resetCreateModalState();
  };

  const editDraft = useMemo(
    () =>
      buildAdminUserEditorDraft({
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
  const { accept: acceptEditDraft, dirty: editDraftDirty } = useSettingsBaseline(
    editDraft,
    () => emptyAdminUserEditorDraft({}),
  );

  const closeEditModal = () => {
    setShowEditModal(false);
    setEditingUser(null);
    editAssociations.reset();
    setEditModalTab("general");
    setEditForm({});
    setEditRoleHelpOpen(false);
    acceptEditDraft(emptyAdminUserEditorDraft({}));
    clearAdminPrincipalEditRequest();
  };

  const roleAccessPatch = (role: UiRole, current: UpdateUserPayload) =>
    adminUserRoleAccessPatch(role, current, {
      currentIsAdminLike,
      currentIsSuperAdmin,
    });

  const createDirty = showCreateModal && createDraftDirty;
  const editMainDirty = showEditModal && editDraftDirty;
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
    const associations: AdminUserAssociationSelection = {
      accounts: createAssociations.accounts.selected,
      s3Users: createAssociations.s3Users.selected,
      connections: createAssociations.connections.selected,
      groups: createAssociations.groups.selected,
      openStack: createAssociations.openStack.selected,
    };
    const payload = adminUserCreatePayload(
      form,
      associations,
      { currentIsAdminLike, currentIsSuperAdmin },
      openStackEnabled,
    );
    savingRef.current = true;
    setCreating(true);
    try {
      if (createSource === "ldap" && selectedLdapEntry) {
        await runWithStepUp(() =>
          importLdapUser({
            selection_token: selectedLdapEntry.selection_token,
            action: "create",
            create: adminUserLdapCreatePayload(payload),
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
    const nextEditForm = adminUserEditForm(user);
    setEditAttempted(false);
    resetAssociationOptionSearches();
    setEditingUser(user);
    setEditForm(nextEditForm);
    const selectedAccounts = user.account_links.map((link) => ({
      id: Number(link.account_id),
      manager_role: link.manager_role,
      portal_role: link.portal_role,
      allow_manager_browser_data_access: link.allow_manager_browser_data_access,
    }));
    const nextSelectedS3Users = user.s3_user_links.map((link) => ({
      s3_user_id: Number(link.s3_user_id),
      allow_manager_browser_data_access: link.allow_manager_browser_data_access,
    }));
    const nextSelectedS3Connections = user.s3_connection_details.map((connection) => Number(connection.id));
    const nextSelectedOpenStackClouds = user.openstack_cloud_details.map((cloud) => Number(cloud.id));
    const nextSelectedGroups = user.group_details.map((group) => Number(group.id));
    const hasAccounts = selectedAccounts.length > 0;
    const hasS3Users = nextSelectedS3Users.length > 0;
    const hasConnections = nextSelectedS3Connections.length > 0;
    const hasOpenStack = nextSelectedOpenStackClouds.length > 0;
    const initialAssociationsTab: StorageAssociationTab = hasAccounts
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
    acceptEditDraft(
      buildAdminUserEditorDraft({
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

  useOpenRequestedAdminPrincipal(principalEditRequest, users, startEdit);

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
      const associations: AdminUserAssociationSelection = {
        accounts: editAssociations.accounts.selected,
        s3Users: editAssociations.s3Users.selected,
        connections: editAssociations.connections.selected,
        groups: editAssociations.groups.selected,
        openStack: editAssociations.openStack.selected,
      };
      const payload = adminUserUpdatePayload(
        editForm,
        editingUser,
        associations,
        { currentIsAdminLike, currentIsSuperAdmin },
        openStackEnabled,
      );
      const updatedUser = await runWithStepUp(() => updateUser(editingUser.id, payload));
      if (currentUserId !== null && currentUserId === editingUser.id && typeof window !== "undefined") {
        setSessionUserCache({ ...(readStoredUser() ?? {}), ...updatedUser });
      }
      const savedForm: UpdateUserPayload = {
        ...editForm,
        ...adminUserEditForm(updatedUser),
      };
      setEditingUser(updatedUser);
      setEditForm(savedForm);
      editAssociations.clearPendingSelections();
      acceptEditDraft(buildAdminUserEditorDraft({
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

            {(createModalTab === "associations" || createModalTab === "groups") && (
              <AdminUserAssociationEditorPanels
                panel={createModalTab}
                editor={createAssociations}
                options={createAssociationOptions}
                resources={associationEditorResources}
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
                  updateUserInList(editingUser.id, (user) => ({ ...user, avatar: updated.avatar }));
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
                  editingUser.effective_access.group_manager_tool_access
                }
                inheritedManagedProvisioning={Boolean(
                  editingUser.effective_access
                    .group_can_provision_managed_private_connections,
                )}
                inheritedMultisiteSwitching={Boolean(
                  editingUser.effective_access.allow_multisite_endpoint_switching
                  && !editingUser.allow_multisite_endpoint_switching
                )}
                text={text}
                onChange={(patch) =>
                  setEditForm((current) => ({ ...current, ...patch }))
                }
              />
            )}

            {(editModalTab === "associations" || editModalTab === "groups") && (
              <AdminUserAssociationEditorPanels
                panel={editModalTab}
                editor={editAssociations}
                options={editAssociationOptions}
                resources={associationEditorResources}
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
