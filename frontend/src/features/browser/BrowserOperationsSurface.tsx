/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import BrowserOperationsModal from "./BrowserOperationsModal";
import BrowserOperationsPanel from "./BrowserOperationsPanel";
import type { useBrowserOperationOverview } from "./useBrowserOperationOverview";

type BrowserOperationOverview = ReturnType<typeof useBrowserOperationOverview>;

type BrowserOperationsSurfaceProps = {
  overview: BrowserOperationOverview;
  cancelOperation: (operationId: string) => void;
  cancelUploadGroup: (groupId: string) => void;
  cancelUploadOperation: (operationId: string) => void;
  removeQueuedUpload: (uploadId: string) => void;
};

export default function BrowserOperationsSurface({
  overview,
  cancelOperation,
  cancelUploadGroup,
  cancelUploadOperation,
  removeQueuedUpload,
}: BrowserOperationsSurfaceProps) {
  const {
    activeOperationsCount,
    allOtherOperations,
    clearFinishedOperations,
    closeOperationsDetailsModal,
    completedOperationsCount,
    copyGroups,
    deleteGroups,
    dismissOperationsPanel,
    downloadGroups,
    downloadOperationDetails,
    failedOperationsCount,
    filtersAllInactive,
    getSectionVisibleCount,
    hasFinishedOperations,
    hasOperationsPanelContent,
    hasPendingOperations,
    isGroupExpanded,
    openOperationsDetailsModal,
    operationsPanelOpen,
    operationsPanelTotalCount,
    operationSortFallback,
    operationSortIndexById,
    queuedOperationsCount,
    showActiveOperations,
    showCompletedOperations,
    showFailedOperations,
    showMoreSection,
    showOperationsDetailsModal,
    showOperationsPanel,
    showQueuedOperations,
    toggleGroupExpanded,
    toggleOperationFilter,
    toggleOperationsPanel,
    uploadGroups,
    uploadGroupSortIndexById,
    visibleCopyGroups,
    visibleDeleteGroups,
    visibleDownloadGroups,
    visibleOtherOperations,
    visibleUploadGroups,
  } = overview;

  return (
    <>
      {showOperationsPanel && (
        <BrowserOperationsPanel
          open={operationsPanelOpen}
          totalOperationsCount={operationsPanelTotalCount}
          activeOperationsCount={activeOperationsCount}
          queuedOperationsCount={queuedOperationsCount}
          completedOperationsCount={completedOperationsCount}
          failedOperationsCount={failedOperationsCount}
          downloadGroups={downloadGroups}
          deleteGroups={deleteGroups}
          copyGroups={copyGroups}
          uploadGroups={uploadGroups}
          otherOperations={allOtherOperations}
          operationSortIndexById={operationSortIndexById}
          uploadGroupSortIndexById={uploadGroupSortIndexById}
          operationSortFallback={operationSortFallback}
          cancelOperation={cancelOperation}
          cancelUploadGroup={cancelUploadGroup}
          hasFinishedOperations={hasFinishedOperations}
          canDismiss={!hasPendingOperations}
          onClearFinishedOperations={clearFinishedOperations}
          onDismiss={dismissOperationsPanel}
          onOpenDetails={openOperationsDetailsModal}
          onToggleOpen={toggleOperationsPanel}
        />
      )}
      {showOperationsDetailsModal && hasOperationsPanelContent && (
        <BrowserOperationsModal
          totalOperationsCount={operationsPanelTotalCount}
          activeOperationsCount={activeOperationsCount}
          queuedOperationsCount={queuedOperationsCount}
          completedOperationsCount={completedOperationsCount}
          failedOperationsCount={failedOperationsCount}
          showActiveOperations={showActiveOperations}
          showQueuedOperations={showQueuedOperations}
          showCompletedOperations={showCompletedOperations}
          showFailedOperations={showFailedOperations}
          filtersAllInactive={filtersAllInactive}
          onToggleActive={() => toggleOperationFilter("active")}
          onToggleQueued={() => toggleOperationFilter("queued")}
          onToggleCompleted={() => toggleOperationFilter("completed")}
          onToggleFailed={() => toggleOperationFilter("failed")}
          visibleDownloadGroups={visibleDownloadGroups}
          visibleDeleteGroups={visibleDeleteGroups}
          visibleCopyGroups={visibleCopyGroups}
          visibleUploadGroups={visibleUploadGroups}
          visibleOtherOperations={visibleOtherOperations}
          operationSortIndexById={operationSortIndexById}
          uploadGroupSortIndexById={uploadGroupSortIndexById}
          operationSortFallback={operationSortFallback}
          isGroupExpanded={isGroupExpanded}
          toggleGroupExpanded={toggleGroupExpanded}
          getSectionVisibleCount={getSectionVisibleCount}
          showMoreSection={showMoreSection}
          cancelOperation={cancelOperation}
          cancelUploadGroup={cancelUploadGroup}
          cancelUploadOperation={cancelUploadOperation}
          removeQueuedUpload={removeQueuedUpload}
          onDownloadOperationDetails={downloadOperationDetails}
          hasFinishedOperations={hasFinishedOperations}
          onClearFinishedOperations={clearFinishedOperations}
          onClose={closeOperationsDetailsModal}
        />
      )}
    </>
  );
}
