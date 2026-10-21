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
import BucketPurgeRunModal from "../shared/BucketPurgeRunModal";
import ManagerBucketSelectionPanel from "./ManagerBucketSelectionPanel";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import { useManagerBucketSelection } from "./useManagerBucketSelection";
import { useManagerI18n } from "./managerI18n";

export default function ManagerBucketPurgePage() {
  const { text } = useManagerI18n();
  const {
    clearSelection,
    error,
    filter,
    filteredBuckets,
    loading,
    requiresContextSelection,
    selectedBuckets,
    selectedTargets,
    selectAllFiltered,
    setFilter,
    sourceContext,
    sourceContextId,
    tableStatus,
    toggleBucket,
  } = useManagerBucketSelection();
  const [showPurgeModal, setShowPurgeModal] = useState(false);

  return (
    <div className={workflowPageHostClass(showPurgeModal)}>
      <PageHeader
        title={text("Bucket purge")}
        description={text("Empty selected buckets without deleting bucket configuration.")}
        breadcrumbs={managerPageBreadcrumbs(text, "purge")}
      />

      {error && <PageBanner tone="error">{text(error)}</PageBanner>}

      {!requiresContextSelection ? (
        <PageEmptyState
          title={text("Bucket purge is unavailable in session mode")}
          description={text("This tool needs a persistent execution context so the selected buckets can be purged with the same manager identity.")}
          primaryAction={{ label: text("Open buckets"), to: "/manager/buckets" }}
          tone="warning"
        />
      ) : !sourceContextId ? (
        <PageEmptyState
          title={text("Select a context before purging buckets")}
          description={text("Choose a manager execution context to load its buckets and launch a purge.")}
          primaryAction={{ label: text("Open dashboard"), to: "/manager" }}
          tone="warning"
        />
      ) : (
        <ManagerBucketSelectionPanel
          description={text("{context} · Select buckets to purge.", {
            context: sourceContext ? sourceContext.display_name : text("Source context"),
          })}
          filter={filter}
          filterPlaceholder={text("Filter buckets")}
          onFilterChange={setFilter}
          buckets={filteredBuckets}
          selectedBuckets={selectedBuckets}
          onToggleBucket={toggleBucket}
          onSelectFiltered={selectAllFiltered}
          onClearSelection={clearSelection}
          tableStatus={tableStatus}
          loadingMessage={text("Loading buckets...")}
          errorMessage={text("Unable to load buckets.")}
          emptyMessage={text("No buckets.")}
          action={
            <UiButton
              type="button"
              onClick={() => setShowPurgeModal(true)}
              disabled={selectedBuckets.size === 0 || loading}
              variant="danger"
              size="sm"
            >
              {text("Purge selected (")}{selectedBuckets.size})
            </UiButton>
          }
        />
      )}

      {showPurgeModal && sourceContextId && selectedTargets.length > 0 && (
        <BucketPurgeRunModal
          mode="manager"
          contextId={sourceContextId}
          contextName={sourceContext?.display_name ?? sourceContextId}
          targets={selectedTargets}
          onClose={() => setShowPurgeModal(false)}
        />
      )}
    </div>
  );
}
