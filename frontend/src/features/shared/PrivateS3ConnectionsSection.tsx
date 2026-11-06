/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  ListActions,
  ListActionButton,
  ListSelectionBar,
} from "../../components/list/ListControls";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import ListPageSection from "../../components/list/ListPageSection";
import ToolbarSearchInput from "../../components/ToolbarSearchInput";
import PageBanner from "../../components/PageBanner";
import WorkflowPage from "../../components/WorkflowPage";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { useSettingsBaseline } from "../../components/settings/useSettingsDraft";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import {
  S3Connection,
  createConnection,
  deleteConnection,
  listConnections,
  listPrivateConnectionStorageEndpoints,
  updateConnection,
  validateConnectionCredentials,
} from "../../api/connections";
import type { S3CredentialsValidationPayload } from "../../api/s3CredentialsValidation";
import type { StorageEndpointPublic } from "../../api/storageEndpoints";
import { retryManagedPrivateAccessCleanup } from "../../api/managedPrivateAccess";
import { useLiveS3CredentialsValidation } from "./useLiveS3CredentialsValidation";
import { extractApiError } from "../../utils/apiError";
import { notifyExecutionContextsRefresh } from "../../utils/executionContextRefresh";
import {
  canAccessPrivateConnectionsSection,
  canCreateManualPrivateConnections,
  type SessionUser,
  readStoredUser,
} from "../../utils/workspaces";
import { useTagCatalog } from "../../hooks/useTagCatalog";
import S3ConnectionAccessFields from "./S3ConnectionAccessFields";
import S3ConnectionCredentialFields from "./S3ConnectionCredentialFields";
import SettingsForm from "../../components/settings/SettingsForm";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import S3ConnectionIdentityFields from "./S3ConnectionIdentityFields";
import { useS3ConnectionFormValidation } from "./useS3ConnectionFormValidation";
import S3ConnectionEndpointFields from "./S3ConnectionEndpointFields";
import S3CredentialsValidationMessage from "./S3CredentialsValidationMessage";
import {
  buildCreateS3ConnectionBaseline,
  buildEditPrivateConnectionBaseline,
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
import { useSharedI18n } from "./sharedI18n";
import PrivateS3ConnectionDeleteDialog, {
  type PendingPrivateConnectionDelete,
} from "./PrivateS3ConnectionDeleteDialog";
import PrivateS3ConnectionsTable from "./PrivateS3ConnectionsTable";

type PrivateS3ConnectionsSectionProps = {
  profilePath?: string;
  onUnsavedChangesChange?: (dirty: boolean) => void;
  onWorkflowActiveChange?: (active: boolean) => void;
};

export default function PrivateS3ConnectionsSection({
  profilePath = "/",
  onUnsavedChangesChange,
  onWorkflowActiveChange,
}: PrivateS3ConnectionsSectionProps) {
  const { text: surfaceText } = useSharedI18n();
  const storedUser = useMemo<SessionUser | null>(() => readStoredUser(), []);
  const authType = storedUser?.authType ?? null;
  const isS3Session = authType === "s3_session";
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
  const [bulkConnectionStatusAction, setBulkConnectionStatusAction] = useState<"activate" | "disable" | null>(null);
  const [bulkDeletingConnections, setBulkDeletingConnections] = useState(false);
  const [pendingConnectionDelete, setPendingConnectionDelete] = useState<PendingPrivateConnectionDelete | null>(null);
  const [editingConnectionId, setEditingConnectionId] = useState<number | null>(null);
  const [createConnectionForm, setCreateConnectionForm] = useState(createDefaultPrivateConnectionForm);
  const [createConnectionEndpointMode, setCreateConnectionEndpointMode] = useState<S3ConnectionEndpointMode>("custom");
  const [createConnectionEndpointId, setCreateConnectionEndpointId] = useState("");
  const [editConnectionEndpointMode, setEditConnectionEndpointMode] = useState<S3ConnectionEndpointMode>("custom");
  const [editConnectionEndpointId, setEditConnectionEndpointId] = useState("");
  const [availableStorageEndpoints, setAvailableStorageEndpoints] = useState<StorageEndpointPublic[]>([]);
  const [loadingStorageEndpoints, setLoadingStorageEndpoints] = useState(false);
  const [storageEndpointsError, setStorageEndpointsError] = useState<string | null>(null);
  const [connectionDrafts, setConnectionDrafts] = useState<Record<number, PrivateConnectionDraft>>({});
  const [connectionCredentialDrafts, setConnectionCredentialDrafts] = useState<Record<number, ConnectionCredentialDraft>>(
    {}
  );
  const [connectionsFilter, setConnectionsFilter] = useState("");
  const [connectionsPage, setConnectionsPage] = useState(1);
  const [connectionsPageSize, setConnectionsPageSize] = useState(25);
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

  const createConnectionDraft = useMemo(
    () =>
      buildCreateS3ConnectionBaseline(
        createConnectionForm,
        createConnectionEndpointMode,
        createConnectionEndpointId
      ),
    [createConnectionEndpointId, createConnectionEndpointMode, createConnectionForm]
  );
  const {
    accept: acceptCreateConnectionDraft,
    dirty: createConnectionDraftDirty,
  } = useSettingsBaseline(createConnectionDraft, createConnectionDraft);

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

  const editConnectionDraft = useMemo(() => {
    if (!editingConnection) return null;
    const draft = connectionDrafts[editingConnection.id] ?? buildPrivateConnectionDraft(editingConnection);
    const credentialDraft =
      connectionCredentialDrafts[editingConnection.id] ?? createEmptyConnectionCredentialDraft();
    return buildEditPrivateConnectionBaseline(
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
    editingConnection,
  ]);
  const {
    accept: acceptEditConnectionDraft,
    dirty: editConnectionDraftDirty,
  } = useSettingsBaseline(editConnectionDraft, null);

  const connectionHasUnsavedChanges =
    (showCreateConnectionModal && createConnectionDraftDirty) ||
    (Boolean(editingConnection) && editConnectionDraftDirty);

  const workflowActive = showCreateConnectionModal || Boolean(editingConnection);

  useEffect(() => {
    onUnsavedChangesChange?.(connectionHasUnsavedChanges);
  }, [connectionHasUnsavedChanges, onUnsavedChangesChange]);

  useEffect(() => {
    onWorkflowActiveChange?.(workflowActive);
  }, [onWorkflowActiveChange, workflowActive]);

  const createConnectionCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: showCreateConnectionModal && createConnectionDraftDirty,
    onClose: closeCreateConnectionModal,
    disabled: creatingConnection,
    zIndexClass: "z-[70]",
  });

  const editConnectionCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: Boolean(editingConnection) && editConnectionDraftDirty,
    onClose: closeEditConnectionModal,
    disabled: editingConnection ? savingConnectionBusyId === editingConnection.id : false,
    zIndexClass: "z-[70]",
  });

  useEffect(() => {
    if (!canAccessConnectionsSection) {
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
        setConnectionsError(extractApiError(error, surfaceText("Unable to load private S3 connections.")));
      })
      .finally(() => {
        if (!cancelled) {
          setConnectionsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canAccessConnectionsSection, surfaceText]);

  useEffect(() => {
    if (!canCreateManualConnections) {
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
        setStorageEndpointsError(extractApiError(error, surfaceText("Unable to load configured endpoints.")));
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingStorageEndpoints(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canCreateManualConnections, surfaceText]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(filteredConnections.length / (connectionsPageSize || 1)));
    if (connectionsPage > totalPages) {
      setConnectionsPage(totalPages);
    }
  }, [connectionsPage, connectionsPageSize, filteredConnections.length]);

  useEffect(() => {
    if (editingConnectionId != null && !connections.some((item) => item.id === editingConnectionId)) {
      setEditingConnectionId(null);
    }
  }, [connections, editingConnectionId]);

  useEffect(() => {
    setSelectedConnectionIds((prev) => {
      const next = prev.filter((connectionId) => filteredConnectionIdSet.has(connectionId));
      return next.length === prev.length ? prev : next;
    });
  }, [filteredConnectionIdSet]);

  useEffect(() => {
    setSelectedConnectionIds([]);
  }, [connectionsPage, connectionsPageSize]);

  const refreshConnections = async () => {
    if (!canAccessConnectionsSection) return;
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
      setConnectionsError(extractApiError(error, surfaceText("Unable to refresh private S3 connections.")));
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
    acceptCreateConnectionDraft(
      buildCreateS3ConnectionBaseline(
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
    acceptEditConnectionDraft(
      buildEditPrivateConnectionBaseline(
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
      setConnectionsMessage(surfaceText("Private S3 connection created."));
      await refreshConnections();
      notifyExecutionContextsRefresh();
    } catch (error) {
      console.error(error);
      setConnectionsError(extractApiError(error, surfaceText("Unable to create private S3 connection.")));
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
      setConnectionsMessage(surfaceText("Private S3 connection updated."));
      await refreshConnections();
      notifyExecutionContextsRefresh();
      return true;
    } catch (error) {
      console.error(error);
      setConnectionsError(extractApiError(error, surfaceText("Unable to update private S3 connection.")));
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
      setConnectionsMessage(surfaceText("Private S3 connection deleted."));
      await refreshConnections();
      notifyExecutionContextsRefresh();
    } catch (error) {
      console.error(error);
      setConnectionsError(extractApiError(error, surfaceText("Unable to delete private S3 connection.")));
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
      setConnectionsMessage(surfaceText("Personal access cleanup completed."));
      await refreshConnections();
      notifyExecutionContextsRefresh();
    } catch (error) {
      console.error(error);
      setConnectionsError(extractApiError(error, surfaceText("Unable to complete personal access cleanup.")));
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

  const handleBulkPrivateConnectionStatusChange = async (action: "activate" | "disable") => {
    if (!canAccessConnectionsSection || selectedFilteredConnectionIds.length === 0) return;
    const activating = action === "activate";
    setConnectionsError(null);
    setConnectionsMessage(null);
    setBulkConnectionStatusAction(action);
    try {
      const results = await Promise.allSettled(
        selectedFilteredConnectionIds.map((connectionId) =>
          updateConnection(connectionId, { is_active: activating }),
        ),
      );
      const failedIds = selectedFilteredConnectionIds.filter((_, index) => results[index].status === "rejected");
      const successCount = selectedFilteredConnectionIds.length - failedIds.length;
      setSelectedConnectionIds(failedIds);
      if (successCount > 0) {
        await refreshConnections();
        notifyExecutionContextsRefresh();
      }
      if (failedIds.length > 0) {
        setConnectionsError(surfaceText(
          failedIds.length === 1
            ? activating
              ? "{count} private connection failed to activate."
              : "{count} private connection failed to disable."
            : activating
              ? "{count} private connections failed to activate."
              : "{count} private connections failed to disable.",
          { count: failedIds.length },
        ));
      }
      setConnectionsMessage(
        surfaceText(
          successCount === 1
            ? activating
              ? "{count} private connection activated."
              : "{count} private connection disabled."
            : activating
              ? "{count} private connections activated."
              : "{count} private connections disabled.",
          { count: successCount },
        ) + (failedIds.length > 0
          ? ` ${surfaceText("{count} failed.", { count: failedIds.length })}`
          : "")
      );
    } finally {
      setBulkConnectionStatusAction(null);
    }
  };

  const handleTogglePrivateConnectionStatus = async (connection: S3Connection) => {
    if (!canAccessConnectionsSection) return;
    const nextIsActive = !connection.is_active;
    setConnectionsError(null);
    setConnectionsMessage(null);
    setTogglingConnectionBusyId(connection.id);
    try {
      await updateConnection(connection.id, { is_active: nextIsActive });
      setConnectionsMessage(surfaceText(
        nextIsActive ? "Private S3 connection activated." : "Private S3 connection disabled.",
      ));
      await refreshConnections();
      notifyExecutionContextsRefresh();
    } catch (error) {
      console.error(error);
      setConnectionsError(extractApiError(error, surfaceText("Unable to update private S3 connection.")));
    } finally {
      setTogglingConnectionBusyId(null);
    }
  };

  const bulkActivatingConnections = bulkConnectionStatusAction === "activate";
  const bulkDisablingConnections = bulkConnectionStatusAction === "disable";

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
        setConnectionsError(surfaceText(
          failedIds.length === 1
            ? "{count} private connection failed to delete."
            : "{count} private connections failed to delete.",
          { count: failedIds.length },
        ));
      }
      setConnectionsMessage(
        surfaceText(
          successCount === 1
            ? "{count} private connection deleted."
            : "{count} private connections deleted.",
          { count: successCount },
        ) + (failedIds.length > 0
          ? ` ${surfaceText("{count} failed.", { count: failedIds.length })}`
          : "")
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

  return (
    <>
      <section className="settings-compact">
        <div className="space-y-4">
          {!canCreateManualConnections && (
            <PageBanner tone="info">
              {surfaceText("Creation, endpoint changes, identity changes, and credential replacement are disabled. Existing connections remain available for metadata, workspace access, activation, cleanup, and deletion.")}</PageBanner>
          )}
            <>
              {connectionsError && <PageBanner tone="error">{connectionsError}</PageBanner>}
              {connectionsMessage && <PageBanner tone="success">{connectionsMessage}</PageBanner>}
              <ListPageSection
                variant="section"
                title={surfaceText("Private S3 connections")}
                countLabel={surfaceText(
                  filteredConnections.length === connections.length
                    ? "{count} connections shown"
                    : "{count} connections shown of {total}",
                  {
                    count: filteredConnections.length,
                    total: connections.length,
                  },
                )}
                search={(
                  <ToolbarSearchInput
                    value={connectionsFilter}
                    onChange={handleConnectionsFilterChange}
                    placeholder={surfaceText("Name, endpoint, provider, tag...")}
                    label={surfaceText("Search connections")}
                  />
                )}
                headingActions={
                  canCreateManualConnections && !showCreateConnectionModal && !editingConnection ? (
                    <ListActionButton variant="primary" onClick={openCreateConnectionModal}>
                      {surfaceText("Add connection")}
                    </ListActionButton>
                  ) : null
                }
              >
                {selectedFilteredConnectionIds.length > 0 && (
                  <ListSelectionBar>
                    <span className="ui-list-selection-summary">
                      {surfaceText("{count} selected", { count: selectedFilteredConnectionIds.length })}
                      {hiddenSelectedConnectionCount > 0
                        ? ` (${surfaceText("{count} not visible", { count: hiddenSelectedConnectionCount })})`
                        : ""}
                    </span>
                    <ListActions>
                      <ListActionButton
                        type="button"
                        onClick={() => void handleBulkPrivateConnectionStatusChange("activate")}
                        disabled={bulkActivatingConnections || bulkDisablingConnections || bulkDeletingConnections}
                      >
                        {surfaceText(bulkActivatingConnections ? "Activating..." : "Activate selected")}
                      </ListActionButton>
                      <ListActionButton
                        type="button"
                        onClick={() => void handleBulkPrivateConnectionStatusChange("disable")}
                        disabled={bulkActivatingConnections || bulkDisablingConnections || bulkDeletingConnections}
                      >
                        {surfaceText(bulkDisablingConnections ? "Disabling..." : "Disable selected")}
                      </ListActionButton>
                      <ListActionButton
                        type="button"
                         variant="danger"
                        onClick={handleBulkDeletePrivateConnections}
                        disabled={bulkActivatingConnections || bulkDisablingConnections || bulkDeletingConnections}
                      >
                        {surfaceText(bulkDeletingConnections ? "Deleting..." : "Delete selected")}
                      </ListActionButton>
                    </ListActions>
                  </ListSelectionBar>
                )}
                <PrivateS3ConnectionsTable
                  connectionsLoading={connectionsLoading}
                  pagedConnections={pagedConnections}
                  filteredConnectionCount={filteredConnections.length}
                  filteredConnectionIds={filteredConnectionIds}
                  selectedFilteredConnectionIdSet={selectedFilteredConnectionIdSet}
                  allFilteredConnectionsSelected={allFilteredConnectionsSelected}
                  storageEndpointLabelById={storageEndpointLabelById}
                  deletingConnectionBusyId={deletingConnectionBusyId}
                  togglingConnectionBusyId={togglingConnectionBusyId}
                  bulkActivatingConnections={bulkActivatingConnections}
                  bulkDisablingConnections={bulkDisablingConnections}
                  bulkDeletingConnections={bulkDeletingConnections}
                  page={connectionsPage}
                  pageSize={connectionsPageSize}
                  onToggleSelectAll={toggleSelectAllFilteredConnections}
                  onToggleSelection={togglePrivateConnectionSelection}
                  onRetryCleanup={handleRetryManagedCleanup}
                  onToggleStatus={handleTogglePrivateConnectionStatus}
                  onEdit={openEditConnectionModal}
                  onDelete={handleDeletePrivateConnection}
                  onPageChange={(page) => {
                    setConnectionsPage(Math.max(1, page));
                    setSelectedConnectionIds([]);
                  }}
                  onPageSizeChange={(size) => {
                    setConnectionsPageSize(size);
                    setSelectedConnectionIds([]);
                    setConnectionsPage(1);
                  }}
                />
              </ListPageSection>
            </>
        </div>
      </section>

      {pendingConnectionDelete && (
        <PrivateS3ConnectionDeleteDialog
          pendingDelete={pendingConnectionDelete}
          bulkDeleting={bulkDeletingConnections}
          deletingConnectionBusyId={deletingConnectionBusyId}
          onCancel={() => setPendingConnectionDelete(null)}
          onConfirm={confirmPendingConnectionDelete}
        />
      )}

      {canCreateManualConnections && showCreateConnectionModal && (
        <WorkflowPage
          title={surfaceText("Add private S3 connection")}
          description={surfaceText("Configure endpoint access, credentials, and workspace availability for this private connection.")}
          breadcrumbs={[
            { label: surfaceText("Profile"), to: profilePath },
            { label: surfaceText("Private connections"), to: `${profilePath}?tab=connections` },
            { label: surfaceText("Create") },
          ]}
          backLabel={surfaceText("Back to connections")}
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
          <SettingsForm label={surfaceText("Create private S3 connection")} onSubmit={handleCreatePrivateConnection} busy={creatingConnection}
            onCancel={createConnectionCloseGuard.requestClose} submitLabel={surfaceText("Create connection")} busyLabel={surfaceText("Creating...")}>
              <S3ConnectionIdentityFields name={createConnectionForm.name} onNameChange={(name) => setCreateConnectionForm((current) => ({ ...current, name }))}
                nameError={createFormValidation.errorFor("name")} catalogError={privateTagCatalogError}
                tagEditor={{ tags: createConnectionForm.tags, catalog: privateTagCatalog, onChange: (tags) => setCreateConnectionForm((current) => ({ ...current, tags })),
                  catalogMode: "private", placeholder: surfaceText("Add a tag for this private connection"), disabled: creatingConnection,
                  hint: privateTagCatalogLoading ? surfaceText("Loading existing private tags...") : undefined }} />
              <S3ConnectionEndpointFields mode={createConnectionEndpointMode}
                onModeChange={(mode) => { setCreateConnectionEndpointMode(mode); if (mode === "preset") setCreateConnectionEndpointId(preferredS3ConnectionEndpointId(createConnectionEndpointId, availableStorageEndpoints)); }}
                modeInputName="create-connection-endpoint-mode" endpointId={createConnectionEndpointId}
                onEndpointIdChange={setCreateConnectionEndpointId} endpoints={availableStorageEndpoints} loadingEndpoints={loadingStorageEndpoints}
                form={createConnectionForm} onFormChange={(field, value) => setCreateConnectionForm((current) => ({ ...current, [field]: value }))}
                endpointIdError={createFormValidation.errorFor("endpointId")} endpointUrlError={createFormValidation.errorFor("endpointUrl")}
                errorMessage={storageEndpointsError
                  ? surfaceText("Unable to load configured endpoints ({error}). Use custom mode.", { error: storageEndpointsError })
                  : null} />
              <SettingsSection title={surfaceText("Credentials")} presentation="compact">
                <div className="settings-stack">

                  <S3ConnectionCredentialFields accessKeyId={createConnectionForm.access_key_id} secretAccessKey={createConnectionForm.secret_access_key}
                    onAccessKeyIdChange={(value) => setCreateConnectionForm((current) => ({ ...current, access_key_id: value }))} onSecretAccessKeyChange={(value) => setCreateConnectionForm((current) => ({ ...current, secret_access_key: value }))}
                    error={createFormValidation.errorFor("credentials")} required accessKeyLabel={surfaceText("Access key ID")} secretAccessKeyLabel={surfaceText("Secret access key")} />
                  <S3CredentialsValidationMessage validation={createConnectionValidation} />
                </div>
              </SettingsSection>
              <SettingsSection title={surfaceText("Access")} presentation="compact">
                <S3ConnectionAccessFields accessManager={Boolean(createConnectionForm.access_manager)} accessBrowser={Boolean(createConnectionForm.access_browser)}
                  onAccessManagerChange={(checked) => setCreateConnectionForm((current) => ({ ...current, access_manager: checked }))} onAccessBrowserChange={(checked) => setCreateConnectionForm((current) => ({ ...current, access_browser: checked }))}
                  className="settings-fields" error={createFormValidation.errorFor("access")} />
              </SettingsSection>
          </SettingsForm>
          {createConnectionCloseGuard.confirmationDialog}
        </WorkflowPage>
      )}

      {editingConnection && (
        <WorkflowPage
          title={surfaceText("Edit connection - {connection}", { connection: editingConnection.name })}
          description={editingConnection.server_managed
            ? surfaceText("Manage the name, tags, status, and workspace availability. Endpoint and credentials are controlled by server provisioning.")
            : surfaceText("Manage endpoint access, credentials, and workspace availability for this private connection.")}
          breadcrumbs={[
            { label: surfaceText("Profile"), to: profilePath },
            { label: surfaceText("Private connections"), to: `${profilePath}?tab=connections` },
            { label: surfaceText("Edit") },
          ]}
          backLabel={surfaceText("Back to connections")}
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
          <SettingsForm label={surfaceText("Edit private S3 connection")} busy={savingConnectionBusyId === editingConnection.id}
            onCancel={editConnectionCloseGuard.requestClose} submitLabel={surfaceText("Save")} busyLabel={surfaceText("Saving...")}
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
                  catalogMode: "private", placeholder: surfaceText("Add a tag for this private connection"), disabled: savingConnectionBusyId === editingConnection.id,
                  hint: privateTagCatalogLoading ? surfaceText("Loading existing private tags...") : undefined }} />
                {canCreateManualConnections && !editingConnection.server_managed && (
              <S3ConnectionEndpointFields mode={editConnectionEndpointMode}
                onModeChange={(mode) => { setEditConnectionEndpointMode(mode); if (mode === "preset") setEditConnectionEndpointId(preferredS3ConnectionEndpointId(editConnectionEndpointId, availableStorageEndpoints)); }}
                modeInputName="edit-connection-endpoint-mode" endpointId={editConnectionEndpointId}
                onEndpointIdChange={setEditConnectionEndpointId} endpoints={availableStorageEndpoints} loadingEndpoints={loadingStorageEndpoints}
                form={draft} onFormChange={(field, value) => handleUpdateConnectionDraft(editingConnection.id, field, value)}
                endpointIdError={editFormValidation.errorFor("endpointId")} endpointUrlError={editFormValidation.errorFor("endpointUrl")}
                errorMessage={storageEndpointsError
                  ? surfaceText("Unable to load configured endpoints ({error}). Use custom mode.", { error: storageEndpointsError })
                  : null} />
                )}
                {editingConnection.server_managed ? (
                  <SettingsSection title={surfaceText("Endpoint and credentials")} presentation="compact">
                    <PageBanner tone="info">{surfaceText("This connection is server managed. Its source context, endpoint, remote principal, access key, and secret are immutable here.")}</PageBanner>
                  </SettingsSection>
                ) : !canCreateManualConnections ? (
                  <SettingsSection title={surfaceText("Endpoint and credentials")} presentation="compact">
                    <PageBanner tone="info">{surfaceText("Endpoint, identity, and credentials are locked because manual private connection creation is not granted. You can still edit the name, tags, and workspace access.")}</PageBanner>
                  </SettingsSection>
                ) : (
              <SettingsSection title={surfaceText("Credentials")} presentation="compact" description={surfaceText("Leave blank to keep current credentials.")}>
                <div className="settings-stack">
                  <p className="settings-description [overflow-wrap:anywhere]">{surfaceText("Current Access Key:")}<span className="ui-mono">{editingConnection.access_key_id || "-"}</span></p>
                  <S3ConnectionCredentialFields accessKeyId={credentialDraft.access_key_id} secretAccessKey={credentialDraft.secret_access_key}
                    onAccessKeyIdChange={(value) => handleUpdateConnectionCredentialDraft(editingConnection.id, "access_key_id", value)} onSecretAccessKeyChange={(value) => handleUpdateConnectionCredentialDraft(editingConnection.id, "secret_access_key", value)}
                    error={editFormValidation.errorFor("credentials")} />
                  <S3CredentialsValidationMessage validation={editConnectionValidation} />
                </div>
              </SettingsSection>
                )}
              <SettingsSection title={surfaceText("Access")} presentation="compact">
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
    </>
  );
}
