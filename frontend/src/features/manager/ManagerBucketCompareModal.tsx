/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useMemo, useState } from "react";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import PaginationControls from "../../components/PaginationControls";
import BucketCompareSetup, { BucketCompareProgress } from "../shared/BucketCompareSetup";
import WorkflowPage from "../../components/WorkflowPage";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import { ListActionButton } from "../../components/list/ListControls";
import UiButton from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import {
  BucketCompareConfigDiff,
  BucketCompareContentDiff,
  BucketCompareFeedback,
  BucketCompareResult,
  BucketCompareResultFilters,
  type BucketCompareFeedbackTone,
} from "../shared/BucketCompareResults";
import UiSelect from "../../components/ui/UiSelect";
import { proxyDownload } from "../../api/browserTransfers";
import { runWithConcurrencySettled } from "../../utils/concurrency";
import {
  compareManagerBucketPair,
  listBucketOptions,
  ManagerBucketCompareAction,
  ManagerBucketCompareActionResult,
  ManagerBucketCompareResult,
  runManagerBucketCompareAction,
} from "../../api/managerBuckets";
import type {
  BucketCompareConfigFeature,
  BucketCompareObjectDetail,
} from "../../api/bucketCompareContracts";
import {
  listExecutionContextOptions,
  type ExecutionContext,
} from "../../api/executionContexts";
import {
  BUCKET_COMPARE_CONFIG_FEATURE_OPTIONS,
  extractCompareError,
  matchesBucketCompareRunFilters,
  normalizeBucketCompareParallelism,
  resolveBucketCompareRunError,
  summarizeBucketCompareRun,
  useBucketCompareWorkflowState,
} from "../shared/bucketCompareShared";
import { BucketCompareManualMappingEditor } from "../shared/bucketCompareMapping";
import {
  getObjectParentPrefix,
  type BucketCompareContentSection,
  type CompareVisibleKeysCopyFeedback,
} from "../shared/bucketCompareContentDiff";
import {
  formatDownloadTimestamp,
  triggerBlobDownload,
  triggerJsonDownload,
} from "../../utils/download";
import { useManagerI18n } from "./managerI18n";
import usePaginatedOptions from "../../hooks/usePaginatedOptions";

const isDemo = import.meta.env.MODE === "demo";

type CompareRunItem = {
  sourceBucket: string;
  targetBucket: string;
  status: "pending" | "running" | "success" | "failed" | "cancelled";
  result?: ManagerBucketCompareResult;
  error?: string;
  actionRunning?: ManagerBucketCompareAction | null;
  actionFeedback?: {
    tone: BucketCompareFeedbackTone;
    message: string;
  } | null;
};

type CompareRunOptionsSnapshot = {
  targetContextId: string;
  includeContent: boolean;
  includeConfig: boolean;
  configFeatures: BucketCompareConfigFeature[];
  ignoreModifiedAfterIso: string | null;
};

type RemediationSectionKey = "source_only" | "different" | "target_only";

type PendingRemediationAction = {
  itemIndex: number;
  action: ManagerBucketCompareAction;
  objectKeys: string[];
  visibleOnly?: boolean;
};

type ManagerBucketCompareModalProps = {
  sourceContextId: string;
  sourceContextName?: string | null;
  sourceBuckets: string[];
  contexts: ExecutionContext[];
  managerBrowserEnabled?: boolean;
  onClose: () => void;
};

const downloadFilenameFromKey = (key: string) => {
  const filename = key.split("/").filter(Boolean).pop();
  return filename || "download";
};

const remediationActionLabel: Record<ManagerBucketCompareAction, string> = {
  sync_source_only: "Sync all missing",
  sync_different: "Sync all different",
  delete_target_only: "Delete all extra",
};

const remediationVisibleActionLabel: Record<ManagerBucketCompareAction, string> = {
  sync_source_only: "Sync visible missing",
  sync_different: "Sync visible different",
  delete_target_only: "Delete visible extra",
};

const remediationActionTitle: Record<ManagerBucketCompareAction, string> = {
  sync_source_only: "Confirm sync missing objects",
  sync_different: "Confirm sync different objects",
  delete_target_only: "Confirm delete extra objects",
};

const remediationSingleActionLabel: Record<ManagerBucketCompareAction, string> = {
  sync_source_only: "Sync this object",
  sync_different: "Sync this object",
  delete_target_only: "Delete this object",
};

const remediationSectionActionMap: Record<RemediationSectionKey, ManagerBucketCompareAction> = {
  source_only: "sync_source_only",
  different: "sync_different",
  target_only: "delete_target_only",
};

const ALL_CONFIG_FEATURE_KEYS = BUCKET_COMPARE_CONFIG_FEATURE_OPTIONS.map((option) => option.key);

export default function ManagerBucketCompareModal({
  sourceContextId,
  sourceContextName,
  sourceBuckets,
  contexts,
  managerBrowserEnabled = true,
  onClose,
}: ManagerBucketCompareModalProps) {
  const { text } = useManagerI18n();
  const sortedSourceBuckets = useMemo(() => [...sourceBuckets].sort((a, b) => a.localeCompare(b)), [sourceBuckets]);
  const [targetContextId, setTargetContextId] = useState<string | null>(null);
  const [lastRunOptions, setLastRunOptions] = useState<CompareRunOptionsSnapshot | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingRemediationAction | null>(null);
  const [downloadFeedback, setDownloadFeedback] = useState<(CompareVisibleKeysCopyFeedback & { id: string }) | null>(null);
  const [downloadInFlight, setDownloadInFlight] = useState<string | null>(null);
  const sameContextSelected = targetContextId === sourceContextId;
  const loadTargetContexts = useCallback(
    (query: { page?: number; page_size?: number; search?: string }) =>
      listExecutionContextOptions("manager", query),
    [],
  );
  const targetContextCatalog = usePaginatedOptions(loadTargetContexts, { initialPageSize: 25 });
  const selectedTargetContext = useMemo(
    () => contexts.find((context) => context.id === targetContextId) ?? null,
    [contexts, targetContextId],
  );
  const targetContextOptions = useMemo(() => {
    const items = [...targetContextCatalog.items];
    if (selectedTargetContext && !items.some((context) => context.id === selectedTargetContext.id)) {
      items.unshift(selectedTargetContext);
    }
    return items;
  }, [selectedTargetContext, targetContextCatalog.items]);
  const loadTargetBuckets = useCallback(
    (query: { page?: number; page_size?: number; search?: string }) => {
      if (!targetContextId) {
        return Promise.resolve({ items: [], total: 0, page: 1, page_size: query.page_size ?? 25, has_next: false });
      }
      return listBucketOptions(targetContextId, query);
    },
    [targetContextId],
  );
  const targetBucketCatalog = usePaginatedOptions(loadTargetBuckets, {
    enabled: Boolean(targetContextId),
    initialPageSize: 25,
  });
  const targetBucketNames = useMemo(
    () => targetBucketCatalog.items.map((bucket) => bucket.name),
    [targetBucketCatalog.items],
  );
  const {
    mappingMode,
    setMappingMode,
    includeContent,
    setIncludeContent,
    includeConfig,
    setIncludeConfig,
    ignoreModifiedAfter,
    setIgnoreModifiedAfter,
    parallelism,
    setParallelism,
    running,
    stopping,
    runError,
    setRunError,
    resultSearch,
    setResultSearch,
    statusFilter,
    setStatusFilter,
    diffFilter,
    setDiffFilter,
    resultFilters,
    resetResultFilters,
    manualMapping,
    parsedRawMapping,
    rawMappingText,
    setManualMapping,
    setRawMappingText,
    selectedConfigFeatures,
    setSelectedConfigFeatures,
    toggleConfigFeature,
    items,
    progress,
    progressPercent,
    availableTargetBucketNames,
    resolvedManualMapping,
    comparePlan,
    hasScopeSelected,
    hasConfigFeatureSelected,
    ignoreModifiedAfterIso,
    ignoreModifiedAfterInvalid,
    setItems,
    settleRunItem,
    beginRun,
    executeRunItem,
    finishRun,
    stopRun,
    copyFeedback,
    copyVisibleKeys,
  } = useBucketCompareWorkflowState<
    BucketCompareConfigFeature,
    ManagerBucketCompareResult,
    CompareRunItem
  >({
    targetSelected: Boolean(targetContextId),
    targetKind: "context",
    sourceBuckets: sortedSourceBuckets,
    targetBuckets: targetBucketNames,
    targetInventoryComplete: false,
    sameTargetSelected: sameContextSelected,
    configFeatures: ALL_CONFIG_FEATURE_KEYS,
  });

  const contextDisplayNameById = useMemo(() => {
    const byId = new Map<string, string>();
    contexts.forEach((context) => {
      byId.set(context.id, context.display_name || context.id);
    });
    byId.set(sourceContextId, sourceContextName ?? sourceContextId);
    return byId;
  }, [contexts, sourceContextId, sourceContextName]);

  const hasActionInFlight = useMemo(() => items.some((item) => Boolean(item.actionRunning)), [items]);
  const runValidationError = resolveBucketCompareRunError({
    targetSelected: Boolean(targetContextId),
    hasScopeSelected,
    includeConfig,
    hasConfigFeatureSelected,
    ignoreModifiedAfterInvalid,
    planError: comparePlan.error,
    messages: {
      targetRequired: text("Select a target context."),
      scopeRequired: text("Select at least one comparison scope: content and/or configuration."),
      configFeatureRequired: text("Select at least one configuration feature or disable configuration scope."),
      invalidCutoff: text("Enter a valid modified-after cutoff or clear the field."),
    },
  });
  const canRunComparison =
    !running &&
    !hasActionInFlight &&
    !runValidationError;

  const buildManagerBrowserHref = useCallback((contextId: string, bucket: string, key: string) => {
    const params = new URLSearchParams();
    params.set("ctx", contextId);
    params.set("bucket", bucket);
    const prefix = getObjectParentPrefix(key);
    if (prefix) params.set("prefix", prefix);
    return `/manager/browser?${params.toString()}`;
  }, []);
  const managerBrowserDisabledReason = managerBrowserEnabled
    ? null
    : "Manager Browser is disabled for this surface.";

  const runCompare = async () => {
    if (runValidationError || !targetContextId) {
      setRunError(runValidationError ?? text("Select a target context."));
      return;
    }
    const safeParallelism = normalizeBucketCompareParallelism(parallelism);
    const mappings = comparePlan.mappings;
    const snapshot: CompareRunOptionsSnapshot = {
      targetContextId,
      includeContent,
      includeConfig,
      configFeatures: includeConfig ? [...selectedConfigFeatures] : [],
      ignoreModifiedAfterIso,
    };
    setLastRunOptions(snapshot);
    beginRun(
      mappings.map((mapping) => ({
        sourceBucket: mapping.sourceBucket,
        targetBucket: mapping.targetBucket,
        status: "pending",
        actionRunning: null,
        actionFeedback: null,
      }))
    );

    try {
      await runWithConcurrencySettled(
        mappings,
        safeParallelism,
        (mapping, index) =>
          executeRunItem(index, (signal) =>
            compareManagerBucketPair(
              sourceContextId,
              {
                target_context_id: snapshot.targetContextId,
                source_bucket: mapping.sourceBucket,
                target_bucket: mapping.targetBucket,
                include_content: snapshot.includeContent,
                include_config: snapshot.includeConfig,
                config_features: snapshot.includeConfig ? snapshot.configFeatures : undefined,
                ignore_modified_after: snapshot.ignoreModifiedAfterIso,
              },
              { signal },
            ),
          ),
        settleRunItem
      );
    } catch (err) {
      const error = extractCompareError(err);
      setRunError(error);
      setItems((prev) =>
        prev.map((item) =>
          item.status === "pending" || item.status === "running"
            ? {
                ...item,
                status: "failed",
                error,
              }
            : item
        )
      );
    } finally {
      finishRun();
    }
  };

  const resultSummary = useMemo(() => summarizeBucketCompareRun(items), [items]);

  const filteredItems = useMemo(() => {
    return items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) =>
        matchesBucketCompareRunFilters(item, resultFilters)
      );
  }, [items, resultFilters]);

  const stopComparison = useCallback(() => {
    if (!stopRun()) return;
    setPendingAction(null);
  }, [stopRun]);

  const handleClose = useCallback(() => {
    stopComparison();
    onClose();
  }, [onClose, stopComparison]);

  const exportGlobalDiff = () => {
    if (items.length === 0) return;
    const targetContext = contexts.find((context) => context.id === targetContextId);
    const payload = {
      generated_at: new Date().toISOString(),
      source_context: {
        id: sourceContextId,
        name: sourceContextName ?? sourceContextId,
      },
      target_context: targetContextId
        ? {
            id: targetContextId,
            name: targetContext?.display_name ?? targetContextId,
          }
        : null,
      options: {
        mapping_mode: mappingMode,
        include_content: includeContent,
        include_config: includeConfig,
        config_features: includeConfig ? selectedConfigFeatures : [],
        ignore_modified_after: ignoreModifiedAfterIso,
        parallelism,
      },
      summary: {
        total: items.length,
        success: resultSummary.success,
        failed: resultSummary.failed,
        cancelled: resultSummary.cancelled,
        with_differences: resultSummary.withDiff,
      },
      items: items.map((item) => ({
        source_bucket: item.sourceBucket,
        target_bucket: item.targetBucket,
        status: item.status,
        error: item.error ?? null,
        result: item.result ?? null,
      })),
    };
    const timestamp = formatDownloadTimestamp(new Date());
    const filename = `bucket-compare-${sourceContextId}-to-${targetContextId ?? "na"}-${timestamp}.json`;
    triggerJsonDownload(filename, payload);
  };

  const startRemediationAction = useCallback(
    async (pending: PendingRemediationAction) => {
      const currentItem = items[pending.itemIndex];
      if (!currentItem) return;

      const targetContextForAction =
        currentItem.result?.target_context_id || lastRunOptions?.targetContextId || targetContextId || null;
      if (!targetContextForAction) {
        setItems((prev) =>
          prev.map((item, index) =>
            index === pending.itemIndex
              ? {
                  ...item,
                  actionFeedback: {
                    tone: "danger",
                    message: text("Unable to run action: target context is missing."),
                  },
                }
              : item
          )
        );
        return;
      }

      const safeActionParallelism = normalizeBucketCompareParallelism(parallelism);
      setItems((prev) =>
        prev.map((item, index) =>
          index === pending.itemIndex
            ? {
                ...item,
                actionRunning: pending.action,
                actionFeedback: null,
              }
            : item
        )
      );

      let actionResult: ManagerBucketCompareActionResult;
      try {
        actionResult = await runManagerBucketCompareAction(sourceContextId, {
          target_context_id: targetContextForAction,
          source_bucket: currentItem.sourceBucket,
          target_bucket: currentItem.targetBucket,
          action: pending.action,
          object_keys: pending.objectKeys,
          parallelism: safeActionParallelism,
        });
      } catch (err) {
        const error = extractCompareError(err);
        setItems((prev) =>
          prev.map((item, index) =>
            index === pending.itemIndex
              ? {
                  ...item,
                  actionRunning: null,
                  actionFeedback: {
                    tone: "danger",
                    message: text("Action failed: {error}", { error }),
                  },
                }
              : item
          )
        );
        return;
      }

      const actionTone: BucketCompareFeedbackTone =
        actionResult.failed_count <= 0 ? "success" : actionResult.succeeded_count > 0 ? "warning" : "danger";
      const actionMessage = actionResult.message;
      setItems((prev) =>
        prev.map((item, index) =>
          index === pending.itemIndex
            ? {
                ...item,
                actionFeedback: {
                  tone: actionTone,
                  message: actionMessage,
                },
              }
            : item
        )
      );

      const refreshOptions: CompareRunOptionsSnapshot = lastRunOptions ?? {
        targetContextId: targetContextForAction,
        includeContent: true,
        includeConfig: false,
        configFeatures: [],
        ignoreModifiedAfterIso: ignoreModifiedAfterIso,
      };
      try {
        const refreshedResult = await compareManagerBucketPair(sourceContextId, {
          target_context_id: refreshOptions.targetContextId,
          source_bucket: currentItem.sourceBucket,
          target_bucket: currentItem.targetBucket,
          include_content: refreshOptions.includeContent,
          include_config: refreshOptions.includeConfig,
          config_features: refreshOptions.includeConfig ? refreshOptions.configFeatures : undefined,
          ignore_modified_after: refreshOptions.ignoreModifiedAfterIso,
        });
        setItems((prev) =>
          prev.map((item, index) =>
            index === pending.itemIndex
              ? {
                  ...item,
                  status: "success",
                  result: refreshedResult,
                  error: undefined,
                  actionRunning: null,
                }
              : item
          )
        );
      } catch (err) {
        const error = extractCompareError(err);
        setItems((prev) =>
          prev.map((item, index) =>
            index === pending.itemIndex
              ? {
                  ...item,
                  status: "failed",
                  error: text("Action applied, but re-compare failed: {error}", { error }),
                  actionRunning: null,
                }
              : item
          )
        );
      }
    },
    [ignoreModifiedAfterIso, items, lastRunOptions, parallelism, setItems, sourceContextId, targetContextId, text]
  );

  const openRemediationConfirm = useCallback(
    (itemIndex: number, sectionKey: RemediationSectionKey, objectKeys: string[], visibleOnly = false) => {
      const item = items[itemIndex];
      if (!item) return;
      if (item.status !== "success") return;
      if (running || item.actionRunning) return;
      if (objectKeys.length <= 0) return;
      setPendingAction({
        itemIndex,
        action: remediationSectionActionMap[sectionKey],
        objectKeys: [...objectKeys],
        visibleOnly,
      });
    },
    [items, running]
  );

  const confirmRemediationAction = useCallback(async () => {
    if (!pendingAction) return;
    const action = pendingAction;
    setPendingAction(null);
    await startRemediationAction(action);
  }, [pendingAction, startRemediationAction]);

  const downloadCompareObject = useCallback(
    async (params: { contextId: string; bucket: string; key: string; feedbackId: string }) => {
      if (managerBrowserDisabledReason || downloadInFlight) return;
      const downloadId = `${params.contextId}:${params.bucket}:${params.key}`;
      setDownloadInFlight(downloadId);
      setDownloadFeedback(null);
      try {
        const blob = await proxyDownload(params.contextId, params.bucket, params.key);
        triggerBlobDownload(downloadFilenameFromKey(params.key), blob);
        setDownloadFeedback({
          id: params.feedbackId,
          tone: "success",
          message: `Download started for ${params.key}.`,
        });
      } catch {
        setDownloadFeedback({
          id: params.feedbackId,
          tone: "danger",
          message: `Unable to download ${params.key}.`,
        });
      } finally {
        setDownloadInFlight(null);
      }
    },
    [downloadInFlight, managerBrowserDisabledReason]
  );

  const pendingActionItem = pendingAction ? items[pendingAction.itemIndex] : null;
  const pendingActionSourceContextId = pendingActionItem?.result?.source_context_id ?? sourceContextId;
  const pendingActionTargetContextId =
    pendingActionItem?.result?.target_context_id || lastRunOptions?.targetContextId || targetContextId || "";
  const pendingActionSourceContextName =
    contextDisplayNameById.get(pendingActionSourceContextId) ?? pendingActionSourceContextId;
  const pendingActionTargetContextName =
    contextDisplayNameById.get(pendingActionTargetContextId) ?? pendingActionTargetContextId;

  return (
    <WorkflowPage
      title={text("Compare buckets")}
      description={text("Configure the target mapping, run the comparison, and review or remediate differences without leaving the workflow.")}
      breadcrumbs={managerPageBreadcrumbs(text, "compare", { label: text("Run") })}
      backLabel={text("Back to bucket selection")}
      onBack={handleClose}
      contentClassName="space-y-4"
    >
      <div className="space-y-4">
        <BucketCompareSetup
          sourceCount={sortedSourceBuckets.length}
          sourceName={sourceContextName ?? sourceContextId}
          targetKind="context"
          sameTarget={sameContextSelected}
          targetSelector={
            <div className="space-y-2">
              <UiInput
                type="search"
                label={text("Search target contexts")}
                value={targetContextCatalog.search}
                onChange={(event) => targetContextCatalog.setSearch(event.target.value)}
                disabled={running}
                size="compact"
              />
              <UiSelect
                label={text("Target context")}
                value={targetContextId ?? ""}
                onChange={(event) => setTargetContextId(event.target.value ? event.target.value : null)}
                disabled={running || targetContextCatalog.loading || targetContextOptions.length === 0}
              >
                {targetContextOptions.length > 0 && <option value="">{text("Select a target context")}</option>}
                {targetContextOptions.length === 0 && <option value="">{text("No context on this page")}</option>}
                {targetContextOptions.map((context) => (
                  <option key={context.id} value={context.id}>
                    {context.display_name}
                  </option>
                ))}
              </UiSelect>
              <PaginationControls
                page={targetContextCatalog.page}
                pageSize={targetContextCatalog.pageSize}
                total={targetContextCatalog.total}
                onPageChange={targetContextCatalog.setPage}
                onPageSizeChange={targetContextCatalog.setPageSize}
                disabled={running || targetContextCatalog.loading}
              />
              {targetContextCatalog.error && (
                <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">
                  {targetContextCatalog.error}
                </p>
              )}
            </div>
          }
          actions={
            <>
              <UiButton
                onClick={runCompare}
                disabled={!canRunComparison}
                className="ui-body"
              >
                {text(running ? "Comparing..." : "Run comparison")}
              </UiButton>
              <UiButton onClick={stopComparison} disabled={!running} variant="warning" className="ui-body">
                {text(stopping ? "Stopping..." : "Stop")}
              </UiButton>
              <UiButton onClick={exportGlobalDiff} disabled={running || items.length === 0} variant="secondary" className="ui-body">
                {text("Export global diff")}
              </UiButton>
            </>
          }
          mappingMode={mappingMode}
          onMappingModeChange={setMappingMode}
          includeContent={includeContent}
          onIncludeContentChange={setIncludeContent}
          includeConfig={includeConfig}
          onIncludeConfigChange={setIncludeConfig}
          parallelism={parallelism}
          onParallelismChange={setParallelism}
          ignoreModifiedAfter={ignoreModifiedAfter}
          onIgnoreModifiedAfterChange={setIgnoreModifiedAfter}
          ignoreModifiedAfterInvalid={ignoreModifiedAfterInvalid}
          selectedConfigFeatures={selectedConfigFeatures}
          onConfigFeaturesChange={setSelectedConfigFeatures}
          onConfigFeatureChange={toggleConfigFeature}
          running={running}
        >
          {mappingMode === "manual" && (
            <div className="space-y-3">
              <UiInput
                type="search"
                label={text("Search target buckets")}
                value={targetBucketCatalog.search}
                onChange={(event) => targetBucketCatalog.setSearch(event.target.value)}
                disabled={running || !targetContextId}
                size="compact"
              />
              {targetBucketCatalog.loading && (
                <p className="ui-caption text-slate-500 dark:text-slate-400">{text("Loading target buckets...")}</p>
              )}
              {targetBucketCatalog.error && (
                <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">{targetBucketCatalog.error}</p>
              )}
              <BucketCompareManualMappingEditor
                rawMappingText={rawMappingText}
                onRawMappingTextChange={setRawMappingText}
                parsedRawMapping={parsedRawMapping}
                sourceBuckets={sortedSourceBuckets}
                resolvedManualMapping={resolvedManualMapping}
                manualMapping={manualMapping}
                onManualMappingChange={(sourceBucket, targetBucket) =>
                  setManualMapping((prev) => ({ ...prev, [sourceBucket]: targetBucket }))
                }
                availableTargetBucketNames={availableTargetBucketNames}
                disabled={running}
              />
              <PaginationControls
                page={targetBucketCatalog.page}
                pageSize={targetBucketCatalog.pageSize}
                total={targetBucketCatalog.total}
                onPageChange={targetBucketCatalog.setPage}
                onPageSizeChange={targetBucketCatalog.setPageSize}
                disabled={running || targetBucketCatalog.loading}
              />
            </div>
          )}
        </BucketCompareSetup>
        {runError && <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">{runError}</p>}
        {(running || progress.total > 0) && <BucketCompareProgress running={running} progress={progress} percent={progressPercent} />}
        {items.length > 0 && !running && (
          <p className="ui-caption text-slate-600 dark:text-slate-300">
            {text("Done:")} {resultSummary.success} {text("/ Failed:")} {resultSummary.failed} {text("/ Cancelled:")} {resultSummary.cancelled} {text("/ With\n            differences:")} {resultSummary.withDiff}
          </p>
        )}
        {items.length > 0 && (
          <div className="space-y-2">
            <BucketCompareResultFilters
              search={resultSearch} onSearchChange={setResultSearch}
              status={statusFilter} onStatusChange={setStatusFilter}
              differences={diffFilter} onDifferencesChange={setDiffFilter}
              visible={filteredItems.length} total={items.length} onReset={resetResultFilters}
            />
            {filteredItems.map(({ item, index: itemIndex }) => {
              const content = item.result?.content_diff;
              const bucketHasDifferences = Boolean(item.result?.has_differences);
              const sourceContextForRow = item.result?.source_context_id ?? sourceContextId;
              const targetContextForRow =
                item.result?.target_context_id || lastRunOptions?.targetContextId || targetContextId || "";
              const renderObjectActions = (
                section: BucketCompareContentSection,
                sectionFeedbackId: string,
                contextId: string,
                bucket: string,
                includeRemediation: boolean,
                remediationVariant: "secondary" | "danger",
              ) => (detail: BucketCompareObjectDetail, closeMetadata: () => void) => {
                const downloadId = `${contextId}:${bucket}:${detail.key}`;
                const downloadDisabled =
                  Boolean(managerBrowserDisabledReason) || Boolean(downloadInFlight) || running;
                const remediationAction = remediationSectionActionMap[section.key];
                return (
                  <>
                    <ListActionButton
                      variant="secondary"
                      disabled={downloadDisabled}
                      title={managerBrowserDisabledReason ?? undefined}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        closeMetadata();
                        void downloadCompareObject({
                          contextId,
                          bucket,
                          key: detail.key,
                          feedbackId: sectionFeedbackId,
                        });
                      }}
                    >
                      {text(downloadInFlight === downloadId ? "Downloading..." : "Download")}
                    </ListActionButton>
                    {!isDemo && section.changed && includeRemediation && (
                      <ListActionButton
                        variant={remediationVariant}
                        disabled={running || item.status !== "success" || Boolean(item.actionRunning)}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          closeMetadata();
                          openRemediationConfirm(itemIndex, section.key, [detail.key]);
                        }}
                      >
                        {item.actionRunning === remediationAction
                          ? "Running..."
                          : remediationSingleActionLabel[remediationAction]}
                      </ListActionButton>
                    )}
                  </>
                );
              };
              return (
                <BucketCompareResult
                  key={`${item.sourceBucket}->${item.targetBucket}:${item.status}:${bucketHasDifferences ? "diff" : "same"}`}
                  item={item}
                  content={content}
                >
                  <div className="space-y-3">
                    {item.error && (
                      <BucketCompareFeedback tone="danger" announce>
                        {item.error}
                      </BucketCompareFeedback>
                    )}
                    {item.actionFeedback && (
                      <BucketCompareFeedback tone={item.actionFeedback.tone} announce>
                        {item.actionFeedback.message}
                      </BucketCompareFeedback>
                    )}
                    {content && (
                      <BucketCompareContentDiff
                        sectionIdPrefix={`${item.sourceBucket}:${item.targetBucket}:content`}
                        content={content}
                        copyFeedback={copyFeedback}
                        onCopyVisibleKeys={copyVisibleKeys}
                        renderSectionActions={(section) => {
                          if (isDemo || !section.changed) return null;
                          const action = remediationSectionActionMap[section.key];
                          const label =
                            section.hiddenCount > 0
                              ? text(remediationVisibleActionLabel[action])
                              : text(remediationActionLabel[action]);
                          return (
                            <ListActionButton
                              variant={action === "delete_target_only" ? "danger" : "secondary"}
                              disabled={
                                running ||
                                item.status !== "success" ||
                                section.copyKeys.length === 0 ||
                                Boolean(item.actionRunning)
                              }
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                openRemediationConfirm(
                                  itemIndex,
                                  section.key,
                                  section.copyKeys,
                                  section.hiddenCount > 0,
                                );
                              }}
                            >
                              {item.actionRunning === action ? "Running..." : label}
                            </ListActionButton>
                          );
                        }}
                        renderSectionFeedback={(_section, sectionFeedbackId) => {
                          const sectionDownloadFeedback =
                            downloadFeedback?.id === sectionFeedbackId ? downloadFeedback : null;
                          return sectionDownloadFeedback ? (
                            <BucketCompareFeedback tone={sectionDownloadFeedback.tone} announce>
                              {sectionDownloadFeedback.message}
                            </BucketCompareFeedback>
                          ) : null;
                        }}
                        getSourceOptions={(section, sectionFeedbackId) => ({
                          browserDisabledReason: managerBrowserDisabledReason,
                          buildBrowserHref: (detail) =>
                            buildManagerBrowserHref(
                              sourceContextForRow,
                              item.sourceBucket,
                              detail.key,
                            ),
                          renderAction:
                            section.sourceDetails.length > 0
                              ? renderObjectActions(
                                  section,
                                  sectionFeedbackId,
                                  sourceContextForRow,
                                  item.sourceBucket,
                                  section.key !== "target_only",
                                  "secondary",
                                )
                              : undefined,
                        })}
                        getTargetOptions={(section, sectionFeedbackId) => ({
                          browserDisabledReason: managerBrowserDisabledReason,
                          buildBrowserHref: (detail) =>
                            buildManagerBrowserHref(
                              targetContextForRow,
                              item.targetBucket,
                              detail.key,
                            ),
                          renderAction:
                            section.targetDetails.length > 0
                              ? renderObjectActions(
                                  section,
                                  sectionFeedbackId,
                                  targetContextForRow,
                                  item.targetBucket,
                                  section.key === "target_only",
                                  "danger",
                                )
                              : undefined,
                        })}
                      />
                    )}
                    {item.result?.config_diff && (
                      <BucketCompareConfigDiff configDiff={item.result.config_diff} />
                    )}
                  </div>
                </BucketCompareResult>
              );
            })}
            {filteredItems.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-300 px-3 py-4 ui-body text-slate-600 dark:border-slate-700 dark:text-slate-300">
                {text("No result matches the current filters.")}
              </div>
            )}
          </div>
        )}
      </div>
      {pendingAction && pendingActionItem && (
        <ConfirmActionDialog
          title={text(remediationActionTitle[pendingAction.action])}
          description={<>{text("This will run")} <strong>{pendingAction.objectKeys.length === 1
            ? text(remediationSingleActionLabel[pendingAction.action])
            : pendingAction.visibleOnly
              ? text(remediationVisibleActionLabel[pendingAction.action])
              : text(remediationActionLabel[pendingAction.action])}</strong> {text("for the exact object keys from the current diff.")}</>}
          details={[
            { label: text("Source context"), value: pendingActionSourceContextName },
            { label: text("Target context"), value: pendingActionTargetContextName },
            { label: text("Source bucket"), value: pendingActionItem.sourceBucket },
            { label: text("Target bucket"), value: pendingActionItem.targetBucket },
            { label: text("Objects impacted"), value: pendingAction.objectKeys.length },
            ...((lastRunOptions?.ignoreModifiedAfterIso ?? ignoreModifiedAfterIso)
              ? [{ label: text("Cutoff"), value: lastRunOptions?.ignoreModifiedAfterIso ?? ignoreModifiedAfterIso }]
              : []),
            { label: text("Object keys"), mono: true, value: <ul className="max-h-48 space-y-1 overflow-auto" aria-label={text("Exact object keys")}>
              {pendingAction.objectKeys.map((key) => <li key={key}>{key}</li>)}
            </ul> },
          ]}
          impacts={[
            ...(pendingAction.visibleOnly ? [text("This diff section is truncated; only displayed keys will be remediated.")] : []),
            ...(pendingAction.action === "delete_target_only" ? [text("This action is destructive and removes extra objects from the target bucket.")] : []),
          ]}
          confirmLabel={text("Confirm")}
          tone={pendingAction.action === "delete_target_only" ? "danger" : "primary"}
          maxWidthClass="max-w-2xl"
          zIndexClass="z-[60]"
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void confirmRemediationAction()}
        />
      )}
    </WorkflowPage>
  );
}
