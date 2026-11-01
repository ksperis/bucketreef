/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { useCallback, useEffect, useState } from "react";

import {
  deleteStorageEndpoint,
  fetchStorageEndpointsMeta,
  listStorageEndpoints,
  setDefaultStorageEndpoint,
  type StorageEndpoint,
} from "../../api/storageEndpoints";
import { extractApiError } from "../../utils/apiError";
import { useStorageEndpointI18n } from "./storageEndpointMessages";

type Args = {
  canEditEndpoints: boolean;
  mutationPending: { current: boolean };
};

export default function useAdminStorageEndpointsListController({
  canEditEndpoints,
  mutationPending,
}: Args) {
  const { text } = useStorageEndpointI18n();
  const extractLocalizedError = useCallback(
    (err: unknown) => extractApiError(err, text("genericError")),
    [text],
  );
  const [endpoints, setEndpoints] = useState<StorageEndpoint[]>([]);
  const [envManaged, setEnvManaged] = useState(false);
  const [metadataReady, setMetadataReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [defaultError, setDefaultError] = useState<string | null>(null);
  const [defaultBusyId, setDefaultBusyId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StorageEndpoint | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const loadEndpoints = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMetadataReady(false);
    const [data, meta] = await Promise.allSettled([listStorageEndpoints(), fetchStorageEndpointsMeta()]);
    if (data.status === "fulfilled") setEndpoints(data.value);
    if (meta.status === "fulfilled") {
      setEnvManaged(Boolean(meta.value.managed_by_env));
      setMetadataReady(true);
    }
    if (data.status === "rejected") setError(extractLocalizedError(data.reason));
    else if (meta.status === "rejected") {
      setError(text("managementModeUnavailable", { error: extractLocalizedError(meta.reason) }));
    }
    setLoading(false);
  }, [extractLocalizedError, text]);

  useEffect(() => {
    void loadEndpoints();
  }, [loadEndpoints]);

  const upsertEndpoint = useCallback((endpoint: StorageEndpoint) => {
    setEndpoints((previous) => [
      ...previous.filter((candidate) => candidate.id !== endpoint.id),
      endpoint,
    ]);
  }, []);

  const openDelete = useCallback((endpoint: StorageEndpoint) => {
    setDeleteTarget(endpoint);
    setDeleteError(null);
  }, []);

  const closeDelete = useCallback(() => {
    setDeleteTarget(null);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!metadataReady || envManaged || !canEditEndpoints || mutationPending.current) return;
    if (!deleteTarget?.is_editable) return;
    mutationPending.current = true;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteStorageEndpoint(deleteTarget.id);
      setDeleteTarget(null);
      setActionMessage(text("endpointDeleted"));
      await loadEndpoints();
    } catch (err) {
      setDeleteError(extractLocalizedError(err));
    } finally {
      mutationPending.current = false;
      setDeleteBusy(false);
    }
  }, [canEditEndpoints, deleteTarget, envManaged, extractLocalizedError, loadEndpoints, metadataReady, mutationPending, text]);

  const handleSetDefault = useCallback(async (endpoint: StorageEndpoint) => {
    if (!metadataReady || envManaged || !canEditEndpoints || mutationPending.current) return;
    if (endpoint.is_default) return;
    mutationPending.current = true;
    setDefaultError(null);
    setDefaultBusyId(endpoint.id);
    try {
      await setDefaultStorageEndpoint(endpoint.id);
      setActionMessage(text("defaultEndpointUpdated"));
      await loadEndpoints();
    } catch (err) {
      setDefaultError(extractLocalizedError(err));
    } finally {
      mutationPending.current = false;
      setDefaultBusyId(null);
    }
  }, [canEditEndpoints, envManaged, extractLocalizedError, loadEndpoints, metadataReady, mutationPending, text]);

  return {
    endpoints,
    envManaged,
    metadataReady,
    loading,
    error,
    actionMessage,
    setActionMessage,
    defaultError,
    defaultBusyId,
    deleteTarget,
    deleteError,
    deleteBusy,
    loadEndpoints,
    upsertEndpoint,
    openDelete,
    closeDelete,
    handleDelete,
    handleSetDefault,
  };
}
