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
import BucketIntegrityCheckModal from "../shared/BucketIntegrityCheckModal";
import ManagerBucketSelectionPanel from "./ManagerBucketSelectionPanel";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import { useManagerBucketSelection } from "./useManagerBucketSelection";
import { useManagerI18n } from "./managerI18n";

export default function ManagerBucketIntegrityPage() {
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
  const [showIntegrityModal, setShowIntegrityModal] = useState(false);

  return (
    <div className={workflowPageHostClass(showIntegrityModal)}>
      <PageHeader
        title={text("Bucket integrity")}
        description={text("Read selected bucket objects and report retrieval failures.")}
        breadcrumbs={managerPageBreadcrumbs(text, "integrity")}
      />

      {error && <PageBanner tone="error">{text(error)}</PageBanner>}

      {!requiresContextSelection ? (
        <PageEmptyState
          title={text("Bucket integrity is unavailable in session mode")}
          description={text("This tool needs a persistent execution context so the selected buckets can be checked with the same manager identity.")}
          primaryAction={{ label: text("Open buckets"), to: "/manager/buckets" }}
          tone="warning"
        />
      ) : !sourceContextId ? (
        <PageEmptyState
          title={text("Select a context before checking buckets")}
          description={text("Choose a manager execution context to load its buckets and launch an integrity check.")}
          primaryAction={{ label: text("Open dashboard"), to: "/manager" }}
          tone="warning"
        />
      ) : (
        <ManagerBucketSelectionPanel
          description={text("{context} · Select buckets to check.", {
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
              onClick={() => setShowIntegrityModal(true)}
              disabled={selectedBuckets.size === 0 || loading}
              size="sm"
            >
              {text("Check selected (")}{selectedBuckets.size})
            </UiButton>
          }
        />
      )}

      {showIntegrityModal && sourceContextId && selectedTargets.length > 0 && (
        <BucketIntegrityCheckModal
          mode="manager"
          contextId={sourceContextId}
          contextName={sourceContext?.display_name ?? sourceContextId}
          targets={selectedTargets}
          onClose={() => setShowIntegrityModal(false)}
        />
      )}
    </div>
  );
}
