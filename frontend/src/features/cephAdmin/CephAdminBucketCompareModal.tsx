/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import BucketCompareSetup, { BucketCompareProgress } from "../shared/BucketCompareSetup";
import WorkflowPage from "../../components/WorkflowPage";
import { ListActionButton, ListBadge } from "../../components/list/ListControls";
import UiButton from "../../components/ui/UiButton";
import {
  BucketCompareFeedback,
  BucketCompareResult,
  BucketCompareResultFilters,
  BucketCompareSection,
} from "../shared/BucketCompareResults";
import BucketCompareObjectDetails from "../shared/BucketCompareObjectDetails";
import UiSelect from "../../components/ui/UiSelect";
import { runWithConcurrencySettled } from "../../utils/concurrency";
import {
  CephAdminBucketCompareResult,
  compareCephAdminBucketPair,
  listCephAdminBuckets,
  type CephAdminBucketCompareConfigFeature,
} from "../../api/cephAdminBuckets";
import type { CephAdminEndpoint } from "../../api/cephAdminEndpoints";
import { cephAdminPageBreadcrumbs } from "./cephAdminBreadcrumbs";
import {
  BUCKET_COMPARE_CONFIG_FEATURE_OPTIONS,
  BucketCompareManualMappingEditor,
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
  triggerJsonDownload,
} from "../../utils/download";

type CompareRunItem = {
  sourceBucket: string;
  targetBucket: string;
  status: "pending" | "running" | "success" | "failed" | "cancelled";
  result?: CephAdminBucketCompareResult;
  error?: string;
};

type PendingExploreNavigation = {
  href: string;
  objectKey: string;
};

type CephAdminBucketCompareModalProps = {
  sourceEndpointId: number;
  sourceEndpointName?: string | null;
  sourceBuckets: string[];
  endpoints: CephAdminEndpoint[];
  onClose: () => void;
};

const extractError = extractCompareError;

const ALL_CONFIG_FEATURE_KEYS = BUCKET_COMPARE_CONFIG_FEATURE_OPTIONS.map((option) => option.key);

export default function CephAdminBucketCompareModal({
  sourceEndpointId,
  sourceEndpointName,
  sourceBuckets,
  endpoints,
  onClose,
}: CephAdminBucketCompareModalProps) {
  const sortedSourceBuckets = useMemo(() => [...sourceBuckets].sort((a, b) => a.localeCompare(b)), [sourceBuckets]);
  const targetEndpointOptions = useMemo(() => endpoints, [endpoints]);
  const [targetEndpointId, setTargetEndpointId] = useState<number | null>(null);
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
  const [pendingExplore, setPendingExplore] = useState<PendingExploreNavigation | null>(null);
  const [resultSearch, setResultSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | CompareRunItem["status"]>("all");
  const [diffFilter, setDiffFilter] = useState<"all" | "with_diff" | "no_diff">("all");
  const sameEndpointSelected = targetEndpointId === sourceEndpointId;
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
    sameTargetSelected: sameEndpointSelected,
  });
  const {
    selectedConfigFeatures,
    setSelectedConfigFeatures,
    toggleConfigFeature,
  } = useBucketCompareConfigFeatures<CephAdminBucketCompareConfigFeature>(
    ALL_CONFIG_FEATURE_KEYS
  );
  const {
    cancelRequestedRef,
    items,
    progress,
    setItems,
    setProgress,
    settleRunItem,
  } = useBucketCompareRunState<CephAdminBucketCompareResult, CompareRunItem>();
  const requestControllersRef = useRef(new Set<AbortController>());
  const { copyFeedback, copyVisibleKeys } = useCompareVisibleKeysClipboard();


  useEffect(() => {
    if (targetEndpointOptions.length === 0) {
      setTargetEndpointId(null);
      return;
    }
    setTargetEndpointId((prev) => {
      if (prev !== null && targetEndpointOptions.some((endpoint) => endpoint.id === prev)) {
        return prev;
      }
      return null;
    });
  }, [targetEndpointOptions]);

  useEffect(() => {
    if (sameEndpointSelected && mappingMode !== "manual") {
      setMappingMode("manual");
    }
  }, [mappingMode, sameEndpointSelected]);

  useEffect(() => {
    if (!targetEndpointId) {
      setTargetBucketNames([]);
      setTargetBucketsError("Select a target endpoint.");
      return;
    }
    let cancelled = false;
    const load = async () => {
      setTargetBucketsLoading(true);
      setTargetBucketsError(null);
      try {
        const names: string[] = [];
        const seen = new Set<string>();
        let page = 1;
        while (true) {
          const response = await listCephAdminBuckets(targetEndpointId, {
            page,
            page_size: 200,
            sort_by: "name",
            sort_dir: "asc",
            with_stats: false,
          });
          response.items.forEach((bucket) => {
            const name = (bucket.name ?? "").trim();
            if (!name || seen.has(name)) return;
            seen.add(name);
            names.push(name);
          });
          if (!response.has_next) break;
          page += 1;
        }
        if (cancelled) return;
        names.sort((a, b) => a.localeCompare(b));
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
  }, [sourceEndpointId, targetEndpointId]);

  const {
    availableTargetBucketNames,
    resolvedManualMapping,
    comparePlan,
    missingByName,
  } = useMemo(
    () =>
      buildBucketCompareMappingModel({
        targetSelected: Boolean(targetEndpointId),
        targetKind: "endpoint",
        sourceBuckets: sortedSourceBuckets,
        targetBuckets: targetBucketNames,
        sameTargetSelected: sameEndpointSelected,
        mappingMode,
        rawMapping: parsedRawMapping.mapping,
        manualMapping,
      }),
    [
      manualMapping,
      mappingMode,
      parsedRawMapping.mapping,
      sameEndpointSelected,
      sortedSourceBuckets,
      targetBucketNames,
      targetEndpointId,
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
  const canRunComparison =
    !running &&
    !comparePlan.error &&
    Boolean(targetEndpointId) &&
    hasScopeSelected &&
    (!includeConfig || hasConfigFeatureSelected) &&
    !ignoreModifiedAfterInvalid;

  const buildCephAdminBrowserHref = useCallback((endpointId: number, bucket: string, key: string) => {
    const params = new URLSearchParams();
    params.set("ep", String(endpointId));
    params.set("bucket", bucket);
    const prefix = getObjectParentPrefix(key);
    if (prefix) params.set("prefix", prefix);
    return `/ceph-admin/browser?${params.toString()}`;
  }, []);

  const runCompare = async () => {
    if (!targetEndpointId) {
      setRunError("Select a target endpoint.");
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
      }))
    );

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
          return await compareCephAdminBucketPair(
            sourceEndpointId,
            {
              target_endpoint_id: targetEndpointId,
              source_bucket: mapping.sourceBucket,
              target_bucket: mapping.targetBucket,
              include_content: includeContent,
              include_config: includeConfig,
              config_features: includeConfig ? selectedConfigFeatures : undefined,
              ignore_modified_after: ignoreModifiedAfterIso,
            },
            { signal: controller.signal }
          );
        } finally {
          requestControllersRef.current.delete(controller);
        }
      },
      settleRunItem
    );
    requestControllersRef.current.forEach((controller) => controller.abort());
    requestControllersRef.current.clear();
    setRunning(false);
    setStopping(false);
  };

  const resultSummary = useMemo(() => summarizeBucketCompareRun(items), [items]);

  const filteredItems = useMemo(() => {
    return items.filter((item) =>
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
    const requestControllers = requestControllersRef.current;
    return () => {
      cancelRequestedRef.current = true;
      requestControllers.forEach((controller) => controller.abort());
      requestControllers.clear();
    };
  }, [cancelRequestedRef]);

  const exportGlobalDiff = () => {
    if (items.length === 0) return;
    const targetEndpoint = endpoints.find((endpoint) => endpoint.id === targetEndpointId);
    const payload = {
      generated_at: new Date().toISOString(),
      source_endpoint: {
        id: sourceEndpointId,
        name: sourceEndpointName ?? `Endpoint #${sourceEndpointId}`,
      },
      target_endpoint: targetEndpointId
        ? {
            id: targetEndpointId,
            name: targetEndpoint?.name ?? `Endpoint #${targetEndpointId}`,
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
    const filename = `bucket-compare-${sourceEndpointId}-to-${targetEndpointId ?? "na"}-${timestamp}.json`;
    triggerJsonDownload(filename, payload);
  };

  const openExploreConfirm = useCallback((href: string, detail: { key: string }) => {
    setPendingExplore({ href, objectKey: detail.key });
  }, []);

  const confirmExploreNavigation = useCallback(() => {
    if (!pendingExplore) return;
    window.location.assign(pendingExplore.href);
  }, [pendingExplore]);

  return (
    <WorkflowPage
      title="Compare buckets"
      description="Map source and target buckets, run the comparison and review or export the resulting differences."
      breadcrumbs={cephAdminPageBreadcrumbs("buckets", { label: "Compare" })}
      onBack={handleClose}
      backLabel={running ? "Stop and return" : "Back to buckets"}
      contentClassName="min-w-0"
    >
      <div className="space-y-4">
        <BucketCompareSetup
          sourceCount={sortedSourceBuckets.length}
          sourceName={sourceEndpointName ?? `Endpoint #${sourceEndpointId}`}
          targetKind="endpoint"
          sameTarget={sameEndpointSelected}
          targetSelector={
            <UiSelect
              label="Target endpoint"
              value={targetEndpointId ?? ""}
              onChange={(event) => setTargetEndpointId(event.target.value ? Number(event.target.value) : null)}
              disabled={running || targetEndpointOptions.length === 0}
            >
              {targetEndpointOptions.length > 0 && <option value="">Select a target endpoint</option>}
              {targetEndpointOptions.length === 0 && <option value="">No other endpoint available</option>}
              {targetEndpointOptions.map((endpoint) => (
                <option key={endpoint.id} value={endpoint.id}>
                  {endpoint.name}
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
            {filteredItems.map((item) => {
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
                        key: "source_only",
                        label: `Source only (${content.only_source_count})`,
                        changed: content.only_source_count > 0,
                        objectCount: content.only_source_count,
                        visibleCount: onlySourceDetails.length,
                        hiddenCount: onlySourceHiddenCount,
                        copyKeys: getVisibleCompareObjectKeys(onlySourceDetails),
                        sourceDetails: onlySourceDetails,
                        targetDetails: [],
                      },
                      {
                        key: "target_only",
                        label: `Target only (${content.only_target_count})`,
                        changed: content.only_target_count > 0,
                        objectCount: content.only_target_count,
                        visibleCount: onlyTargetDetails.length,
                        hiddenCount: onlyTargetHiddenCount,
                        copyKeys: getVisibleCompareObjectKeys(onlyTargetDetails),
                        sourceDetails: [],
                        targetDetails: onlyTargetDetails,
                      },
                      {
                        key: "different",
                        label: `Different objects (${content.different_count})`,
                        changed: content.different_count > 0,
                        objectCount: content.different_count,
                        visibleCount: differentSourceDetails.length,
                        hiddenCount: differentHiddenCount,
                        copyKeys: getVisibleCompareObjectKeys(differentSourceDetails),
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
                            const displayLimitMessage = formatCompareDisplayLimitMessage(
                              section.objectCount,
                              section.visibleCount,
                              section.hiddenCount
                            );
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
                                  </div>
                                }
                              >
                                <div className="mt-1 space-y-2 pb-2">
                                  {sectionCopyFeedback && (
                                    <BucketCompareFeedback tone={sectionCopyFeedback.tone} announce>
                                      {sectionCopyFeedback.message}
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
                                        onExplore: openExploreConfirm,
                                        buildBrowserHref: (detail) =>
                                          buildCephAdminBrowserHref(sourceEndpointId, item.sourceBucket, detail.key),
                                      }} />
                                    </div>
                                    <div className="space-y-1">
                                      <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                        Target
                                      </p>
                                      <BucketCompareObjectDetails rows={section.targetDetails} options={{
                                        onExplore: openExploreConfirm,
                                        buildBrowserHref: (detail) =>
                                          buildCephAdminBrowserHref(
                                            item.result?.target_endpoint_id ?? targetEndpointId ?? sourceEndpointId,
                                            item.targetBucket,
                                            detail.key
                                          ),
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
      {pendingExplore && (
        <ConfirmActionDialog
          title="Leave comparison page?"
          description="This will leave the bucket comparison page and open this object in Browser."
          details={[{ label: "Object key", value: pendingExplore.objectKey, mono: true }]}
          confirmLabel="Open Browser"
          tone="primary"
          maxWidthClass="max-w-lg"
          zIndexClass="z-[60]"
          onCancel={() => setPendingExplore(null)}
          onConfirm={confirmExploreNavigation}
        />
      )}
    </WorkflowPage>
  );
}
