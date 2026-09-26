/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import TableSortControls from "../../components/list/TableSortControls";
import { ListActions, ListBadge, ListActionButton } from "../../components/list/ListControls";
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
import { SettingsButton, useSettingsCloseGuard } from "../../components/settings/SettingsControls";
import AdminUserIdentityFields, { userIdentityErrors, type UserIdentityErrors } from "./AdminUserIdentityFields";
import SettingsNavigationGuard from "../../components/settings/SettingsNavigationGuard";
import UserAvatarEditor from "../shared/UserAvatarEditor";
import { UserLanguageField, UserNotificationFields } from "../shared/UserProfilePreferenceFields";
import { profileMessages, type ProfileText } from "../shared/profileMessages";
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
import AdminEffectiveAccessPanel from "./AdminEffectiveAccessPanel";

type UserModalTab = "general" | "authentication" | "associations" | "groups" | "access" | "connections" | "effective_access";
type AuxiliaryLoadState = "idle" | "loading" | "loaded" | "error";

const userWorkflowTabs: Array<{ id: UserModalTab; label: string }> = [
  { id: "general", label: "General" },
  { id: "groups", label: "Groups" },
  { id: "associations", label: "Associations" },
  { id: "access", label: "Workspaces" },
  { id: "connections", label: "Connections" },
];
const editUserWorkflowTabs: Array<{ id: UserModalTab; label: string }> = [
  { id: "general", label: profileMessages.preferencesTab.en },
  { id: "authentication", label: profileMessages.security.en },
  ...userWorkflowTabs.filter((tab) => tab.id !== "general"),
  { id: "effective_access", label: "Effective access" },
];

const adminProfileText: ProfileText = (key) => profileMessages[key].en;

const storageOpsAccessDescription =
  "Grant direct /storage-ops access when the UI role is User, Admin, or Superadmin.";

function focusIdentityError(prefix: string, errors: UserIdentityErrors) {
  const field = errors.email ? "email" : "password";
  requestAnimationFrame(() => document.getElementById(`${prefix}-${field}`)?.focus());
}

export default function UsersPage() {
  type SortField = "name" | "role" | "accounts" | "last_login_at";

  const MAX_VISIBLE_OPTIONS = 10;
  const { generalSettings } = useGeneralSettings();
  const { runWithStepUp, verificationDialog } = useRecentWebAuthnStepUp();
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
    if (role === "ui_superadmin") return "Superadmin";
    if (role === "ui_admin") return "Admin";
    if (role === "ui_user") return "User";
    return "No access";
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
    return parsed.toLocaleString();
  };

  const renderAssociationSummary = (user: User) => {
    const effectiveAccountLinks = user.effective_access?.account_links ?? [];
    const displayedAccountLinks = effectiveAccountLinks.length > 0
      ? effectiveAccountLinks
      : (user.account_links ?? []);
    const accountItems = displayedAccountLinks.map((link) => {
      const id = Number(link.account_id);
      const label = accountOptionsById.get(id)?.name ?? `Account #${id}`;
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
            label: entry.name || `User #${entry.id}`,
          }))
        : (user.s3_user_details ?? []).map((entry) => ({
            id: entry.id,
            label: entry.name || `User #${entry.id}`,
          }));
    const effectiveConnectionDetails = user.effective_access?.s3_connection_details ?? [];
    const connectionItems =
      effectiveConnectionDetails.length > 0
        ? effectiveConnectionDetails.map((entry) => ({
            id: entry.id,
            label: entry.name || `Connection #${entry.id}`,
          }))
        : (user.s3_connection_details ?? []).map((entry) => ({
            id: entry.id,
            label: entry.name || `Connection #${entry.id}`,
          }));
    const categories: CompactAssociationCategory[] = [
      {
        id: "accounts",
        label: "Accounts",
        itemLabel: "RGW account",
        items: accountItems.map((account) => ({
          id: account.id,
          label: account.label,
          role_labels: account.role_labels,
        })),
      },
      { id: "s3_users", label: "RGW users", itemLabel: "RGW user", items: s3UserItems },
      { id: "connections", label: "S3 connections", itemLabel: "S3 connection", items: connectionItems },
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

  const extractError = (err: unknown): string => extractApiError(err, "Unexpected error");

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
      setError(extractApiError(err, "Unable to load users."));
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
  const editDirty = showEditModal && (editCurrentSignature !== editInitialSignature || authenticationDirty || avatarDirty);
  const createCloseGuard = useSettingsCloseGuard({
    hasUnsavedChanges: createDirty,
    description: "Your changes have not been saved.",
    onClose: closeCreateModal,
    disabled: creating,
  });

  const editCloseGuard = useSettingsCloseGuard({
    hasUnsavedChanges: editDirty,
    description: "Your changes have not been saved.",
    onClose: closeEditModal,
    disabled: authenticationBusy || avatarBusy || (editingUser ? busyId === editingUser.id : false),
  });

  const pendingEditTab = useRef<UserModalTab>("general");
  const editTabGuard = useSettingsCloseGuard({
    hasUnsavedChanges: authenticationDirty || avatarDirty,
    description: "Your changes have not been saved.",
    disabled: authenticationBusy || avatarBusy,
    onClose: () => setEditModalTab(pendingEditTab.current),
  });

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (savingRef.current) return;
    setActionError(null);
    setActionMessage(null);
    const errors = userIdentityErrors(form, true);
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
      setActionMessage("User created");
      resetCreateModalState();
      await fetchUsers();
      if (s3AccountsLoaded) {
        await fetchS3Accounts();
      }
      setShowCreateModal(false);
    } catch (err) {
      if (!isRecentWebAuthnVerificationCancelled(err)) {
        setActionError(extractError(err));
      }
    } finally {
      savingRef.current = false;
      setCreating(false);
    }
  };

  const startEdit = (user: User) => {
    if (!currentIsSuperAdmin && (user.role === "ui_admin" || user.role === "ui_superadmin")) {
      setActionError("Administrators can manage only standard users.");
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
    const errors = userIdentityErrors(editForm, false);
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
      setActionMessage("User updated");
      closeEditModal();
      await fetchUsers();
      if (s3AccountsLoaded) {
        await fetchS3Accounts();
      }
    } catch (err) {
      if (!isRecentWebAuthnVerificationCancelled(err)) {
        setActionError(extractError(err));
      }
    } finally {
      savingRef.current = false;
      setBusyId(null);
    }
  };

  const handleDeleteRequest = (user: User) => {
    const userId = user.id;
    if (currentUserId !== null && userId === currentUserId) {
      setActionError("You cannot delete your own user.");
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
      setActionMessage("User deleted");
      await fetchUsers();
      setPendingDeleteUser(null);
    } catch (err) {
      if (!isRecentWebAuthnVerificationCancelled(err)) {
        setActionError(extractError(err));
      }
    } finally {
      setBusyId(null);
    }
  };

  const usersDescription = "Create, edit, delete, and link UI users to groups, RGW accounts, S3 users, and S3 connections.";
  const associationLabel = "Storage associations";
  const filterPlaceholder = "Search users...";
  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: users.length,
  });
  const userTableColumns: Array<DataTableColumn<User, SortField>> = [
    {
      id: "user",
      label: "User",
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
      label: "Role",
      field: "role",
      render: (user) => (
        <div className="flex flex-wrap items-center gap-2">
          <span>{displayUiRole(user.role)}</span>
          {cephAdminFeatureEnabled &&
            (user.role === "ui_admin" || user.role === "ui_superadmin") &&
            user.can_access_ceph_admin && (
              <ListBadge tone="warning" className="uppercase tracking-wide">
                Ceph Admin
              </ListBadge>
            )}
        </div>
      ),
    },
    {
      id: "last_login_at",
      label: "Last login",
      field: "last_login_at",
      render: (user) => formatLastLogin(user.last_login_at),
    },
    {
      id: "associations",
      label: associationLabel,
      field: "accounts",
      mobileLabel: "Links",
      render: (user) => renderAssociationSummary(user),
    },
    {
      id: "actions",
      label: "Actions",
      align: "right",
      field: null,
      mobileRole: "actions",
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
              Edit
            </ListActionButton>
            <ListActionButton
              type="button"
              onClick={() => handleDeleteRequest(user)}
               variant="danger"
              disabled={busyId === user.id || isCurrentUser || !canManage}
              title={isCurrentUser ? "You cannot delete your own user." : !canManage ? "Administrators can manage only standard users." : undefined}
            >
              {busyId === user.id ? "Deleting..." : "Delete"}
            </ListActionButton>
          </ListActions>
        );
      },
    },
  ];

  return (
    <div className={workflowPageHostClass(showCreateModal || (Boolean(editingUser) && showEditModal))}>
      <SettingsNavigationGuard dirty={createDirty || editDirty} onDiscard={() => {
        if (showCreateModal) closeCreateModal();
        if (showEditModal) closeEditModal();
      }} />
      <PageHeader actionPresentation="listing"
        title="UI Users"
        description={usersDescription}
        breadcrumbs={adminPageBreadcrumbs("users")}
        actions={[
          {
            label: "Create user",
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
          title="Create user"
          description="Configure identity, workspace access, groups, and storage associations for this UI user."
          breadcrumbs={adminPageBreadcrumbs("users", { label: "Create" })}
          backLabel="Back to users"
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
          <SettingsForm label="Create UI user" busy={creating} onSubmit={handleCreate}
            onCancel={createCloseGuard.requestClose} submitLabel="Create" busyLabel="Creating...">
            <WorkflowTabs<UserModalTab>
              panelClassName={createModalTab === "groups" || createModalTab === "associations" ? adminAssociationPanelClass : undefined}
              activeTab={createModalTab}
              onTabChange={setCreateModalTab}
              ariaLabel="User creation sections"
              idPrefix="admin-user-create"
              tabs={userWorkflowTabs}
            >

            {createModalTab === "general" && (
              <AdminUserIdentityFields
                idPrefix="create-user"
                values={{ ...form, role: createRoleValue }}
                creating
                errors={createAttempted ? userIdentityErrors(form, true) : {}}
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
                  description="Additional operational workspaces available to this UI user."
                  cephAdmin={{
                    title: "Ceph Admin access",
                    description:
                      'Allow access to /ceph-admin. Grantable only by Superadmin for roles "Admin" and "Superadmin".',
                    checked: createCanGrantCephAdmin && Boolean(form.can_access_ceph_admin),
                    disabled: !createCanGrantCephAdmin,
                    onChange: (value) =>
                      setForm((f) => ({
                        ...f,
                        can_access_ceph_admin: value,
                      })),
                    ariaLabel: "Allow access to /ceph-admin",
                  }}
                  storageOps={{
                    title: "Storage Ops access",
                    description: storageOpsAccessDescription,
                    checked: createCanGrantStorageOps && Boolean(form.can_access_storage_ops),
                    disabled: !createCanGrantStorageOps,
                    onChange: (value) =>
                      setForm((f) => ({
                        ...f,
                        can_access_storage_ops: value,
                      })),
                    ariaLabel: "Allow access to /storage-ops",
                  }}
                />
                {!createTargetSupportsManagerTools && (
                  <PageBanner tone="warning">
                    Manager access requires the target role to be User, Admin, or Superadmin.
                  </PageBanner>
                )}

                <ManagerToolAccessSection
                  title="Manager"
                  additionalItems={[
                    {
                      title: "Provision managed private connections",
                      description: "Allow server-side IAM or RGW credential provisioning without revealing generated secrets.",
                      checked: createTargetSupportsManagerTools && Boolean(form.can_provision_managed_private_connections),
                      disabled:
                        !createTargetSupportsManagerTools ||
                        !generalSettings.managed_private_connection_provisioning_enabled,
                      onChange: (value) =>
                        setForm((current) => ({
                          ...current,
                          can_provision_managed_private_connections: value,
                        })),
                      ariaLabel: "Allow managed private connection provisioning",
                      badge: {
                        visible: !generalSettings.managed_private_connection_provisioning_enabled,
                        label: "Disabled globally",
                        tone: "neutral",
                      },
                    },
                  ]}
                  description="Manager permissions for advanced operations."
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
                  description="Browser options for this UI user. Groups can also grant these options."
                  checked={Boolean(form.browser_advanced_features_enabled)}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      browser_advanced_features_enabled: value,
                    }))
                  }
                />
              </>
            )}

            {createModalTab === "connections" && (
              <AdminAccessToggleSection
                title="Connections"
                description="Private S3 connection permissions for this UI user. Groups can also grant this permission."
                items={[
                  {
                    title: "Create manual private connections",
                    description: "Allow credentials supplied by the user on a registered endpoint or a custom URL.",
                    checked: createTargetSupportsManagerTools && Boolean(form.can_create_manual_private_connections),
                    disabled: !createTargetSupportsManagerTools,
                    onChange: (value) =>
                      setForm((current) => ({
                        ...current,
                        can_create_manual_private_connections: value,
                      })),
                    ariaLabel: "Allow manual private connection creation",
                  },
                ]}
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

      <ListPageSection
        variant="page"
        mobileSort={<TableSortControls columns={userTableColumns} sort={{ field: sort.field, direction: sort.direction, onSort: toggleSort }} />}
          title="Users"
          countLabel={`${totalUsers} entr${totalUsers === 1 ? "y" : "ies"}`}
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
          loadingMessage="Loading users..."
          errorMessage="Unable to load users."
          emptyMessage="No users."
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
          title="Delete UI user"
          description="This removes the platform user and revokes access to the UI workspaces linked to it."
          confirmLabel="Delete user"
          details={[
            { label: "User", value: pendingDeleteUser.email, mono: true },
            { label: "Role", value: displayUiRole(pendingDeleteUser.role) },
          ]}
          impacts={[
            "The user loses access immediately after deletion.",
            "Linked accounts, S3 users, and S3 connections remain in the platform but are no longer attached to this UI user.",
          ]}
          loading={busyId === pendingDeleteUser.id}
          onCancel={() => setPendingDeleteUser(null)}
          onConfirm={() => void handleDeleteConfirm()}
        />
      )}

      {editingUser && showEditModal && (
        <WorkflowPage
          title="Edit user"
          description="Manage direct access, inherited associations, workspace permissions, and Manager permissions for this UI user."
          breadcrumbs={adminPageBreadcrumbs("users", { label: "Edit" })}
          backLabel="Back to users"
          onBack={editCloseGuard.requestClose}
          backDisabled={busyId === editingUser.id || authenticationBusy || avatarBusy}
          contentClassName="settings-compact settings-form"
          contentVariant="plain"
          width="wide"
          metaContent={<WorkflowMetadata items={[{ label: "Identity", value: editingUser.email }]} />}
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
          <SettingsForm label="Edit UI user" busy={busyId === editingUser.id || avatarBusy} onSubmit={submitEdit}
            onCancel={editCloseGuard.requestClose} submitLabel="Save" busyLabel="Saving..."
            actions={editModalTab === "authentication" || editModalTab === "effective_access" ? (
              <SettingsButton variant="secondary" disabled={authenticationBusy} onClick={editCloseGuard.requestClose}>Done</SettingsButton>
            ) : undefined}>
            <WorkflowTabs<UserModalTab>
              panelClassName={editModalTab === "groups" || editModalTab === "associations" ? adminAssociationPanelClass : undefined}
              activeTab={editModalTab}
              onTabChange={(tab) => {
                if (tab === editModalTab) return;
                pendingEditTab.current = tab;
                editTabGuard.requestClose();
              }}
              ariaLabel="User configuration sections"
              idPrefix="admin-user-edit"
              tabs={editUserWorkflowTabs.map((tab) => ({ ...tab, disabled: authenticationBusy || avatarBusy }))}
            >

            {editModalTab === "general" && (
              <>
                <AdminUserIdentityFields
                  idPrefix="edit-user"
                  values={{ ...editForm, role: editRoleValue }}
                  errors={editAttempted ? userIdentityErrors(editForm, false) : {}}
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
                  description="Additional operational workspaces available to this UI user."
                  cephAdmin={{
                    title: "Ceph Admin access",
                    description:
                      'Allow access to /ceph-admin. Grantable only by Superadmin for roles "Admin" and "Superadmin".',
                    checked: editCanGrantCephAdmin && Boolean(editForm.can_access_ceph_admin),
                    disabled: !editCanGrantCephAdmin,
                    onChange: (value) =>
                      setEditForm((f) => ({
                        ...f,
                        can_access_ceph_admin: value,
                      })),
                    ariaLabel: "Allow access to /ceph-admin",
                  }}
                  storageOps={{
                    title: "Storage Ops access",
                    description: storageOpsAccessDescription,
                    checked: editCanGrantStorageOps && Boolean(editForm.can_access_storage_ops),
                    disabled: !editCanGrantStorageOps,
                    onChange: (value) =>
                      setEditForm((f) => ({
                        ...f,
                        can_access_storage_ops: value,
                      })),
                    ariaLabel: "Allow access to /storage-ops",
                  }}
                />
                {!editTargetSupportsManagerTools && (
                  <PageBanner tone="warning">
                    Manager access requires the target role to be User, Admin, or Superadmin.
                  </PageBanner>
                )}

                <ManagerToolAccessSection
                  title="Manager"
                  additionalItems={[
                    {
                      title: "Provision managed private connections",
                      description: "Allow server-side IAM or RGW credential provisioning without revealing generated secrets.",
                      checked: editTargetSupportsManagerTools && Boolean(editForm.can_provision_managed_private_connections),
                      disabled:
                        !editTargetSupportsManagerTools ||
                        !generalSettings.managed_private_connection_provisioning_enabled,
                      onChange: (value) =>
                        setEditForm((current) => ({
                          ...current,
                          can_provision_managed_private_connections: value,
                        })),
                      ariaLabel: "Allow managed private connection provisioning",
                      badge: {
                        visible: !generalSettings.managed_private_connection_provisioning_enabled,
                        label: "Disabled globally",
                        tone: "neutral",
                      },
                    },
                  ]}
                  description="Manager permissions for advanced operations."
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
                  description="Browser options for this UI user. Groups can also grant these options."
                  checked={Boolean(editForm.browser_advanced_features_enabled ?? editingUser.browser_advanced_features_enabled)}
                  onChange={(value) =>
                    setEditForm((current) => ({
                      ...current,
                      browser_advanced_features_enabled: value,
                    }))
                  }
                />
              </>
            )}

            {editModalTab === "connections" && (
              <AdminAccessToggleSection
                title="Connections"
                description="Private S3 connection permissions for this UI user. Groups can also grant this permission."
                items={[
                  {
                    title: "Create manual private connections",
                    description: "Allow credentials supplied by the user on a registered endpoint or a custom URL.",
                    checked: editTargetSupportsManagerTools && Boolean(editForm.can_create_manual_private_connections),
                    disabled: !editTargetSupportsManagerTools,
                    onChange: (value) =>
                      setEditForm((current) => ({
                        ...current,
                        can_create_manual_private_connections: value,
                      })),
                    ariaLabel: "Allow manual private connection creation",
                  },
                ]}
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

            {editModalTab === "effective_access" && (
              <AdminEffectiveAccessPanel
                userId={editingUser.id}
                contextLabel={editingUser.full_name || editingUser.email}
                showUserColumn={false}
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
