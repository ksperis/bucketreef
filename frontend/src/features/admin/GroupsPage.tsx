/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  isRecentWebAuthnVerificationCancelled,
  useRecentWebAuthnStepUp,
} from "../../auth/useRecentWebAuthnStepUp";
import {
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  UiGroup,
  UiGroupPayload,
  type UiGroupAvatarIcon,
  createGroup,
  deleteGroupAvatar,
  deleteGroup,
  listGroups,
  uploadGroupAvatar,
  updateGroup,
} from "../../api/groups";
import type { S3UserMembership } from "../../api/users";
import {
  getAccountAccessRequiredMessage,
  hasAccountAccessRole,
} from "../../api/accountAccess";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import GroupAvatar from "../../components/GroupAvatar";
import WorkflowPage, { workflowPageHostClass } from "../../components/WorkflowPage";
import WorkflowTabs from "../../components/WorkflowTabs";
import PageBanner from "../../components/PageBanner";
import PageHeader, { type PageBreadcrumb } from "../../components/PageHeader";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import {
  AdminAccessToggleSection,
  BrowserAccessSection,
  ManagerToolAccessSection,
  WorkspaceAccessSection,
} from "./AdminAccessSections";
import { AdminAssociationTabs, adminAssociationPanelClass } from "./AdminAssociationPicker";
import {
  buildManagerToolDefinitions,
  normalizeManagerToolAccess,
  type ManagerToolKey,
} from "./adminAccessConfig";
import SettingsForm from "../../components/settings/SettingsForm";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import { SettingsButton, SettingsPersistentEditActions, useSettingsCloseGuard } from "../../components/settings/SettingsControls";
import SettingsNavigationGuard from "../../components/settings/SettingsNavigationGuard";
import { useSettingsDraft } from "../../components/settings/useSettingsDraft";
import UiInput from "../../components/ui/UiInput";
import UiTextarea from "../../components/ui/UiTextarea";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { isFeaturePolicyAvailable } from "../../api/featurePolicies";
import { extractApiError } from "../../utils/apiError";
import {
  clearAdminPrincipalEditRequest,
} from "./adminPrincipalEditLink";
import {
  useAdminPrincipalEditRequest,
  useOpenRequestedAdminPrincipal,
} from "./useAdminPrincipalEditRequest";
import { useGroupsI18n, type GroupsMessageKey } from "./groupsMessage";
import AdminGroupsList, { type GroupSortField } from "./AdminGroupsList";
import useAdminAssociationPickerState from "./useAdminAssociationPickerState";
import useAdminGroupAssociationOptions from "./useAdminGroupAssociationOptions";
import useAdminPaginatedListState from "./useAdminPaginatedListState";
import useAdminPaginatedListController from "./useAdminPaginatedListController";
import useAdminStorageAssociationEditorState from "./useAdminStorageAssociationEditorState";
import {
  deriveAdminAssociationOptions,
  MAX_VISIBLE_ASSOCIATION_OPTIONS,
} from "./adminAssociationOptions";
import AdminSimpleIdAssociationsPanel, {
  type AdminSimpleIdAssociationsState,
} from "./AdminSimpleIdAssociationsPanel";
import AdminRgwUserAccessAssociationsPanel, {
  type AdminRgwUserAccessAssociationsState,
} from "./AdminRgwUserAccessAssociationsPanel";
import AdminAccountAssociationsPanel, {
  type AdminAccountAssociationsState,
  type AdminAccountSelection,
} from "./AdminAccountAssociationsPanel";
import {
  adminGroupForm,
  adminGroupPayload,
  emptyAdminGroupForm,
} from "./adminGroupForm";

type GroupModalTab = "general" | "members" | "associations" | "access";
const groupAvatarIconOptions: Array<{ value: UiGroupAvatarIcon; label: GroupsMessageKey }> = [
  { value: "users", label: "team" },
  { value: "building", label: "organization" },
  { value: "shield", label: "security" },
  { value: "briefcase", label: "operations" },
  { value: "academic", label: "research" },
];

export default function GroupsPage() {
  const { locale, text } = useGroupsI18n();
  const errorTextRef = useRef(text);
  errorTextRef.current = text;
  const groupAvatarIcons = groupAvatarIconOptions.map((icon) => ({ ...icon, label: text(icon.label) }));
  const groupBreadcrumbs = (...trailingBreadcrumbs: PageBreadcrumb[]) =>
    adminPageBreadcrumbs("groups", ...trailingBreadcrumbs).map((breadcrumb, index) => ({
      ...breadcrumb,
      label: index === 0 ? text("admin") : index === 1 ? text("uiGroups") : breadcrumb.label,
    }));
  const { generalSettings } = useGeneralSettings();
  const openStackEnabled = generalSettings.openstack_enabled;
  const stepUpLabels = useMemo(() => ({
    title: text("verifyWithPasskey"),
    description: text("verificationDescription"),
    cancel: text("cancel"),
    close: locale === "en" ? undefined : text("close"),
    cancelled: text("verificationCancelled"),
    failure: (error: unknown) => extractApiError(error, text("verificationFailed")),
  }), [locale, text]);
  const { runWithStepUp, verificationDialog } = useRecentWebAuthnStepUp(stepUpLabels);
  const showPortalRole = Boolean(generalSettings.portal_enabled);
  const principalEditRequest = useAdminPrincipalEditRequest();
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const handleAssociationOptionsError = useCallback(
    (loadError: unknown) =>
      setActionError(
        extractApiError(loadError, errorTextRef.current("loadResourcesError")),
      ),
    [],
  );
  const {
    users,
    accounts,
    s3Users,
    connections,
    openStackClouds,
    usersCatalog,
    accountsCatalog,
    s3UsersCatalog,
    connectionsCatalog,
    openStackCloudsCatalog,
    refresh: loadAuxiliaryData,
  } = useAdminGroupAssociationOptions({
    openStackEnabled,
    onError: handleAssociationOptionsError,
  });
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
  } = useAdminPaginatedListState<GroupSortField>({
    initialFilter: principalEditRequest?.search ?? "",
    initialSort: { field: "name", direction: "asc" },
  });
  const loadGroupsPage = useCallback(() => listGroups({
    page,
    page_size: pageSize,
    search: filter.trim() || undefined,
    sort_by: sort.field,
    sort_dir: sort.direction,
  }), [filter, page, pageSize, sort.direction, sort.field]);
  const formatGroupsLoadError = useCallback(
    (loadError: unknown) => extractApiError(loadError, errorTextRef.current("loadGroupsError")),
    [],
  );
  const {
    items: groups,
    loading,
    error,
    total: totalGroups,
    refresh: fetchGroups,
  } = useAdminPaginatedListController({
    loadPage: loadGroupsPage,
    ensurePageInRange,
    formatError: formatGroupsLoadError,
  });
  const [showModal, setShowModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<UiGroup | null>(null);
  const [modalTab, setModalTab] = useState<GroupModalTab>("general");
  const [pendingDeleteGroup, setPendingDeleteGroup] = useState<UiGroup | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const {
    draft: form,
    setDraft: setForm,
    accept: acceptForm,
    dirty: formDirty,
  } = useSettingsDraft<UiGroupPayload>(emptyAdminGroupForm);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [attempted, setAttempted] = useState(false);
  const memberPicker = useAdminAssociationPickerState();
  const storageAssociations = useAdminStorageAssociationEditorState();
  const associationTab = storageAssociations.tab;
  const setAssociationTab = storageAssociations.setTab;
  const accountPicker = storageAssociations.accounts.picker;
  const s3UserPicker = storageAssociations.s3Users.picker;
  const connectionPicker = storageAssociations.connections.picker;
  const openStackPicker = storageAssociations.openStack.picker;
  const accountAccessChoice = storageAssociations.accounts.accessChoice;
  const setAccountAccessChoice = storageAssociations.accounts.setAccessChoice;
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [removeAvatarImage, setRemoveAvatarImage] = useState(false);
  const avatarFileUrl = useMemo(
    () => (avatarFile && typeof URL.createObjectURL === "function" ? URL.createObjectURL(avatarFile) : null),
    [avatarFile],
  );

  useEffect(() => () => {
    if (avatarFileUrl && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(avatarFileUrl);
  }, [avatarFileUrl]);

  const avatarPreview = avatarFileUrl
    ? { source: "uploaded" as const, initials: "", icon: null, url: avatarFileUrl, updated_at: null }
    : form.avatar_source === "preset"
      ? { source: "preset" as const, initials: "", icon: form.avatar_icon ?? "users", url: null, updated_at: null }
      : form.avatar_source === "uploaded" && editingGroup?.avatar
        ? editingGroup.avatar
        : { source: "initials" as const, initials: "", icon: null, url: null, updated_at: null };

  const selectAvatarFile = (file: File | null) => {
    if (!file) return;
    if (!(["image/png", "image/jpeg"].includes(file.type)) || file.size > 1024 * 1024) {
      setActionError(text("imageRequirementsError"));
      return;
    }
    setActionError(null);
    setAvatarFile(file);
    setRemoveAvatarImage(false);
  };

  const accountOptionsById = useMemo(() => {
    const map = new Map<number, { name: string }>();
    editingGroup?.account_details.forEach((account) => map.set(account.id, account));
    accounts.forEach((account) => {
      const id = account.id;
      if (!Number.isNaN(id)) map.set(id, account);
    });
    return map;
  }, [accounts, editingGroup]);

  const s3UserLabelById = useMemo(() => {
    const map = new Map<number, string>();
    editingGroup?.s3_user_details.forEach((user) => map.set(user.id, user.name));
    s3Users.forEach((user) => map.set(user.id, user.name));
    return map;
  }, [editingGroup, s3Users]);

  const connectionLabelById = useMemo(() => {
    const map = new Map<number, string>();
    editingGroup?.s3_connection_details.forEach((connection) => map.set(connection.id, connection.name));
    connections.forEach((connection) => map.set(connection.id, connection.name));
    return map;
  }, [connections, editingGroup]);

  const openStackCloudLabelById = useMemo(() => {
    const map = new Map<number, string>();
    editingGroup?.openstack_cloud_details.forEach((cloud) => map.set(cloud.id, cloud.name));
    openStackClouds.forEach((cloud) => map.set(cloud.id, cloud.name));
    return map;
  }, [editingGroup, openStackClouds]);

  const managerToolDefinitions = useMemo(
    () => buildManagerToolDefinitions(generalSettings),
    [generalSettings]
  );

  const resetForm = () => {
    const draft = emptyAdminGroupForm();
    acceptForm(draft);
    setAttempted(false);
    setModalTab("general");
    memberPicker.reset();
    storageAssociations.reset();
    usersCatalog.setSearch("");
    accountsCatalog.setSearch("");
    s3UsersCatalog.setSearch("");
    connectionsCatalog.setSearch("");
    openStackCloudsCatalog.setSearch("");
    setAvatarFile(null);
    setRemoveAvatarImage(false);
  };

  const openCreateModal = () => {
    setEditingGroup(null);
    resetForm();
    setShowModal(true);
    setActionError(null);
    setActionMessage(null);
    void loadAuxiliaryData();
  };

  const openEditModal = (group: UiGroup) => {
    resetForm();
    setEditingGroup(group);
    const draft = adminGroupForm(group);
    acceptForm(draft);
    setModalTab("general");
    setActionError(null);
    setActionMessage(null);
    setShowModal(true);
    void loadAuxiliaryData();
  };

  useOpenRequestedAdminPrincipal(principalEditRequest, groups, openEditModal);

  const closeModal = () => {
    setShowModal(false);
    setEditingGroup(null);
    resetForm();
    clearAdminPrincipalEditRequest();
  };

  const hasUnsavedChanges = showModal && (
    formDirty || Boolean(avatarFile) || removeAvatarImage ||
    memberPicker.selections.length > 0 || accountPicker.selections.length > 0 || s3UserPicker.selections.length > 0 ||
    connectionPicker.selections.length > 0 || openStackPicker.selections.length > 0 || Object.keys(accountAccessChoice).length > 0
  );
  const closeGuard = useSettingsCloseGuard({
    hasUnsavedChanges,
    title: text("discardTitle"),
    description: text("unsavedChanges"),
    cancelLabel: text("keepEditing"),
    confirmLabel: text("discardChanges"),
    closeLabel: locale === "en" ? undefined : text("close"),
    onClose: closeModal,
    disabled: saving,
  });

  const submitGroup = async (event: FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    setAttempted(true);
    setActionError(null);
    setActionMessage(null);
    const name = String(form.name || "").trim();
    if (!name) {
      setModalTab("general");
      requestAnimationFrame(() => document.getElementById("admin-ui-group-name")?.focus());
      return;
    }
    if ((form.account_links ?? []).some((link) => !hasAccountAccessRole(link))) {
      setModalTab("associations");
      setAssociationTab("accounts");
      setActionError(getAccountAccessRequiredMessage(showPortalRole));
      return;
    }
    const payload = adminGroupPayload(form, {
      includeMembers: !editingGroup?.system_key,
      openStackEnabled,
      avatarUploadPending: Boolean(avatarFile),
    });
    savingRef.current = true;
    setSaving(true);
    try {
      let savedGroup: UiGroup;
      if (editingGroup) {
        savedGroup = await runWithStepUp(() => updateGroup(editingGroup.id, payload));
        setActionMessage(text("groupUpdated"));
      } else {
        savedGroup = await runWithStepUp(() => createGroup(payload));
        setActionMessage(text("groupCreated"));
      }
      if (avatarFile) {
        savedGroup = await uploadGroupAvatar(savedGroup.id, avatarFile);
      } else if (editingGroup && removeAvatarImage) {
        savedGroup = await deleteGroupAvatar(savedGroup.id);
      }
      if (editingGroup) {
        const savedDraft = adminGroupForm(savedGroup);
        setEditingGroup(savedGroup);
        acceptForm(savedDraft);
        setAvatarFile(null);
        setRemoveAvatarImage(false);
        memberPicker.setSelections([]);
        storageAssociations.clearPendingSelections();
      } else {
        closeModal();
      }
      await fetchGroups();
    } catch (err) {
      if (!isRecentWebAuthnVerificationCancelled(err)) {
        setActionError(extractApiError(err, text("saveGroupError")));
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDeleteGroup) return;
    setBusyId(pendingDeleteGroup.id);
    setActionError(null);
    setActionMessage(null);
    try {
      await deleteGroup(pendingDeleteGroup.id);
      setActionMessage(text("groupDeleted"));
      await fetchGroups();
    } catch (err) {
      setActionError(extractApiError(err, text("deleteGroupError")));
    } finally {
      setBusyId(null);
      setPendingDeleteGroup(null);
    }
  };

  const selectedUserIds = new Set(form.user_ids ?? []);
  const selectedS3UserIds = new Set((form.s3_user_links ?? []).map((link) => link.s3_user_id));
  const selectedConnectionIds = new Set(form.s3_connection_ids ?? []);
  const selectedOpenStackCloudIds = new Set(form.openstack_cloud_ids ?? []);
  const selectedAccountIds = new Set((form.account_links ?? []).map((link) => Number(link.account_id)));
  const userLabelById = new Map<number, string>();
  editingGroup?.user_details.forEach((user) => userLabelById.set(user.id, user.email));
  users.forEach((user) => userLabelById.set(user.id, user.email));
  const userOptions = deriveAdminAssociationOptions({
    items: users,
    selectedIds: selectedUserIds,
    search: memberPicker.search,
    getId: (user) => user.id,
    getLabel: (user) => user.email,
  });
  const accountOptions = deriveAdminAssociationOptions({
    items: accounts,
    selectedIds: selectedAccountIds,
    search: accountPicker.search,
    getId: (account) => account.id,
    getLabel: (account) => account.name,
  });
  const s3UserOptions = deriveAdminAssociationOptions({
    items: s3Users,
    selectedIds: selectedS3UserIds,
    search: s3UserPicker.search,
    getId: (user) => user.id,
    getLabel: (user) => user.name,
  });
  const connectionOptions = deriveAdminAssociationOptions({
    items: connections,
    selectedIds: selectedConnectionIds,
    search: connectionPicker.search,
    getId: (connection) => connection.id,
    getLabel: (connection) => connection.name,
  });
  const openStackOptions = deriveAdminAssociationOptions({
    items: openStackClouds,
    selectedIds: selectedOpenStackCloudIds,
    search: openStackPicker.search,
    getId: (cloud) => cloud.id,
    getLabel: (cloud) => cloud.name,
  });
  const setConnectionIds: Dispatch<SetStateAction<number[]>> = (value) =>
    setForm((current) => ({
      ...current,
      s3_connection_ids:
        typeof value === "function"
          ? value(current.s3_connection_ids ?? [])
          : value,
    }));
  const setUserIds: Dispatch<SetStateAction<number[]>> = (value) =>
    setForm((current) => ({
      ...current,
      user_ids:
        typeof value === "function"
          ? value(current.user_ids ?? [])
          : value,
    }));
  const setAccountSelections: Dispatch<SetStateAction<AdminAccountSelection[]>> = (value) =>
    setForm((current) => {
      const currentSelections: AdminAccountSelection[] = (current.account_links ?? []).map(
        (link) => ({
          id: Number(link.account_id),
          manager_role: link.manager_role,
          portal_role: link.portal_role,
          allow_manager_browser_data_access: link.allow_manager_browser_data_access,
        }),
      );
      const next = typeof value === "function" ? value(currentSelections) : value;
      return {
        ...current,
        account_links: next.map(({ id, ...access }) => ({
          account_id: id,
          ...access,
        })),
      };
    });
  const setS3UserLinks: Dispatch<SetStateAction<S3UserMembership[]>> = (value) =>
    setForm((current) => ({
      ...current,
      s3_user_links:
        typeof value === "function"
          ? value(current.s3_user_links ?? [])
          : value,
    }));
  const setOpenStackCloudIds: Dispatch<SetStateAction<number[]>> = (value) =>
    setForm((current) => ({
      ...current,
      openstack_cloud_ids:
        typeof value === "function"
          ? value(current.openstack_cloud_ids ?? [])
          : value,
    }));
  const connectionAssociationState: AdminSimpleIdAssociationsState = {
    selected: form.s3_connection_ids ?? [],
    setSelected: setConnectionIds,
    labelById: connectionLabelById,
    available: connectionOptions.available.map((connection) => ({
      id: connection.id,
      label: connection.name,
    })),
    visible: connectionOptions.visible.map((connection) => ({
      id: connection.id,
      label: connection.name,
    })),
    search: connectionPicker.search,
    setSearch: (value) => {
      connectionPicker.setSearch(value);
      connectionsCatalog.setSearch(value);
    },
    loading: connectionsCatalog.loading,
    showPanel: connectionPicker.open,
    setShowPanel: connectionPicker.setOpen,
    selections: connectionPicker.selections,
    setSelections: connectionPicker.setSelections,
    toggleSelection: connectionPicker.toggleSelection,
    pagination: {
      page: connectionsCatalog.page,
      pageSize: connectionsCatalog.pageSize,
      total: connectionsCatalog.total,
      onPageChange: connectionsCatalog.setPage,
      onPageSizeChange: connectionsCatalog.setPageSize,
    },
  };
  const memberAssociationState: AdminSimpleIdAssociationsState = {
    selected: form.user_ids ?? [],
    setSelected: setUserIds,
    labelById: userLabelById,
    available: userOptions.available.map((user) => ({
      id: user.id,
      label: user.email,
    })),
    visible: userOptions.visible.map((user) => ({
      id: user.id,
      label: user.email,
    })),
    search: memberPicker.search,
    setSearch: (value) => {
      memberPicker.setSearch(value);
      usersCatalog.setSearch(value);
    },
    loading: usersCatalog.loading,
    showPanel: memberPicker.open,
    setShowPanel: memberPicker.setOpen,
    selections: memberPicker.selections,
    setSelections: memberPicker.setSelections,
    toggleSelection: memberPicker.toggleSelection,
    pagination: {
      page: usersCatalog.page,
      pageSize: usersCatalog.pageSize,
      total: usersCatalog.total,
      onPageChange: usersCatalog.setPage,
      onPageSizeChange: usersCatalog.setPageSize,
    },
  };
  const accountAssociationState: AdminAccountAssociationsState = {
    selected: (form.account_links ?? []).map((link) => ({
      id: Number(link.account_id),
      manager_role: link.manager_role,
      portal_role: link.portal_role,
      allow_manager_browser_data_access: link.allow_manager_browser_data_access,
    })),
    setSelected: setAccountSelections,
    optionsById: accountOptionsById,
    available: accountOptions.available.map((account) => ({
      id: account.id,
      label: account.name,
    })),
    visible: accountOptions.visible.map((account) => ({
      id: account.id,
      label: account.name,
    })),
    search: accountPicker.search,
    setSearch: (value) => {
      accountPicker.setSearch(value);
      accountsCatalog.setSearch(value);
    },
    loading: accountsCatalog.loading,
    showPanel: accountPicker.open,
    setShowPanel: accountPicker.setOpen,
    selections: accountPicker.selections,
    setSelections: accountPicker.setSelections,
    accountAccessChoice,
    setAccountAccessChoice,
    toggleSelection: accountPicker.toggleSelection,
    pagination: {
      page: accountsCatalog.page,
      pageSize: accountsCatalog.pageSize,
      total: accountsCatalog.total,
      onPageChange: accountsCatalog.setPage,
      onPageSizeChange: accountsCatalog.setPageSize,
    },
  };
  const s3UserAssociationState: AdminRgwUserAccessAssociationsState<S3UserMembership> = {
    selected: form.s3_user_links ?? [],
    setSelected: setS3UserLinks,
    getId: (link) => link.s3_user_id,
    createLink: (id) => ({
      s3_user_id: id,
      allow_manager_browser_data_access: false,
    }),
    withAccess: (link, allowed) => ({
      ...link,
      allow_manager_browser_data_access: allowed,
    }),
    labelById: s3UserLabelById,
    available: s3UserOptions.available.map((s3User) => ({
      id: s3User.id,
      label: s3User.name,
    })),
    visible: s3UserOptions.visible.map((s3User) => ({
      id: s3User.id,
      label: s3User.name,
    })),
    search: s3UserPicker.search,
    setSearch: (value) => {
      s3UserPicker.setSearch(value);
      s3UsersCatalog.setSearch(value);
    },
    loading: s3UsersCatalog.loading,
    showPanel: s3UserPicker.open,
    setShowPanel: s3UserPicker.setOpen,
    selections: s3UserPicker.selections,
    setSelections: s3UserPicker.setSelections,
    toggleSelection: s3UserPicker.toggleSelection,
    pagination: {
      page: s3UsersCatalog.page,
      pageSize: s3UsersCatalog.pageSize,
      total: s3UsersCatalog.total,
      onPageChange: s3UsersCatalog.setPage,
      onPageSizeChange: s3UsersCatalog.setPageSize,
    },
  };
  const openStackAssociationState: AdminSimpleIdAssociationsState = {
    selected: form.openstack_cloud_ids ?? [],
    setSelected: setOpenStackCloudIds,
    labelById: openStackCloudLabelById,
    available: openStackOptions.available.map((cloud) => ({ id: cloud.id, label: cloud.name })),
    visible: openStackOptions.visible.map((cloud) => ({ id: cloud.id, label: cloud.name })),
    search: openStackPicker.search,
    setSearch: (value) => {
      openStackPicker.setSearch(value);
      openStackCloudsCatalog.setSearch(value);
    },
    loading: openStackCloudsCatalog.loading,
    showPanel: openStackPicker.open,
    setShowPanel: openStackPicker.setOpen,
    selections: openStackPicker.selections,
    setSelections: openStackPicker.setSelections,
    toggleSelection: openStackPicker.toggleSelection,
    pagination: {
      page: openStackCloudsCatalog.page,
      pageSize: openStackCloudsCatalog.pageSize,
      total: openStackCloudsCatalog.total,
      onPageChange: openStackCloudsCatalog.setPage,
      onPageSizeChange: openStackCloudsCatalog.setPageSize,
    },
  };

  const renderMembersTab = () => (
    <AdminSimpleIdAssociationsPanel
      state={memberAssociationState}
      maxVisibleOptions={MAX_VISIBLE_ASSOCIATION_OPTIONS}
      primaryLabel={text("user")}
      actionsLabel={text("actions")}
      removeLabel={text("remove")}
      loadingMessage={text("loadingUsers")}
      emptyMessage={text("noLinkedUsers")}
      pickerTitle={text("addUiUsers")}
      searchHint={text("filterByEmail")}
      fallbackLabel={(id) => text("userNumber", { id })}
      searchAriaLabel={text("searchGroupMembers")}
      pickerEmptyMessage={text("noUsersAvailable")}
      normalizeSelection={(ids) => [...new Set(ids)].sort((left, right) => left - right)}
      section={{
        title: text("members"),
        countLabel: text("linkedCount", { count: selectedUserIds.size }),
        actionLabel: memberPicker.open ? text("close") : text("addUiUsers"),
      }}
    />
  );

  const renderAssociationsTab = () => (
    <AdminAssociationTabs
      tabs={[
        {
          id: "accounts",
          label: text("accounts"),
          count: selectedAccountIds.size,
          actionLabel: accountPicker.open ? text("close") : text("addAccounts"),
          onAction: () => accountPicker.setOpen((current) => !current),
          content: (
            <AdminAccountAssociationsPanel
              accounts={accountAssociationState}
              maxVisibleOptions={MAX_VISIBLE_ASSOCIATION_OPTIONS}
              showPortalRole={showPortalRole}
              labels={{
                account: text("account"),
                managerRole: text("managerRole"),
                portalRole: text("portalRole"),
                actions: text("actions"),
                remove: text("remove"),
                loading: text("loadingAccounts"),
                empty: text("noLinkedAccounts"),
                pickerTitle: text("addAccounts"),
                searchHint: text("searchByName"),
                availableTitle: text("availableAccounts"),
                fallbackLabel: (id) => text("accountNumber", { id }),
                searchAriaLabel: text("searchGroupAccounts"),
                pickerEmptyMessage: text("noAccountsAvailable"),
              }}
              normalizeSelection={(links) =>
                [...links].sort((left, right) => left.id - right.id)
              }
            />
          ),
        },
        {
          id: "s3_users",
          label: text("s3Users"),
          count: selectedS3UserIds.size,
          actionLabel: s3UserPicker.open ? text("close") : text("addRgwUsers"),
          onAction: () => s3UserPicker.setOpen((current) => !current),
          content: (
            <AdminRgwUserAccessAssociationsPanel
              state={s3UserAssociationState}
              maxVisibleOptions={MAX_VISIBLE_ASSOCIATION_OPTIONS}
              primaryLabel={text("rgwUser")}
              actionsLabel={text("actions")}
              removeLabel={text("remove")}
              loadingMessage={text("loadingRgwUsers")}
              emptyMessage={text("noLinkedRgwUsers")}
              pickerTitle={text("addRgwUsers")}
              searchHint={text("searchByName")}
              fallbackLabel={(id) => text("rgwUserNumber", { id })}
              searchAriaLabel={text("searchGroupS3Users")}
              pickerEmptyMessage={text("noRgwUsersAvailable")}
              normalizeSelection={(links) =>
                [...links].sort((a, b) => a.s3_user_id - b.s3_user_id)
              }
            />
          ),
        },
        {
          id: "connections",
          label: text("connections"),
          count: selectedConnectionIds.size,
          actionLabel: connectionPicker.open ? text("close") : text("addS3Connections"),
          onAction: () => connectionPicker.setOpen((current) => !current),
          hint: text("sharedConnectionsOnly"),
          content: (
            <AdminSimpleIdAssociationsPanel
              state={connectionAssociationState}
              maxVisibleOptions={MAX_VISIBLE_ASSOCIATION_OPTIONS}
              primaryLabel={text("s3Connection")}
              actionsLabel={text("actions")}
              removeLabel={text("remove")}
              loadingMessage={text("loadingSharedConnections")}
              emptyMessage={text("noLinkedS3Connections")}
              pickerTitle={text("addS3Connections")}
              searchHint={text("sharedOnly")}
              fallbackLabel={(id) => text("connectionNumber", { id })}
              searchAriaLabel={text("searchGroupSharedConnections")}
              pickerEmptyMessage={text("noSharedConnectionsAvailable")}
              normalizeSelection={(ids) => [...new Set(ids)].sort((a, b) => a - b)}
            />
          ),
        },
        ...(openStackEnabled ? [{
          id: "openstack",
          label: text("openStack"),
          count: selectedOpenStackCloudIds.size,
          actionLabel: openStackPicker.open ? text("close") : text("addOpenStackClouds"),
          onAction: () => openStackPicker.setOpen((current) => !current),
          content: (
            <AdminSimpleIdAssociationsPanel
              state={openStackAssociationState}
              maxVisibleOptions={MAX_VISIBLE_ASSOCIATION_OPTIONS}
              primaryLabel={text("cloud")}
              actionsLabel={text("actions")}
              removeLabel={text("remove")}
              loadingMessage={text("loadingOpenStackClouds")}
              emptyMessage={text("noLinkedOpenStackClouds")}
              pickerTitle={text("addOpenStackClouds")}
              searchHint={text("searchByName")}
              fallbackLabel={(id) => text("cloudNumber", { id })}
              searchAriaLabel={text("searchGroupOpenStackClouds")}
              pickerEmptyMessage={text("noOpenStackCloudsAvailable")}
              normalizeSelection={(ids) => [...new Set(ids)].sort((a, b) => a - b)}
            />
          ),
        }] : []),
      ]}
      activeTab={associationTab}
      onChange={(id) => {
        setAssociationTab(
          id === "s3_users" || id === "connections" || id === "openstack" ? id : "accounts"
        );
        storageAssociations.closePickers();
      }}
    />
  );

  return (
    <div className={workflowPageHostClass(showModal)}>
      <SettingsNavigationGuard dirty={hasUnsavedChanges} onDiscard={closeModal}
        title={text("discardTitle")} description={text("unsavedChanges")}
        confirmLabel={text("discardChanges")} cancelLabel={text("keepEditing")}
        closeLabel={locale === "en" ? undefined : text("close")} />
      <PageHeader actionPresentation="listing"
        title={text("uiGroups")}
        description={text("pageDescription")}
        breadcrumbs={groupBreadcrumbs()}
        actions={[{ label: text("createGroup"), onClick: openCreateModal }]}
      />
      {actionError && <PageBanner tone="error">{actionError}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}

      <AdminGroupsList
        groups={groups}
        loading={loading}
        error={error}
        filter={filter}
        sort={sort}
        page={page}
        pageSize={pageSize}
        total={totalGroups}
        busyId={busyId}
        accountOptionsById={accountOptionsById}
        s3UserLabelById={s3UserLabelById}
        connectionLabelById={connectionLabelById}
        onFilterChange={handleFilterChange}
        onSort={toggleSort}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
        onEdit={openEditModal}
        onDelete={setPendingDeleteGroup}
      />

      {showModal && (
        <WorkflowPage
          title={editingGroup ? text("editUiGroup") : text("createUiGroup")}
          description={text("editorDescription")}
          breadcrumbs={groupBreadcrumbs({ label: editingGroup ? text("edit") : text("create") })}
          backLabel={text("backToGroups")}
          onBack={closeGuard.requestClose}
          backDisabled={saving}
          contentClassName="settings-compact settings-form"
          contentVariant="plain"
          width="wide"
        >
          {actionError && (
            <PageBanner tone="error" className="mb-3">
              {actionError}
            </PageBanner>
          )}
          <SettingsForm label={editingGroup ? text("editUiGroup") : text("createUiGroup")} busy={saving}
            onSubmit={submitGroup} onCancel={closeGuard.requestClose} submitLabel={text("save")} busyLabel={text("saving")}
            actions={editingGroup ? (
              <SettingsPersistentEditActions dirty={hasUnsavedChanges} busy={saving} onCancel={closeGuard.requestClose}
                saveLabel={text("save")} savingLabel={text("saving")} cancelLabel={text("cancel")} doneLabel={text("done")} />
            ) : <>
              <SettingsButton variant="secondary" disabled={saving} onClick={closeGuard.requestClose}>{text("cancel")}</SettingsButton>
              <SettingsButton type="submit" disabled={saving}>{saving ? text("saving") : text("save")}</SettingsButton>
            </>}>
            <WorkflowTabs<GroupModalTab>
              panelClassName={modalTab === "members" || modalTab === "associations" ? adminAssociationPanelClass : undefined}
              activeTab={modalTab}
              onTabChange={setModalTab}
              ariaLabel={text("configurationSections")}
              idPrefix="admin-ui-group-editor"
              tabs={[
                { id: "general", label: text("general") },
                ...(!editingGroup?.system_key ? [{ id: "members" as const, label: text("members") }] : []),
                { id: "associations", label: text("associations") },
                { id: "access", label: text("platformAccess") },
              ]}
            >

            {modalTab === "general" && (
              <>
                <SettingsSection title={text("identity")} presentation="compact">
                  <div className="settings-fields">
                    <UiInput id="admin-ui-group-name" label={text("name")} required disabled={Boolean(editingGroup?.system_key)}
                      value={form.name ?? ""} placeholder={text("namePlaceholder")}
                      error={attempted && !String(form.name || "").trim() ? text("nameRequired") : undefined}
                      onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
                    <UiTextarea label={text("description")} rows={3} value={form.description ?? ""}
                      placeholder={text("descriptionPlaceholder")}
                      onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
                    {editingGroup?.system_key === "all_users" && (
                      <p className="settings-readonly">{text("allUsersImplicitMembership")}</p>
                    )}
                  </div>
                </SettingsSection>
                <SettingsSection title={text("groupPictogram")} presentation="compact"
                  description={text("pictogramDescription")}>
                  <div className="settings-fields">
                    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={text("groupPictogram")}>
                      <GroupAvatar avatar={avatarPreview} name={String(form.name || text("uiGroup"))} size="md" />
                      <SettingsButton variant={form.avatar_source === "initials" && !avatarFile ? "primary" : "secondary"}
                        aria-pressed={form.avatar_source === "initials" && !avatarFile}
                        onClick={() => {
                          setAvatarFile(null);
                          setRemoveAvatarImage(false);
                          setForm((current) => ({ ...current, avatar_source: "initials", avatar_icon: null }));
                        }}>{text("initials")}</SettingsButton>
                      {groupAvatarIcons.map((icon) => (
                        <SettingsButton key={icon.value} title={icon.label}
                          variant={form.avatar_source === "preset" && form.avatar_icon === icon.value && !avatarFile ? "primary" : "secondary"}
                          aria-label={text("usePictogram", { label: icon.label })}
                          aria-pressed={form.avatar_source === "preset" && form.avatar_icon === icon.value && !avatarFile}
                          onClick={() => {
                            setAvatarFile(null);
                            setRemoveAvatarImage(false);
                            setForm((current) => ({ ...current, avatar_source: "preset", avatar_icon: icon.value }));
                          }}>
                          <GroupAvatar avatar={{ source: "preset", initials: "", icon: icon.value, url: null, updated_at: null }}
                            name={icon.label} size="sm" className="border-0" />
                        </SettingsButton>
                      ))}
                    </div>
                    <UiInput label={text("uploadImage")} type="file" accept="image/png,image/jpeg"
                      hint={text("imageRequirements")}
                      onChange={(event) => {
                        selectAvatarFile(event.target.files?.[0] ?? null);
                        event.target.value = "";
                      }} />
                    {avatarFile && <p className="settings-readonly [overflow-wrap:anywhere]">{avatarFile.name}</p>}
                    {editingGroup?.avatar?.source === "uploaded" && !avatarFile && !removeAvatarImage && (
                      <div><SettingsButton variant="danger" onClick={() => {
                        setRemoveAvatarImage(true);
                        setForm((current) => ({ ...current, avatar_source: "initials", avatar_icon: null }));
                      }}>{text("removeUploadedImage")}</SettingsButton></div>
                    )}
                  </div>
                </SettingsSection>
              </>
            )}

            {modalTab === "members" && renderMembersTab()}

            {modalTab === "associations" && (
              renderAssociationsTab()
            )}

            {modalTab === "access" && (
              <>
                <WorkspaceAccessSection
                  description={text("workspaceAccessDescription")}
                  cephAdmin={{
                    title: text("cephAdminAccess"),
                    description: text("cephAdminAccessDescription"),
                    checked: Boolean(form.can_access_ceph_admin),
                    onChange: (value) => setForm((current) => ({ ...current, can_access_ceph_admin: value })),
                    ariaLabel: text("allowCephAdminAccess"),
                  }}
                  storageOps={{
                    title: text("storageOpsAccess"),
                    description: text("storageOpsAccessDescription"),
                    checked: Boolean(form.can_access_storage_ops),
                    onChange: (value) => setForm((current) => ({ ...current, can_access_storage_ops: value })),
                    ariaLabel: text("allowStorageOpsAccess"),
                  }}
                />
                <ManagerToolAccessSection
                  title={text("manager")}
                  additionalItems={[
                    {
                      title: text("provisionManagedPrivateConnections"),
                      description: text("managedProvisioningDescription"),
                      checked: Boolean(form.can_provision_managed_private_connections),
                      platformDefault: generalSettings.manager_feature_policies?.managed_private_connection_provisioning === "default_on",
                      blocked: !isFeaturePolicyAvailable(generalSettings.manager_feature_policies.managed_private_connection_provisioning),
                      onChange: (value) =>
                        setForm((current) => ({
                          ...current,
                          can_provision_managed_private_connections: value,
                        })),
                      ariaLabel: text("allowManagedProvisioning"),
                    },
                  ]}
                  description={text("managerAccessDescription")}
                  tools={managerToolDefinitions}
                  access={form.manager_tool_access}
                  onChange={(key: ManagerToolKey, value) =>
                    setForm((current) => ({
                      ...current,
                      manager_tool_access: {
                        ...normalizeManagerToolAccess(current.manager_tool_access),
                        [key]: value,
                      },
                    }))
                  }
                />
                <AdminAccessToggleSection
                  title={text("rgwMultisite")}
                  description={text("rgwMultisiteAccessDescription")}
                  items={[
                    {
                      title: text("switchRgwMultisiteEndpoints"),
                      description: text("switchRgwMultisiteEndpointsDescription"),
                      checked: Boolean(form.allow_multisite_endpoint_switching),
                      onChange: (value) =>
                        setForm((current) => ({
                          ...current,
                          allow_multisite_endpoint_switching: value,
                        })),
                      ariaLabel: text("allowRgwMultisiteEndpointSwitching"),
                    },
                  ]}
                />
                <BrowserAccessSection
                  description={text("browserAccessDescription")}
                  checked={Boolean(form.browser_advanced_features_enabled)}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      browser_advanced_features_enabled: value,
                    }))
                  }
                />
                <AdminAccessToggleSection
                  title={text("connections")}
                  description={text("connectionAccessDescription")}
                  items={[
                    {
                      title: text("createManualPrivateConnections"),
                      description: text("manualConnectionsDescription"),
                      checked: Boolean(form.can_create_manual_private_connections),
                      onChange: (value) =>
                        setForm((current) => ({
                          ...current,
                          can_create_manual_private_connections: value,
                        })),
                      ariaLabel: text("allowManualConnections"),
                    },
                  ]}
                />
              </>
            )}

            </WorkflowTabs>

          </SettingsForm>
          {closeGuard.confirmationDialog}
        </WorkflowPage>
      )}

      {pendingDeleteGroup && (
        <ConfirmActionDialog
          title={text("deleteUiGroup")}
          description={text("deleteDescription")}
          confirmLabel={text("deleteGroup")}
          cancelLabel={text("cancel")}
          processingLabel={text("processing")}
          impactLabel={text("impact")}
          closeLabel={locale === "en" ? undefined : text("close")}
          details={[{ label: text("group"), value: pendingDeleteGroup.name }]}
          impacts={[
            text("directPermissionsRemain"),
            text("resourcesRemain"),
          ]}
          loading={busyId === pendingDeleteGroup.id}
          onCancel={() => setPendingDeleteGroup(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
      {verificationDialog}
    </div>
  );
}
