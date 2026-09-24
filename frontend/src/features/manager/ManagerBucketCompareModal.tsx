/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import BucketCompareSetup, { BucketCompareProgress } from "../shared/BucketCompareSetup";
import WorkflowPage from "../../components/WorkflowPage";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import { ListActionButton, ListBadge } from "../../components/list/ListControls";
import UiButton from "../../components/ui/UiButton";
import {
  BucketCompareFeedback,
  BucketCompareResult,
  BucketCompareResultFilters,
  BucketCompareSection,
  type BucketCompareFeedbackTone,
} from "../shared/BucketCompareResults";
import BucketCompareObjectDetails from "../shared/BucketCompareObjectDetails";
import UiSelect from "../../components/ui/UiSelect";
import { proxyDownload } from "../../api/browserTransfers";
import { runWithConcurrencySettled } from "../../utils/concurrency";
import {
  compareManagerBucketPair,
  listBuckets,
  ManagerBucketCompareAction,
  ManagerBucketCompareActionResult,
  ManagerBucketCompareResult,
  ManagerBucketObjectDetail,
  runManagerBucketCompareAction,
  type ManagerBucketCompareConfigFeature,
} from "../../api/managerBuckets";
import type { ExecutionContext } from "../../api/executionContexts";
import {
  BUCKET_COMPARE_CONFIG_FEATURE_OPTIONS,
  BucketCompareManualMappingEditor,
  CompareVisibleKeysCopyFeedback,
  bucketComparisonCancelledMessage,
  buildBucketCompareMappingModel,
  compareObjectDetailsFromKeys,
  extractCompareError,
  formatCompareDisplayLimitMessage,
  formatUnknown,
  getChangedTone,
  getCompareHiddenCount,
  getObjectParentPrefix,
  getVisibleCompareObjectKeys,
  matchesBucketCompareRunFilters,
  parseOptionalIsoDateTime,
  renderDiffLines,
  sourceCompareObjectDetailFromDiff,
  summarizeBucketCompareRun,
  targetCompareObjectDetailFromDiff,
  useBucketCompareConfigFeatures,
  useBucketCompareManualMappingState,
  useBucketCompareRunState,
  useCompareVisibleKeysClipboard,
} from "../shared/bucketCompareShared";
import {
  formatDownloadTimestamp,
  triggerBlobDownload,
  triggerJsonDownload,
} from "../../utils/download";

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
  configFeatures: ManagerBucketCompareConfigFeature[];
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

const extractError = extractCompareError;

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
  const sortedSourceBuckets = useMemo(() => [...sourceBuckets].sort((a, b) => a.localeCompare(b)), [sourceBuckets]);
  const targetContextOptions = useMemo(() => contexts, [contexts]);
  const [targetContextId, setTargetContextId] = useState<string | null>(null);
  const [targetBucketNames, setTargetBucketNames] = useState<string[]>([]);
  const [targetBucketsLoading, setTargetBucketsLoading] = useState(false);
  const [targetBucketsError, setTargetBucketsError] = useState<string | null>(null);
  const [mappingMode, setMappingMode] = useState<"by_name" | "manual">("by_name");
  const [includeContent, setIncludeContent] = useState(true);
  const [includeConfig, setIncludeConfig] = useState(false);
  const [ignoreModifiedAfter, setIgnoreModifiedAfter] = useState("");
  const [parallelism, setParallelism] = useState(4);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [lastRunOptions, setLastRunOptions] = useState<CompareRunOptionsSnapshot | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingRemediationAction | null>(null);
  const [downloadFeedback, setDownloadFeedback] = useState<(CompareVisibleKeysCopyFeedback & { id: string }) | null>(null);
  const [downloadInFlight, setDownloadInFlight] = useState<string | null>(null);
  const [resultSearch, setResultSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | CompareRunItem["status"]>("all");
  const [diffFilter, setDiffFilter] = useState<"all" | "with_diff" | "no_diff">("all");
  const sameContextSelected = targetContextId === sourceContextId;
  const {
    manualMapping,
    parsedRawMapping,
    rawMappingText,
    setManualMapping,
    setRawMappingText,
  } = useBucketCompareManualMappingState({
    mappingMode,
    sourceBuckets: sortedSourceBuckets,
    targetBuckets: targetBucketNames,
    sameTargetSelected: sameContextSelected,
  });
  const {
    selectedConfigFeatures,
    setSelectedConfigFeatures,
    toggleConfigFeature,
  } = useBucketCompareConfigFeatures<ManagerBucketCompareConfigFeature>(
    ALL_CONFIG_FEATURE_KEYS
  );
  const {
    cancelRequestedRef,
    items,
    progress,
    setItems,
    setProgress,
    settleRunItem,
  } = useBucketCompareRunState<ManagerBucketCompareResult, CompareRunItem>();
  const requestControllersRef = useRef(new Set<AbortController>());
  const { copyFeedback, copyVisibleKeys } = useCompareVisibleKeysClipboard();

  const contextDisplayNameById = useMemo(() => {
    const byId = new Map<string, string>();
    contexts.forEach((context) => {
      byId.set(context.id, context.display_name || context.id);
    });
    byId.set(sourceContextId, sourceContextName ?? sourceContextId);
    return byId;
  }, [contexts, sourceContextId, sourceContextName]);

  useEffect(() => {
    if (targetContextOptions.length === 0) {
      setTargetContextId(null);
      return;
    }
    setTargetContextId((prev) => {
      if (prev !== null && targetContextOptions.some((context) => context.id === prev)) {
        return prev;
      }
      return null;
    });
  }, [targetContextOptions]);

  useEffect(() => {
    if (sameContextSelected && mappingMode !== "manual") {
      setMappingMode("manual");
    }
  }, [mappingMode, sameContextSelected]);

  useEffect(() => {
    if (!targetContextId) {
      setTargetBucketNames([]);
      setTargetBucketsError("Select a target context.");
      return;
    }
    let cancelled = false;
    const load = async () => {
      setTargetBucketsLoading(true);
      setTargetBucketsError(null);
      try {
        const names = (await listBuckets(targetContextId, { with_stats: false }))
          .map((bucket) => (bucket.name ?? "").trim())
          .filter((name): name is string => Boolean(name))
          .sort((a, b) => a.localeCompare(b));
        if (cancelled) return;
        setTargetBucketNames(names);
        setTargetBucketsError(null);
      } catch (err) {
        if (cancelled) return;
        setTargetBucketNames([]);
        setTargetBucketsError(extractError(err));
      } finally {
        if (!cancelled) {
          setTargetBucketsLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [sourceContextId, targetContextId]);

  const {
    availableTargetBucketNames,
    resolvedManualMapping,
    comparePlan,
    missingByName,
  } = useMemo(
    () =>
      buildBucketCompareMappingModel({
        targetSelected: Boolean(targetContextId),
        targetKind: "context",
        sourceBuckets: sortedSourceBuckets,
        targetBuckets: targetBucketNames,
        sameTargetSelected: sameContextSelected,
        mappingMode,
        rawMapping: parsedRawMapping.mapping,
        manualMapping,
      }),
    [
      manualMapping,
      mappingMode,
      parsedRawMapping.mapping,
      sameContextSelected,
      sortedSourceBuckets,
      targetBucketNames,
      targetContextId,
    ]
  );
  const progressPercent = useMemo(() => {
    if (progress.total <= 0) return 0;
    return Math.min(100, Math.round((progress.completed / progress.total) * 100));
  }, [progress.completed, progress.total]);
  const hasScopeSelected = includeContent || includeConfig;
  const hasConfigFeatureSelected = selectedConfigFeatures.length > 0;
  const ignoreModifiedAfterIso = useMemo(
    () => parseOptionalIsoDateTime(ignoreModifiedAfter),
    [ignoreModifiedAfter],
  );
  const ignoreModifiedAfterInvalid = Boolean(ignoreModifiedAfter.trim()) && !ignoreModifiedAfterIso;
  const hasActionInFlight = useMemo(() => items.some((item) => Boolean(item.actionRunning)), [items]);
  const canRunComparison =
    !running &&
    !hasActionInFlight &&
    !comparePlan.error &&
    Boolean(targetContextId) &&
    hasScopeSelected &&
    (!includeConfig || hasConfigFeatureSelected) &&
    !ignoreModifiedAfterInvalid;

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
    if (!targetContextId) {
      setRunError("Select a target context.");
      return;
    }
    if (!hasScopeSelected) {
      setRunError("Select at least one comparison scope: content and/or configuration.");
      return;
    }
    if (includeConfig && !hasConfigFeatureSelected) {
      setRunError("Select at least one configuration feature or disable configuration scope.");
      return;
    }
    if (ignoreModifiedAfterInvalid) {
      setRunError("Enter a valid modified-after cutoff or clear the field.");
      return;
    }
    if (comparePlan.error) {
      setRunError(comparePlan.error);
      return;
    }
    const safeParallelism = Number.isFinite(parallelism) ? Math.max(1, Math.min(20, Math.floor(parallelism))) : 4;
    const mappings = comparePlan.mappings;
    const snapshot: CompareRunOptionsSnapshot = {
      targetContextId,
      includeContent,
      includeConfig,
      configFeatures: includeConfig ? [...selectedConfigFeatures] : [],
      ignoreModifiedAfterIso,
    };
    setLastRunOptions(snapshot);
    setRunError(null);
    cancelRequestedRef.current = false;
    setRunning(true);
    setStopping(false);
    setProgress({ completed: 0, total: mappings.length, failed: 0, cancelled: 0 });
    setItems(
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
        async (mapping, index) => {
          if (cancelRequestedRef.current) {
            throw new DOMException("Comparison cancelled", "AbortError");
          }
          setItems((prev) =>
            prev.map((item, itemIdx) =>
              itemIdx === index
                ? {
                    ...item,
                    status: "running",
                  }
                : item
            )
          );
          const controller = new AbortController();
          requestControllersRef.current.add(controller);
          try {
            return await compareManagerBucketPair(
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
              { signal: controller.signal }
            );
          } finally {
            requestControllersRef.current.delete(controller);
          }
        },
        settleRunItem
      );
    } catch (err) {
      const error = extractError(err);
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
      requestControllersRef.current.forEach((controller) => controller.abort());
      requestControllersRef.current.clear();
      setRunning(false);
      setStopping(false);
    }
  };

  const resultSummary = useMemo(() => summarizeBucketCompareRun(items), [items]);

  const filteredItems = useMemo(() => {
    return items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) =>
        matchesBucketCompareRunFilters(item, {
          search: resultSearch,
          status: statusFilter,
          differences: diffFilter,
        })
      );
  }, [diffFilter, items, resultSearch, statusFilter]);

  const resetResultFilters = () => {
    setResultSearch("");
    setStatusFilter("all");
    setDiffFilter("all");
  };

  const stopComparison = useCallback(() => {
    if (!running) return;
    cancelRequestedRef.current = true;
    setStopping(true);
    setPendingAction(null);
    requestControllersRef.current.forEach((controller) => controller.abort());
    requestControllersRef.current.clear();
    setItems((prev) =>
      prev.map((item) =>
        item.status === "pending" || item.status === "running"
          ? {
              ...item,
              status: "cancelled",
              error: bucketComparisonCancelledMessage,
            }
          : item
      )
    );
  }, [cancelRequestedRef, running, setItems]);

  const handleClose = useCallback(() => {
    stopComparison();
    onClose();
  }, [onClose, stopComparison]);

  useEffect(() => {
    const controllers = requestControllersRef.current;
    return () => {
      cancelRequestedRef.current = true;
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
    };
  }, [cancelRequestedRef]);

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
                    message: "Unable to run action: target context is missing.",
                  },
                }
              : item
          )
        );
        return;
      }

      const safeActionParallelism = Number.isFinite(parallelism) ? Math.max(1, Math.min(32, Math.floor(parallelism))) : 4;
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
        const error = extractError(err);
        setItems((prev) =>
          prev.map((item, index) =>
            index === pending.itemIndex
              ? {
                  ...item,
                  actionRunning: null,
                  actionFeedback: {
                    tone: "danger",
                    message: `Action failed: ${error}`,
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
        const error = extractError(err);
        setItems((prev) =>
          prev.map((item, index) =>
            index === pending.itemIndex
              ? {
                  ...item,
                  status: "failed",
                  error: `Action applied, but re-compare failed: ${error}`,
                  actionRunning: null,
                }
              : item
          )
        );
      }
    },
    [ignoreModifiedAfterIso, items, lastRunOptions, parallelism, setItems, sourceContextId, targetContextId]
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
      title="Compare buckets"
      description="Configure the target mapping, run the comparison, and review or remediate differences without leaving the workflow."
      breadcrumbs={managerPageBreadcrumbs("compare", { label: "Run" })}
      backLabel="Back to bucket selection"
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
            <UiSelect
              label="Target context"
              value={targetContextId ?? ""}
              onChange={(event) => setTargetContextId(event.target.value ? event.target.value : null)}
              disabled={running || targetContextOptions.length === 0}
            >
              {targetContextOptions.length > 0 && <option value="">Select a target context</option>}
              {targetContextOptions.length === 0 && <option value="">No other context available</option>}
              {targetContextOptions.map((context) => (
                <option key={context.id} value={context.id}>
                  {context.display_name}
                </option>
              ))}
            </UiSelect>
          }
          actions={
            <>
              <UiButton
                onClick={runCompare}
                disabled={!canRunComparison}
                className="ui-body"
              >
                {running ? "Comparing..." : "Run comparison"}
              </UiButton>
              <UiButton onClick={stopComparison} disabled={!running} variant="warning" className="ui-body">
                {stopping ? "Stopping..." : "Stop"}
              </UiButton>
              <UiButton onClick={exportGlobalDiff} disabled={running || items.length === 0} variant="secondary" className="ui-body">
                Export global diff
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
          {targetBucketsLoading && <p className="ui-caption text-slate-500 dark:text-slate-400">Loading target buckets...</p>}
          {targetBucketsError && <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">{targetBucketsError}</p>}
          {mappingMode === "by_name" && missingByName.length > 0 && (
            <p className="ui-caption font-semibold text-amber-700 dark:text-amber-200">
              {missingByName.length} target bucket(s) do not exist with the same name.
            </p>
          )}
          {mappingMode === "manual" && (
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
          )}
        </BucketCompareSetup>
        {runError && <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">{runError}</p>}
        {(running || progress.total > 0) && <BucketCompareProgress running={running} progress={progress} percent={progressPercent} />}
        {items.length > 0 && !running && (
          <p className="ui-caption text-slate-600 dark:text-slate-300">
            Done: {resultSummary.success} / Failed: {resultSummary.failed} / Cancelled: {resultSummary.cancelled} / With
            differences: {resultSummary.withDiff}
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
              const contentHasDifferences = Boolean(
                content && (content.different_count > 0 || content.only_source_count > 0 || content.only_target_count > 0)
              );
              const contentSections = content
                ? (() => {
                    const onlySourceDetails =
                      content.only_source_count > 0
                        ? (content.only_source_details?.length ? content.only_source_details : compareObjectDetailsFromKeys(content.only_source_sample))
                        : [];
                    const onlyTargetDetails =
                      content.only_target_count > 0
                        ? (content.only_target_details?.length ? content.only_target_details : compareObjectDetailsFromKeys(content.only_target_sample))
                        : [];
                    const differentSourceDetails =
                      content.different_count > 0 ? content.different_sample.map(sourceCompareObjectDetailFromDiff) : [];
                    const differentTargetDetails =
                      content.different_count > 0 ? content.different_sample.map(targetCompareObjectDetailFromDiff) : [];
                    const onlySourceHiddenCount = getCompareHiddenCount(
                      content.only_source_count,
                      onlySourceDetails.length,
                      content.only_source_hidden_count
                    );
                    const onlyTargetHiddenCount = getCompareHiddenCount(
                      content.only_target_count,
                      onlyTargetDetails.length,
                      content.only_target_hidden_count
                    );
                    const differentHiddenCount = getCompareHiddenCount(
                      content.different_count,
                      differentSourceDetails.length,
                      content.different_hidden_count
                    );
                    return [
                      {
                        key: "source_only" as const,
                        label: `Source only (${content.only_source_count})`,
                        changed: content.only_source_count > 0,
                        objectCount: content.only_source_count,
                        visibleCount: onlySourceDetails.length,
                        hiddenCount: onlySourceHiddenCount,
                        copyKeys: getVisibleCompareObjectKeys(onlySourceDetails),
                        action:
                          content.only_source_count > 0
                            ? {
                                type: "sync_source_only" as const,
                                label:
                                  onlySourceHiddenCount > 0
                                    ? remediationVisibleActionLabel.sync_source_only
                                    : remediationActionLabel.sync_source_only,
                              }
                            : null,
                        sourceDetails: onlySourceDetails,
                        targetDetails: [],
                      },
                      {
                        key: "target_only" as const,
                        label: `Target only (${content.only_target_count})`,
                        changed: content.only_target_count > 0,
                        objectCount: content.only_target_count,
                        visibleCount: onlyTargetDetails.length,
                        hiddenCount: onlyTargetHiddenCount,
                        copyKeys: getVisibleCompareObjectKeys(onlyTargetDetails),
                        action:
                          content.only_target_count > 0
                            ? {
                                type: "delete_target_only" as const,
                                label:
                                  onlyTargetHiddenCount > 0
                                    ? remediationVisibleActionLabel.delete_target_only
                                    : remediationActionLabel.delete_target_only,
                              }
                            : null,
                        sourceDetails: [],
                        targetDetails: onlyTargetDetails,
                      },
                      {
                        key: "different" as const,
                        label: `Different objects (${content.different_count})`,
                        changed: content.different_count > 0,
                        objectCount: content.different_count,
                        visibleCount: differentSourceDetails.length,
                        hiddenCount: differentHiddenCount,
                        copyKeys: getVisibleCompareObjectKeys(differentSourceDetails),
                        action:
                          content.different_count > 0
                            ? {
                                type: "sync_different" as const,
                                label:
                                  differentHiddenCount > 0
                                    ? remediationVisibleActionLabel.sync_different
                                    : remediationActionLabel.sync_different,
                              }
                            : null,
                        sourceDetails: differentSourceDetails,
                        targetDetails: differentTargetDetails,
                      },
                    ];
                  })()
                : [];
              const configSections =
                item.result?.config_diff?.sections.map((section) => ({
                  key: section.key,
                  label: section.label,
                  changed: section.changed,
                  before: [{ text: formatUnknown(section.source), tone: section.changed ? ("removed" as const) : undefined }],
                  after: [{ text: formatUnknown(section.target), tone: section.changed ? ("added" as const) : undefined }],
                })) ?? [];
              const configHasDifferences = Boolean(item.result?.config_diff?.changed);
              const bucketHasDifferences = Boolean(item.result?.has_differences);
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
                      <BucketCompareSection
                        summary={
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="ui-caption font-semibold text-slate-700 dark:text-slate-200">
                              Content diff (md5 or size)
                            </span>
                            <ListBadge tone={getChangedTone(contentHasDifferences)}>
                              {contentHasDifferences ? "Different" : "Identical"}
                            </ListBadge>
                          </div>
                        }
                      >
                        <div className="mt-2 space-y-3">
                          {contentSections.map((section) => {
                            const sectionFeedbackId = `${item.sourceBucket}:${item.targetBucket}:content:${section.key}`;
                            const sectionCopyFeedback = copyFeedback?.id === sectionFeedbackId ? copyFeedback : null;
                            const sectionDownloadFeedback =
                              downloadFeedback?.id === sectionFeedbackId ? downloadFeedback : null;
                            const displayLimitMessage = formatCompareDisplayLimitMessage(
                              section.objectCount,
                              section.visibleCount,
                              section.hiddenCount
                            );
                            const sourceContextForRow = item.result?.source_context_id ?? sourceContextId;
                            const targetContextForRow =
                              item.result?.target_context_id || lastRunOptions?.targetContextId || targetContextId || "";
                            const renderObjectActions = (
                              contextId: string,
                              bucket: string,
                              includeRemediation: boolean,
                              remediationVariant: "secondary" | "danger"
                            ) => (detail: ManagerBucketObjectDetail, closeMetadata: () => void) => {
                              const downloadId = `${contextId}:${bucket}:${detail.key}`;
                              const downloadDisabled =
                                Boolean(managerBrowserDisabledReason) || Boolean(downloadInFlight) || running;
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
                                    {downloadInFlight === downloadId ? "Downloading..." : "Download"}
                                  </ListActionButton>
                                  {section.action && includeRemediation && (
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
                                      {item.actionRunning === section.action.type
                                        ? "Running..."
                                        : remediationSingleActionLabel[section.action.type]}
                                    </ListActionButton>
                                  )}
                                </>
                              );
                            };
                            return (
                              <BucketCompareSection
                                key={sectionFeedbackId}
                                summary={
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="ui-caption font-semibold text-slate-700 dark:text-slate-200">{section.label}</span>
                                      <ListBadge tone={getChangedTone(section.changed)}>
                                        {section.changed ? "Different" : "Identical"}
                                      </ListBadge>
                                      {displayLimitMessage && (
                                        <ListBadge tone="warning">
                                          Showing {section.visibleCount} of {section.objectCount}
                                        </ListBadge>
                                      )}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      {section.changed && section.copyKeys.length > 0 && (
                                        <ListActionButton
                                          variant="secondary"
                                          onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            void copyVisibleKeys(sectionFeedbackId, section.copyKeys);
                                          }}
                                        >
                                          Copy keys
                                        </ListActionButton>
                                      )}
                                      {section.action && (
                                        <ListActionButton
                                          variant={section.action.type === "delete_target_only" ? "danger" : "secondary"}
                                          disabled={
                                            running ||
                                            item.status !== "success" ||
                                            !content ||
                                            section.copyKeys.length === 0 ||
                                            Boolean(item.actionRunning) ||
                                            item.actionRunning === section.action.type
                                          }
                                          onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            openRemediationConfirm(
                                              itemIndex,
                                              section.key,
                                              section.copyKeys,
                                              section.hiddenCount > 0
                                            );
                                          }}
                                        >
                                          {item.actionRunning === section.action.type ? "Running..." : section.action.label}
                                        </ListActionButton>
                                      )}
                                    </div>
                                  </div>
                                }
                              >
                                <div className="mt-1 space-y-2 pb-2">
                                  {sectionCopyFeedback && (
                                    <BucketCompareFeedback tone={sectionCopyFeedback.tone} announce>
                                      {sectionCopyFeedback.message}
                                    </BucketCompareFeedback>
                                  )}
                                  {sectionDownloadFeedback && (
                                    <BucketCompareFeedback tone={sectionDownloadFeedback.tone} announce>
                                      {sectionDownloadFeedback.message}
                                    </BucketCompareFeedback>
                                  )}
                                  {displayLimitMessage && (
                                    <BucketCompareFeedback tone="warning">
                                      {displayLimitMessage}
                                    </BucketCompareFeedback>
                                  )}
                                  <div className="grid gap-2 lg:grid-cols-2">
                                    <div className="space-y-1">
                                      <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                        Source
                                      </p>
                                      <BucketCompareObjectDetails rows={section.sourceDetails} options={{
                                        browserDisabledReason: managerBrowserDisabledReason,
                                        buildBrowserHref: (detail) =>
                                          buildManagerBrowserHref(
                                            sourceContextForRow,
                                            item.sourceBucket,
                                            detail.key
                                          ),
                                        renderAction:
                                          section.sourceDetails.length > 0
                                            ? renderObjectActions(
                                                sourceContextForRow,
                                                item.sourceBucket,
                                                section.key !== "target_only",
                                                "secondary"
                                              )
                                            : undefined,
                                      }} />
                                    </div>
                                    <div className="space-y-1">
                                      <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                        Target
                                      </p>
                                      <BucketCompareObjectDetails rows={section.targetDetails} options={{
                                        browserDisabledReason: managerBrowserDisabledReason,
                                        buildBrowserHref: (detail) =>
                                          buildManagerBrowserHref(
                                            targetContextForRow,
                                            item.targetBucket,
                                            detail.key
                                          ),
                                        renderAction:
                                          section.targetDetails.length > 0
                                            ? renderObjectActions(
                                                targetContextForRow,
                                                item.targetBucket,
                                                section.key === "target_only",
                                                "danger"
                                              )
                                            : undefined,
                                      }} />
                                    </div>
                                  </div>
                                </div>
                              </BucketCompareSection>
                            );
                          })}
                        </div>
                      </BucketCompareSection>
                    )}
                    {item.result?.config_diff && (
                      <BucketCompareSection
                        summary={
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="ui-caption font-semibold text-slate-700 dark:text-slate-200">Config diff</span>
                            <ListBadge tone={getChangedTone(configHasDifferences)}>
                              {configHasDifferences ? "Different" : "Identical"}
                            </ListBadge>
                          </div>
                        }
                      >
                        <div className="mt-2 space-y-3">
                          {configSections.map((section) => (
                            <BucketCompareSection
                              key={`${item.sourceBucket}:${item.targetBucket}:config:${section.key}`}
                              summary={
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="ui-caption font-semibold text-slate-700 dark:text-slate-200">{section.label}</span>
                                  <ListBadge tone={getChangedTone(section.changed)}>
                                    {section.changed ? "Different" : "Identical"}
                                  </ListBadge>
                                </div>
                              }
                            >
                              <div className="mt-1 grid gap-2 pb-2 lg:grid-cols-2">
                                <div className="space-y-1">
                                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                    Source
                                  </p>
                                  {renderDiffLines(section.before)}
                                </div>
                                <div className="space-y-1">
                                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                    Target
                                  </p>
                                  {renderDiffLines(section.after)}
                                </div>
                              </div>
                            </BucketCompareSection>
                          ))}
                        </div>
                      </BucketCompareSection>
                    )}
                  </div>
                </BucketCompareResult>
              );
            })}
            {filteredItems.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-300 px-3 py-4 ui-body text-slate-600 dark:border-slate-700 dark:text-slate-300">
                No result matches the current filters.
              </div>
            )}
          </div>
        )}
      </div>
      {pendingAction && pendingActionItem && (
        <ConfirmActionDialog
          title={remediationActionTitle[pendingAction.action]}
          description={<>This will run <strong>{pendingAction.objectKeys.length === 1
            ? remediationSingleActionLabel[pendingAction.action]
            : pendingAction.visibleOnly
              ? remediationVisibleActionLabel[pendingAction.action]
              : remediationActionLabel[pendingAction.action]}</strong> for the exact object keys from the current diff.</>}
          details={[
            { label: "Source context", value: pendingActionSourceContextName },
            { label: "Target context", value: pendingActionTargetContextName },
            { label: "Source bucket", value: pendingActionItem.sourceBucket },
            { label: "Target bucket", value: pendingActionItem.targetBucket },
            { label: "Objects impacted", value: pendingAction.objectKeys.length },
            ...((lastRunOptions?.ignoreModifiedAfterIso ?? ignoreModifiedAfterIso)
              ? [{ label: "Cutoff", value: lastRunOptions?.ignoreModifiedAfterIso ?? ignoreModifiedAfterIso }]
              : []),
            { label: "Object keys", mono: true, value: <ul className="max-h-48 space-y-1 overflow-auto" aria-label="Exact object keys">
              {pendingAction.objectKeys.map((key) => <li key={key}>{key}</li>)}
            </ul> },
          ]}
          impacts={[
            ...(pendingAction.visibleOnly ? ["This diff section is truncated; only displayed keys will be remediated."] : []),
            ...(pendingAction.action === "delete_target_only" ? ["This action is destructive and removes extra objects from the target bucket."] : []),
          ]}
          confirmLabel="Confirm"
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
