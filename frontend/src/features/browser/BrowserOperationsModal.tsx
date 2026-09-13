/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Fragment, useMemo } from "react";
import ListDialog from "../../components/list/ListDialog";
import { ListActionButton, ListBadge } from "../../components/list/ListControls";
import { formatBytes } from "../../utils/format";
import { DEFAULT_QUEUED_VISIBLE_COUNT } from "./browserConstants";
import { DownloadIcon } from "./browserIcons";
import {
  BrowserOperationCard,
  BrowserTransferOperationGroupCard,
} from "./BrowserOperationCards";
import { buildOperationTimelineEntries } from "./browserOperationGroups";
import { buildOperationStatusPill, operationCompletionLabel } from "./browserOperationStatus";
import { formatBadgeCount } from "./browserUtils";
import type {
  CopyOperationGroup,
  DeleteOperationGroup,
  DownloadOperationGroup,
  OperationDetailsKind,
  OperationItem,
  UploadOperationGroup,
} from "./browserTypes";

type BrowserOperationsModalProps = {
  totalOperationsCount: number;
  activeOperationsCount: number;
  queuedOperationsCount: number;
  completedOperationsCount: number;
  failedOperationsCount: number;
  showActiveOperations: boolean;
  showQueuedOperations: boolean;
  showCompletedOperations: boolean;
  showFailedOperations: boolean;
  filtersAllInactive: boolean;
  onToggleActive: () => void;
  onToggleQueued: () => void;
  onToggleCompleted: () => void;
  onToggleFailed: () => void;
  visibleDownloadGroups: DownloadOperationGroup[];
  visibleDeleteGroups: DeleteOperationGroup[];
  visibleCopyGroups: CopyOperationGroup[];
  visibleUploadGroups: UploadOperationGroup[];
  visibleOtherOperations: OperationItem[];
  operationSortIndexById: Record<string, number>;
  uploadGroupSortIndexById: Record<string, number>;
  operationSortFallback: number;
  isGroupExpanded: (groupId: string) => boolean;
  toggleGroupExpanded: (groupId: string) => void;
  getSectionVisibleCount: (groupId: string, section: "queued" | "completed" | "failed") => number;
  showMoreSection: (groupId: string, section: "queued" | "completed" | "failed") => void;
  cancelOperation: (operationId: string) => void;
  cancelUploadGroup: (groupId: string) => void;
  cancelUploadOperation: (operationId: string) => void;
  removeQueuedUpload: (uploadId: string) => void;
  onDownloadOperationDetails: (kind: OperationDetailsKind, operationId: string) => void;
  hasFinishedOperations: boolean;
  onClearFinishedOperations: () => void;
  onClose: () => void;
};

export default function BrowserOperationsModal(props: BrowserOperationsModalProps) {
  const {
    totalOperationsCount,
    activeOperationsCount,
    queuedOperationsCount,
    completedOperationsCount,
    failedOperationsCount,
    showActiveOperations,
    showQueuedOperations,
    showCompletedOperations,
    showFailedOperations = false,
    filtersAllInactive,
    onToggleActive,
    onToggleQueued,
    onToggleCompleted,
    onToggleFailed,
    visibleDownloadGroups,
    visibleDeleteGroups,
    visibleCopyGroups,
    visibleUploadGroups,
    visibleOtherOperations,
    operationSortIndexById,
    uploadGroupSortIndexById,
    operationSortFallback,
    isGroupExpanded,
    toggleGroupExpanded,
    getSectionVisibleCount,
    showMoreSection,
    cancelOperation,
    cancelUploadGroup,
    cancelUploadOperation,
    removeQueuedUpload,
    onDownloadOperationDetails,
    hasFinishedOperations,
    onClearFinishedOperations,
    onClose,
  } = props;

  const showAllOperations = filtersAllInactive;
  const showActiveSection = showAllOperations || showActiveOperations;
  const showQueuedSection = showAllOperations || showQueuedOperations;
  const showCompletedSection = showAllOperations || showCompletedOperations;
  const showFailedSection = showAllOperations || showFailedOperations;
  const renderDetailsAction = (kind: OperationDetailsKind, operationId: string) => (
    <ListActionButton
      type="button"
      iconOnly
      onClick={() => onDownloadOperationDetails(kind, operationId)}
      title="Export details (JSON)"
      aria-label="Export operation details (JSON)"
    >
      <DownloadIcon className="h-3.5 w-3.5" />
    </ListActionButton>
  );
  const renderDetailsTextAction = (kind: OperationDetailsKind, operationId: string) => (
    <ListActionButton
      type="button"
      onClick={() => onDownloadOperationDetails(kind, operationId)}
    >
      Download details (JSON)
    </ListActionButton>
  );

  const timelineEntries = useMemo(
    () =>
      buildOperationTimelineEntries({
        downloadGroups: visibleDownloadGroups,
        deleteGroups: visibleDeleteGroups,
        copyGroups: visibleCopyGroups,
        uploadGroups: visibleUploadGroups,
        otherOperations: visibleOtherOperations,
        operationSortIndexById,
        uploadGroupSortIndexById,
        operationSortFallback,
      }),
    [
      operationSortFallback,
      operationSortIndexById,
      uploadGroupSortIndexById,
      visibleCopyGroups,
      visibleDeleteGroups,
      visibleDownloadGroups,
      visibleOtherOperations,
      visibleUploadGroups,
    ],
  );
  const operationSections = {
    active: showActiveSection,
    queued: showQueuedSection,
    completed: showCompletedSection,
    failed: showFailedSection,
  };
  const renderUploadGroup = (group: UploadOperationGroup) => {
    const activeCount = group.activeItems.length;
    const queuedCount = group.queuedItems.length;
    const completedItems = group.completedItems.filter((item) => item.completionStatus !== "failed");
    const failedItems = group.completedItems.filter((item) => item.completionStatus === "failed");
    const failedCount = failedItems.length;
    const completedCount = completedItems.length;
    const visibleQueuedItems = group.queuedItems.slice(0, getSectionVisibleCount(group.id, "queued"));
    const visibleCompletedItems = completedItems.slice(0, getSectionVisibleCount(group.id, "completed"));
    const visibleFailedItems = failedItems.slice(0, getSectionVisibleCount(group.id, "failed"));
    const hasMoreQueued = group.queuedItems.length > visibleQueuedItems.length;
    const hasMoreCompleted = completedItems.length > visibleCompletedItems.length;
    const hasMoreFailed = failedItems.length > visibleFailedItems.length;
    const hasFailed = failedCount > 0;
    const isCompleted = activeCount === 0 && queuedCount === 0 && group.completedItems.length > 0;
    const queuedOnly = activeCount === 0 && queuedCount > 0;
    const statusPill = buildOperationStatusPill({
      hasFailed,
      isCompleted,
      queuedOnly,
      status: "uploading",
      completionStatus: hasFailed ? "failed" : "done",
    });
    const title = group.kind === "folder" ? `Upload folder ${group.label}` : `Upload ${group.label}`;
    const subtitle = group.totalBytes > 0 ? `${formatBytes(group.totalBytes)} total` : undefined;
    const actions = (
      <>
        <ListActionButton
          type="button"
          aria-expanded={isGroupExpanded(group.id)}
          onClick={() => toggleGroupExpanded(group.id)}
        >
          {isGroupExpanded(group.id) ? "Hide files" : "Show files"}
        </ListActionButton>
        {(activeCount > 0 || queuedCount > 0) && (
          <ListActionButton type="button" variant="danger" onClick={() => cancelUploadGroup(group.id)}>
            Stop all
          </ListActionButton>
        )}
      </>
    );
    const details = isGroupExpanded(group.id) ? (
      <>
        {showActiveSection &&
          group.activeItems.map((op) => (
            <div key={op.id} className="flex items-center justify-between gap-3 ui-caption">
              <div className="min-w-0">
                <p className="whitespace-pre-wrap [overflow-wrap:anywhere] font-semibold text-[var(--ui-text)]">{op.itemLabel ?? op.path}</p>
                <p className="ui-caption text-[var(--ui-text-muted)]">
                  Uploading · {op.progress > 0 ? `${op.progress}%` : "In progress"}
                </p>
              </div>
              <ListActionButton
                type="button"
                variant="danger"
                onClick={() => cancelUploadOperation(op.id)}
                disabled={!op.cancelable}
              >
                Stop
              </ListActionButton>
            </div>
          ))}
        {showQueuedSection &&
          visibleQueuedItems.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 ui-caption">
              <div className="min-w-0">
                <p className="whitespace-pre-wrap [overflow-wrap:anywhere] font-semibold text-[var(--ui-text)]">{item.itemLabel || item.key}</p>
                <p className="ui-caption text-[var(--ui-text-muted)]">Queued · {formatBytes(item.file.size)}</p>
              </div>
              <ListActionButton type="button" variant="danger" onClick={() => removeQueuedUpload(item.id)}>
                Stop
              </ListActionButton>
            </div>
          ))}
        {showQueuedSection && hasMoreQueued && (
          <div className="flex flex-wrap items-center gap-2">
            <ListActionButton
              type="button"
              onClick={() => showMoreSection(group.id, "queued")}
            >
              Show next {DEFAULT_QUEUED_VISIBLE_COUNT}
            </ListActionButton>
            {renderDetailsTextAction("upload", group.id)}
          </div>
        )}
        {showCompletedSection &&
          visibleCompletedItems.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 ui-caption">
              <div className="min-w-0">
                <p className="whitespace-pre-wrap [overflow-wrap:anywhere] font-semibold text-[var(--ui-text)]">
                  {item.itemLabel ?? item.path}
                </p>
                <p className="ui-caption text-[var(--ui-text-muted)]">
                  {operationCompletionLabel(item.completionStatus)}
                  {item.sizeBytes != null ? ` · ${formatBytes(item.sizeBytes)}` : ""}
                </p>
              </div>
            </div>
          ))}
        {showCompletedSection && hasMoreCompleted && (
          <div className="flex flex-wrap items-center gap-2">
            <ListActionButton
              type="button"
              onClick={() => showMoreSection(group.id, "completed")}
            >
              Show next {DEFAULT_QUEUED_VISIBLE_COUNT}
            </ListActionButton>
            {renderDetailsTextAction("upload", group.id)}
          </div>
        )}
        {showFailedSection &&
          visibleFailedItems.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 ui-caption">
              <div className="min-w-0">
                <p className="whitespace-pre-wrap [overflow-wrap:anywhere] font-semibold text-[var(--ui-text)]">{item.itemLabel ?? item.path}</p>
                <p className="ui-caption text-[var(--ui-text-muted)]">
                  Failed
                  {item.sizeBytes != null ? ` · ${formatBytes(item.sizeBytes)}` : ""}
                </p>
                {item.errorMessage && (
                  <p className="ui-caption [overflow-wrap:anywhere] text-[var(--list-danger-text)]">{item.errorMessage}</p>
                )}
              </div>
            </div>
          ))}
        {showFailedSection && hasMoreFailed && (
          <div className="flex flex-wrap items-center gap-2">
            <ListActionButton
              type="button"
              onClick={() => showMoreSection(group.id, "failed")}
            >
              Show next {DEFAULT_QUEUED_VISIBLE_COUNT}
            </ListActionButton>
            {renderDetailsTextAction("upload", group.id)}
          </div>
        )}
        {!((showQueuedSection && hasMoreQueued) || (showCompletedSection && hasMoreCompleted) || (showFailedSection && hasMoreFailed)) && (
          <div className="pt-1">
            {renderDetailsTextAction("upload", group.id)}
          </div>
        )}
      </>
    ) : null;

    return (
      <BrowserOperationCard
        key={group.id}
        title={title}
        subtitle={subtitle}
        summary={`${activeCount} active · ${queuedCount} queued · ${completedCount} completed · ${failedCount} failed · ${group.progress}%`}
        progress={group.progress}
        statusPill={statusPill}
        actions={actions}
      >
        {details}
      </BrowserOperationCard>
    );
  };

  const renderOtherOperation = (op: OperationItem) => {
    const isCompleted = Boolean(op.completedAt);
    const hasFailed = op.completionStatus === "failed";
    const statusPill = buildOperationStatusPill({
      hasFailed,
      isCompleted,
      queuedOnly: false,
      status: op.status,
      completionStatus: op.completionStatus,
    });
    const summary = isCompleted
      ? `${operationCompletionLabel(op.completionStatus)}${op.completedAt ? ` · ${op.completedAt}` : ""}`
      : `${op.progress > 0 ? `${op.progress}%` : "In progress"}`;
    const actions = (
      <>
        {renderDetailsAction("other", op.id)}
        {!isCompleted && op.cancelable && (
          <ListActionButton type="button" variant="danger" onClick={() => cancelOperation(op.id)}>
            Stop
          </ListActionButton>
        )}
      </>
    );
    return (
      <BrowserOperationCard
        key={op.id}
        title={op.label}
        subtitle={op.path}
        summary={summary}
        progress={op.progress}
        statusPill={statusPill}
        actions={actions}
      >
        {op.completionStatus === "failed" && op.errorMessage ? (
          <p className="ui-caption [overflow-wrap:anywhere] text-[var(--list-danger-text)]">{op.errorMessage}</p>
        ) : null}
      </BrowserOperationCard>
    );
  };

  const filters = [
    { label: "Active", count: activeOperationsCount, selected: showActiveOperations, toggle: onToggleActive },
    { label: "Queue", count: queuedOperationsCount, selected: showQueuedOperations, toggle: onToggleQueued },
    { label: "Completed", count: completedOperationsCount, selected: showCompletedOperations, toggle: onToggleCompleted },
    { label: "Failed", count: failedOperationsCount, selected: showFailedOperations, toggle: onToggleFailed },
  ];

  return (
    <ListDialog title="Operations overview" onClose={onClose} maxWidthClass="max-w-4xl"
      rowCount={timelineEntries.length} countLabel={`${formatBadgeCount(totalOperationsCount)} operation${totalOperationsCount === 1 ? "" : "s"}`}
      emptyMessage="No operations to show."
      filters={filters.map((filter) => (
        <ListActionButton key={filter.label} aria-pressed={filter.selected} onClick={filter.toggle}>
          {filter.label}{" "}<ListBadge tone={filter.label === "Failed" ? "danger" : "neutral"}>{formatBadgeCount(filter.count)}</ListBadge>
        </ListActionButton>
      ))}
      actions={<ListActionButton onClick={onClearFinishedOperations} disabled={!hasFinishedOperations}>Clear completed/failed</ListActionButton>}>
      <div>
        {timelineEntries.map((entry) => {
          if (entry.type === "download" || entry.type === "delete" || entry.type === "copy") {
            return <BrowserTransferOperationGroupCard key={entry.key} kind={entry.type} group={entry.group}
              expanded={isGroupExpanded(entry.group.op.id)} sections={operationSections}
              getSectionVisibleCount={getSectionVisibleCount} onToggleExpanded={toggleGroupExpanded}
              onShowMore={showMoreSection} onCancel={cancelOperation} onDownloadDetails={onDownloadOperationDetails} />;
          }
          if (entry.type === "upload") return <Fragment key={entry.key}>{renderUploadGroup(entry.group)}</Fragment>;
          return <Fragment key={entry.key}>{renderOtherOperation(entry.op)}</Fragment>;
        })}
      </div>
    </ListDialog>
  );
}
