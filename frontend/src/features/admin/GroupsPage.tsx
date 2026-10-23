/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ListActionButton } from "../../components/list/ListControls";
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
import { AccountMembership, UserSummary, listMinimalUsers } from "../../api/users";
import {
  defaultAccountAccessGrant,
  getAccountAccessRequiredMessage,
  hasAccountAccessRole,
  type AccountAccessGrant,
} from "../../api/accountAccess";
import { S3AccountSummary, listMinimalS3Accounts } from "../../api/accounts";
import { S3UserSummary, listMinimalS3Users } from "../../api/s3Users";
import { S3ConnectionSummary, listMinimalS3Connections } from "../../api/s3ConnectionsAdmin";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import {
  AccountAccessRoleValidationMessage,
  ManagerAccountRoleSelect,
  PortalAccountRoleSelect,
} from "./AccountAccessRoleSelectors";
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
import { AdminAssociationAccessPickerTable, AdminAssociationLinkedTable, AdminAssociationOptionCheckbox, AdminAssociationTabs, adminAssociationPanelClass, AdminAssociationPickerPanel, adminAssociationOptionRowClass } from "./AdminAssociationPicker";
import AdminAssociationAdvancedSettings from "./AdminAssociationAdvancedSettings";
import {
  DEFAULT_MANAGER_TOOL_ACCESS,
  buildManagerToolDefinitions,
  normalizeManagerToolAccess,
  type ManagerToolKey,
} from "./adminAccessConfig";
import SettingsForm from "../../components/settings/SettingsForm";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import { SettingsButton, SettingsPersistentEditActions, useSettingsCloseGuard } from "../../components/settings/SettingsControls";
import SettingsNavigationGuard from "../../components/settings/SettingsNavigationGuard";
import UiInput from "../../components/ui/UiInput";
import UiTextarea from "../../components/ui/UiTextarea";
import { stableSignature } from "../../utils/stableSignature";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { isFeaturePolicyAvailable } from "../../api/featurePolicies";
import { extractApiError } from "../../utils/apiError";
import { nextSortState } from "../../utils/sortValues";
import {
  clearAdminPrincipalEditRequest,
  readAdminPrincipalEditRequest,
} from "./adminPrincipalEditLink";
import { useGroupsI18n, type GroupsMessageKey } from "./groupsMessage";
import AdminGroupsList, { type GroupSortField } from "./AdminGroupsList";

type GroupModalTab = "general" | "members" | "associations" | "access";
type AssociationTab = "accounts" | "s3_users" | "connections";
const MAX_VISIBLE_OPTIONS = 10;
const groupAvatarIconOptions: Array<{ value: UiGroupAvatarIcon; label: GroupsMessageKey }> = [
  { value: "users", label: "team" },
  { value: "building", label: "organization" },
  { value: "shield", label: "security" },
  { value: "briefcase", label: "operations" },
  { value: "academic", label: "research" },
];
function includesQuery(label: string, query: string): boolean {
  return !query || label.toLowerCase().includes(query.trim().toLowerCase());
}

function emptyGroupForm(): UiGroupPayload {
  return {
    name: "",
    description: "",
    avatar_source: "initials",
    avatar_icon: null,
    can_access_ceph_admin: false,
    can_access_storage_ops: false,
    can_create_manual_private_connections: false,
    can_provision_managed_private_connections: false,
    browser_advanced_features_enabled: false,
    manager_tool_access: { ...DEFAULT_MANAGER_TOOL_ACCESS },
    user_ids: [],
    account_links: [],
    s3_user_links: [],
    s3_connection_ids: [],
  };
}

function groupFormFromGroup(group: UiGroup): UiGroupPayload {
  return {
    name: group.name,
    description: group.description ?? "",
    avatar_source: group.avatar.source,
    avatar_icon: group.avatar.icon,
    can_access_ceph_admin: group.can_access_ceph_admin,
    can_access_storage_ops: group.can_access_storage_ops,
    can_create_manual_private_connections: group.can_create_manual_private_connections,
    can_provision_managed_private_connections: group.can_provision_managed_private_connections,
    browser_advanced_features_enabled: group.browser_advanced_features_enabled,
    manager_tool_access: group.manager_tool_access,
    user_ids: group.user_details.map((user) => Number(user.id)),
    account_links:
      group.account_links.map((link) => ({
        account_id: Number(link.account_id),
        manager_role: link.manager_role,
        portal_role: link.portal_role,
        allow_manager_browser_data_access: link.allow_manager_browser_data_access,
      })),
    s3_user_links: group.s3_user_links.map((link) => ({
      s3_user_id: Number(link.s3_user_id),
      allow_manager_browser_data_access: link.allow_manager_browser_data_access,
    })),
    s3_connection_ids: group.s3_connection_details.map((connection) => Number(connection.id)),
  };
}

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
  const principalEditRequest = useMemo(
    () => readAdminPrincipalEditRequest(typeof window === "undefined" ? "" : window.location.search),
    [],
  );
  const requestedEditHandledRef = useRef(false);
  const openEditRef = useRef<(group: UiGroup) => void>(() => undefined);
  const [groups, setGroups] = useState<UiGroup[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [accounts, setAccounts] = useState<S3AccountSummary[]>([]);
  const [s3Users, setS3Users] = useState<S3UserSummary[]>([]);
  const [connections, setConnections] = useState<S3ConnectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [auxLoading, setAuxLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState(principalEditRequest?.search ?? "");
  const [sort, setSort] = useState<{ field: GroupSortField; direction: "asc" | "desc" }>({
    field: "name",
    direction: "asc",
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalGroups, setTotalGroups] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<UiGroup | null>(null);
  const [modalTab, setModalTab] = useState<GroupModalTab>("general");
  const [associationTab, setAssociationTab] = useState<AssociationTab>("accounts");
  const [pendingDeleteGroup, setPendingDeleteGroup] = useState<UiGroup | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [form, setForm] = useState<UiGroupPayload>(emptyGroupForm);
  const [initialFormSignature, setInitialFormSignature] = useState(() => stableSignature(emptyGroupForm()));
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [attempted, setAttempted] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [s3UserSearch, setS3UserSearch] = useState("");
  const [connectionSearch, setConnectionSearch] = useState("");
  const [showMemberPicker, setShowMemberPicker] = useState(false);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [showS3UserPicker, setShowS3UserPicker] = useState(false);
  const [showConnectionPicker, setShowConnectionPicker] = useState(false);
  const [memberSelections, setMemberSelections] = useState<number[]>([]);
  const [accountSelections, setAccountSelections] = useState<number[]>([]);
  const [s3UserSelections, setS3UserSelections] = useState<number[]>([]);
  const [connectionSelections, setConnectionSelections] = useState<number[]>([]);
  const [accountAccessChoice, setAccountAccessChoice] = useState<
    Record<number, AccountAccessGrant>
  >({});
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
    const map = new Map<number, S3AccountSummary>();
    accounts.forEach((account) => {
      const id = account.id;
      if (!Number.isNaN(id)) map.set(id, account);
    });
    return map;
  }, [accounts]);

  const s3UserLabelById = useMemo(() => {
    const map = new Map<number, string>();
    s3Users.forEach((user) => map.set(user.id, user.name));
    return map;
  }, [s3Users]);

  const connectionLabelById = useMemo(() => {
    const map = new Map<number, string>();
    connections.forEach((connection) => map.set(connection.id, connection.name));
    return map;
  }, [connections]);

  const managerToolDefinitions = useMemo(
    () => buildManagerToolDefinitions(generalSettings),
    [generalSettings]
  );

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await listGroups({
        page,
        page_size: pageSize,
        search: filter.trim() || undefined,
        sort_by: sort.field,
        sort_dir: sort.direction,
      });
      const totalPages = Math.max(1, Math.ceil((response.total || 0) / pageSize));
      if (response.total > 0 && page > totalPages) {
        setPage(totalPages);
        return;
      }
      setGroups(response.items);
      setTotalGroups(response.total);
    } catch (err) {
      setError(extractApiError(err, errorTextRef.current("loadGroupsError")));
    } finally {
      setLoading(false);
    }
  }, [filter, page, pageSize, sort.direction, sort.field]);

  const loadAuxiliaryData = useCallback(async () => {
    setAuxLoading(true);
    try {
      const [nextUsers, nextAccounts, nextS3Users, nextConnections] = await Promise.all([
        listMinimalUsers(),
        listMinimalS3Accounts(),
        listMinimalS3Users(),
        listMinimalS3Connections(),
      ]);
      setUsers(nextUsers);
      setAccounts(nextAccounts);
      setS3Users(nextS3Users);
      setConnections(nextConnections);
    } catch (err) {
      setActionError(extractApiError(err, errorTextRef.current("loadResourcesError")));
    } finally {
      setAuxLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const toggleSort = (field: GroupSortField) => {
    setSort((current) => nextSortState(current, field, "desc"));
    setPage(1);
  };

  const resetForm = () => {
    const draft = emptyGroupForm();
    setForm(draft);
    setInitialFormSignature(stableSignature(draft));
    setAttempted(false);
    setModalTab("general");
    setAssociationTab("accounts");
    setMemberSearch("");
    setAccountSearch("");
    setS3UserSearch("");
    setConnectionSearch("");
    setShowMemberPicker(false);
    setShowAccountPicker(false);
    setShowS3UserPicker(false);
    setShowConnectionPicker(false);
    setMemberSelections([]);
    setAccountSelections([]);
    setS3UserSelections([]);
    setConnectionSelections([]);
    setAccountAccessChoice({});
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
    const draft = groupFormFromGroup(group);
    setForm(draft);
    setInitialFormSignature(stableSignature(draft));
    setModalTab("general");
    setAssociationTab("accounts");
    setActionError(null);
    setActionMessage(null);
    setShowModal(true);
    void loadAuxiliaryData();
  };

  openEditRef.current = openEditModal;
  useEffect(() => {
    if (!principalEditRequest || requestedEditHandledRef.current) return;
    const requestedGroup = groups.find((group) => group.id === principalEditRequest.id);
    if (!requestedGroup) return;
    requestedEditHandledRef.current = true;
    openEditRef.current(requestedGroup);
  }, [groups, principalEditRequest]);

  const closeModal = () => {
    setShowModal(false);
    setEditingGroup(null);
    resetForm();
    clearAdminPrincipalEditRequest();
  };

  const hasUnsavedChanges = showModal && (
    stableSignature(form) !== initialFormSignature || Boolean(avatarFile) || removeAvatarImage ||
    memberSelections.length > 0 || accountSelections.length > 0 || s3UserSelections.length > 0 ||
    connectionSelections.length > 0 || Object.keys(accountAccessChoice).length > 0
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

  const updateAccountSelection = (accountId: number, patch: Partial<AccountMembership>) => {
    setForm((current) => ({
      ...current,
      account_links: (current.account_links ?? []).map((link) =>
        Number(link.account_id) === accountId ? { ...link, ...patch } : link
      ),
    }));
  };

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
    const payload: UiGroupPayload = {
      name,
      description: form.description || null,
      avatar_source: avatarFile ? undefined : form.avatar_source,
      avatar_icon: form.avatar_icon,
      can_access_ceph_admin: Boolean(form.can_access_ceph_admin),
      can_access_storage_ops: Boolean(form.can_access_storage_ops),
      can_create_manual_private_connections: Boolean(form.can_create_manual_private_connections),
      can_provision_managed_private_connections: Boolean(form.can_provision_managed_private_connections),
      browser_advanced_features_enabled: Boolean(form.browser_advanced_features_enabled),
      manager_tool_access: normalizeManagerToolAccess(form.manager_tool_access),
      user_ids: form.user_ids ?? [],
      account_links:
        form.account_links?.map((link) => ({
          account_id: Number(link.account_id),
          manager_role: link.manager_role,
          portal_role: link.portal_role,
          allow_manager_browser_data_access: link.allow_manager_browser_data_access,
        })) ?? [],
      s3_user_links: form.s3_user_links ?? [],
      s3_connection_ids: form.s3_connection_ids ?? [],
    };
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
        const savedDraft = groupFormFromGroup(savedGroup);
        setEditingGroup(savedGroup);
        setForm(savedDraft);
        setInitialFormSignature(stableSignature(savedDraft));
        setAvatarFile(null);
        setRemoveAvatarImage(false);
        setMemberSelections([]);
        setAccountSelections([]);
        setS3UserSelections([]);
        setConnectionSelections([]);
        setAccountAccessChoice({});
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
  const selectedAccountIds = new Set((form.account_links ?? []).map((link) => Number(link.account_id)));
  const showAccountPortalRoleColumn = showPortalRole;
  const userLabelById = new Map(users.map((user) => [user.id, user.email]));
  const availableUsers = users.filter(
    (user) => !selectedUserIds.has(user.id) && includesQuery(user.email, memberSearch)
  );
  const availableAccounts = accounts.filter(
    (account) => !selectedAccountIds.has(account.id) && includesQuery(account.name, accountSearch)
  );
  const availableS3Users = s3Users.filter(
    (user) => !selectedS3UserIds.has(user.id) && includesQuery(user.name, s3UserSearch)
  );
  const availableConnections = connections.filter(
    (connection) => !selectedConnectionIds.has(connection.id) && includesQuery(connection.name, connectionSearch)
  );
  const visibleUsers = availableUsers.slice(0, MAX_VISIBLE_OPTIONS);
  const visibleAccounts = availableAccounts.slice(0, MAX_VISIBLE_OPTIONS);
  const visibleS3Users = availableS3Users.slice(0, MAX_VISIBLE_OPTIONS);
  const visibleConnections = availableConnections.slice(0, MAX_VISIBLE_OPTIONS);

  const togglePendingSelection = (
    setSelections: Dispatch<SetStateAction<number[]>>,
    id: number,
  ) => {
    setSelections((current) =>
      current.includes(id) ? current.filter((selectedId) => selectedId !== id) : [...current, id]
    );
  };

  const renderMembersTab = () => (
    <AdminAssociationLinkedTable
      title={text("members")}
      toolbar={{
        countLabel: text("linkedCount", { count: selectedUserIds.size }),
        actionLabel: showMemberPicker ? text("close") : text("addUiUsers"),
        onAction: () => setShowMemberPicker((current) => !current),
      }}
      headers={[{ label: text("user") }, { label: text("actions"), align: "right" }]}
      hasItems={selectedUserIds.size > 0}
      emptyLabel={text("noLinkedUsers")}
      rows={(form.user_ids ?? []).map((userId) => (
        <tr key={userId}>
          <td className="ui-table-primary">
            {userLabelById.get(userId) ?? text("userNumber", { id: userId })}
          </td>
          <td className="ui-table-actions-cell w-px text-right">
            <ListActionButton
              type="button"
               variant="danger"
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  user_ids: (current.user_ids ?? []).filter((id) => id !== userId),
                }))
              }
            >
              {text("remove")}
            </ListActionButton>
          </td>
        </tr>
      ))}
      picker={
        showMemberPicker ? (
          <AdminAssociationPickerPanel
            title={text("addUiUsers")}
            hint={text("filterByEmail")}
            search={memberSearch}
            onSearchChange={setMemberSearch}
            searchAriaLabel={text("searchGroupMembers")}
            loading={auxLoading}
            availableCount={availableUsers.length}
            maxVisibleOptions={MAX_VISIBLE_OPTIONS}
            selectedCount={memberSelections.length}
            loadingLabel={text("loadingUsers")}
            emptyLabel={text("noUsersAvailable")}
            addDisabled={memberSelections.length === 0}
            onCancel={() => {
              setShowMemberPicker(false);
              setMemberSelections([]);
              setMemberSearch("");
            }}
            onAdd={() => {
              setForm((current) => ({
                ...current,
                user_ids: [...new Set([...(current.user_ids ?? []), ...memberSelections])].sort((a, b) => a - b),
              }));
              setShowMemberPicker(false);
              setMemberSelections([]);
              setMemberSearch("");
            }}
          >
            {visibleUsers.map((user) => (
              <div
                key={user.id}
                className={adminAssociationOptionRowClass(memberSelections.includes(user.id))}
              >
                <AdminAssociationOptionCheckbox
                  checked={memberSelections.includes(user.id)}
                  onChange={() => togglePendingSelection(setMemberSelections, user.id)}
                  inputPosition="end"
                  className="w-full justify-between"
                >
                  <span>{user.email}</span>
                </AdminAssociationOptionCheckbox>
              </div>
            ))}
          </AdminAssociationPickerPanel>
        ) : undefined
      }
    />
  );

  const renderAssociationsTab = () => (
    <AdminAssociationTabs
      tabs={[
        {
          id: "accounts",
          label: text("accounts"),
          count: selectedAccountIds.size,
          actionLabel: showAccountPicker ? text("close") : text("addAccounts"),
          onAction: () => setShowAccountPicker((current) => !current),
          content: (
            <AdminAssociationLinkedTable
              title={text("linkedAccounts")}
              headers={[
                { label: text("account") },
                { label: text("managerRole") },
                ...(showAccountPortalRoleColumn
                  ? [{ label: text("portalRole") }]
                  : []),
                { label: text("actions"), align: "right" as const },
              ]}
              hasItems={selectedAccountIds.size > 0}
              emptyLabel={text("noLinkedAccounts")}
              rows={(form.account_links ?? []).map((link) => {
                const accountId = Number(link.account_id);
                const label = accountOptionsById.get(accountId)?.name ?? text("accountNumber", { id: accountId });
                const accessErrorId = `group-account-access-${accountId}-error`;
                const invalid = !hasAccountAccessRole(link);
                const updateAccess = (value: AccountAccessGrant) =>
                  updateAccountSelection(accountId, value);
                return (
                  <tr key={accountId}>
                    <td className="ui-table-primary">
                      {label}
                      <AccountAccessRoleValidationMessage
                        id={accessErrorId}
                        value={link}
                        portalEnabled={showPortalRole}
                      />
                    </td>
                    <td>
                      <ManagerAccountRoleSelect
                        label={label}
                        portalEnabled={showPortalRole}
                        value={link}
                        onChange={updateAccess}
                        showLabel={false}
                        invalid={invalid}
                        describedBy={invalid ? accessErrorId : undefined}
                      />
                    </td>
                    {showAccountPortalRoleColumn ? (
                      <td>
                        <PortalAccountRoleSelect
                          label={label}
                          portalEnabled={showPortalRole}
                          value={link}
                          onChange={updateAccess}
                          showLabel={false}
                          invalid={invalid}
                          describedBy={invalid ? accessErrorId : undefined}
                        />
                      </td>
                    ) : null}
                    <td className="ui-table-actions-cell w-px text-right">
                      {link.manager_role ? (
                        <AdminAssociationAdvancedSettings
                          targetLabel={label}
                          associationKind="account"
                          allowManagerBrowserDataAccess={link.allow_manager_browser_data_access}
                          onApply={(allowed) =>
                            updateAccountSelection(accountId, {
                              allow_manager_browser_data_access: allowed,
                            })
                          }
                        />
                      ) : null}
                      <ListActionButton
                        type="button"
                         variant="danger"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            account_links: (current.account_links ?? []).filter(
                              (currentLink) => Number(currentLink.account_id) !== accountId
                            ),
                          }))
                        }
                      >
                        {text("remove")}
                      </ListActionButton>
                    </td>
                  </tr>
                );
              })}
              picker={
                showAccountPicker ? (
                  <AdminAssociationPickerPanel
                    title={text("addAccounts")}
                    hint={text("searchByName")}
                    search={accountSearch}
                    onSearchChange={setAccountSearch}
                    searchAriaLabel={text("searchGroupAccounts")}
                    loading={auxLoading}
                    availableCount={availableAccounts.length}
                    maxVisibleOptions={MAX_VISIBLE_OPTIONS}
                    selectedCount={accountSelections.length}
                    loadingLabel={text("loadingAccounts")}
                    emptyLabel={text("noAccountsAvailable")}
                    addDisabled={
                      accountSelections.length === 0 ||
                      accountSelections.some(
                        (accountId) =>
                          !hasAccountAccessRole(
                            accountAccessChoice[accountId] ??
                              defaultAccountAccessGrant(showPortalRole),
                          ),
                      )
                    }
                    onCancel={() => {
                      setShowAccountPicker(false);
                      setAccountSelections([]);
                      setAccountSearch("");
                    }}
                    onAdd={() => {
                      setForm((current) => ({
                        ...current,
                        account_links: [
                          ...(current.account_links ?? []),
                          ...accountSelections.map((accountId) => ({
                            account_id: accountId,
                            ...(accountAccessChoice[accountId] ??
                              defaultAccountAccessGrant(showPortalRole)),
                            allow_manager_browser_data_access: false,
                          })),
                        ].sort((left, right) => Number(left.account_id) - Number(right.account_id)),
                      }));
                      setShowAccountPicker(false);
                      setAccountSelections([]);
                      setAccountSearch("");
                    }}
                  >
                    <AdminAssociationAccessPickerTable
                      title={text("availableAccounts")}
                      principalLabel={text("account")}
                      options={visibleAccounts.map((account) => ({
                        id: account.id,
                        label: account.name,
                        selected: accountSelections.includes(account.id),
                        access:
                          accountAccessChoice[account.id] ??
                          defaultAccountAccessGrant(showPortalRole),
                      }))}
                      portalEnabled={showPortalRole}
                      onToggle={(accountId) =>
                        togglePendingSelection(setAccountSelections, accountId)
                      }
                      onAccessChange={(accountId, value) =>
                        setAccountAccessChoice((current) => ({
                          ...current,
                          [accountId]: value,
                        }))
                      }
                    />
                  </AdminAssociationPickerPanel>
                ) : undefined
              }
            />
          ),
        },
        {
          id: "s3_users",
          label: text("s3Users"),
          count: selectedS3UserIds.size,
          actionLabel: showS3UserPicker ? text("close") : text("addRgwUsers"),
          onAction: () => setShowS3UserPicker((current) => !current),
          content: (
            <AdminAssociationLinkedTable
              title={text("linkedRgwUsers")}
              headers={[{ label: text("rgwUser") }, { label: text("actions"), align: "right" }]}
              hasItems={selectedS3UserIds.size > 0}
              emptyLabel={text("noLinkedRgwUsers")}
              rows={(form.s3_user_links ?? []).map((link) => (
                <tr key={link.s3_user_id}>
                  <td className="ui-table-primary">
                    {s3UserLabelById.get(link.s3_user_id) ?? text("rgwUserNumber", { id: link.s3_user_id })}
                  </td>
                  <td className="ui-table-actions-cell w-px text-right">
                    <AdminAssociationAdvancedSettings
                      targetLabel={s3UserLabelById.get(link.s3_user_id) ?? text("rgwUserNumber", { id: link.s3_user_id })}
                      associationKind="rgw_user"
                      allowManagerBrowserDataAccess={link.allow_manager_browser_data_access}
                      onApply={(allowed) =>
                        setForm((current) => ({
                          ...current,
                          s3_user_links: (current.s3_user_links ?? []).map((item) =>
                            item.s3_user_id === link.s3_user_id
                              ? { ...item, allow_manager_browser_data_access: allowed }
                              : item
                          ),
                        }))
                      }
                    />
                    <ListActionButton
                      type="button"
                       variant="danger"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          s3_user_links: (current.s3_user_links ?? []).filter(
                            (item) => item.s3_user_id !== link.s3_user_id
                          ),
                        }))
                      }
                    >
                      {text("remove")}
                    </ListActionButton>
                  </td>
                </tr>
              ))}
              picker={
                showS3UserPicker ? (
                  <AdminAssociationPickerPanel
                    title={text("addRgwUsers")}
                    hint={text("searchByName")}
                    search={s3UserSearch}
                    onSearchChange={setS3UserSearch}
                    searchAriaLabel={text("searchGroupS3Users")}
                    loading={auxLoading}
                    availableCount={availableS3Users.length}
                    maxVisibleOptions={MAX_VISIBLE_OPTIONS}
                    selectedCount={s3UserSelections.length}
                    loadingLabel={text("loadingRgwUsers")}
                    emptyLabel={text("noRgwUsersAvailable")}
                    addDisabled={s3UserSelections.length === 0}
                    onCancel={() => {
                      setShowS3UserPicker(false);
                      setS3UserSelections([]);
                      setS3UserSearch("");
                    }}
                    onAdd={() => {
                      setForm((current) => ({
                        ...current,
                        s3_user_links: [
                          ...(current.s3_user_links ?? []),
                          ...s3UserSelections.map((s3UserId) => ({
                            s3_user_id: s3UserId,
                            allow_manager_browser_data_access: false,
                          })),
                        ].sort((a, b) => a.s3_user_id - b.s3_user_id),
                      }));
                      setShowS3UserPicker(false);
                      setS3UserSelections([]);
                      setS3UserSearch("");
                    }}
                  >
                    {visibleS3Users.map((s3User) => (
                      <div
                        key={s3User.id}
                        className={adminAssociationOptionRowClass(s3UserSelections.includes(s3User.id))}
                      >
                        <AdminAssociationOptionCheckbox
                          checked={s3UserSelections.includes(s3User.id)}
                          onChange={() => togglePendingSelection(setS3UserSelections, s3User.id)}
                          inputPosition="end"
                          className="w-full justify-between"
                        >
                          <span>{s3User.name}</span>
                        </AdminAssociationOptionCheckbox>
                      </div>
                    ))}
                  </AdminAssociationPickerPanel>
                ) : undefined
              }
            />
          ),
        },
        {
          id: "connections",
          label: text("connections"),
          count: selectedConnectionIds.size,
          actionLabel: showConnectionPicker ? text("close") : text("addS3Connections"),
          onAction: () => setShowConnectionPicker((current) => !current),
          hint: text("sharedConnectionsOnly"),
          content: (
            <AdminAssociationLinkedTable
              title={text("linkedSharedS3Connections")}
              headers={[{ label: text("s3Connection") }, { label: text("actions"), align: "right" }]}
              hasItems={selectedConnectionIds.size > 0}
              emptyLabel={text("noLinkedS3Connections")}
              rows={(form.s3_connection_ids ?? []).map((connectionId) => (
                <tr key={connectionId}>
                  <td className="ui-table-primary">
                    {connectionLabelById.get(connectionId) ?? text("connectionNumber", { id: connectionId })}
                  </td>
                  <td className="ui-table-actions-cell w-px text-right">
                    <ListActionButton
                      type="button"
                       variant="danger"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          s3_connection_ids: (current.s3_connection_ids ?? []).filter((id) => id !== connectionId),
                        }))
                      }
                    >
                      {text("remove")}
                    </ListActionButton>
                  </td>
                </tr>
              ))}
              picker={
                showConnectionPicker ? (
                  <AdminAssociationPickerPanel
                    title={text("addS3Connections")}
                    hint={text("sharedOnly")}
                    search={connectionSearch}
                    onSearchChange={setConnectionSearch}
                    searchAriaLabel={text("searchGroupSharedConnections")}
                    loading={auxLoading}
                    availableCount={availableConnections.length}
                    maxVisibleOptions={MAX_VISIBLE_OPTIONS}
                    selectedCount={connectionSelections.length}
                    loadingLabel={text("loadingSharedConnections")}
                    emptyLabel={text("noSharedConnectionsAvailable")}
                    addDisabled={connectionSelections.length === 0}
                    onCancel={() => {
                      setShowConnectionPicker(false);
                      setConnectionSelections([]);
                      setConnectionSearch("");
                    }}
                    onAdd={() => {
                      setForm((current) => ({
                        ...current,
                        s3_connection_ids: [
                          ...new Set([...(current.s3_connection_ids ?? []), ...connectionSelections]),
                        ].sort((a, b) => a - b),
                      }));
                      setShowConnectionPicker(false);
                      setConnectionSelections([]);
                      setConnectionSearch("");
                    }}
                  >
                    {visibleConnections.map((connection) => (
                      <div
                        key={connection.id}
                        className={adminAssociationOptionRowClass(connectionSelections.includes(connection.id))}
                      >
                        <AdminAssociationOptionCheckbox
                          checked={connectionSelections.includes(connection.id)}
                          onChange={() => togglePendingSelection(setConnectionSelections, connection.id)}
                          inputPosition="end"
                          className="w-full justify-between"
                        >
                          <span>{connection.name}</span>
                        </AdminAssociationOptionCheckbox>
                      </div>
                    ))}
                  </AdminAssociationPickerPanel>
                ) : undefined
              }
            />
          ),
        },
      ]}
      activeTab={associationTab}
      onChange={(id) => {
        setAssociationTab(id === "s3_users" ? "s3_users" : id === "connections" ? "connections" : "accounts");
        setShowAccountPicker(false);
        setShowS3UserPicker(false);
        setShowConnectionPicker(false);
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
        onFilterChange={(value) => {
          setFilter(value);
          setPage(1);
        }}
        onSort={toggleSort}
        onPageChange={(nextPage) => setPage(Math.max(1, nextPage))}
        onPageSizeChange={(nextSize) => {
          setPageSize(nextSize);
          setPage(1);
        }}
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
                { id: "members", label: text("members") },
                { id: "associations", label: text("associations") },
                { id: "access", label: text("platformAccess") },
              ]}
            >

            {modalTab === "general" && (
              <>
                <SettingsSection title={text("identity")} presentation="compact">
                  <div className="settings-fields">
                    <UiInput id="admin-ui-group-name" label={text("name")} required
                      value={form.name ?? ""} placeholder={text("namePlaceholder")}
                      error={attempted && !String(form.name || "").trim() ? text("nameRequired") : undefined}
                      onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
                    <UiTextarea label={text("description")} rows={3} value={form.description ?? ""}
                      placeholder={text("descriptionPlaceholder")}
                      onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
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
