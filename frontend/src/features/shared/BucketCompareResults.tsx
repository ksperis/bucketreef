/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import InlineSummary from "../../components/InlineSummary";
import ListToolbar from "../../components/ListToolbar";
import ToolbarSearchInput from "../../components/ToolbarSearchInput";
import { ListActionButton, ListBadge } from "../../components/list/ListControls";
import UiDetails from "../../components/ui/UiDetails";
import UiProgressBar from "../../components/ui/UiProgressBar";
import UiSelect from "../../components/ui/UiSelect";
import { ChevronDownIcon } from "../browser/browserIcons";
import {
  getRunStatusLabel,
  getRunStatusTone,
  type BucketCompareRunFilters,
  type BucketCompareRunPresentationItem,
} from "./bucketCompareShared";
import "./bucketOperationRun.css";

export function BucketCompareResultFilters({
  search, status, differences, visible, total,
  onSearchChange, onStatusChange, onDifferencesChange, onReset,
}: BucketCompareRunFilters & {
  visible: number;
  total: number;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: BucketCompareRunFilters["status"]) => void;
  onDifferencesChange: (value: BucketCompareRunFilters["differences"]) => void;
  onReset: () => void;
}) {
  return (
    <ListToolbar
      variant="section"
      title="Comparison results"
      countLabel={`Showing ${visible} / ${total} result(s).`}
      search={
        <ToolbarSearchInput
          label="Filter comparison results"
          value={search}
          onChange={onSearchChange}
          placeholder="Filter by source/target bucket or error"
        />
      }
      filters={
        <>
          <UiSelect
            label="Status"
            aria-label="Filter comparison status"
            value={status}
            onChange={(event) => onStatusChange(event.target.value as BucketCompareRunFilters["status"])}
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="running">Running</option>
            <option value="success">Done</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </UiSelect>
          <UiSelect
            label="Differences"
            aria-label="Filter comparison differences"
            value={differences}
            onChange={(event) => onDifferencesChange(event.target.value as BucketCompareRunFilters["differences"])}
          >
            <option value="all">All diff states</option>
            <option value="with_diff">With differences</option>
            <option value="no_diff">No differences</option>
          </UiSelect>
        </>
      }
      actions={
        <ListActionButton
          variant="secondary"
          onClick={onReset}
          disabled={!search && status === "all" && differences === "all"}
        >
          Reset filters
        </ListActionButton>
      }
    />
  );
}

type ContentMetrics = {
  matched_count: number;
  different_count: number;
  only_source_count: number;
  only_target_count: number;
  ignored_after_cutoff_count?: number;
};

export function BucketCompareResult({ item, content, children }: {
  item: BucketCompareRunPresentationItem;
  content?: ContentMetrics | null;
  children: ReactNode;
}) {
  const progress = item.status === "running" ? null : item.status === "pending" ? 0 : 100;
  return (
    <UiDetails className="bucket-operation-result">
      <summary>
        <ChevronDownIcon aria-hidden="true" className="bucket-operation-result-chevron" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
            <p className="min-w-0 break-all font-medium text-[var(--ui-text)]">{item.sourceBucket} → {item.targetBucket}</p>
            <ListBadge tone={getRunStatusTone(item)}>{getRunStatusLabel(item)}</ListBadge>
            {content && (
              <InlineSummary items={[
                { label: "Matched", value: content.matched_count },
                { label: "Different", value: content.different_count },
                { label: "Source only", value: content.only_source_count },
                { label: "Target only", value: content.only_target_count },
                ...(content.ignored_after_cutoff_count ? [{ label: "Ignored after cutoff", value: content.ignored_after_cutoff_count }] : []),
              ]} />
            )}
          </div>
          <UiProgressBar
            value={progress}
            label={`Comparison progress for ${item.sourceBucket} to ${item.targetBucket}`}
            className="!bg-[var(--ui-surface-muted)]"
            barClassName="bg-primary transition-[width] duration-150 motion-reduce:transition-none"
          />
        </div>
      </summary>
      <div className="min-w-0 border-t border-[var(--ui-border-soft)] p-3">{children}</div>
    </UiDetails>
  );
}

export function BucketCompareSection({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return (
    <UiDetails className="bucket-compare-section">
      <summary>
        <ChevronDownIcon aria-hidden="true" className="bucket-operation-result-chevron" />
        <div className="min-w-0 flex-1">{summary}</div>
      </summary>
      {children}
    </UiDetails>
  );
}
