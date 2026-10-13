/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import TableSortControls from "../../components/list/TableSortControls";
import { ListActions, ListBadge, ListActionButton, ListActionLink } from "../../components/list/ListControls";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CreateUserPayload,
  UpdateUserPayload,
  User,
  type S3UserMembership,
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
  type AccountAccessGrant,
} from "../../api/accountAccess";
import { UiGroupSummary, listMinimalGroups } from "../../api/groups";
import { S3AccountSummary, listMinimalS3Accounts } from "../../api/accounts";
import { S3UserSummary, listMinimalS3Users } from "../../api/s3Users";
import { S3ConnectionSummary, listMinimalS3Connections } from "../../api/s3ConnectionsAdmin";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import ListPageSection from "../../components/list/ListPageSection";
import WorkflowPage, {
  WorkflowMetadata,
  workflowPageHostClass,
} from "../../components/WorkflowPage";
import WorkflowTabs from "../../components/WorkflowTabs";
import PageHeader from "../../components/PageHeader";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import {
  CompactAssociationSummary,
  accountAssociationRoleLabels,
  type CompactAssociationCategory,
} from "./AssociationSummary";
import {
  AdminAccessToggleSection,
  BrowserAccessSection,
  ManagerToolAccessSection,
  WorkspaceAccessSection,
} from "./AdminAccessSections";
import {
  DEFAULT_MANAGER_TOOL_ACCESS,
  buildManagerToolDefinitions,
  normalizeManagerToolAccess,
  type ManagerToolKey,
} from "./adminAccessConfig";
import PageBanner from "../../components/PageBanner";
import SettingsForm from "../../components/settings/SettingsForm";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import { SettingsButton, SettingsPersistentEditActions, useSettingsCloseGuard } from "../../components/settings/SettingsControls";
import AdminUserIdentityFields, { userIdentityErrors, type UserIdentityErrors } from "./AdminUserIdentityFields";
import SettingsNavigationGuard from "../../components/settings/SettingsNavigationGuard";
import UserAvatarEditor from "../shared/UserAvatarEditor";
import { UserLanguageField, UserNotificationFields } from "../shared/UserProfilePreferenceFields";
import { useProfileI18n } from "../shared/profileMessages";
import DataTableShell, {
  dataTableDefaultActionProps,
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import ToolbarSearchInput from "../../components/ToolbarSearchInput";
import UserAvatar from "../../components/UserAvatar";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";

import { cx, uiMutedTextClass } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { stableSignature } from "../../utils/stableSignature";
import { isAdminLikeRole, isSuperAdminRole, readStoredUser, setSessionUserCache } from "../../utils/workspaces";
import {
  clearAdminPrincipalEditRequest,
  readAdminPrincipalEditRequest,
} from "./adminPrincipalEditLink";
import UserAssociationsTabs, { type AssociationTab } from "./UserAssociationsTabs";
import type { AccountSelection } from "./UserAccountAssociationsPanel";
import { adminAssociationPanelClass } from "./AdminAssociationPicker";
import UserGroupsSelector from "./UserGroupsSelector";
import UserAuthenticationPanel from "./UserAuthenticationPanel";
import { buildAccessAuditHref } from "./accessAuditLink";
import { useUsersI18n } from "./usersMessage";
import { useAdminUserI18n } from "./adminUserMessage";

type UserModalTab = "general" | "authentication" | "associations" | "groups" | "access";
type AuxiliaryLoadState = "idle" | "loading" | "loaded" | "error";

function focusIdentityError(prefix: string, errors: UserIdentityErrors) {
  const field = errors.email ? "email" : "password";
  requestAnimationFrame(() => document.getElementById(`${prefix}-${field}`)?.focus());
}

export default function UsersPage() {
  type SortField = "name" | "role" | "accounts" | "last_login_at";

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
  const storageOpsAccessDescription = text("storageOpsAccessDescription");
  const closeLabel = locale === "zh" ? text("close") : undefined;
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
  const [accounts, setS3Accounts] = useState<S3AccountSummary[]>([]);
  const [s3AccountsLoaded, setS3AccountsLoaded] = useState(false);
  const [s3AccountsLoading, setS3AccountsLoading] = useState(false);
  const [s3Users, setS3Users] = useState<S3UserSummary[]>([]);
  const [s3UsersLoading, setS3UsersLoading] = useState(false);
  const [s3Connections, setS3Connections] = useState<S3ConnectionSummary[]>([]);
  const [s3ConnectionsLoading, setS3ConnectionsLoading] = useState(false);
  const [groups, setGroups] = useState<UiGroupSummary[]>([]);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [groupsLoading, setGroupsLoading] = useState(false);
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
    stableSignature({
      form: createFormTemplate(),
      selectedAccounts: [],
      selectedS3Users: [],
      selectedS3Connections: [],
      selectedGroups: [],
      pendingAccountSelections: [],
      pendingS3UserSelections: [],
      pendingConnectionSelections: [],
      pendingGroupSelections: [],
      accountAccessChoice: {},
    })
  );
  const [createSelectedS3Accounts, setCreateSelectedS3Accounts] = useState<AccountSelection[]>([]);
  const [createSelectedS3Users, setCreateSelectedS3Users] = useState<S3UserMembership[]>([]);
  const [createSelectedS3Connections, setCreateSelectedS3Connections] = useState<number[]>([]);
  const [createSelectedGroups, setCreateSelectedGroups] = useState<number[]>([]);
  const [createAccountAccessChoice, setCreateAccountAccessChoice] = useState<
    Record<number, AccountAccessGrant>
  >({});
  const [createS3AccountSearch, setCreateS3AccountSearch] = useState("");
  const [createS3Search, setCreateS3Search] = useState("");
  const [createConnectionSearch, setCreateConnectionSearch] = useState("");
  const [createGroupSearch, setCreateGroupSearch] = useState("");
  const [createModalTab, setCreateModalTab] = useState<UserModalTab>("general");
  const [createAssociationsTab, setCreateAssociationsTab] = useState<"accounts" | "s3_users" | "connections">("accounts");
  const [showCreateAccountPanel, setShowCreateAccountPanel] = useState(false);
  const [createAccountSelections, setCreateAccountSelections] = useState<number[]>([]);
  const [showCreateS3UserPanel, setShowCreateS3UserPanel] = useState(false);
  const [createS3UserSelections, setCreateS3UserSelections] = useState<number[]>([]);
  const [showCreateConnectionPanel, setShowCreateConnectionPanel] = useState(false);
  const [createConnectionSelections, setCreateConnectionSelections] = useState<number[]>([]);
  const [showCreateGroupPanel, setShowCreateGroupPanel] = useState(false);
  const [createGroupSelections, setCreateGroupSelections] = useState<number[]>([]);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState<UpdateUserPayload>({});
  const [editInitialSignature, setEditInitialSignature] = useState(() =>
    stableSignature({
      form: {},
      selectedAccounts: [],
      selectedS3Users: [],
      selectedS3Connections: [],
      selectedGroups: [],
      pendingAccountSelections: [],
      pendingS3UserSelections: [],
      pendingConnectionSelections: [],
      pendingGroupSelections: [],
      accountAccessChoice: {},
    })
  );
  const [editSelectedS3Accounts, setEditSelectedS3Accounts] = useState<AccountSelection[]>([]);
  const [editSelectedS3Users, setEditSelectedS3Users] = useState<S3UserMembership[]>([]);
  const [editSelectedS3Connections, setEditSelectedS3Connections] = useState<number[]>([]);
  const [editSelectedGroups, setEditSelectedGroups] = useState<number[]>([]);
  const [editAccountAccessChoice, setEditAccountAccessChoice] = useState<
    Record<number, AccountAccessGrant>
  >({});
  const [editS3AccountSearch, setEditS3AccountSearch] = useState("");
  const [editS3Search, setEditS3Search] = useState("");
  const [editConnectionSearch, setEditConnectionSearch] = useState("");
  const [editGroupSearch, setEditGroupSearch] = useState("");
  const [editModalTab, setEditModalTab] = useState<UserModalTab>("general");
  const [editAssociationsTab, setEditAssociationsTab] = useState<"accounts" | "s3_users" | "connections">("accounts");
  const [showEditAccountPanel, setShowEditAccountPanel] = useState(false);
  const [editAccountSelections, setEditAccountSelections] = useState<number[]>([]);
  const [showEditS3UserPanel, setShowEditS3UserPanel] = useState(false);
  const [editS3UserSelections, setEditS3UserSelections] = useState<number[]>([]);
  const [showEditConnectionPanel, setShowEditConnectionPanel] = useState(false);
  const [editConnectionSelections, setEditConnectionSelections] = useState<number[]>([]);
  const [showEditGroupPanel, setShowEditGroupPanel] = useState(false);
  const [editGroupSelections, setEditGroupSelections] = useState<number[]>([]);
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
  const [sort, setSort] = useState<{ field: SortField; direction: "asc" | "desc" }>({
    field: "name",
    direction: "asc",
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalUsers, setTotalUsers] = useState(0);
  const s3AccountsLoadStateRef = useRef<AuxiliaryLoadState>("idle");
  const s3UsersLoadStateRef = useRef<AuxiliaryLoadState>("idle");
  const s3ConnectionsLoadStateRef = useRef<AuxiliaryLoadState>("idle");
  const groupsLoadStateRef = useRef<AuxiliaryLoadState>("idle");
  const accountOptions = useMemo(() => accounts.map((a) => ({ id: a.id, label: a.name })), [accounts]);
  const accountOptionsById = useMemo(() => {
    const map = new Map<number, S3AccountSummary>();
    accounts.forEach((a) => {
      map.set(a.id, a);
    });
    return map;
  }, [accounts]);
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
  const createTargetSupportsCephAdmin = createRoleValue === "ui_admin" || createRoleValue === "ui_superadmin";
  const createTargetSupportsStorageOps =
    createRoleValue === "ui_user" || createRoleValue === "ui_admin" || createRoleValue === "ui_superadmin";
  const editTargetSupportsCephAdmin = editRoleValue === "ui_admin" || editRoleValue === "ui_superadmin";
  const editTargetSupportsStorageOps =
    editRoleValue === "ui_user" || editRoleValue === "ui_admin" || editRoleValue === "ui_superadmin";
  const editTargetSupportsManagerTools = editTargetSupportsStorageOps;
  const createTargetSupportsManagerTools = createTargetSupportsStorageOps;
  const createCanGrantCephAdmin = currentIsSuperAdmin && createTargetSupportsCephAdmin;
  const createCanGrantStorageOps = currentIsAdminLike && createTargetSupportsStorageOps;
  const editCanGrantCephAdmin = currentIsSuperAdmin && editTargetSupportsCephAdmin;
  const editCanGrantStorageOps = currentIsAdminLike && editTargetSupportsStorageOps;
  const managerToolDefinitions = useMemo(
    () => buildManagerToolDefinitions(generalSettings),
    [generalSettings]
  );

  const formatLastLogin = (value?: string | null) => {
    if (!value) return "-";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }
    return parsed.toLocaleString(locale);
  };

  const renderAssociationSummary = (user: User) => {
    const effectiveAccountLinks = user.effective_access?.account_links ?? [];
    const displayedAccountLinks = effectiveAccountLinks.length > 0
      ? effectiveAccountLinks
      : (user.account_links ?? []);
    const accountItems = displayedAccountLinks.map((link) => {
      const id = Number(link.account_id);
      const label = accountOptionsById.get(id)?.name ?? text("accountFallback", { id });
      const roleLabels = accountAssociationRoleLabels({
        id,
        label,
        manager_role: link.manager_role,
        portal_role: link.portal_role,
      });
      return {
        id,
        label,
        manager_role: link.manager_role,
        portal_role: link.portal_role,
        role_labels: roleLabels,
      };
    });
    const effectiveS3UserDetails = user.effective_access?.s3_user_details ?? [];
    const s3UserItems =
      effectiveS3UserDetails.length > 0
        ? effectiveS3UserDetails.map((entry) => ({
            id: entry.id,
            label: entry.name || text("userFallback", { id: entry.id }),
          }))
        : (user.s3_user_details ?? []).map((entry) => ({
            id: entry.id,
            label: entry.name || text("userFallback", { id: entry.id }),
          }));
    const effectiveConnectionDetails = user.effective_access?.s3_connection_details ?? [];
    const connectionItems =
      effectiveConnectionDetails.length > 0
        ? effectiveConnectionDetails.map((entry) => ({
            id: entry.id,
            label: entry.name || text("connectionFallback", { id: entry.id }),
          }))
        : (user.s3_connection_details ?? []).map((entry) => ({
            id: entry.id,
            label: entry.name || text("connectionFallback", { id: entry.id }),
          }));
    const categories: CompactAssociationCategory[] = [
      {
        id: "accounts",
        label: text("accounts"),
        itemLabel: text("rgwAccount"),
        items: accountItems.map((account) => ({
          id: account.id,
          label: account.label,
          role_labels: account.role_labels,
        })),
      },
      { id: "s3_users", label: text("rgwUsers"), itemLabel: text("rgwUser"), items: s3UserItems },
      { id: "connections", label: text("s3Connections"), itemLabel: text("s3Connection"), items: connectionItems },
    ];
    return <CompactAssociationSummary categories={categories} />;
  };

  const toggleSort = (field: SortField) => {
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
      const totalPages = Math.max(1, Math.ceil((response.total || 0) / pageSize));
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

  const fetchS3Accounts = useCallback(async () => {
    if (s3AccountsLoadStateRef.current === "loading") return;
    s3AccountsLoadStateRef.current = "loading";
    setS3AccountsLoading(true);
    try {
      const data = await listMinimalS3Accounts();
      setS3Accounts(data);
      setS3AccountsLoaded(true);
      s3AccountsLoadStateRef.current = "loaded";
    } catch (err) {
      s3AccountsLoadStateRef.current = "error";
      console.error(err);
    } finally {
      setS3AccountsLoading(false);
    }
  }, []);

  const fetchS3Users = useCallback(async () => {
    if (s3UsersLoadStateRef.current === "loading") return;
    s3UsersLoadStateRef.current = "loading";
    setS3UsersLoading(true);
    try {
      const data = await listMinimalS3Users();
      setS3Users(data);
      s3UsersLoadStateRef.current = "loaded";
    } catch (err) {
      s3UsersLoadStateRef.current = "error";
      console.error(err);
    } finally {
      setS3UsersLoading(false);
    }
  }, []);

  const fetchS3Connections = useCallback(async () => {
    if (s3ConnectionsLoadStateRef.current === "loading") return;
    s3ConnectionsLoadStateRef.current = "loading";
    setS3ConnectionsLoading(true);
    try {
      const data = await listMinimalS3Connections();
      setS3Connections(data);
      s3ConnectionsLoadStateRef.current = "loaded";
    } catch (err) {
      s3ConnectionsLoadStateRef.current = "error";
      console.error(err);
    } finally {
      setS3ConnectionsLoading(false);
    }
  }, []);

  const ensureS3Accounts = useCallback(async (options?: { retryOnError?: boolean }) => {
    const loadState = s3AccountsLoadStateRef.current;
    if (loadState === "loaded" || loadState === "loading") return;
    if (loadState === "error" && !options?.retryOnError) return;
    await fetchS3Accounts();
  }, [fetchS3Accounts]);

  const ensureS3Users = useCallback(async (options?: { retryOnError?: boolean }) => {
    const loadState = s3UsersLoadStateRef.current;
    if (loadState === "loaded" || loadState === "loading") return;
    if (loadState === "error" && !options?.retryOnError) return;
    await fetchS3Users();
  }, [fetchS3Users]);

  const ensureS3Connections = useCallback(async (options?: { retryOnError?: boolean }) => {
    const loadState = s3ConnectionsLoadStateRef.current;
    if (loadState === "loaded" || loadState === "loading") return;
    if (loadState === "error" && !options?.retryOnError) return;
    await fetchS3Connections();
  }, [fetchS3Connections]);

  const fetchGroups = useCallback(async () => {
    if (groupsLoadStateRef.current === "loading") return;
    groupsLoadStateRef.current = "loading";
    setGroupsLoading(true);
    try {
      const data = await listMinimalGroups();
      setGroups(data);
      setGroupsLoaded(true);
      groupsLoadStateRef.current = "loaded";
    } catch (err) {
      groupsLoadStateRef.current = "error";
      console.error(err);
    } finally {
      setGroupsLoading(false);
    }
  }, []);

  const ensureGroups = useCallback(async (options?: { retryOnError?: boolean }) => {
    const loadState = groupsLoadStateRef.current;
    if (loadState === "loaded" || loadState === "loading") return;
    if (loadState === "error" && !options?.retryOnError) return;
    await fetchGroups();
  }, [fetchGroups]);

  const ensureAssociationOptionsForTab = useCallback(
    async (tab: AssociationTab, options?: { retryOnError?: boolean }) => {
      if (tab === "accounts") {
        await ensureS3Accounts(options);
        return;
      }
      if (tab === "s3_users") {
        await ensureS3Users(options);
        return;
      }
      await ensureS3Connections(options);
    },
    [ensureS3Accounts, ensureS3Connections, ensureS3Users]
  );

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    ensureS3Accounts();
  }, [ensureS3Accounts]);

  useEffect(() => {
    if ((showCreateModal && createModalTab === "groups") || (showEditModal && editModalTab === "groups")) {
      void ensureGroups({ retryOnError: true });
    }
  }, [createModalTab, editModalTab, ensureGroups, showCreateModal, showEditModal]);

  const toggleCreateAccountSelection = (accountId: number) => {
    setCreateAccountSelections((prev) =>
      prev.includes(accountId) ? prev.filter((id) => id !== accountId) : [...prev, accountId]
    );
  };

  const toggleCreateS3UserSelection = (userId: number) => {
    setCreateS3UserSelections((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const toggleCreateConnectionSelection = (connectionId: number) => {
    setCreateConnectionSelections((prev) =>
      prev.includes(connectionId) ? prev.filter((id) => id !== connectionId) : [...prev, connectionId]
    );
  };

  const toggleEditAccountSelection = (accountId: number) => {
    setEditAccountSelections((prev) =>
      prev.includes(accountId) ? prev.filter((id) => id !== accountId) : [...prev, accountId]
    );
  };

  const toggleEditS3UserSelection = (userId: number) => {
    setEditS3UserSelections((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const toggleEditConnectionSelection = (connectionId: number) => {
    setEditConnectionSelections((prev) =>
      prev.includes(connectionId) ? prev.filter((id) => id !== connectionId) : [...prev, connectionId]
    );
  };

  const emptyCreateSignature = () =>
    stableSignature({
      form: createFormTemplate(),
      selectedAccounts: [],
      selectedS3Users: [],
      selectedS3Connections: [],
      selectedGroups: [],
      pendingAccountSelections: [],
      pendingS3UserSelections: [],
      pendingConnectionSelections: [],
      pendingGroupSelections: [],
      accountAccessChoice: {},
    });

  const createCurrentSignature = useMemo(
    () =>
      stableSignature({
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
    setCreateSelectedS3Accounts([]);
    setCreateSelectedS3Users([]);
    setCreateSelectedS3Connections([]);
    setCreateSelectedGroups([]);
    setCreateAccountAccessChoice({});
    setCreateS3AccountSearch("");
    setCreateS3Search("");
    setCreateConnectionSearch("");
    setCreateGroupSearch("");
    setCreateModalTab("general");
    setCreateAssociationsTab("accounts");
    setShowCreateAccountPanel(false);
    setShowCreateS3UserPanel(false);
    setShowCreateConnectionPanel(false);
    setShowCreateGroupPanel(false);
    setCreateAccountSelections([]);
    setCreateS3UserSelections([]);
    setCreateConnectionSelections([]);
    setCreateGroupSelections([]);
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
      stableSignature({
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
    setEditSelectedS3Accounts([]);
    setEditS3AccountSearch("");
    setEditSelectedS3Users([]);
    setEditS3Search("");
    setEditSelectedS3Connections([]);
    setEditConnectionSearch("");
    setEditSelectedGroups([]);
    setEditGroupSearch("");
    setEditModalTab("general");
    setEditAssociationsTab("accounts");
    setShowEditAccountPanel(false);
    setShowEditS3UserPanel(false);
    setShowEditConnectionPanel(false);
    setShowEditGroupPanel(false);
    setEditAccountSelections([]);
    setEditS3UserSelections([]);
    setEditConnectionSelections([]);
    setEditGroupSelections([]);
    setEditAccountAccessChoice({});
    setEditForm({});
    setEditRoleHelpOpen(false);
    setEditInitialSignature(
      stableSignature({
        form: {},
        selectedAccounts: [],
        selectedS3Users: [],
        selectedS3Connections: [],
        selectedGroups: [],
        pendingAccountSelections: [],
        pendingS3UserSelections: [],
        pendingConnectionSelections: [],
        pendingGroupSelections: [],
        accountAccessChoice: {},
      })
    );
    clearAdminPrincipalEditRequest();
  };

  const roleAccessPatch = (role: UiRole, current: UpdateUserPayload) => {
    const supportsCephAdmin = role === "ui_admin" || role === "ui_superadmin";
    const supportsStorageOps = role === "ui_user" || supportsCephAdmin;
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
        currentIsSuperAdmin && (role === "ui_admin" || role === "ui_superadmin")
          ? Boolean(form.can_access_ceph_admin)
          : false,
      can_access_storage_ops:
        currentIsAdminLike && (role === "ui_user" || role === "ui_admin" || role === "ui_superadmin")
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
            allow_manager_browser_data_access: Boolean(entry.allow_manager_browser_data_access),
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
        await fetchS3Accounts();
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
    if (!currentIsSuperAdmin && (user.role === "ui_admin" || user.role === "ui_superadmin")) {
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
        role === "ui_admin" || role === "ui_superadmin"
          ? Boolean(user.can_access_ceph_admin)
          : false,
      can_access_storage_ops:
        role === "ui_user" || role === "ui_admin" || role === "ui_superadmin"
          ? Boolean(user.can_access_storage_ops)
          : false,
      can_create_manual_private_connections:
        role === "ui_user" || role === "ui_admin" || role === "ui_superadmin"
          ? Boolean(user.can_create_manual_private_connections)
          : false,
      can_provision_managed_private_connections:
        role === "ui_user" || role === "ui_admin" || role === "ui_superadmin"
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
      allow_manager_browser_data_access: Boolean(link.allow_manager_browser_data_access),
    }));
    setEditSelectedS3Accounts(selectedAccounts);
    const nextSelectedS3Users = (user.s3_user_links ?? []).map((link) => ({
      s3_user_id: Number(link.s3_user_id),
      allow_manager_browser_data_access: Boolean(link.allow_manager_browser_data_access),
    }));
    const nextSelectedS3Connections = (user.s3_connection_details ?? []).map((connection) => Number(connection.id));
    const nextSelectedGroups = (user.group_details ?? []).map((group) => Number(group.id));
    setEditSelectedS3Users(nextSelectedS3Users);
    setEditSelectedS3Connections(nextSelectedS3Connections);
    setEditSelectedGroups(nextSelectedGroups);
    setEditS3AccountSearch("");
    setEditS3Search("");
    setEditConnectionSearch("");
    setEditGroupSearch("");
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
    setEditAssociationsTab(initialAssociationsTab);
    setShowEditAccountPanel(false);
    setShowEditS3UserPanel(false);
    setShowEditConnectionPanel(false);
    setShowEditGroupPanel(false);
    setEditAccountSelections([]);
    setEditS3UserSelections([]);
    setEditConnectionSelections([]);
    setEditGroupSelections([]);
    setEditAccountAccessChoice({});
    setEditInitialSignature(
      stableSignature({
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
      payload.quota_alerts_global_watch = (nextRole === "ui_admin" || nextRole === "ui_superadmin") && Boolean(editForm.quota_alerts_global_watch);
      if (editForm.role) {
        payload.role = nextRole;
      }
      payload.can_access_ceph_admin =
        currentIsSuperAdmin && (nextRole === "ui_admin" || nextRole === "ui_superadmin")
          ? Boolean(editForm.can_access_ceph_admin ?? editingUser.can_access_ceph_admin)
          : false;
      payload.can_access_storage_ops =
        currentIsAdminLike && (nextRole === "ui_user" || nextRole === "ui_admin" || nextRole === "ui_superadmin")
          ? Boolean(editForm.can_access_storage_ops ?? editingUser.can_access_storage_ops)
          : false;
      const nextRoleSupportsConnectionPermissions =
        nextRole === "ui_user" || nextRole === "ui_admin" || nextRole === "ui_superadmin";
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
        nextRole === "ui_user" || nextRole === "ui_admin" || nextRole === "ui_superadmin"
          ? normalizeManagerToolAccess(editForm.manager_tool_access ?? editingUser.manager_tool_access)
          : { ...DEFAULT_MANAGER_TOOL_ACCESS };
      payload.browser_advanced_features_enabled = Boolean(
        editForm.browser_advanced_features_enabled ?? editingUser.browser_advanced_features_enabled
      );
      payload.account_links = editSelectedS3Accounts.map((entry) => ({
        account_id: Number(entry.id),
        manager_role: entry.manager_role,
        portal_role: entry.portal_role,
        allow_manager_browser_data_access: Boolean(entry.allow_manager_browser_data_access),
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
      setEditAccountSelections([]);
      setEditS3UserSelections([]);
      setEditConnectionSelections([]);
      setEditGroupSelections([]);
      setEditAccountAccessChoice({});
      setEditInitialSignature(stableSignature({
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
        await fetchS3Accounts();
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

  const usersDescription = text("description");
  const associationLabel = text("storageAssociations");
  const filterPlaceholder = text("searchPlaceholder");
  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: users.length,
  });
  const userTableColumns: Array<DataTableColumn<User, SortField>> = [
    {
      id: "user",
      label: text("user"),
      field: "name",
      primary: true,
      render: (user) => {
        const fullName = user.full_name?.trim();
        return (
          <span className="flex min-w-0 items-center gap-2.5">
            <UserAvatar
              avatar={user.avatar}
              name={fullName || user.email}
              email={user.email}
              size="md"
              decorative
            />
            <span className="min-w-0">
              <span className="block break-words">{fullName || user.email}</span>
              {fullName && (
                <span className={cx("block break-all text-[11px] font-medium", uiMutedTextClass)}>
                  {user.email}
                </span>
              )}
            </span>
          </span>
        );
      },
    },
    {
      id: "role",
      label: text("role"),
      field: "role",
      render: (user) => (
        <div className="flex flex-wrap items-center gap-2">
          <span>{displayUiRole(user.role)}</span>
          {cephAdminFeatureEnabled &&
            (user.role === "ui_admin" || user.role === "ui_superadmin") &&
            user.can_access_ceph_admin && (
              <ListBadge tone="warning" className="uppercase tracking-wide">
                {text("cephAdmin")}
              </ListBadge>
            )}
        </div>
      ),
    },
    {
      id: "last_login_at",
      label: text("lastLogin"),
      field: "last_login_at",
      render: (user) => formatLastLogin(user.last_login_at),
    },
    {
      id: "associations",
      label: associationLabel,
      field: "accounts",
      mobileLabel: text("links"),
      render: (user) => renderAssociationSummary(user),
    },
    {
      id: "actions",
      label: text("actions"),
      align: "right",
      field: null,
      mobileRole: "actions",
      cellClassName: "min-w-[220px]",
      render: (user) => {
        const isCurrentUser = currentUserId !== null && user.id === currentUserId;
        const canManage = currentIsSuperAdmin || (user.role !== "ui_admin" && user.role !== "ui_superadmin");
        return (
          <ListActions>
            <ListActionButton
              type="button"
              onClick={() => startEdit(user)}
              disabled={!canManage}
              {...dataTableDefaultActionProps}
            >
              {text("edit")}
            </ListActionButton>
            <ListActionLink to={buildAccessAuditHref({ userId: user.id })}>
              {text("reviewAccess")}
            </ListActionLink>
            <ListActionButton
              type="button"
              onClick={() => handleDeleteRequest(user)}
               variant="danger"
              disabled={busyId === user.id || isCurrentUser || !canManage}
              title={isCurrentUser ? text("cannotDeleteSelf") : !canManage ? text("standardUsersOnly") : undefined}
            >
              {busyId === user.id ? text("deleting") : text("delete")}
            </ListActionButton>
          </ListActions>
        );
      },
    },
  ];

  return (
    <div className={workflowPageHostClass(showCreateModal || (Boolean(editingUser) && showEditModal))}>
      <SettingsNavigationGuard {...discardLabels} dirty={createDirty || editDirty} onDiscard={() => {
        if (showCreateModal) closeCreateModal();
        if (showEditModal) closeEditModal();
      }} />
      <PageHeader actionPresentation="listing"
        title={text("uiUsers")}
        description={usersDescription}
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
              <>
                <WorkspaceAccessSection
                  description={text("operationalWorkspaces")}
                  cephAdmin={{
                    title: text("cephAdminAccess"),
                    description:
                      text("cephAdminAccessDescription"),
                    checked: createCanGrantCephAdmin && Boolean(form.can_access_ceph_admin),
                    disabled: !createCanGrantCephAdmin,
                    onChange: (value) =>
                      setForm((f) => ({
                        ...f,
                        can_access_ceph_admin: value,
                      })),
                    ariaLabel: text("allowCephAdmin"),
                  }}
                  storageOps={{
                    title: text("storageOpsAccess"),
                    description: storageOpsAccessDescription,
                    checked: createCanGrantStorageOps && Boolean(form.can_access_storage_ops),
                    disabled: !createCanGrantStorageOps,
                    onChange: (value) =>
                      setForm((f) => ({
                        ...f,
                        can_access_storage_ops: value,
                      })),
                    ariaLabel: text("allowStorageOps"),
                  }}
                />
                {!createTargetSupportsManagerTools && (
                  <PageBanner tone="warning">
                    {text("managerRoleRequirement")}
                  </PageBanner>
                )}

                <ManagerToolAccessSection
                  eligible={createTargetSupportsManagerTools}
                  title={text("manager")}
                  additionalItems={[
                    {
                      title: text("provisionConnections"),
                      description: text("provisionConnectionsDescription"),
                      checked: createTargetSupportsManagerTools && Boolean(form.can_provision_managed_private_connections),
                      platformDefault: generalSettings.manager_feature_policies?.managed_private_connection_provisioning === "default_on",
                      blocked: !generalSettings.managed_private_connection_provisioning_enabled,
                      disabled: !createTargetSupportsManagerTools,
                      onChange: (value) =>
                        setForm((current) => ({
                          ...current,
                          can_provision_managed_private_connections: value,
                        })),
                      ariaLabel: text("allowProvisionConnections"),
                    },
                  ]}
                  description={text("managerPermissions")}
                  tools={managerToolDefinitions}
                  access={form.manager_tool_access}
                  isToolDisabled={(tool) => !createTargetSupportsManagerTools || !tool.enabled}
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
                <BrowserAccessSection
                  description={text("browserOptions")}
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
                  description={text("privateConnectionPermissions")}
                  items={[
                    {
                      title: text("createManualConnections"),
                      description: text("manualConnectionsDescription"),
                      checked: createTargetSupportsManagerTools && Boolean(form.can_create_manual_private_connections),
                      disabled: !createTargetSupportsManagerTools,
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

      <ListPageSection
        variant="page"
        mobileSort={<TableSortControls columns={userTableColumns} sort={{ field: sort.field, direction: sort.direction, onSort: toggleSort }}
          labels={{ sortBy: text("sortBy"), direction: text("direction"), ascending: text("ascending"), descending: text("descending") }} />}
          title={text("users")}
          countLabel={text(totalUsers === 1 ? "entryCount" : "entriesCount", { count: totalUsers })}
          search={
            <ToolbarSearchInput
              value={filter}
              onChange={handleFilterChange}
              placeholder={filterPlaceholder}
              className="min-w-0 flex-1 sm:w-64 md:w-72"
            />
          }
      >
        <DataTableShell
          columns={userTableColumns}
          rows={users}
          rowKey={(user) => user.id}
          status={tableStatus}
          loadingMessage={text("loadingUsers")}
          errorMessage={text("loadError")}
          emptyMessage={filter.trim() ? text("noMatches") : text("noUsers")}
          primaryColumnId="user"
          responsiveCards
          tableClassName="ui-data-table"
          sort={{ field: sort.field, direction: sort.direction, onSort: toggleSort }}
          pagination={{
            page,
            pageSize,
            total: totalUsers,
            onPageChange: handlePageChange,
            onPageSizeChange: handlePageSizeChange,
            disabled: loading,
          }}
        />
      </ListPageSection>

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
              <>
                <AdminUserIdentityFields
                  idPrefix="edit-user"
                  values={{ ...editForm, role: editRoleValue }}
                  errors={editAttempted ? userIdentityErrors(editForm, false, adminUserText) : {}}
                  onChange={(patch) => setEditForm((current) => ({ ...current, ...patch }))}
                  canAssignAdmin={currentIsSuperAdmin}
                  helpOpen={editRoleHelpOpen}
                  onToggleHelp={() => setEditRoleHelpOpen((open) => !open)}
                  onRoleChange={(value) => setEditForm((current) => ({ ...current, ...roleAccessPatch(value, current) }))}
                >
                  <UserAvatarEditor avatar={editingUser.avatar} name={editingUser.full_name} email={editingUser.email}
                    text={adminProfileText} disabled={busyId === editingUser.id || avatarBusy}
                    onDirtyChange={setAvatarDirty} onBusyChange={setAvatarBusy} onSave={async (draft) => {
                      const updated = draft.file && draft.preference === "uploaded" ? await uploadUserAvatar(editingUser.id, draft.file)
                        : draft.remove ? await deleteUserAvatar(editingUser.id) : await updateUser(editingUser.id, { avatar_preference: draft.preference });
                      setEditingUser(current => current ? { ...current, avatar: updated.avatar } : current);
                      setUsers(current => current.map(user => user.id === editingUser.id ? { ...user, avatar: updated.avatar } : user));
                      if (currentUserId === editingUser.id) setSessionUserCache({ ...(readStoredUser() ?? {}), avatar: updated.avatar });
                      setActionMessage(adminProfileText("imageSaved"));
                    }} />
                </AdminUserIdentityFields>
                <SettingsSection title={adminProfileText("display")} presentation="compact">
                  <UserLanguageField value={editForm.ui_language ?? "auto"} text={adminProfileText}
                    onChange={value => setEditForm(current => ({ ...current, ui_language: value === "auto" ? null : value }))} />
                </SettingsSection>
                <UserNotificationFields quotaAlerts={editForm.quota_alerts_enabled !== false}
                  quotaWatch={Boolean(editForm.quota_alerts_global_watch)} canWatch={editRoleValue === "ui_admin" || editRoleValue === "ui_superadmin"}
                  text={adminProfileText} onQuotaAlertsChange={value => setEditForm(current => ({ ...current, quota_alerts_enabled: value }))}
                  onQuotaWatchChange={value => setEditForm(current => ({ ...current, quota_alerts_global_watch: value }))} />
              </>
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
              <>
                <WorkspaceAccessSection
                  description={text("operationalWorkspaces")}
                  cephAdmin={{
                    title: text("cephAdminAccess"),
                    description:
                      text("cephAdminAccessDescription"),
                    checked: editCanGrantCephAdmin && Boolean(editForm.can_access_ceph_admin),
                    disabled: !editCanGrantCephAdmin,
                    onChange: (value) =>
                      setEditForm((f) => ({
                        ...f,
                        can_access_ceph_admin: value,
                      })),
                    ariaLabel: text("allowCephAdmin"),
                  }}
                  storageOps={{
                    title: text("storageOpsAccess"),
                    description: storageOpsAccessDescription,
                    checked: editCanGrantStorageOps && Boolean(editForm.can_access_storage_ops),
                    disabled: !editCanGrantStorageOps,
                    onChange: (value) =>
                      setEditForm((f) => ({
                        ...f,
                        can_access_storage_ops: value,
                      })),
                    ariaLabel: text("allowStorageOps"),
                  }}
                />
                {!editTargetSupportsManagerTools && (
                  <PageBanner tone="warning">
                    {text("managerRoleRequirement")}
                  </PageBanner>
                )}

                <ManagerToolAccessSection
                  eligible={editTargetSupportsManagerTools}
                  inheritedAccess={editingUser.effective_access?.group_manager_tool_access}
                  title={text("manager")}
                  additionalItems={[
                    {
                      title: text("provisionConnections"),
                      description: text("provisionConnectionsDescription"),
                      checked: editTargetSupportsManagerTools && Boolean(editForm.can_provision_managed_private_connections),
                      platformDefault: generalSettings.manager_feature_policies?.managed_private_connection_provisioning === "default_on",
                      inherited: Boolean(editingUser.effective_access?.group_can_provision_managed_private_connections),
                      blocked: !generalSettings.managed_private_connection_provisioning_enabled,
                      disabled: !editTargetSupportsManagerTools,
                      onChange: (value) =>
                        setEditForm((current) => ({
                          ...current,
                          can_provision_managed_private_connections: value,
                        })),
                      ariaLabel: text("allowProvisionConnections"),
                    },
                  ]}
                  description={text("managerPermissions")}
                  tools={managerToolDefinitions}
                  access={editForm.manager_tool_access ?? editingUser.manager_tool_access}
                  isToolDisabled={(tool) => !editTargetSupportsManagerTools || !tool.enabled}
                  onChange={(key: ManagerToolKey, value) =>
                    setEditForm((f) => ({
                      ...f,
                      manager_tool_access: {
                        ...normalizeManagerToolAccess(f.manager_tool_access ?? editingUser.manager_tool_access),
                        [key]: value,
                      },
                    }))
                  }
                />
                <BrowserAccessSection
                  description={text("browserOptions")}
                  checked={Boolean(editForm.browser_advanced_features_enabled ?? editingUser.browser_advanced_features_enabled)}
                  onChange={(value) =>
                    setEditForm((current) => ({
                      ...current,
                      browser_advanced_features_enabled: value,
                    }))
                  }
                />
                <AdminAccessToggleSection
                  title={text("connections")}
                  description={text("privateConnectionPermissions")}
                  items={[
                    {
                      title: text("createManualConnections"),
                      description: text("manualConnectionsDescription"),
                      checked: editTargetSupportsManagerTools && Boolean(editForm.can_create_manual_private_connections),
                      disabled: !editTargetSupportsManagerTools,
                      onChange: (value) =>
                        setEditForm((current) => ({
                          ...current,
                          can_create_manual_private_connections: value,
                        })),
                      ariaLabel: text("allowManualConnections"),
                    },
                  ]}
                />
              </>
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
