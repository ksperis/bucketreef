/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { useCallback, useEffect, useMemo, useState } from "react";

import { isRecentWebAuthnVerificationCancelled } from "../../auth/useRecentWebAuthnStepUp";
import {
  type S3ConnectionAdminItem,
  deleteAdminS3Connection,
  listAdminS3Connections,
  updateAdminS3Connection,
} from "../../api/s3ConnectionsAdmin";
import { extractApiError } from "../../utils/apiError";
import { collectPaginatedItems } from "../../utils/pagination";
import type { TextMatchMode } from "../../utils/textMatch";
import type { S3ConnectionBulkStatusAction } from "./AdminS3ConnectionsList";
import { useAdminI18n } from "./adminI18n";
import useAdminPaginatedListController from "./useAdminPaginatedListController";

type RunWithStepUp = <T>(operation: () => Promise<T>) => Promise<T>;

type Args = {
  filter: string;
  quickFilterMode: TextMatchMode;
  page: number;
  pageSize: number;
  ensurePageInRange: (total: number) => boolean;
  runWithStepUp: RunWithStepUp;
};

export default function useAdminS3ConnectionsListController({
  filter,
  quickFilterMode,
  page,
  pageSize,
  ensurePageInRange,
  runWithStepUp,
}: Args) {
  const { text: adminText } = useAdminI18n();
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkStatusAction, setBulkStatusAction] = useState<S3ConnectionBulkStatusAction | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  const [selectAllFilteredBusy, setSelectAllFilteredBusy] = useState(false);
  const [allFilteredSelectableIds, setAllFilteredSelectableIds] = useState<number[] | null>(null);
  const [allFilteredSelectableIdsKey, setAllFilteredSelectableIdsKey] = useState<string | null>(null);

  const selectionQueryKey = useMemo(
    () =>
      JSON.stringify({
        filter: filter.trim() || null,
        matchMode: quickFilterMode,
      }),
    [filter, quickFilterMode],
  );

  const invalidateSelectionCache = useCallback(() => {
    setAllFilteredSelectableIds(null);
    setAllFilteredSelectableIdsKey(null);
  }, []);

  const loadPage = useCallback(() => {
    const quick = filter.trim();
    return listAdminS3Connections({
      page,
      page_size: pageSize,
      search: quick || undefined,
      search_exact: quickFilterMode === "exact",
    });
  }, [filter, page, pageSize, quickFilterMode]);
  const formatLoadError = useCallback(
    (err: unknown) => extractApiError(err, adminText("Unexpected error")),
    [adminText],
  );
  const {
    items,
    loading,
    error,
    total,
    setError,
    refresh: refreshItems,
  } = useAdminPaginatedListController({
    loadPage,
    ensurePageInRange,
    formatError: formatLoadError,
    onLoaded: invalidateSelectionCache,
  });

  useEffect(() => {
    invalidateSelectionCache();
  }, [invalidateSelectionCache, selectionQueryKey]);

  useEffect(() => {
    setSelectedIds([]);
  }, [page, pageSize]);

  const loadAllSelectableFilteredIds = useCallback(async () => {
    if (allFilteredSelectableIdsKey === selectionQueryKey && allFilteredSelectableIds) {
      return allFilteredSelectableIds;
    }
    const allItems = await collectPaginatedItems((nextPage) =>
      listAdminS3Connections({
        page: nextPage,
        page_size: 200,
        search: filter.trim() || undefined,
        search_exact: quickFilterMode === "exact",
      }),
    );
    const resolved = Array.from(new Set(allItems.map((item) => item.id)).values());
    setAllFilteredSelectableIds(resolved);
    setAllFilteredSelectableIdsKey(selectionQueryKey);
    return resolved;
  }, [allFilteredSelectableIds, allFilteredSelectableIdsKey, filter, quickFilterMode, selectionQueryKey]);

  const setSelectionForFilteredResults = useCallback(
    async (checked: boolean) => {
      setSelectAllFilteredBusy(true);
      setError(null);
      try {
        const selectableFilteredIds = await loadAllSelectableFilteredIds();
        setSelectedIds(checked ? selectableFilteredIds : []);
      } catch (err) {
        setError(extractApiError(err, adminText("Unexpected error")));
      } finally {
        setSelectAllFilteredBusy(false);
      }
    },
    [adminText, loadAllSelectableFilteredIds, setError],
  );

  const toggleRowSelection = useCallback((connectionId: number) => {
    setSelectedIds((current) =>
      current.includes(connectionId)
        ? current.filter((id) => id !== connectionId)
        : [...current, connectionId],
    );
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
  }, []);

  const removeSelectedId = useCallback((connectionId: number) => {
    setSelectedIds((current) => current.filter((id) => id !== connectionId));
  }, []);

  const submitToggleConnectionStatus = useCallback(async (conn: S3ConnectionAdminItem) => {
    if (conn.execution_status === "remediation_required") {
      setStatusBusyId(conn.id);
      setError(null);
      try {
        await runWithStepUp(() => updateAdminS3Connection(conn.id, {
          remediation_action: "activate_manager",
        }));
        setActionMessage(adminText("Connection remediated and activated for Manager."));
        await refreshItems();
      } catch (err) {
        if (!isRecentWebAuthnVerificationCancelled(err)) {
          setError(extractApiError(err, adminText("Unexpected error")));
        }
      } finally {
        setStatusBusyId(null);
      }
      return;
    }

    const nextIsActive = !conn.is_active;
    setStatusBusyId(conn.id);
    setError(null);
    setActionMessage(null);
    try {
      await (nextIsActive
        ? runWithStepUp(() => updateAdminS3Connection(conn.id, { is_active: true }))
        : updateAdminS3Connection(conn.id, { is_active: false }));
      setActionMessage(adminText(nextIsActive ? "Connection activated." : "Connection disabled."));
      await refreshItems();
    } catch (err) {
      if (!isRecentWebAuthnVerificationCancelled(err)) {
        setError(extractApiError(err, adminText("Unexpected error")));
      }
    } finally {
      setStatusBusyId(null);
    }
  }, [adminText, refreshItems, runWithStepUp, setError]);

  const submitBulkStatusChange = useCallback(async (action: S3ConnectionBulkStatusAction) => {
    if (selectedIds.length === 0 || bulkStatusAction !== null) return;
    const connectionIds = [...selectedIds];
    setBulkStatusAction(action);
    setError(null);
    setActionMessage(null);
    const failedIds: number[] = [];
    try {
      if (action === "disable") {
        const results = await Promise.allSettled(
          connectionIds.map((connectionId) => updateAdminS3Connection(connectionId, { is_active: false })),
        );
        connectionIds.forEach((connectionId, index) => {
          if (results[index].status === "rejected") failedIds.push(connectionId);
        });
      } else {
        for (const connectionId of connectionIds) {
          try {
            const connection = items.find((item) => item.id === connectionId);
            await runWithStepUp(() => connection?.execution_status === "remediation_required"
              ? updateAdminS3Connection(connectionId, {
                  remediation_action: "activate_manager",
                })
              : updateAdminS3Connection(connectionId, { is_active: true }));
          } catch (err) {
            if (isRecentWebAuthnVerificationCancelled(err)) return;
            failedIds.push(connectionId);
          }
        }
      }
      const successCount = connectionIds.length - failedIds.length;
      const completedAction = action === "activate" ? "activated" : "disabled";
      setSelectedIds(failedIds);
      if (successCount > 0) {
        await refreshItems();
      }
      if (failedIds.length > 0) {
        setError(`${failedIds.length} connection${failedIds.length > 1 ? "s" : ""} could not be ${completedAction}.`);
      }
      setActionMessage(
        `${successCount} connection${successCount > 1 ? "s" : ""} ${completedAction}.` +
          (failedIds.length > 0 ? ` ${failedIds.length} failed.` : ""),
      );
    } finally {
      setBulkStatusAction(null);
    }
  }, [bulkStatusAction, items, refreshItems, runWithStepUp, selectedIds, setError]);

  const submitBulkDelete = useCallback(async () => {
    if (bulkDeleteBusy) return;
    if (selectedIds.length === 0) {
      setBulkDeleteOpen(false);
      return;
    }
    setBulkDeleteBusy(true);
    setError(null);
    setActionMessage(null);
    const results = await Promise.allSettled(
      selectedIds.map((connectionId) => deleteAdminS3Connection(connectionId)),
    );
    const failedIds = selectedIds.filter((_, index) => results[index].status === "rejected");
    const successCount = selectedIds.length - failedIds.length;
    setSelectedIds(failedIds);
    setBulkDeleteOpen(false);
    if (successCount > 0) {
      await refreshItems();
    }
    if (failedIds.length > 0) {
      setError(`${failedIds.length} connection${failedIds.length > 1 ? "s" : ""} could not be deleted.`);
    }
    setActionMessage(
      `${successCount} connection${successCount > 1 ? "s" : ""} deleted.` +
        (failedIds.length > 0 ? ` ${failedIds.length} failed.` : ""),
    );
    setBulkDeleteBusy(false);
  }, [bulkDeleteBusy, refreshItems, selectedIds, setError]);

  return {
    items,
    loading,
    error,
    total,
    actionMessage,
    setActionMessage,
    selectedIds,
    resolvedFilteredSelectableIds:
      allFilteredSelectableIdsKey === selectionQueryKey ? allFilteredSelectableIds : null,
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
    openBulkDelete: () => setBulkDeleteOpen(true),
    closeBulkDelete: () => setBulkDeleteOpen(false),
    submitBulkDelete,
  };
}
