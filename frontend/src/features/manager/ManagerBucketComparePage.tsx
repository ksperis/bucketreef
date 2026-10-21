/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useState } from "react";

import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import { workflowPageHostClass } from "../../components/WorkflowPage";
import UiButton from "../../components/ui/UiButton";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import ManagerBucketCompareModal from "./ManagerBucketCompareModal";
import ManagerBucketSelectionPanel from "./ManagerBucketSelectionPanel";
import { useExecutionContext } from "./ExecutionContextProvider";
import { useManagerContexts } from "./useManagerContexts";
import { useManagerBucketSelection } from "./useManagerBucketSelection";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import { useManagerI18n } from "./managerI18n";

export default function ManagerBucketComparePage() {
  const { text } = useManagerI18n();
  const { managerBrowserEnabled } = useExecutionContext();
  const { generalSettings } = useGeneralSettings();
  const { contexts, contextsLoading, contextsError } = useManagerContexts();
  const {
    clearSelection,
    error: bucketsError,
    filter,
    filteredBuckets,
    loading: bucketsLoading,
    requiresContextSelection,
    selectedBucketList,
    selectedBuckets,
    selectAllFiltered,
    setFilter,
    sourceContext,
    sourceContextId,
    tableStatus,
    toggleBucket,
  } = useManagerBucketSelection();
  const [showCompareModal, setShowCompareModal] = useState(false);
  const managerBrowserAvailable =
    generalSettings.browser_enabled && generalSettings.browser_manager_enabled && managerBrowserEnabled === true;

  const openCompareModal = () => {
    if (selectedBuckets.size === 0) return;
    setShowCompareModal(true);
  };

  return (
    <div className={workflowPageHostClass(showCompareModal)}>
      <PageHeader
        title={text("Bucket compare")}
        description={text("Compare selected buckets across manager contexts.")}
        breadcrumbs={managerPageBreadcrumbs(text, "compare")}
      />

      {contextsError && <PageBanner tone="error">{text(contextsError)}</PageBanner>}
      {bucketsError && <PageBanner tone="error">{text(bucketsError)}</PageBanner>}

      {!requiresContextSelection ? (
        <PageEmptyState
          title={text("Bucket compare is unavailable in session mode")}
          description={text("This tool needs a persistent execution context so it can load a source inventory and compare it against other manager contexts.")}
          primaryAction={{ label: text("Open buckets"), to: "/manager/buckets" }}
          tone="warning"
        />
      ) : !sourceContextId ? (
        <PageEmptyState
          title={text("Select a source context before comparing buckets")}
          description={text("Choose a manager execution context to load its buckets, filter the source inventory, and compare selected buckets against other targets.")}
          primaryAction={{ label: text("Open dashboard"), to: "/manager" }}
          tone="warning"
        />
      ) : (
        <ManagerBucketSelectionPanel
          description={text("{context} · Select source buckets to compare across manager contexts.", {
            context: sourceContext ? sourceContext.display_name : text("Source context"),
          })}
          filter={filter}
          filterPlaceholder={text("Filter source buckets")}
          onFilterChange={setFilter}
          buckets={filteredBuckets}
          selectedBuckets={selectedBuckets}
          onToggleBucket={toggleBucket}
          onSelectFiltered={selectAllFiltered}
          onClearSelection={clearSelection}
          tableStatus={tableStatus}
          loadingMessage={text("Loading source buckets...")}
          errorMessage={text("Unable to load buckets.")}
          emptyMessage={text("No buckets.")}
          action={
            <UiButton
              type="button"
              onClick={openCompareModal}
              disabled={selectedBuckets.size === 0 || bucketsLoading || contextsLoading}
              size="sm"
            >
              {text("Compare selected (")}{selectedBuckets.size})
            </UiButton>
          }
        />
      )}

      {showCompareModal && sourceContextId && selectedBucketList.length > 0 && (
        <ManagerBucketCompareModal
          sourceContextId={sourceContextId}
          sourceContextName={sourceContext?.display_name ?? sourceContextId}
          sourceBuckets={selectedBucketList}
          contexts={contexts}
          managerBrowserEnabled={managerBrowserAvailable}
          onClose={() => setShowCompareModal(false)}
        />
      )}
    </div>
  );
}
