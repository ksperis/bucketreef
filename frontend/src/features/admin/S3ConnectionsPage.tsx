/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  isRecentWebAuthnVerificationCancelled,
  useRecentWebAuthnStepUp,
} from "../../auth/useRecentWebAuthnStepUp";
import PageHeader from "../../components/PageHeader";
import { useAdminPageBreadcrumbs } from "./adminBreadcrumbs";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import WorkflowPage, { workflowPageHostClass } from "../../components/WorkflowPage";
import WorkflowTabs from "../../components/WorkflowTabs";
import PageBanner from "../../components/PageBanner";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiInput from "../../components/ui/UiInput";

import { useTagCatalog } from "../../hooks/useTagCatalog";
import {
  S3ConnectionAdminItem,
  createAdminS3Connection,
  deleteAdminS3Connection,
  updateAdminS3Connection,
  validateAdminS3ConnectionCredentials,
} from "../../api/s3ConnectionsAdmin";
import { listStorageEndpoints, StorageEndpoint } from "../../api/storageEndpoints";
import { extractApiError } from "../../utils/apiError";
import { type TextMatchMode } from "../../utils/textMatch";
import { normalizeUiTags } from "../../utils/uiTags";
import { adminAssociationPanelClass } from "./AdminAssociationPicker";
import AdminSimpleIdAssociationsPanel, {
  type AdminSimpleIdAssociationsState,
} from "./AdminSimpleIdAssociationsPanel";
import SettingsForm from "../../components/settings/SettingsForm";
import { SettingsPersistentEditActions } from "../../components/settings/SettingsControls";
import FeatureOverrideField from "../../components/settings/FeatureOverrideField";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import S3ConnectionIdentityFields from "../shared/S3ConnectionIdentityFields";
import { useS3ConnectionFormValidation } from "../shared/useS3ConnectionFormValidation";
import S3ConnectionEndpointFields from "../shared/S3ConnectionEndpointFields";
import S3ConnectionCredentialFields from "../shared/S3ConnectionCredentialFields";
import S3CredentialsValidationMessage from "../shared/S3CredentialsValidationMessage";
import { useLiveS3CredentialsValidation } from "../shared/useLiveS3CredentialsValidation";
import {
  buildCreateS3ConnectionSignature,
  buildEditAdminS3ConnectionSignature,
  buildS3CredentialsValidationPayload,
  createDefaultAdminS3ConnectionForm,
  normalizeS3ConnectionLinkedIds,
  preferredS3ConnectionEndpointId,
  prepareCreateAdminS3ConnectionPayload,
  prepareUpdateAdminS3ConnectionPayload,
  type EditAdminS3ConnectionForm,
  type S3ConnectionEndpointMode,
} from "../shared/s3ConnectionFormModel";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { useAdminI18n } from "./adminI18n";
import useAdminAssociationPickerState from "./useAdminAssociationPickerState";
import useAdminPaginationState from "./useAdminPaginationState";
import AdminS3ConnectionsList from "./AdminS3ConnectionsList";
import useAdminPrincipalCatalogs from "./useAdminPrincipalCatalogs";
import useAdminS3ConnectionsListController from "./useAdminS3ConnectionsListController";

type EditTab = "general" | "users" | "groups";

export default function S3ConnectionsPage() {
  const { text: adminText } = useAdminI18n();
  const adminBreadcrumbs = useAdminPageBreadcrumbs();
  const { generalSettings } = useGeneralSettings();
  const { runWithStepUp, verificationDialog } = useRecentWebAuthnStepUp();
  const {
    filter,
    page,
    pageSize,
    handleFilterChange,
    handlePageChange,
    handlePageSizeChange,
    resetPage,
    ensurePageInRange,
  } = useAdminPaginationState();
  const [quickFilterMode, setQuickFilterMode] = useState<TextMatchMode>("contains");
  const {
    items,
    loading,
    error,
    total,
    actionMessage,
    setActionMessage,
    selectedIds,
    resolvedFilteredSelectableIds,
    statusBusyId,
    selectAllFilteredBusy,
    bulkStatusAction,
    bulkDeleteOpen,
    bulkDeleteBusy,
    refreshItems,
    clearSelection,
    removeSelectedId,
    toggleRowSelection,
    setSelectionForFilteredResults,
    submitToggleConnectionStatus,
    submitBulkStatusChange,
    openBulkDelete,
    closeBulkDelete,
    submitBulkDelete,
  } = useAdminS3ConnectionsListController({
    filter,
    quickFilterMode,
    page,
    pageSize,
    ensurePageInRange,
    runWithStepUp,
  });

  const [storageEndpoints, setStorageEndpoints] = useState<StorageEndpoint[]>([]);
  const [loadingEndpoints, setLoadingEndpoints] = useState(false);
  const {
    users: portalUsers,
    groups: uiGroups,
    loadUsers: loadPortalUsers,
    loadGroups,
  } = useAdminPrincipalCatalogs();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createEndpointMode, setCreateEndpointMode] = useState<S3ConnectionEndpointMode>("custom");
  const [createEndpointPresetId, setCreateEndpointPresetId] = useState("");
  const [createForm, setCreateForm] = useState(createDefaultAdminS3ConnectionForm);
  const [createInitialSignature, setCreateInitialSignature] = useState("");

  const [editing, setEditing] = useState<S3ConnectionAdminItem | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editEndpointMode, setEditEndpointMode] = useState<S3ConnectionEndpointMode>("custom");
  const [editEndpointPresetId, setEditEndpointPresetId] = useState("");
  const [editForm, setEditForm] = useState<EditAdminS3ConnectionForm>({
    name: "",
    tags: [],
    provider_hint: "",
    rgw_user_uid: "",
    rgw_tenant: "",
    rgw_account_id: "",
    endpoint_url: "",
    region: "",
    force_path_style: false,
    verify_tls: true,
    allow_activity_history: null,
  });
  const [editCredentials, setEditCredentials] = useState({
    access_key_id: "",
    secret_access_key: "",
  });
  const [editInitialSignature, setEditInitialSignature] = useState("");
  const [editTab, setEditTab] = useState<EditTab>("general");
  const [editLinkedUserIds, setEditLinkedUserIds] = useState<number[]>([]);
  const [editLinkedGroupIds, setEditLinkedGroupIds] = useState<number[]>([]);
  const editUserPicker = useAdminAssociationPickerState();
  const editGroupPicker = useAdminAssociationPickerState();
  const maxLinkOptions = 10;

  const [deleteTarget, setDeleteTarget] = useState<S3ConnectionAdminItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const showEditGeneralTab = editTab === "general";
  const showEditUsersTab = editTab === "users";
  const showEditGroupsTab = editTab === "groups";
  const {
    catalog: adminTagCatalog,
    loading: adminTagCatalogLoading,
    error: adminTagCatalogError,
  } = useTagCatalog(
    { kind: "admin", domain: "admin_managed" },
    Boolean(showCreateModal || editing)
  );

  const resetEditUsersState = () => {
    setEditTab("general");
    setEditLinkedUserIds([]);
    setEditLinkedGroupIds([]);
    editUserPicker.reset();
    editGroupPicker.reset();
  };
  const closeEditModal = () => {
    setEditing(null);
    setEditError(null);
    setEditCredentials({ access_key_id: "", secret_access_key: "" });
    setEditInitialSignature("");
    resetEditUsersState();
  };

  const resetCreateForm = () => {
    const nextForm = createDefaultAdminS3ConnectionForm();
    setCreateEndpointMode("custom");
    setCreateEndpointPresetId("");
    setCreateError(null);
    setCreateForm(nextForm);
    setCreateInitialSignature(
      buildCreateS3ConnectionSignature(nextForm, "custom", ""),
    );
  };

  const openCreateModal = () => {
    createFormValidation.reset();
    const nextForm = createDefaultAdminS3ConnectionForm();
    let nextEndpointMode: S3ConnectionEndpointMode = "custom";
    let nextEndpointPresetId = "";
    if (defaultEndpoint) {
      nextEndpointMode = "preset";
      nextEndpointPresetId = String(defaultEndpoint.id);
      Object.assign(nextForm, {
        endpoint_url: defaultEndpoint.endpoint_url,
        region: defaultEndpoint.region || "",
        force_path_style: false,
        verify_tls: true,
      });
    }
    setCreateEndpointMode(nextEndpointMode);
    setCreateEndpointPresetId(nextEndpointPresetId);
    setCreateError(null);
    setCreateForm(nextForm);
    setCreateInitialSignature(
      buildCreateS3ConnectionSignature(
        nextForm,
        nextEndpointMode,
        nextEndpointPresetId,
      ),
    );
    setShowCreateModal(true);
  };

  useEffect(() => {
    const loadEndpoints = async () => {
      setLoadingEndpoints(true);
      try {
        const data = await listStorageEndpoints();
        setStorageEndpoints(data);
      } catch {
        setStorageEndpoints([]);
      } finally {
        setLoadingEndpoints(false);
      }
    };
    loadEndpoints();
  }, []);

  useEffect(() => {
    void loadPortalUsers();
    void loadGroups();
  }, [loadGroups, loadPortalUsers]);

  const createValidationPayload = useMemo(
    () =>
      buildS3CredentialsValidationPayload(
        createForm,
        createEndpointMode,
        createEndpointPresetId,
      ),
    [createEndpointMode, createEndpointPresetId, createForm],
  );

  const createCredentialsValidation = useLiveS3CredentialsValidation({
    enabled: showCreateModal,
    payload: createValidationPayload,
    validate: validateAdminS3ConnectionCredentials,
  });

  const defaultEndpoint = storageEndpoints.find((ep) => ep.is_default);
  const portalUserLabelById = useMemo(() => {
    const map = new Map<number, string>();
    portalUsers.forEach((user) => map.set(user.id, user.email));
    return map;
  }, [portalUsers]);
  const groupLabelById = useMemo(() => {
    const map = new Map<number, string>();
    uiGroups.forEach((group) => map.set(group.id, group.name));
    return map;
  }, [uiGroups]);
  const availableEditUsers = useMemo(() => {
    const query = editUserPicker.search.trim().toLowerCase();
    const selectedIds = new Set(editLinkedUserIds);
    return portalUsers
      .filter((user) => !selectedIds.has(user.id))
      .filter((user) => !query || user.email.toLowerCase().includes(query))
      .map((user) => ({ id: user.id, label: user.email }));
  }, [editLinkedUserIds, editUserPicker.search, portalUsers]);
  const availableEditGroups = useMemo(() => {
    const query = editGroupPicker.search.trim().toLowerCase();
    const selectedIds = new Set(editLinkedGroupIds);
    return uiGroups
      .filter((group) => !selectedIds.has(group.id))
      .filter((group) => !query || group.name.toLowerCase().includes(query))
      .map((group) => ({ id: group.id, label: group.name }));
  }, [editGroupPicker.search, editLinkedGroupIds, uiGroups]);
  const visibleAvailableEditUsers = useMemo(() => availableEditUsers.slice(0, maxLinkOptions), [availableEditUsers, maxLinkOptions]);
  const visibleAvailableEditGroups = useMemo(() => availableEditGroups.slice(0, maxLinkOptions), [availableEditGroups, maxLinkOptions]);
  const editUserAssociationState: AdminSimpleIdAssociationsState = {
    selected: editLinkedUserIds,
    setSelected: setEditLinkedUserIds,
    labelById: portalUserLabelById,
    available: availableEditUsers,
    visible: visibleAvailableEditUsers,
    search: editUserPicker.search,
    setSearch: editUserPicker.setSearch,
    loading: false,
    showPanel: editUserPicker.open,
    setShowPanel: editUserPicker.setOpen,
    selections: editUserPicker.selections,
    setSelections: editUserPicker.setSelections,
    toggleSelection: editUserPicker.toggleSelection,
  };
  const editGroupAssociationState: AdminSimpleIdAssociationsState = {
    selected: editLinkedGroupIds,
    setSelected: setEditLinkedGroupIds,
    labelById: groupLabelById,
    available: availableEditGroups,
    visible: visibleAvailableEditGroups,
    search: editGroupPicker.search,
    setSearch: editGroupPicker.setSearch,
    loading: false,
    showPanel: editGroupPicker.open,
    setShowPanel: editGroupPicker.setOpen,
    selections: editGroupPicker.selections,
    setSelections: editGroupPicker.setSelections,
    toggleSelection: editGroupPicker.toggleSelection,
  };
  const createCurrentSignature = useMemo(
    () =>
      buildCreateS3ConnectionSignature(
        createForm,
        createEndpointMode,
        createEndpointPresetId,
      ),
    [createEndpointMode, createEndpointPresetId, createForm]
  );
  const createCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: Boolean(createInitialSignature) && createCurrentSignature !== createInitialSignature,
    disabled: creating,
    onClose: () => setShowCreateModal(false),
  });
  const editCurrentSignature = useMemo(
    () =>
      buildEditAdminS3ConnectionSignature({
        credentialDraft: editCredentials,
        endpointId: editEndpointPresetId,
        endpointMode: editEndpointMode,
        form: editForm,
        linkedGroupIds: editLinkedGroupIds,
        linkedUserIds: editLinkedUserIds,
      }),
    [editCredentials, editEndpointMode, editEndpointPresetId, editForm, editLinkedGroupIds, editLinkedUserIds]
  );
  const editCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: Boolean(editing && editInitialSignature && editCurrentSignature !== editInitialSignature),
    disabled: editBusy,
    onClose: closeEditModal,
  });
  const createPrepared = prepareCreateAdminS3ConnectionPayload(createForm, createEndpointMode, createEndpointPresetId);
  const createFormValidation = useS3ConnectionFormValidation(createPrepared, createEndpointMode === "custom" ? createForm.endpoint_url : undefined);
  const editPrepared = prepareUpdateAdminS3ConnectionPayload({
    credentialDraft: editCredentials, endpointId: editEndpointPresetId, endpointMode: editEndpointMode,
    form: editForm, linkedGroupIds: editLinkedGroupIds, linkedUserIds: editLinkedUserIds,
  });
  const editFormValidation = useS3ConnectionFormValidation(editPrepared, editEndpointMode === "custom" ? editForm.endpoint_url : undefined);
  const openEdit = (conn: S3ConnectionAdminItem, initialTab: EditTab = "general") => {
    editFormValidation.reset();
    const presetMatch =
      conn.storage_endpoint_id != null
        ? storageEndpoints.find((ep) => ep.id === conn.storage_endpoint_id)
        : storageEndpoints.find((ep) => ep.endpoint_url === conn.endpoint_url);
    const nextEndpointMode: S3ConnectionEndpointMode =
      conn.storage_endpoint_id != null ? "preset" : presetMatch ? "preset" : "custom";
    const nextEndpointPresetId =
      conn.storage_endpoint_id != null ? String(conn.storage_endpoint_id) : presetMatch ? String(presetMatch.id) : "";
    const nextForm: EditAdminS3ConnectionForm = {
      name: conn.name,
      tags: normalizeUiTags(conn.tags),
      provider_hint: conn.provider_hint || "",
      rgw_user_uid: conn.rgw_user_uid || "",
      rgw_tenant: conn.rgw_tenant || "",
      rgw_account_id: conn.rgw_account_id || "",
      endpoint_url: conn.endpoint_url,
      region: conn.region || "",
      force_path_style: conn.force_path_style,
      verify_tls: conn.verify_tls,
      allow_activity_history: conn.allow_activity_history ?? null,
    };
    const nextLinkedUserIds = normalizeS3ConnectionLinkedIds(conn.user_details.map((user) => user.id));
    const nextLinkedGroupIds = normalizeS3ConnectionLinkedIds(conn.group_details.map((group) => group.id));
    setEditing(conn);
    setEditEndpointMode(nextEndpointMode);
    setEditEndpointPresetId(nextEndpointPresetId);
    setEditForm(nextForm);
    setEditTab(initialTab);
    setEditLinkedUserIds(nextLinkedUserIds);
    setEditLinkedGroupIds(nextLinkedGroupIds);
    editUserPicker.reset();
    editGroupPicker.reset();
    const nextCredentialDraft = { access_key_id: "", secret_access_key: "" };
    setEditCredentials(nextCredentialDraft);
    setEditInitialSignature(
      buildEditAdminS3ConnectionSignature({
        credentialDraft: nextCredentialDraft,
        endpointId: nextEndpointPresetId,
        endpointMode: nextEndpointMode,
        form: nextForm,
        linkedGroupIds: nextLinkedGroupIds,
        linkedUserIds: nextLinkedUserIds,
      }),
    );
    setEditError(null);
  };

  const submitCreate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (creating || !createFormValidation.validate(e.currentTarget) || createPrepared.payload === null) return;
    const prepared = createPrepared;
    setCreating(true);
    setCreateError(null);
    try {
      await runWithStepUp(() => createAdminS3Connection(prepared.payload));
      setShowCreateModal(false);
      resetCreateForm();
      setActionMessage(adminText("Connection created."));
      await refreshItems();
    } catch (err) {
      if (!isRecentWebAuthnVerificationCancelled(err)) {
        setCreateError(extractApiError(err, adminText("Unexpected error")));
      }
    } finally {
      setCreating(false);
    }
  };

  const submitEdit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing || editBusy) return;
    if (!editFormValidation.validate(e.currentTarget) || editPrepared.payload === null) {
      setEditTab("general");
      return;
    }
    const prepared = editPrepared;
    setEditBusy(true);
    setEditError(null);
    try {
      const updated = await runWithStepUp(() => updateAdminS3Connection(editing.id, prepared.payload));
      openEdit(updated, editTab);
      setActionMessage(adminText("Connection updated."));
      await refreshItems();
    } catch (err) {
      if (!isRecentWebAuthnVerificationCancelled(err)) {
        setEditError(extractApiError(err, adminText("Unexpected error")));
      }
    } finally {
      setEditBusy(false);
    }
  };

  const submitDelete = async () => {
    if (!deleteTarget || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteAdminS3Connection(deleteTarget.id);
      setDeleteTarget(null);
      removeSelectedId(deleteTarget.id);
      setActionMessage(adminText("Connection deleted."));
      await refreshItems();
    } catch (err) {
      setDeleteError(extractApiError(err, adminText("Unexpected error")));
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className={workflowPageHostClass(showCreateModal || Boolean(editing))}>
      <PageHeader actionPresentation="listing"
        title={adminText("S3 Connections")}
        description={adminText("Credential-based S3 contexts assigned to linked UI users and groups.")}
        breadcrumbs={adminBreadcrumbs("shared-connections")}
        actions={[{ label: "Add connection", onClick: openCreateModal }]}
      />

      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {error && <PageBanner tone="error">{error}</PageBanner>}

      <AdminS3ConnectionsList
        items={items}
        storageEndpoints={storageEndpoints}
        loading={loading}
        error={error}
        total={total}
        filter={filter}
        quickFilterMode={quickFilterMode}
        page={page}
        pageSize={pageSize}
        selectedIds={selectedIds}
        resolvedFilteredSelectableIds={resolvedFilteredSelectableIds}
        statusBusyId={statusBusyId}
        selectAllFilteredBusy={selectAllFilteredBusy}
        bulkStatusAction={bulkStatusAction}
        bulkDeleteBusy={bulkDeleteBusy}
        onFilterChange={(value) => {
          handleFilterChange(value);
          clearSelection();
        }}
        onQuickFilterModeChange={(mode) => {
          setQuickFilterMode(mode);
          clearSelection();
          resetPage();
        }}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
        onToggleRowSelection={toggleRowSelection}
        onSelectAllFiltered={setSelectionForFilteredResults}
        onToggleStatus={submitToggleConnectionStatus}
        onEdit={openEdit}
        onDelete={setDeleteTarget}
        onBulkStatusChange={submitBulkStatusChange}
        onBulkDelete={openBulkDelete}
      />

      {/* Create modal */}
      {showCreateModal && (
        <WorkflowPage
          title={adminText("Add S3 connection")}
          description={adminText("Configure endpoint access, credentials, and workspace availability for this S3 connection.")}
          breadcrumbs={adminBreadcrumbs("shared-connections", { label: adminText("Create") })}
          backLabel={adminText("Back to connections")}
          onBack={createCloseGuard.requestClose}
          backDisabled={creating}
          contentVariant="plain"
          contentClassName="settings-compact"
          width="wide"
        >
          {createError && (
            <UiInlineMessage tone="error" className="mb-3">
              {createError}
            </UiInlineMessage>
          )}
          <SettingsForm label={adminText("Create S3 connection")} onSubmit={submitCreate} busy={creating}
            onCancel={createCloseGuard.requestClose} submitLabel={adminText("Create")} busyLabel={adminText("Creating...")}>
            <S3ConnectionIdentityFields name={createForm.name} nameError={createFormValidation.errorFor("name")}
              onNameChange={(name) => setCreateForm((current) => ({ ...current, name }))} catalogError={adminTagCatalogError}
              tagEditor={{ tags: createForm.tags, catalog: adminTagCatalog,
                onChange: (tags) => setCreateForm((current) => ({ ...current, tags })),
                placeholder: adminText("Add a tag for this S3 connection"), disabled: creating,
                hint: adminTagCatalogLoading ? adminText("Loading existing tag catalog...") : undefined }} />
            <S3ConnectionEndpointFields mode={createEndpointMode}
              onModeChange={(mode) => { setCreateEndpointMode(mode); if (mode === "preset") setCreateEndpointPresetId(preferredS3ConnectionEndpointId(createEndpointPresetId, storageEndpoints)); }}
              modeInputName="create-admin-s3-connection-endpoint-mode" endpointId={createEndpointPresetId}
              onEndpointIdChange={setCreateEndpointPresetId} endpoints={storageEndpoints} loadingEndpoints={loadingEndpoints}
              form={createForm} onFormChange={(field, value) => setCreateForm((current) => ({ ...current, [field]: value }))}
              endpointIdError={createFormValidation.errorFor("endpointId")} endpointUrlError={createFormValidation.errorFor("endpointUrl")} />
            <SettingsSection title={adminText("Credentials")} presentation="compact">
              <div className="settings-stack">
                <S3ConnectionCredentialFields accessKeyId={createForm.access_key_id} secretAccessKey={createForm.secret_access_key}
                  onAccessKeyIdChange={(value) => setCreateForm((current) => ({ ...current, access_key_id: value }))}
                  onSecretAccessKeyChange={(value) => setCreateForm((current) => ({ ...current, secret_access_key: value }))}
                  error={createFormValidation.errorFor("credentials")} required accessKeyLabel={adminText("Access key ID")} secretAccessKeyLabel={adminText("Secret access key")} />
                <S3CredentialsValidationMessage validation={createCredentialsValidation} />
              </div>
            </SettingsSection>
            <SettingsSection title={adminText("Access")} presentation="compact">
              <p className="settings-label">{adminText("Manager access")}</p>
              <p className="settings-description mt-1">{adminText("Assign this shared connection to UI users or groups to make it available as a Manager execution context.")}</p>
              <p className="settings-label mt-3">{adminText("Browser access")}</p>
              <p className="settings-description mt-1">{adminText("Shared connections are not available in Browser. Browser access requires an eligible private connection.")}</p>
            </SettingsSection>
          </SettingsForm>
          {createCloseGuard.confirmationDialog}
        </WorkflowPage>
      )}

      {/* Edit modal */}
      {editing && (
        <WorkflowPage
          title={adminText("Edit connection · {name}", { name: editing.name })}
          description={adminText("Manage endpoint access, credentials, workspace availability, and UI associations for this S3 connection.")}
          breadcrumbs={adminBreadcrumbs("shared-connections", { label: adminText("Edit") })}
          backLabel={adminText("Back to connections")}
          onBack={editCloseGuard.requestClose}
          backDisabled={editBusy}
          contentClassName="settings-compact"
          contentVariant="plain"
          width="wide"
        >
          {editError && (
            <UiInlineMessage tone="error" className="mb-3">
              {editError}
            </UiInlineMessage>
          )}
          {actionMessage && <UiInlineMessage tone="success" role="status" className="mb-3">{actionMessage}</UiInlineMessage>}
          <SettingsForm label={adminText("Edit S3 connection")} onSubmit={submitEdit} busy={editBusy}
            onCancel={editCloseGuard.requestClose} submitLabel={adminText("Save")} busyLabel={adminText("Saving...")}
            actions={<SettingsPersistentEditActions dirty={Boolean(editInitialSignature && editCurrentSignature !== editInitialSignature)}
              busy={editBusy} onCancel={editCloseGuard.requestClose} saveLabel={adminText("Save")} savingLabel={adminText("Saving...")} />}>
            <WorkflowTabs<EditTab>
              panelClassName={editTab === "users" || editTab === "groups" ? adminAssociationPanelClass : undefined}
              activeTab={editTab}
              onTabChange={setEditTab}
              ariaLabel={adminText("S3 connection configuration sections")}
              idPrefix="admin-shared-connection-edit"
              tabs={[
                { id: "general", label: adminText("General") },
                { id: "users", label: adminText("Linked UI users") },
                { id: "groups", label: adminText("Linked UI groups") },
              ]}
            >

            {showEditGeneralTab && (
              <>
            <S3ConnectionIdentityFields name={editForm.name} nameError={editFormValidation.errorFor("name")}
              onNameChange={(name) => setEditForm((current) => ({ ...current, name }))} catalogError={adminTagCatalogError}
              tagEditor={{ tags: editForm.tags, catalog: adminTagCatalog,
                onChange: (tags) => setEditForm((current) => ({ ...current, tags })),
                placeholder: adminText("Add a tag for this S3 connection"), disabled: editBusy,
                hint: adminTagCatalogLoading ? adminText("Loading existing tag catalog...") : undefined }} />
            <S3ConnectionEndpointFields mode={editEndpointMode}
              onModeChange={(mode) => { setEditEndpointMode(mode); if (mode === "preset") setEditEndpointPresetId(preferredS3ConnectionEndpointId(editEndpointPresetId, storageEndpoints)); }}
              modeInputName="edit-admin-s3-connection-endpoint-mode" endpointId={editEndpointPresetId}
              onEndpointIdChange={setEditEndpointPresetId} endpoints={storageEndpoints} loadingEndpoints={loadingEndpoints}
              form={editForm} onFormChange={(field, value) => setEditForm((current) => ({ ...current, [field]: value }))}
              endpointIdError={editFormValidation.errorFor("endpointId")} endpointUrlError={editFormValidation.errorFor("endpointUrl")} />
            <SettingsSection title={adminText("Credentials")} presentation="compact" description={adminText("Leave blank to keep the current keys.")}>
              <div className="settings-stack">
                <S3ConnectionCredentialFields accessKeyId={editCredentials.access_key_id} secretAccessKey={editCredentials.secret_access_key}
                  onAccessKeyIdChange={(value) => setEditCredentials((current) => ({ ...current, access_key_id: value }))}
                  onSecretAccessKeyChange={(value) => setEditCredentials((current) => ({ ...current, secret_access_key: value }))}
                  error={editFormValidation.errorFor("credentials")} />

              </div>
            </SettingsSection>
                <SettingsSection title={adminText("Access and RGW identity")} presentation="compact"
                  description={adminText("Persist the canonical RGW principal used for metrics and identity resolution when it is known.")}>
                  <div className="settings-stack">
                    <div><p className="settings-label">{adminText("Created by:")}</p>
                      <p className="settings-description mt-1 [overflow-wrap:anywhere]">{editing.created_by_email || editing.created_by_user_id}</p></div>
                    <div><p className="settings-label">{adminText("Manager access")}</p>
                      <p className="settings-description mt-1">{adminText("Assign this shared connection to UI users or groups to make it available as a Manager execution context.")}</p></div>
                    <div><p className="settings-label">{adminText("Browser access")}</p>
                      <p className="settings-description mt-1">{adminText("Shared connections are not available in Browser. Browser access requires an eligible private connection.")}</p></div>
                    <div className="settings-fields sm:grid-cols-3">
                    <UiInput
                      label={adminText("RGW user UID")}
                      value={editForm.rgw_user_uid}
                      onChange={(e) => setEditForm((p) => ({ ...p, rgw_user_uid: e.target.value }))}
                      placeholder="alice"
                    />
                    <UiInput
                      label={adminText("RGW tenant")}
                      value={editForm.rgw_tenant}
                      onChange={(e) => setEditForm((p) => ({ ...p, rgw_tenant: e.target.value }))}
                      placeholder={adminText("Optional tenant")}
                    />
                    <UiInput
                      label={adminText("RGW account ID")}
                      value={editForm.rgw_account_id}
                      onChange={(e) => setEditForm((p) => ({ ...p, rgw_account_id: e.target.value }))}
                      placeholder="RGW00000000000000000"
                    />
                    </div>
                  </div>
                </SettingsSection>
                <SettingsSection title={adminText("Activity history")} presentation="compact">
                  <FeatureOverrideField
                    title={adminText("Manager activity history")}
                    value={editForm.allow_activity_history}
                    policy={generalSettings.manager_feature_policies.activity_history}
                    disabled={editBusy}
                    help={adminText("Shows control and configuration actions performed through this shared Manager connection. It does not include S3 object access logs.")}
                    onChange={(value) => setEditForm((current) => ({ ...current, allow_activity_history: value }))}
                  />
                </SettingsSection>
              </>
            )}

            {showEditUsersTab && (
              <AdminSimpleIdAssociationsPanel
                state={editUserAssociationState}
                maxVisibleOptions={maxLinkOptions}
                primaryLabel={adminText("User")}
                actionsLabel={adminText("Actions")}
                removeLabel={adminText("Remove")}
                loadingMessage="Loading UI users..."
                emptyMessage={adminText("No linked users yet.")}
                pickerTitle={adminText("Add UI users")}
                searchHint={adminText("(filter by email)")}
                fallbackLabel={(id) => `User #${id}`}
                searchAriaLabel="Search UI users"
                normalizeSelection={normalizeS3ConnectionLinkedIds}
                section={{
                  title: adminText("Linked UI users"),
                  countLabel: adminText("{count} linked", { count: editLinkedUserIds.length }),
                  actionLabel: adminText(editUserPicker.open ? "Close" : "Add UI users"),
                }}
              />
            )}

            {showEditGroupsTab && (
              <AdminSimpleIdAssociationsPanel
                state={editGroupAssociationState}
                maxVisibleOptions={maxLinkOptions}
                primaryLabel={adminText("Group")}
                actionsLabel={adminText("Actions")}
                removeLabel={adminText("Remove")}
                loadingMessage="Loading UI groups..."
                emptyMessage={adminText("No linked groups yet.")}
                pickerTitle={adminText("Add UI groups")}
                searchHint={adminText("(filter by name)")}
                fallbackLabel={(id) => `Group #${id}`}
                searchAriaLabel="Search UI groups"
                normalizeSelection={normalizeS3ConnectionLinkedIds}
                section={{
                  title: adminText("Linked UI groups"),
                  countLabel: adminText("{count} linked", { count: editLinkedGroupIds.length }),
                  actionLabel: adminText(editGroupPicker.open ? "Close" : "Add UI groups"),
                }}
              />
            )}
            </WorkflowTabs>

          </SettingsForm>
          {editCloseGuard.confirmationDialog}

        </WorkflowPage>
      )}

      {/* Bulk delete modal */}
      {bulkDeleteOpen && (
        <ConfirmActionDialog
          title={`Delete selected (${selectedIds.length})`}
          description={`This will permanently delete ${selectedIds.length} selected connection${selectedIds.length > 1 ? "s" : ""} and their credentials.`}
          confirmLabel={adminText("Delete selected connections")}
          processingLabel="Deleting..."
          loading={bulkDeleteBusy}
          onCancel={closeBulkDelete}
          onConfirm={() => void submitBulkDelete()}
        />
      )}

      {/* Delete modal */}
      {deleteTarget && (
        <ConfirmActionDialog
          title={`Delete: ${deleteTarget.name}`}
          description={adminText("This will permanently delete the connection and its credentials.")}
          confirmLabel={adminText("Delete")}
          processingLabel="Deleting..."
          loading={deleteBusy}
          error={deleteError}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void submitDelete()}
        />
      )}
      {verificationDialog}
    </div>
  );
}
