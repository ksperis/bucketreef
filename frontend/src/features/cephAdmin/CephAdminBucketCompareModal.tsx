/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import PaginationControls from "../../components/PaginationControls";
import BucketCompareSetup, { BucketCompareProgress } from "../shared/BucketCompareSetup";
import WorkflowPage from "../../components/WorkflowPage";
import { ListBadge } from "../../components/list/ListControls";
import UiButton from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import {
  BucketCompareContentDiff,
  BucketCompareFeedback,
  BucketCompareResult,
  BucketCompareResultFilters,
  BucketCompareSection,
} from "../shared/BucketCompareResults";
import UiSelect from "../../components/ui/UiSelect";
import { runWithConcurrencySettled } from "../../utils/concurrency";
import {
  CephAdminBucketCompareResult,
  compareCephAdminBucketPair,
  listCephAdminBuckets,
} from "../../api/cephAdminBuckets";
import type { BucketCompareConfigFeature } from "../../api/bucketCompareContracts";
import type { CephAdminEndpoint } from "../../api/cephAdminEndpoints";
import type { RgwBucketReference } from "../../api/bucketOperation";
import { cephAdminPageBreadcrumbs } from "./cephAdminBreadcrumbs";
import {
  BUCKET_COMPARE_CONFIG_FEATURE_OPTIONS,
  formatUnknown,
  getChangedTone,
  matchesBucketCompareRunFilters,
  normalizeBucketCompareParallelism,
  renderDiffLines,
  resolveBucketCompareRunError,
  summarizeBucketCompareRun,
  useBucketCompareWorkflowState,
} from "../shared/bucketCompareShared";
import { BucketCompareManualMappingEditor } from "../shared/bucketCompareMapping";
import {
  buildBucketCompareContentSections,
  getObjectParentPrefix,
} from "../shared/bucketCompareContentDiff";
import {
  formatDownloadTimestamp,
  triggerJsonDownload,
} from "../../utils/download";
import { useCephAdminI18n } from "./cephAdminI18n";
import usePaginatedOptions from "../../hooks/usePaginatedOptions";

type CompareRunItem = {
  sourceBucket: string;
  targetBucket: string;
  sourceRef: RgwBucketReference;
  targetRef: RgwBucketReference;
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
  sourceBuckets: RgwBucketReference[];
  endpoints: CephAdminEndpoint[];
  onClose: () => void;
};

const ALL_CONFIG_FEATURE_KEYS = BUCKET_COMPARE_CONFIG_FEATURE_OPTIONS.map((option) => option.key);

function normalizeBucketReference(reference: RgwBucketReference): RgwBucketReference {
  return {
    name: reference.name.trim(),
    tenant: reference.tenant?.trim() ?? "",
  };
}

function bucketReferenceLabel(reference: RgwBucketReference): string {
  const normalized = normalizeBucketReference(reference);
  return normalized.tenant ? `${normalized.tenant}/${normalized.name}` : normalized.name;
}

function bucketReferenceFromLabel(label: string): RgwBucketReference {
  const normalized = label.trim();
  const separator = normalized.indexOf("/");
  if (separator <= 0) return { name: normalized, tenant: "" };
  return normalizeBucketReference({
    tenant: normalized.slice(0, separator),
    name: normalized.slice(separator + 1),
  });
}

export default function CephAdminBucketCompareModal({
  sourceEndpointId,
  sourceEndpointName,
  sourceBuckets,
  endpoints,
  onClose,
}: CephAdminBucketCompareModalProps) {
  const { text: surfaceText } = useCephAdminI18n();
  const sortedSourceReferences = useMemo(
    () => [...sourceBuckets]
      .map(normalizeBucketReference)
      .sort((left, right) => bucketReferenceLabel(left).localeCompare(bucketReferenceLabel(right))),
    [sourceBuckets],
  );
  const sortedSourceBuckets = useMemo(
    () => sortedSourceReferences.map(bucketReferenceLabel),
    [sortedSourceReferences],
  );
  const sourceReferenceByLabel = useMemo(
    () => new Map(sortedSourceReferences.map((reference) => [bucketReferenceLabel(reference), reference])),
    [sortedSourceReferences],
  );
  const targetEndpointOptions = useMemo(() => endpoints, [endpoints]);
  const [targetEndpointId, setTargetEndpointId] = useState<number | null>(null);
  const [pendingExplore, setPendingExplore] = useState<PendingExploreNavigation | null>(null);
  const sameEndpointSelected = targetEndpointId === sourceEndpointId;
  const loadTargetBucketOptions = useCallback(
    (query: { page?: number; page_size?: number; search?: string }) => {
      if (!targetEndpointId) {
        return Promise.resolve({ items: [], total: 0, page: 1, page_size: query.page_size ?? 25, has_next: false });
      }
      return listCephAdminBuckets(targetEndpointId, {
        page: query.page,
        page_size: query.page_size,
        filter: query.search,
        sort_by: "name",
        sort_dir: "asc",
        with_stats: false,
      });
    },
    [targetEndpointId],
  );
  const targetBucketCatalog = usePaginatedOptions(loadTargetBucketOptions, {
    enabled: Boolean(targetEndpointId),
    initialPageSize: 25,
  });
  const targetBucketNames = useMemo(
    () => targetBucketCatalog.items.map((bucket) => bucketReferenceLabel({ name: bucket.name, tenant: bucket.tenant ?? "" })),
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
    settleRunItem,
    beginRun,
    executeRunItem,
    finishRun,
    stopRun,
    copyFeedback,
    copyVisibleKeys,
  } = useBucketCompareWorkflowState<
    BucketCompareConfigFeature,
    CephAdminBucketCompareResult,
    CompareRunItem
  >({
    targetSelected: Boolean(targetEndpointId),
    targetKind: "endpoint",
    sourceBuckets: sortedSourceBuckets,
    targetBuckets: targetBucketNames,
    targetInventoryComplete: false,
    sameTargetSelected: sameEndpointSelected,
    configFeatures: ALL_CONFIG_FEATURE_KEYS,
  });


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

  const runValidationError = resolveBucketCompareRunError({
    targetSelected: Boolean(targetEndpointId),
    hasScopeSelected,
    includeConfig,
    hasConfigFeatureSelected,
    ignoreModifiedAfterInvalid,
    planError: comparePlan.error,
    messages: {
      targetRequired: surfaceText("Select a target endpoint."),
      scopeRequired: surfaceText("Select at least one comparison scope: content and/or configuration."),
      configFeatureRequired: surfaceText("Select at least one configuration feature or disable configuration scope."),
      invalidCutoff: surfaceText("Enter a valid modified-after cutoff or clear the field."),
    },
  });
  const canRunComparison = !running && !runValidationError;

  const buildCephAdminBrowserHref = useCallback((endpointId: number, bucket: RgwBucketReference, key: string) => {
    const params = new URLSearchParams();
    params.set("ep", String(endpointId));
    params.set("bucket", bucket.name);
    if (bucket.tenant?.trim()) params.set("tenant", bucket.tenant.trim());
    const prefix = getObjectParentPrefix(key);
    if (prefix) params.set("prefix", prefix);
    return `/ceph-admin/browser?${params.toString()}`;
  }, []);

  const runCompare = async () => {
    if (runValidationError || !targetEndpointId) {
      setRunError(runValidationError ?? surfaceText("Select a target endpoint."));
      return;
    }
    const safeParallelism = normalizeBucketCompareParallelism(parallelism);
    const mappings = comparePlan.mappings;
    const initialItems = mappings.map((mapping) => {
      const sourceRef = sourceReferenceByLabel.get(mapping.sourceBucket);
      const targetRef = bucketReferenceFromLabel(mapping.targetBucket);
      if (!sourceRef || !targetRef.name) {
        throw new Error("Unable to resolve the selected tenant-aware bucket mapping.");
      }
      return {
        sourceBucket: mapping.sourceBucket,
        targetBucket: mapping.targetBucket,
        sourceRef,
        targetRef,
        status: "pending" as const,
      };
    });
    beginRun(initialItems);

    try {
      await runWithConcurrencySettled(
        mappings,
        safeParallelism,
        (mapping, index) =>
          executeRunItem(index, (signal) => {
            const sourceRef = sourceReferenceByLabel.get(mapping.sourceBucket);
            const targetRef = bucketReferenceFromLabel(mapping.targetBucket);
            if (!sourceRef || !targetRef.name) {
              throw new Error("Unable to resolve the selected tenant-aware bucket mapping.");
            }
            return compareCephAdminBucketPair(
              sourceEndpointId,
              {
                target_endpoint_id: targetEndpointId,
                source: sourceRef,
                target: targetRef,
                include_content: includeContent,
                include_config: includeConfig,
                config_features: includeConfig ? selectedConfigFeatures : undefined,
                ignore_modified_after: ignoreModifiedAfterIso,
              },
              { signal },
            );
          }),
        settleRunItem,
      );
    } finally {
      finishRun();
    }
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
    stopRun();
  }, [stopRun]);

  const handleClose = useCallback(() => {
    stopComparison();
    onClose();
  }, [onClose, stopComparison]);

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
        source: item.sourceRef,
        target: item.targetRef,
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
      title={surfaceText("Compare buckets")}
      description={surfaceText("Map source and target buckets, run the comparison and review or export the resulting differences.")}
      breadcrumbs={cephAdminPageBreadcrumbs("buckets", { label: surfaceText("Compare") })}
      onBack={handleClose}
      backLabel={running ? surfaceText("Stop and return") : surfaceText("Back to buckets")}
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
              label={surfaceText("Target endpoint")}
              value={targetEndpointId ?? ""}
              onChange={(event) => setTargetEndpointId(event.target.value ? Number(event.target.value) : null)}
              disabled={running || targetEndpointOptions.length === 0}
            >
              {targetEndpointOptions.length > 0 && <option value="">{surfaceText("Select a target endpoint")}</option>}
              {targetEndpointOptions.length === 0 && <option value="">{surfaceText("No other endpoint available")}</option>}
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
                {running ? surfaceText("Comparing...") : surfaceText("Run comparison")}
              </UiButton>
              <UiButton onClick={stopComparison} disabled={!running} variant="warning" className="ui-body">
                {stopping ? surfaceText("Stopping...") : surfaceText("Stop")}
              </UiButton>
              <UiButton onClick={exportGlobalDiff} disabled={running || items.length === 0} variant="secondary" className="ui-body">
                {surfaceText("Export global diff")}</UiButton>
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
                label={surfaceText("Search target buckets")}
                value={targetBucketCatalog.search}
                onChange={(event) => targetBucketCatalog.setSearch(event.target.value)}
                disabled={running || !targetEndpointId}
                size="compact"
              />
              {targetBucketCatalog.loading && (
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  {surfaceText("Loading target buckets...")}
                </p>
              )}
              {targetBucketCatalog.error && (
                <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">
                  {targetBucketCatalog.error}
                </p>
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
            {surfaceText("Done:")}{resultSummary.success} {surfaceText("/ Failed:")}{resultSummary.failed} {surfaceText("/ Cancelled:")}{resultSummary.cancelled} {surfaceText("/ With differences:")}{resultSummary.withDiff}
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
              const contentSections = content
                ? buildBucketCompareContentSections(content).map((section) => ({
                    ...section,
                    label:
                      section.key === "source_only"
                        ? surfaceText("Source only ({count})", { count: section.objectCount })
                        : section.key === "target_only"
                          ? surfaceText("Target only ({count})", { count: section.objectCount })
                          : surfaceText("Different objects ({count})", { count: section.objectCount }),
                  }))
                : [];
              const configSections =
                item.result?.config_diff?.sections.map((section) => ({
                  key: section.key,
                  label: surfaceText(section.label),
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
                      <BucketCompareContentDiff
                        sectionIdPrefix={`${item.sourceBucket}:${item.targetBucket}:content`}
                        sections={contentSections}
                        copyFeedback={copyFeedback}
                        onCopyVisibleKeys={copyVisibleKeys}
                        getSourceOptions={() => ({
                          onExplore: openExploreConfirm,
                          buildBrowserHref: (detail) =>
                            buildCephAdminBrowserHref(sourceEndpointId, item.sourceRef, detail.key),
                        })}
                        getTargetOptions={() => ({
                          onExplore: openExploreConfirm,
                          buildBrowserHref: (detail) =>
                            buildCephAdminBrowserHref(
                              item.result?.target_endpoint_id ?? targetEndpointId ?? sourceEndpointId,
                              item.targetRef,
                              detail.key,
                            ),
                        })}
                      />
                    )}
                    {item.result?.config_diff && (
                      <BucketCompareSection
                        summary={
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="ui-caption font-semibold text-slate-700 dark:text-slate-200">{surfaceText("Config diff")}</span>
                            <ListBadge tone={getChangedTone(configHasDifferences)}>
                              {configHasDifferences ? surfaceText("Different") : surfaceText("Identical")}
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
                                    {section.changed ? surfaceText("Different") : surfaceText("Identical")}
                                  </ListBadge>
                                </div>
                              }
                            >
                              <div className="mt-1 grid gap-2 pb-2 lg:grid-cols-2">
                                <div className="space-y-1">
                                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                    {surfaceText("Source")}</p>
                                  {renderDiffLines(section.before)}
                                </div>
                                <div className="space-y-1">
                                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                    {surfaceText("Target")}</p>
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
                {surfaceText("No result matches the current filters.")}</div>
            )}
          </div>
        )}
      </div>
      {pendingExplore && (
        <ConfirmActionDialog
          title={surfaceText("Leave comparison page?")}
          description={surfaceText("This will leave the bucket comparison page and open this object in Browser.")}
          details={[{ label: surfaceText("Object key"), value: pendingExplore.objectKey, mono: true }]}
          confirmLabel={surfaceText("Open Browser")}
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
