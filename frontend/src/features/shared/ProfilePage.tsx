/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ListActions, ListBadge, ListActionButton } from "../../components/list/ListControls";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import ListToolbar from "../../components/ListToolbar";
import ToolbarSearchInput from "../../components/ToolbarSearchInput";
import { isApiError } from "../../api/client";
import { useSearchParams } from "react-router-dom";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import WorkflowPage, { workflowPageHostClass } from "../../components/WorkflowPage";
import UiTagBadgeList from "../../components/UiTagBadgeList";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import UiButton from "../../components/ui/UiButton";
import UiInlineMessage from "../../components/ui/UiInlineMessage";

import { toolbarCompactInputClasses } from "../../components/toolbarControlClasses";
import {
  S3Connection,
  createConnection,
  deleteConnection,
  listConnections,
  listPrivateConnectionStorageEndpoints,
  type PrivateConnectionStorageEndpoint,
  updateConnection,
  validateConnectionCredentials,
} from "../../api/connections";
import type { S3CredentialsValidationPayload } from "../../api/s3CredentialsValidation";
import { retryManagedPrivateAccessCleanup } from "../../api/managedPrivateAccess";
import { useLiveS3CredentialsValidation } from "./useLiveS3CredentialsValidation";
import { formatLocalDateTime } from "../../utils/dateTime";
import { notifyExecutionContextsRefresh } from "../../utils/executionContextRefresh";
import {
  canAccessPrivateConnectionsSection,
  canCreateManualPrivateConnections,
  type SessionUser,
  readStoredUser,
} from "../../utils/workspaces";
import { buildUiTagItems } from "../../utils/uiTags";
import { useTagCatalog } from "../../hooks/useTagCatalog";
import ProfilePreferencesPage from "./ProfilePreferencesPage";
import S3ConnectionAccessFields from "./S3ConnectionAccessFields";
import S3ConnectionCredentialFields from "./S3ConnectionCredentialFields";
import SettingsForm from "../../components/settings/SettingsForm";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import S3ConnectionIdentityFields from "./S3ConnectionIdentityFields";
import { useS3ConnectionFormValidation } from "./useS3ConnectionFormValidation";
import S3ConnectionEndpointFields from "./S3ConnectionEndpointFields";
import S3CredentialsValidationMessage from "./S3CredentialsValidationMessage";
import {
  buildCreateS3ConnectionSignature,
  buildEditPrivateConnectionSignature,
  buildPrivateConnectionDraft,
  buildPrivateConnectionEditorState,
  buildPrivateConnectionsProjection,
  buildPrivateStorageEndpointLabelById,
  buildS3CredentialsValidationPayload,
  createDefaultPrivateConnectionForm,
  createEmptyConnectionCredentialDraft,
  type ConnectionCredentialDraft,
  type CreatePrivateConnectionForm,
  type PrivateConnectionDraft,
  type S3ConnectionEndpointMode,
  preferredS3ConnectionEndpointId,
  prepareCreatePrivateConnectionPayload,
  prepareUpdatePrivateConnectionPayload,
} from "./s3ConnectionFormModel";

type PendingPrivateConnectionDelete = {
  scope: "single" | "bulk";
  connections: S3Connection[];
};

function getErrorMessage(error: unknown, fallback: string): string {
  if (isApiError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
    if (detail && typeof detail === "object" && "message" in detail && typeof detail.message === "string") {
      return detail.message;
    }
  }
  return fallback;
}

type ProfilePageProps = {
  profilePath?: string;
  showPageHeader?: boolean;
  /** Opt in outside Browser; the shared Browser profile keeps its existing header. */
  listPresentation?: boolean;
  headerActionsTarget?: HTMLElement | null;
  showSettingsCards?: boolean;
  showConnectionsSection?: boolean;
  onUnsavedChangesChange?: (dirty: boolean) => void;
};

export default function ProfilePage({
  profilePath = "/",
  showPageHeader = true,
  listPresentation = false,
  headerActionsTarget,
  showSettingsCards: showSettingsCardsProp = true,
  showConnectionsSection: showConnectionsSectionProp = false,
  onUnsavedChangesChange,
}: ProfilePageProps) {
  const [searchParams] = useSearchParams();
  const profileView = searchParams.get("view");
  const showConnectionsSection = showConnectionsSectionProp || profileView === "connections";
  const showSettingsCards = showSettingsCardsProp && profileView !== "connections";
  const storedUser = useMemo<SessionUser | null>(() => readStoredUser(), []);
  const authType = storedUser?.authType ?? null;
  const isS3Session = authType === "s3_session";
  const [settingsHaveUnsavedChanges, setSettingsHaveUnsavedChanges] = useState(false);
  const [connections, setConnections] = useState<S3Connection[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);
  const [connectionsMessage, setConnectionsMessage] = useState<string | null>(null);
  const [showCreateConnectionModal, setShowCreateConnectionModal] = useState(false);
  const [creatingConnection, setCreatingConnection] = useState(false);
  const [savingConnectionBusyId, setSavingConnectionBusyId] = useState<number | null>(null);
  const [deletingConnectionBusyId, setDeletingConnectionBusyId] = useState<number | null>(null);
  const [togglingConnectionBusyId, setTogglingConnectionBusyId] = useState<number | null>(null);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<number[]>([]);
  const [bulkActivatingConnections, setBulkActivatingConnections] = useState(false);
  const [bulkDisablingConnections, setBulkDisablingConnections] = useState(false);
  const [bulkDeletingConnections, setBulkDeletingConnections] = useState(false);
  const [pendingConnectionDelete, setPendingConnectionDelete] = useState<PendingPrivateConnectionDelete | null>(null);
  const [editingConnectionId, setEditingConnectionId] = useState<number | null>(null);
  const [createConnectionForm, setCreateConnectionForm] = useState(createDefaultPrivateConnectionForm);
  const [createConnectionEndpointMode, setCreateConnectionEndpointMode] = useState<S3ConnectionEndpointMode>("custom");
  const [createConnectionEndpointId, setCreateConnectionEndpointId] = useState("");
  const [editConnectionEndpointMode, setEditConnectionEndpointMode] = useState<S3ConnectionEndpointMode>("custom");
  const [editConnectionEndpointId, setEditConnectionEndpointId] = useState("");
  const [createConnectionInitialSignature, setCreateConnectionInitialSignature] = useState(() =>
    buildCreateS3ConnectionSignature(createDefaultPrivateConnectionForm(), "custom", "")
  );
  const [editConnectionInitialSignature, setEditConnectionInitialSignature] = useState(() =>
    buildEditPrivateConnectionSignature(
      buildPrivateConnectionDraft({ id: 0 } as S3Connection),
      createEmptyConnectionCredentialDraft(),
      "custom",
      "",
    )
  );
  const [availableStorageEndpoints, setAvailableStorageEndpoints] = useState<PrivateConnectionStorageEndpoint[]>([]);
  const [loadingStorageEndpoints, setLoadingStorageEndpoints] = useState(false);
  const [storageEndpointsError, setStorageEndpointsError] = useState<string | null>(null);
  const [connectionDrafts, setConnectionDrafts] = useState<Record<number, PrivateConnectionDraft>>({});
  const [connectionCredentialDrafts, setConnectionCredentialDrafts] = useState<Record<number, ConnectionCredentialDraft>>(
    {}
  );
  const [connectionsFilter, setConnectionsFilter] = useState("");
  const [connectionsPage, setConnectionsPage] = useState(1);
  const [connectionsPageSize, setConnectionsPageSize] = useState(10);
  const { catalog: privateTagCatalog, loading: privateTagCatalogLoading, error: privateTagCatalogError } = useTagCatalog(
    { kind: "private" },
    Boolean(showCreateConnectionModal || editingConnectionId != null)
  );
  const canCreateManualConnections =
    !isS3Session && canCreateManualPrivateConnections(storedUser);
  const canAccessConnectionsSection =
    !isS3Session && canAccessPrivateConnectionsSection(storedUser);

  const createConnectionValidationPayload = useMemo(
    () =>
      buildS3CredentialsValidationPayload(
        createConnectionForm,
        createConnectionEndpointMode,
        createConnectionEndpointId,
      ),
    [createConnectionEndpointId, createConnectionEndpointMode, createConnectionForm],
  );

  const validatePrivateCreateCredentials = useCallback(
    (payload: S3CredentialsValidationPayload) => validateConnectionCredentials(payload),
    []
  );

  const createConnectionValidation = useLiveS3CredentialsValidation({
    enabled: showCreateConnectionModal && canCreateManualConnections,
    payload: createConnectionValidationPayload,
    validate: validatePrivateCreateCredentials,
    debounceMs: 450,
  });

  const {
    allFilteredConnectionsSelected,
    filteredConnectionIdSet,
    filteredConnectionIds,
    filteredConnections,
    hiddenSelectedConnectionCount,
    pagedConnections,
    selectedFilteredConnectionIdSet,
    selectedFilteredConnectionIds,
  } = useMemo(
    () =>
      buildPrivateConnectionsProjection({
        connections,
        filter: connectionsFilter,
        page: connectionsPage,
        pageSize: connectionsPageSize,
        selectedConnectionIds,
      }),
    [
      connections,
      connectionsFilter,
      connectionsPage,
      connectionsPageSize,
      selectedConnectionIds,
    ],
  );
  const storageEndpointLabelById = useMemo(
    () => buildPrivateStorageEndpointLabelById(availableStorageEndpoints),
    [availableStorageEndpoints],
  );

  const editingConnection = useMemo(
    () =>
      editingConnectionId == null ? null : connections.find((connection) => connection.id === editingConnectionId) ?? null,
    [connections, editingConnectionId]
  );

  const createPrepared = prepareCreatePrivateConnectionPayload(createConnectionForm, createConnectionEndpointMode, createConnectionEndpointId);
  const createFormValidation = useS3ConnectionFormValidation(createPrepared, createConnectionEndpointMode === "custom" ? createConnectionForm.endpoint_url : undefined);
  const currentEditDraft = editingConnection ? connectionDrafts[editingConnection.id] ?? buildPrivateConnectionDraft(editingConnection) : null;
  const editPrepared = currentEditDraft && editingConnection ? prepareUpdatePrivateConnectionPayload({
    canManageCredentials: canCreateManualConnections, serverManaged: Boolean(editingConnection.server_managed),
    credentialDraft: connectionCredentialDrafts[editingConnection.id] ?? createEmptyConnectionCredentialDraft(),
    draft: currentEditDraft, endpointId: editConnectionEndpointId, endpointMode: editConnectionEndpointMode,
  }) : { error: null, payload: null };
  const editFormValidation = useS3ConnectionFormValidation(editPrepared, canCreateManualConnections && !editingConnection?.server_managed && editConnectionEndpointMode === "custom" ? currentEditDraft?.endpoint_url : undefined);

  const createConnectionCurrentSignature = useMemo(
    () =>
      buildCreateS3ConnectionSignature(
        createConnectionForm,
        createConnectionEndpointMode,
        createConnectionEndpointId
      ),
    [createConnectionEndpointId, createConnectionEndpointMode, createConnectionForm]
  );

  const closeCreateConnectionModal = useCallback(() => {
    if (creatingConnection) return;
    setShowCreateConnectionModal(false);
    setCreateConnectionForm(createDefaultPrivateConnectionForm());
    setCreateConnectionEndpointMode("custom");
    setCreateConnectionEndpointId("");
  }, [creatingConnection]);

  const closeEditConnectionModal = useCallback(() => {
    if (editingConnection && savingConnectionBusyId === editingConnection.id) return;
    if (editingConnection) {
      setConnectionDrafts((prev) => ({
        ...prev,
        [editingConnection.id]: buildPrivateConnectionDraft(editingConnection),
      }));
      setConnectionCredentialDrafts((prev) => ({
        ...prev,
        [editingConnection.id]: createEmptyConnectionCredentialDraft(),
      }));
    }
    setEditingConnectionId(null);
  }, [editingConnection, savingConnectionBusyId]);

  const editConnectionCurrentSignature = useMemo(() => {
    if (!editingConnection) return editConnectionInitialSignature;
    const draft = connectionDrafts[editingConnection.id] ?? buildPrivateConnectionDraft(editingConnection);
    const credentialDraft =
      connectionCredentialDrafts[editingConnection.id] ?? createEmptyConnectionCredentialDraft();
    return buildEditPrivateConnectionSignature(
      draft,
      credentialDraft,
      editConnectionEndpointMode,
      editConnectionEndpointId
    );
  }, [
    connectionCredentialDrafts,
    connectionDrafts,
    editConnectionEndpointId,
    editConnectionEndpointMode,
    editConnectionInitialSignature,
    editingConnection,
  ]);

  const connectionHasUnsavedChanges =
    (showCreateConnectionModal && createConnectionCurrentSignature !== createConnectionInitialSignature) ||
    (Boolean(editingConnection) && editConnectionCurrentSignature !== editConnectionInitialSignature);

  useEffect(() => {
    onUnsavedChangesChange?.((showSettingsCards && settingsHaveUnsavedChanges) || connectionHasUnsavedChanges);
  }, [connectionHasUnsavedChanges, onUnsavedChangesChange, settingsHaveUnsavedChanges, showSettingsCards]);

  const createConnectionCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: showCreateConnectionModal && createConnectionCurrentSignature !== createConnectionInitialSignature,
    onClose: closeCreateConnectionModal,
    disabled: creatingConnection,
    zIndexClass: "z-[70]",
  });

  const editConnectionCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: Boolean(editingConnection) && editConnectionCurrentSignature !== editConnectionInitialSignature,
    onClose: closeEditConnectionModal,
    disabled: editingConnection ? savingConnectionBusyId === editingConnection.id : false,
    zIndexClass: "z-[70]",
  });

  useEffect(() => {
    if (!showConnectionsSection || !canAccessConnectionsSection) {
      setConnections([]);
      setConnectionDrafts({});
      setConnectionCredentialDrafts({});
      setConnectionsError(null);
      setConnectionsLoading(false);
      setShowCreateConnectionModal(false);
      setEditingConnectionId(null);
      setConnectionsFilter("");
      setConnectionsPage(1);
      return;
    }
    let cancelled = false;
    setConnectionsLoading(true);
    setConnectionsError(null);
    listConnections()
      .then((items) => {
        if (cancelled) return;
        const editorState = buildPrivateConnectionEditorState(items);
        setConnections(items);
        setConnectionDrafts(editorState.drafts);
        setConnectionCredentialDrafts(editorState.credentialDrafts);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error(error);
        setConnections([]);
        setConnectionDrafts({});
        setConnectionCredentialDrafts({});
        setConnectionsError(getErrorMessage(error, "Unable to load private S3 connections."));
      })
      .finally(() => {
        if (!cancelled) {
          setConnectionsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canAccessConnectionsSection, showConnectionsSection]);

  useEffect(() => {
    if (!showConnectionsSection || !canCreateManualConnections) {
      setAvailableStorageEndpoints([]);
      setStorageEndpointsError(null);
      setLoadingStorageEndpoints(false);
      return;
    }
    let cancelled = false;
    setLoadingStorageEndpoints(true);
    setStorageEndpointsError(null);
    listPrivateConnectionStorageEndpoints()
      .then((items) => {
        if (cancelled) return;
        setAvailableStorageEndpoints(items);
      })
      .catch((error) => {
        if (cancelled) return;
        setAvailableStorageEndpoints([]);
        setStorageEndpointsError(getErrorMessage(error, "Unable to load configured endpoints."));
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingStorageEndpoints(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canCreateManualConnections, showConnectionsSection]);

  useEffect(() => {
    if (!showConnectionsSection) return;
    const totalPages = Math.max(1, Math.ceil(filteredConnections.length / (connectionsPageSize || 1)));
    if (connectionsPage > totalPages) {
      setConnectionsPage(totalPages);
    }
  }, [connectionsPage, connectionsPageSize, filteredConnections.length, showConnectionsSection]);

  useEffect(() => {
    if (!showConnectionsSection) return;
    if (editingConnectionId != null && !connections.some((item) => item.id === editingConnectionId)) {
      setEditingConnectionId(null);
    }
  }, [connections, editingConnectionId, showConnectionsSection]);

  useEffect(() => {
    if (!showConnectionsSection) return;
    setSelectedConnectionIds((prev) => {
      const next = prev.filter((connectionId) => filteredConnectionIdSet.has(connectionId));
      return next.length === prev.length ? prev : next;
    });
  }, [filteredConnectionIdSet, showConnectionsSection]);

  useEffect(() => {
    if (!showConnectionsSection) return;
    setSelectedConnectionIds([]);
  }, [connectionsPage, connectionsPageSize, showConnectionsSection]);

  const refreshConnections = async () => {
    if (!showConnectionsSection || !canAccessConnectionsSection) return;
    setConnectionsLoading(true);
    setConnectionsError(null);
    try {
      const items = await listConnections();
      const editorState = buildPrivateConnectionEditorState(items);
      setConnections(items);
      setConnectionDrafts(editorState.drafts);
      setConnectionCredentialDrafts(editorState.credentialDrafts);
    } catch (error) {
      console.error(error);
      setConnectionsError(getErrorMessage(error, "Unable to refresh private S3 connections."));
    } finally {
      setConnectionsLoading(false);
    }
  };

  const openCreateConnectionModal = () => {
    createFormValidation.reset();
    if (!canCreateManualConnections) return;
    setConnectionsError(null);
    setConnectionsMessage(null);
    const nextForm: CreatePrivateConnectionForm =
      createDefaultPrivateConnectionForm();
    let nextEndpointMode: S3ConnectionEndpointMode = "custom";
    let nextEndpointId = "";
    if (availableStorageEndpoints.length > 0) {
      const preferred = availableStorageEndpoints.find((item) => item.is_default) ?? availableStorageEndpoints[0];
      nextEndpointMode = "preset";
      nextEndpointId = String(preferred.id);
    }
    setCreateConnectionForm(nextForm);
    setCreateConnectionEndpointMode(nextEndpointMode);
    setCreateConnectionEndpointId(nextEndpointId);
    setCreateConnectionInitialSignature(
      buildCreateS3ConnectionSignature(
        nextForm,
        nextEndpointMode,
        nextEndpointId,
      ),
    );
    setShowCreateConnectionModal(true);
  };

  const openEditConnectionModal = (connection: S3Connection) => {
    editFormValidation.reset();
    setConnectionsError(null);
    setConnectionsMessage(null);
    const nextDraft = buildPrivateConnectionDraft(connection);
    const nextCredentialDraft = createEmptyConnectionCredentialDraft();
    setConnectionDrafts((prev) => ({
      ...prev,
      [connection.id]: nextDraft,
    }));
    let nextEndpointMode: S3ConnectionEndpointMode = "custom";
    let nextEndpointId = "";
    if (connection.storage_endpoint_id != null) {
      nextEndpointMode = "preset";
      nextEndpointId = String(connection.storage_endpoint_id);
    }
    setEditConnectionEndpointMode(nextEndpointMode);
    setEditConnectionEndpointId(nextEndpointId);
    setConnectionCredentialDrafts((prev) => ({
      ...prev,
      [connection.id]: nextCredentialDraft,
    }));
    setEditConnectionInitialSignature(
      buildEditPrivateConnectionSignature(
        nextDraft,
        nextCredentialDraft,
        nextEndpointMode,
        nextEndpointId,
      ),
    );
    setEditingConnectionId(connection.id);
  };

  const handleCreatePrivateConnection = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCreateManualConnections || creatingConnection || !createFormValidation.validate(event.currentTarget) || createPrepared.payload === null) return;
    const prepared = createPrepared;
    setConnectionsError(null);
    setConnectionsMessage(null);
    setCreatingConnection(true);
    try {
      await createConnection(prepared.payload);
      setCreateConnectionForm(createDefaultPrivateConnectionForm());
      setCreateConnectionEndpointMode(availableStorageEndpoints.length > 0 ? "preset" : "custom");
      setCreateConnectionEndpointId("");
      setShowCreateConnectionModal(false);
      setConnectionsPage(1);
      setConnectionsMessage("Private S3 connection created.");
      await refreshConnections();
      notifyExecutionContextsRefresh();
    } catch (error) {
      console.error(error);
      setConnectionsError(getErrorMessage(error, "Unable to create private S3 connection."));
    } finally {
      setCreatingConnection(false);
    }
  };

  const handleUpdateConnectionDraft = (
    connectionId: number,
    field: keyof PrivateConnectionDraft,
    value: PrivateConnectionDraft[keyof PrivateConnectionDraft]
  ) => {
    setConnectionDrafts((prev) => ({
      ...prev,
      [connectionId]: {
        ...prev[connectionId],
        [field]: value,
      },
    }));
  };

  const handleUpdateConnectionCredentialDraft = (
    connectionId: number,
    field: keyof ConnectionCredentialDraft,
    value: string
  ) => {
    setConnectionCredentialDrafts((prev) => ({
      ...prev,
      [connectionId]: {
        ...prev[connectionId],
        [field]: value,
      },
    }));
  };

  const handleUpdatePrivateConnection = async (connectionId: number, form: HTMLFormElement): Promise<boolean> => {
    if (!canAccessConnectionsSection || savingConnectionBusyId !== null || !editFormValidation.validate(form) || editPrepared.payload === null) return false;
    const prepared = editPrepared;
    setConnectionsError(null);
    setConnectionsMessage(null);
    setSavingConnectionBusyId(connectionId);
    try {
      await updateConnection(connectionId, prepared.payload);
      setConnectionCredentialDrafts((prev) => ({
        ...prev,
        [connectionId]: createEmptyConnectionCredentialDraft(),
      }));
      setConnectionsMessage("Private S3 connection updated.");
      await refreshConnections();
      notifyExecutionContextsRefresh();
      return true;
    } catch (error) {
      console.error(error);
      setConnectionsError(getErrorMessage(error, "Unable to update private S3 connection."));
      return false;
    } finally {
      setSavingConnectionBusyId(null);
    }
  };

  const editConnectionValidationPayload = useMemo(() => {
    if (!editingConnection || editingConnection.server_managed) return null;
    const draft =
      connectionDrafts[editingConnection.id] ??
      buildPrivateConnectionDraft(editingConnection);
    const credentialDraft =
      connectionCredentialDrafts[editingConnection.id] ??
      createEmptyConnectionCredentialDraft();
    return buildS3CredentialsValidationPayload(
      { ...draft, ...credentialDraft },
      editConnectionEndpointMode,
      editConnectionEndpointId,
    );
  }, [
    connectionCredentialDrafts,
    connectionDrafts,
    editConnectionEndpointId,
    editConnectionEndpointMode,
    editingConnection,
  ]);

  const editConnectionValidation = useLiveS3CredentialsValidation({
    enabled: Boolean(editingConnection) && !editingConnection?.server_managed && canCreateManualConnections,
    payload: editConnectionValidationPayload,
    validate: validatePrivateCreateCredentials,
    debounceMs: 450,
  });

  const handleDeletePrivateConnection = (connection: S3Connection) => {
    if (!canAccessConnectionsSection) return;
    setPendingConnectionDelete({ scope: "single", connections: [connection] });
  };

  const confirmDeletePrivateConnection = async (connectionId: number) => {
    setConnectionsError(null);
    setConnectionsMessage(null);
    setDeletingConnectionBusyId(connectionId);
    try {
      await deleteConnection(connectionId);
      setSelectedConnectionIds((prev) => prev.filter((id) => id !== connectionId));
      setConnectionsMessage("Private S3 connection deleted.");
      await refreshConnections();
      notifyExecutionContextsRefresh();
    } catch (error) {
      console.error(error);
      setConnectionsError(getErrorMessage(error, "Unable to delete private S3 connection."));
    } finally {
      setDeletingConnectionBusyId(null);
    }
  };

  const handleRetryManagedCleanup = async (connectionId: number) => {
    setConnectionsError(null);
    setConnectionsMessage(null);
    setDeletingConnectionBusyId(connectionId);
    try {
      await retryManagedPrivateAccessCleanup(connectionId);
      setConnectionsMessage("Managed private access cleanup completed.");
      await refreshConnections();
      notifyExecutionContextsRefresh();
    } catch (error) {
      console.error(error);
      setConnectionsError(getErrorMessage(error, "Unable to complete managed private access cleanup."));
    } finally {
      setDeletingConnectionBusyId(null);
    }
  };
  const togglePrivateConnectionSelection = (connectionId: number) => {
    setSelectedConnectionIds((prev) =>
      prev.includes(connectionId) ? prev.filter((id) => id !== connectionId) : [...prev, connectionId]
    );
  };

  const toggleSelectAllFilteredConnections = () => {
    if (allFilteredConnectionsSelected) {
      setSelectedConnectionIds([]);
      return;
    }
    setSelectedConnectionIds(filteredConnectionIds);
  };

  const handleBulkActivatePrivateConnections = async () => {
    if (!canAccessConnectionsSection || selectedFilteredConnectionIds.length === 0) return;
    setConnectionsError(null);
    setConnectionsMessage(null);
    setBulkActivatingConnections(true);
    const results = await Promise.allSettled(
      selectedFilteredConnectionIds.map((connectionId) => updateConnection(connectionId, { is_active: true }))
    );
    const failedIds = selectedFilteredConnectionIds.filter((_, index) => results[index].status === "rejected");
    const successCount = selectedFilteredConnectionIds.length - failedIds.length;
    setSelectedConnectionIds(failedIds);
    if (successCount > 0) {
      await refreshConnections();
      notifyExecutionContextsRefresh();
    }
    if (failedIds.length > 0) {
      setConnectionsError(`${failedIds.length} private connection${failedIds.length > 1 ? "s" : ""} failed to activate.`);
    }
    setConnectionsMessage(
      `${successCount} private connection${successCount > 1 ? "s" : ""} activated.` +
        (failedIds.length > 0 ? ` ${failedIds.length} failed.` : "")
    );
    setBulkActivatingConnections(false);
  };

  const handleTogglePrivateConnectionStatus = async (connection: S3Connection) => {
    if (!canAccessConnectionsSection) return;
    const nextIsActive = connection.is_active !== false ? false : true;
    setConnectionsError(null);
    setConnectionsMessage(null);
    setTogglingConnectionBusyId(connection.id);
    try {
      await updateConnection(connection.id, { is_active: nextIsActive });
      setConnectionsMessage(nextIsActive ? "Private S3 connection activated." : "Private S3 connection disabled.");
      await refreshConnections();
      notifyExecutionContextsRefresh();
    } catch (error) {
      console.error(error);
      setConnectionsError(getErrorMessage(error, "Unable to update private S3 connection."));
    } finally {
      setTogglingConnectionBusyId(null);
    }
  };

  const handleBulkDisablePrivateConnections = async () => {
    if (!canAccessConnectionsSection || selectedFilteredConnectionIds.length === 0) return;
    setConnectionsError(null);
    setConnectionsMessage(null);
    setBulkDisablingConnections(true);
    const results = await Promise.allSettled(
      selectedFilteredConnectionIds.map((connectionId) => updateConnection(connectionId, { is_active: false }))
    );
    const failedIds = selectedFilteredConnectionIds.filter((_, index) => results[index].status === "rejected");
    const successCount = selectedFilteredConnectionIds.length - failedIds.length;
    setSelectedConnectionIds(failedIds);
    if (successCount > 0) {
      await refreshConnections();
      notifyExecutionContextsRefresh();
    }
    if (failedIds.length > 0) {
      setConnectionsError(`${failedIds.length} private connection${failedIds.length > 1 ? "s" : ""} failed to disable.`);
    }
    setConnectionsMessage(
      `${successCount} private connection${successCount > 1 ? "s" : ""} disabled.` +
        (failedIds.length > 0 ? ` ${failedIds.length} failed.` : "")
    );
    setBulkDisablingConnections(false);
  };

  const handleBulkDeletePrivateConnections = () => {
    if (!canAccessConnectionsSection || selectedFilteredConnectionIds.length === 0) return;
    const selectedIdSet = new Set(selectedFilteredConnectionIds);
    setPendingConnectionDelete({
      scope: "bulk",
      connections: connections.filter((connection) => selectedIdSet.has(connection.id)),
    });
  };

  const confirmBulkDeletePrivateConnections = async (connectionIds: number[]) => {
    setConnectionsError(null);
    setConnectionsMessage(null);
    setBulkDeletingConnections(true);
    try {
      const results = await Promise.allSettled(connectionIds.map((connectionId) => deleteConnection(connectionId)));
      const failedIds = connectionIds.filter((_, index) => results[index].status === "rejected");
      const successCount = connectionIds.length - failedIds.length;
      setSelectedConnectionIds(failedIds);
      if (successCount > 0) {
        await refreshConnections();
        notifyExecutionContextsRefresh();
      }
      if (failedIds.length > 0) {
        setConnectionsError(`${failedIds.length} private connection${failedIds.length > 1 ? "s" : ""} failed to delete.`);
      }
      setConnectionsMessage(
        `${successCount} private connection${successCount > 1 ? "s" : ""} deleted.` +
          (failedIds.length > 0 ? ` ${failedIds.length} failed.` : "")
      );
    } finally {
      setBulkDeletingConnections(false);
    }
  };

  const confirmPendingConnectionDelete = async () => {
    if (!pendingConnectionDelete) return;
    try {
      if (pendingConnectionDelete.scope === "single") {
        const connection = pendingConnectionDelete.connections[0];
        if (connection) await confirmDeletePrivateConnection(connection.id);
      } else {
        await confirmBulkDeletePrivateConnections(pendingConnectionDelete.connections.map((connection) => connection.id));
      }
    } finally {
      setPendingConnectionDelete(null);
    }
  };

  const handleConnectionsFilterChange = (value: string) => {
    setConnectionsFilter(value);
    setSelectedConnectionIds([]);
    setConnectionsPage(1);
  };

  const privateConnectionsTableStatus = connectionsLoading
    ? "loading"
    : pagedConnections.length === 0
      ? "empty"
      : "ready";

  const privateConnectionTableColumns: Array<DataTableColumn<S3Connection>> = [
    {
      id: "select",
      label: "Select",
      headerClassName: "w-10",
      cellClassName: "w-10",
      header: (
        <label className="ui-list-selection"><input
          type="checkbox"
          aria-label="Select all filtered private connections"
          checked={allFilteredConnectionsSelected}
          onChange={toggleSelectAllFilteredConnections}
          disabled={
            filteredConnectionIds.length === 0 ||
            bulkActivatingConnections ||
            bulkDisablingConnections ||
            bulkDeletingConnections
          }
          className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
        /></label>
      ),
      render: (connection) => (
        <label className="ui-list-selection"><input
          type="checkbox"
          aria-label={`Select private connection ${connection.name || connection.id}`}
          checked={selectedFilteredConnectionIdSet.has(connection.id)}
          onChange={() => togglePrivateConnectionSelection(connection.id)}
          disabled={bulkActivatingConnections || bulkDisablingConnections || bulkDeletingConnections}
          className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
        /></label>
      ),
    },
    {
      id: "connection",
      label: "Connection",
      primary: true,
      render: (connection) => {
        const connectionTagItems = buildUiTagItems(connection.tags);
        return (
          <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
            <div className="min-w-0 flex-1">
              <p className="truncate">{connection.name || "-"}</p>
              {connection.server_managed && (
                <ListBadge tone="primary" className="mt-1">
                  Server managed{connection.managed_access_state === "cleanup_pending" ? " - cleanup required" : ""}
                </ListBadge>
              )}
              <p className="ui-caption font-normal text-slate-500 dark:text-slate-400">
                Access Key: {connection.access_key_id || "-"}
              </p>
            </div>
            {connectionTagItems.length > 0 && (
              <UiTagBadgeList
                items={connectionTagItems}
                variant="listing-compact"
                layout="inline-compact"
                className="ml-auto max-w-full"
                maxVisible={4}
              />
            )}
          </div>
        );
      },
    },
    {
      id: "endpoint",
      label: "Endpoint",
      render: (connection) => {
        const endpointLabel = connection.storage_endpoint_id
          ? storageEndpointLabelById.get(connection.storage_endpoint_id) ||
            `Managed endpoint #${connection.storage_endpoint_id}`
          : connection.endpoint_url || "-";
        return connection.storage_endpoint_id ? (
          <ListBadge tone="neutral">{endpointLabel}</ListBadge>
        ) : (
          <span className="ui-mono">{endpointLabel}</span>
        );
      },
    },
    {
      id: "provider",
      label: "Provider",
      render: (connection) => connection.provider_hint || "-",
    },
    {
      id: "status",
      label: "Status",
      render: (connection) => {
        const isActive = connection.is_active !== false;
        return <ListBadge tone={isActive ? "success" : "neutral"}>{isActive ? "Active" : "Inactive"}</ListBadge>;
      },
    },
    {
      id: "updated-at",
      label: "Last update",
      render: (connection) => formatLocalDateTime(connection.updated_at ?? connection.created_at),
    },
    {
      id: "last-used-at",
      label: "Last used",
      render: (connection) => formatLocalDateTime(connection.last_used_at),
    },
    {
      id: "actions",
      label: "Actions",
      align: "right",
      mobileRole: "actions",
      render: (connection) => {
        const isActive = connection.is_active !== false;
        return (
          <ListActions>
            {connection.managed_access_state === "cleanup_pending" && (
              <ListActionButton
                type="button"
                disabled={deletingConnectionBusyId === connection.id}
                onClick={() => void handleRetryManagedCleanup(connection.id)}
              >
                {deletingConnectionBusyId === connection.id ? "Retrying..." : "Retry cleanup"}
              </ListActionButton>
            )}
            <ListActionButton
              type="button"
              disabled={
                togglingConnectionBusyId === connection.id ||
                bulkActivatingConnections ||
                bulkDisablingConnections ||
                bulkDeletingConnections
              }
              onClick={() => void handleTogglePrivateConnectionStatus(connection)}
            >
              {togglingConnectionBusyId === connection.id ? "Saving..." : isActive ? "Deactivate" : "Activate"}
            </ListActionButton>
            <ListActionButton
              type="button"
              onClick={() => openEditConnectionModal(connection)}
              disabled={bulkActivatingConnections || bulkDisablingConnections || bulkDeletingConnections}
            >
              Edit
            </ListActionButton>
            <ListActionButton
              type="button"
              variant="danger"
              disabled={
                deletingConnectionBusyId === connection.id ||
                bulkActivatingConnections ||
                bulkDisablingConnections ||
                bulkDeletingConnections
              }
              onClick={() => handleDeletePrivateConnection(connection)}
            >
              {deletingConnectionBusyId === connection.id ? "Deleting..." : "Delete"}
            </ListActionButton>
          </ListActions>
        );
      },
    },
  ];

  return (
    <div className={workflowPageHostClass(showConnectionsSection && (showCreateConnectionModal || Boolean(editingConnection)))}>
      {showPageHeader && (
        <PageHeader
          title={showConnectionsSection && !showSettingsCards ? "Private S3 connections" : "User profile"}
          description={showConnectionsSection && !showSettingsCards ? "Manage your personal storage connections and credentials." : "Configure your account and preferences."}
          breadcrumbs={[{ label: "Profile" }]}
        />
      )}

      {showSettingsCards && <ProfilePreferencesPage onUnsavedChangesChange={setSettingsHaveUnsavedChanges} />}

      {showConnectionsSection && <section className="settings-compact">
        <div className="space-y-4">
          {!canCreateManualConnections && (
            <PageBanner tone="info">
              Creation, endpoint changes, identity changes, and credential replacement are disabled. Existing connections remain available for metadata, workspace access, activation, cleanup, and deletion.
            </PageBanner>
          )}
            <>
              {connectionsError && <PageBanner tone="error">{connectionsError}</PageBanner>}
              {connectionsMessage && <PageBanner tone="success">{connectionsMessage}</PageBanner>}
              {listPresentation && headerActionsTarget && canCreateManualConnections && !showCreateConnectionModal && !editingConnection ? createPortal(
                <ListActionButton variant="primary" onClick={openCreateConnectionModal}>Add connection</ListActionButton>,
                headerActionsTarget,
              ) : null}
              <div className="rounded-lg border border-[color:var(--ui-border)]">
                {listPresentation ? <ListToolbar variant="page" title="Private S3 connections"
                  countLabel={`${filteredConnections.length} connections shown${filteredConnections.length !== connections.length ? ` of ${connections.length}` : ""}`}
                  search={<ToolbarSearchInput value={connectionsFilter} onChange={handleConnectionsFilterChange}
                    placeholder="Name, endpoint, provider, tag..." label="Search connections" />} /> : (
                <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    {filteredConnections.length} connections shown
                    {filteredConnections.length !== connections.length ? ` of ${connections.length}` : ""}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Search
                      </span>
                      <input
                        type="text"
                        value={connectionsFilter}
                        onChange={(event) => handleConnectionsFilterChange(event.target.value)}
                        placeholder="Name, endpoint, provider, tag..."
                        className={`${toolbarCompactInputClasses} min-w-0 w-full sm:w-72`}
                      />
                    </div>
                    {canCreateManualConnections && (
                      <UiButton size="sm" onClick={openCreateConnectionModal}>
                        Add connection
                      </UiButton>
                    )}
                  </div>
                </div>
                )}
                {selectedFilteredConnectionIds.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 dark:border-slate-800 dark:bg-slate-900/50">
                    <span className="ui-caption font-semibold text-slate-700 dark:text-slate-200">
                      {selectedFilteredConnectionIds.length} selected
                      {hiddenSelectedConnectionCount > 0 ? ` (${hiddenSelectedConnectionCount} not visible)` : ""}
                    </span>
                    <ListActions>
                      <ListActionButton
                        type="button"
                        onClick={() => void handleBulkActivatePrivateConnections()}
                        disabled={bulkActivatingConnections || bulkDisablingConnections || bulkDeletingConnections}
                      >
                        {bulkActivatingConnections ? "Activating..." : "Activate selected"}
                      </ListActionButton>
                      <ListActionButton
                        type="button"
                        onClick={() => void handleBulkDisablePrivateConnections()}
                        disabled={bulkActivatingConnections || bulkDisablingConnections || bulkDeletingConnections}
                      >
                        {bulkDisablingConnections ? "Disabling..." : "Disable selected"}
                      </ListActionButton>
                      <ListActionButton
                        type="button"
                         variant="danger"
                        onClick={handleBulkDeletePrivateConnections}
                        disabled={bulkActivatingConnections || bulkDisablingConnections || bulkDeletingConnections}
                      >
                        {bulkDeletingConnections ? "Deleting..." : "Delete selected"}
                      </ListActionButton>
                    </ListActions>
                  </div>
                )}
                <DataTableShell
                  columns={privateConnectionTableColumns}
                  rows={connectionsLoading ? [] : pagedConnections}
                  rowKey={(connection) => connection.id}
                  status={privateConnectionsTableStatus}
                  loadingMessage="Loading connections..."
                  errorMessage="Unable to load private S3 connections."
                  emptyMessage="No private S3 connection configured."
                  pagination={!connectionsLoading && filteredConnections.length > 0 ? {
                    page: connectionsPage,
                    pageSize: connectionsPageSize,
                    total: filteredConnections.length,
                    onPageChange: (page) => {
                      setConnectionsPage(Math.max(1, page));
                      setSelectedConnectionIds([]);
                    },
                    onPageSizeChange: (size) => {
                      setConnectionsPageSize(size);
                      setSelectedConnectionIds([]);
                      setConnectionsPage(1);
                    },
                    pageSizeOptions: [5, 10, 25, 50],
                  } : undefined}
                />
              </div>
            </>
        </div>
      </section>}

      {pendingConnectionDelete && (
        <ConfirmActionDialog
          title={pendingConnectionDelete.scope === "single" ? "Delete private S3 connection?" : "Delete selected private S3 connections?"}
          description={
            pendingConnectionDelete.scope === "single"
              ? "Remove this private connection from your profile."
              : "Remove all selected private connections from your profile."
          }
          confirmLabel={pendingConnectionDelete.scope === "single" ? "Delete connection" : "Delete selected connections"}
          details={
            pendingConnectionDelete.scope === "single"
              ? [
                  {
                    label: "Connection",
                    value: pendingConnectionDelete.connections[0]?.name || `#${pendingConnectionDelete.connections[0]?.id}`,
                  },
                  {
                    label: "Endpoint",
                    value: pendingConnectionDelete.connections[0]?.endpoint_url || "Managed endpoint",
                    mono: true,
                  },
                ]
              : [{ label: "Connections", value: pendingConnectionDelete.connections.length }]
          }
          impacts={[
            "Access through the selected connection will be removed from Manager and Browser.",
            "Remote buckets and their objects will not be deleted.",
          ]}
          loading={
            pendingConnectionDelete.scope === "bulk"
              ? bulkDeletingConnections
              : deletingConnectionBusyId === pendingConnectionDelete.connections[0]?.id
          }
          onCancel={() => setPendingConnectionDelete(null)}
          onConfirm={() => void confirmPendingConnectionDelete()}
        />
      )}

      {showConnectionsSection && canCreateManualConnections && showCreateConnectionModal && (
        <WorkflowPage
          title="Add private S3 connection"
          description="Configure endpoint access, credentials, and workspace availability for this private connection."
          breadcrumbs={[{ label: "Profile", to: profilePath }, { label: "Private connections", to: `${profilePath}?tab=connections` }, { label: "Create" }]}
          backLabel="Back to connections"
          onBack={createConnectionCloseGuard.requestClose}
          backDisabled={creatingConnection}
          contentVariant="plain"
          contentClassName="settings-compact"
          width="standard"
        >
          {connectionsError && (
            <UiInlineMessage tone="error" className="mb-3">
              {connectionsError}
            </UiInlineMessage>
          )}
          <SettingsForm label="Create private S3 connection" onSubmit={handleCreatePrivateConnection} busy={creatingConnection}
            onCancel={createConnectionCloseGuard.requestClose} submitLabel="Create connection" busyLabel="Creating...">
              <S3ConnectionIdentityFields name={createConnectionForm.name} onNameChange={(name) => setCreateConnectionForm((current) => ({ ...current, name }))}
                nameError={createFormValidation.errorFor("name")} catalogError={privateTagCatalogError}
                tagEditor={{ tags: createConnectionForm.tags, catalog: privateTagCatalog, onChange: (tags) => setCreateConnectionForm((current) => ({ ...current, tags })),
                  catalogMode: "private", placeholder: "Add a tag for this private connection", disabled: creatingConnection,
                  hint: privateTagCatalogLoading ? "Loading existing private tags..." : undefined }} />
              <S3ConnectionEndpointFields mode={createConnectionEndpointMode}
                onModeChange={(mode) => { setCreateConnectionEndpointMode(mode); if (mode === "preset") setCreateConnectionEndpointId(preferredS3ConnectionEndpointId(createConnectionEndpointId, availableStorageEndpoints)); }}
                modeInputName="create-connection-endpoint-mode" endpointId={createConnectionEndpointId}
                onEndpointIdChange={setCreateConnectionEndpointId} endpoints={availableStorageEndpoints} loadingEndpoints={loadingStorageEndpoints}
                form={createConnectionForm} onFormChange={(field, value) => setCreateConnectionForm((current) => ({ ...current, [field]: value }))}
                endpointIdError={createFormValidation.errorFor("endpointId")} endpointUrlError={createFormValidation.errorFor("endpointUrl")}
                errorMessage={storageEndpointsError ? `Unable to load configured endpoints (${storageEndpointsError}). Use custom mode.` : null} />
              <SettingsSection title="Credentials" presentation="compact">
                <div className="settings-stack">

                  <S3ConnectionCredentialFields accessKeyId={createConnectionForm.access_key_id} secretAccessKey={createConnectionForm.secret_access_key}
                    onAccessKeyIdChange={(value) => setCreateConnectionForm((current) => ({ ...current, access_key_id: value }))} onSecretAccessKeyChange={(value) => setCreateConnectionForm((current) => ({ ...current, secret_access_key: value }))}
                    error={createFormValidation.errorFor("credentials")} required accessKeyLabel="Access key ID" secretAccessKeyLabel="Secret access key" />
                  <S3CredentialsValidationMessage validation={createConnectionValidation} />
                </div>
              </SettingsSection>
              <SettingsSection title="Access" presentation="compact">
                <S3ConnectionAccessFields accessManager={Boolean(createConnectionForm.access_manager)} accessBrowser={Boolean(createConnectionForm.access_browser)}
                  onAccessManagerChange={(checked) => setCreateConnectionForm((current) => ({ ...current, access_manager: checked }))} onAccessBrowserChange={(checked) => setCreateConnectionForm((current) => ({ ...current, access_browser: checked }))}
                  className="settings-fields" error={createFormValidation.errorFor("access")} />
              </SettingsSection>
          </SettingsForm>
          {createConnectionCloseGuard.confirmationDialog}
        </WorkflowPage>
      )}

      {showConnectionsSection && editingConnection && (
        <WorkflowPage
          title={`Edit connection - ${editingConnection.name}`}
          description={editingConnection.server_managed
            ? "Manage the name, tags, status, and workspace availability. Endpoint and credentials are controlled by server provisioning."
            : "Manage endpoint access, credentials, and workspace availability for this private connection."}
          breadcrumbs={[{ label: "Profile", to: profilePath }, { label: "Private connections", to: `${profilePath}?tab=connections` }, { label: "Edit" }]}
          backLabel="Back to connections"
          onBack={editConnectionCloseGuard.requestClose}
          backDisabled={savingConnectionBusyId === editingConnection.id}
          contentVariant="plain"
          contentClassName="settings-compact"
          width="standard"
        >
          {connectionsError && (
            <UiInlineMessage tone="error" className="mb-3">
              {connectionsError}
            </UiInlineMessage>
          )}
          <SettingsForm label="Edit private S3 connection" busy={savingConnectionBusyId === editingConnection.id}
            onCancel={editConnectionCloseGuard.requestClose} submitLabel="Save" busyLabel="Saving..."
            onSubmit={async (event) => {
              const success = await handleUpdatePrivateConnection(editingConnection.id, event.currentTarget);
              if (success) closeEditConnectionModal();
            }}>
            {(() => {
              const draft = connectionDrafts[editingConnection.id] ?? buildPrivateConnectionDraft(editingConnection);
              const credentialDraft = connectionCredentialDrafts[editingConnection.id] ?? createEmptyConnectionCredentialDraft();
              return <>
              <S3ConnectionIdentityFields name={draft.name} onNameChange={(name) => handleUpdateConnectionDraft(editingConnection.id, "name", name)}
                nameError={editFormValidation.errorFor("name")} catalogError={privateTagCatalogError}
                tagEditor={{ tags: draft.tags, catalog: privateTagCatalog, onChange: (tags) => handleUpdateConnectionDraft(editingConnection.id, "tags", tags),
                  catalogMode: "private", placeholder: "Add a tag for this private connection", disabled: savingConnectionBusyId === editingConnection.id,
                  hint: privateTagCatalogLoading ? "Loading existing private tags..." : undefined }} />
                {canCreateManualConnections && !editingConnection.server_managed && (
              <S3ConnectionEndpointFields mode={editConnectionEndpointMode}
                onModeChange={(mode) => { setEditConnectionEndpointMode(mode); if (mode === "preset") setEditConnectionEndpointId(preferredS3ConnectionEndpointId(editConnectionEndpointId, availableStorageEndpoints)); }}
                modeInputName="edit-connection-endpoint-mode" endpointId={editConnectionEndpointId}
                onEndpointIdChange={setEditConnectionEndpointId} endpoints={availableStorageEndpoints} loadingEndpoints={loadingStorageEndpoints}
                form={draft} onFormChange={(field, value) => handleUpdateConnectionDraft(editingConnection.id, field, value)}
                endpointIdError={editFormValidation.errorFor("endpointId")} endpointUrlError={editFormValidation.errorFor("endpointUrl")}
                errorMessage={storageEndpointsError ? `Unable to load configured endpoints (${storageEndpointsError}). Use custom mode.` : null} />
                )}
                {editingConnection.server_managed ? (
                  <SettingsSection title="Endpoint and credentials" presentation="compact">
                    <PageBanner tone="info">This connection is server managed. Its source context, endpoint, remote principal, access key, and secret are immutable here.</PageBanner>
                  </SettingsSection>
                ) : !canCreateManualConnections ? (
                  <SettingsSection title="Endpoint and credentials" presentation="compact">
                    <PageBanner tone="info">Endpoint, identity, and credentials are locked because manual private connection creation is not granted. You can still edit the name, tags, and workspace access.</PageBanner>
                  </SettingsSection>
                ) : (
              <SettingsSection title="Credentials" presentation="compact" description="Leave blank to keep current credentials.">
                <div className="settings-stack">
                  <p className="settings-description [overflow-wrap:anywhere]">Current Access Key: <span className="ui-mono">{editingConnection.access_key_id || "-"}</span></p>
                  <S3ConnectionCredentialFields accessKeyId={credentialDraft.access_key_id} secretAccessKey={credentialDraft.secret_access_key}
                    onAccessKeyIdChange={(value) => handleUpdateConnectionCredentialDraft(editingConnection.id, "access_key_id", value)} onSecretAccessKeyChange={(value) => handleUpdateConnectionCredentialDraft(editingConnection.id, "secret_access_key", value)}
                    error={editFormValidation.errorFor("credentials")} />
                  <S3CredentialsValidationMessage validation={editConnectionValidation} />
                </div>
              </SettingsSection>
                )}
              <SettingsSection title="Access" presentation="compact">
                <S3ConnectionAccessFields accessManager={Boolean(draft.access_manager)} accessBrowser={Boolean(draft.access_browser)}
                  onAccessManagerChange={(checked) => handleUpdateConnectionDraft(editingConnection.id, "access_manager", checked)} onAccessBrowserChange={(checked) => handleUpdateConnectionDraft(editingConnection.id, "access_browser", checked)}
                  className="settings-fields" error={editFormValidation.errorFor("access")} />
              </SettingsSection>
              </>;
            })()}
          </SettingsForm>
          {editConnectionCloseGuard.confirmationDialog}
        </WorkflowPage>
      )}
    </div>
  );
}
