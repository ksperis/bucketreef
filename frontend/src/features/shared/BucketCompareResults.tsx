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
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiProgressBar from "../../components/ui/UiProgressBar";
import UiSelect from "../../components/ui/UiSelect";
import { ChevronDownIcon } from "../browser/browserIcons";
import BucketCompareObjectDetails, {
  type CompareObjectOptions,
} from "./BucketCompareObjectDetails";
import {
  formatCompareDisplayLimitMessage,
  type BucketCompareContentSection,
  type CompareVisibleKeysCopyFeedback,
} from "./bucketCompareContentDiff";
import {
  getChangedTone,
  getRunStatusLabel,
  getRunStatusTone,
  type BucketCompareRunFilters,
  type BucketCompareRunPresentationItem,
} from "./bucketCompareShared";
import "./bucketOperationRun.css";
import { useSharedI18n } from "./sharedI18n";

export type BucketCompareFeedbackTone = "neutral" | "info" | "success" | "warning" | "danger";

export function BucketCompareFeedback({
  tone = "neutral",
  children,
  announce = false,
}: {
  tone?: BucketCompareFeedbackTone;
  children: ReactNode;
  announce?: boolean;
}) {
  return (
    <UiInlineMessage
      tone={tone === "danger" ? "error" : tone}
      role={announce ? (tone === "danger" ? "alert" : "status") : undefined}
      className="[overflow-wrap:anywhere]"
    >
      {children}
    </UiInlineMessage>
  );
}

type BucketCompareContentSectionView = BucketCompareContentSection & {
  label: string;
};

export function BucketCompareContentDiff({
  sectionIdPrefix,
  sections,
  copyFeedback,
  onCopyVisibleKeys,
  getSourceOptions,
  getTargetOptions,
  renderSectionActions,
  renderSectionFeedback,
}: {
  sectionIdPrefix: string;
  sections: BucketCompareContentSectionView[];
  copyFeedback: (CompareVisibleKeysCopyFeedback & { id: string }) | null;
  onCopyVisibleKeys: (id: string, keys: string[]) => void | Promise<void>;
  getSourceOptions?: (
    section: BucketCompareContentSectionView,
    sectionFeedbackId: string,
  ) => CompareObjectOptions | undefined;
  getTargetOptions?: (
    section: BucketCompareContentSectionView,
    sectionFeedbackId: string,
  ) => CompareObjectOptions | undefined;
  renderSectionActions?: (
    section: BucketCompareContentSectionView,
    sectionFeedbackId: string,
  ) => ReactNode;
  renderSectionFeedback?: (
    section: BucketCompareContentSectionView,
    sectionFeedbackId: string,
  ) => ReactNode;
}) {
  const { text: surfaceText } = useSharedI18n();
  const contentHasDifferences = sections.some((section) => section.changed);

  return (
    <BucketCompareSection
      summary={
        <div className="flex flex-wrap items-center gap-2">
          <span className="ui-caption font-semibold text-slate-700 dark:text-slate-200">
            {surfaceText("Content diff (md5 or size)")}
          </span>
          <ListBadge tone={getChangedTone(contentHasDifferences)}>
            {surfaceText(contentHasDifferences ? "Different" : "Identical")}
          </ListBadge>
        </div>
      }
    >
      <div className="mt-2 space-y-3">
        {sections.map((section) => {
          const sectionFeedbackId = `${sectionIdPrefix}:${section.key}`;
          const sectionCopyFeedback =
            copyFeedback?.id === sectionFeedbackId ? copyFeedback : null;
          const displayLimitMessage = formatCompareDisplayLimitMessage(
            section.objectCount,
            section.visibleCount,
            section.hiddenCount,
          );

          return (
            <BucketCompareSection
              key={sectionFeedbackId}
              summary={
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="ui-caption font-semibold text-slate-700 dark:text-slate-200">
                      {section.label}
                    </span>
                    <ListBadge tone={getChangedTone(section.changed)}>
                      {surfaceText(section.changed ? "Different" : "Identical")}
                    </ListBadge>
                    {displayLimitMessage && (
                      <ListBadge tone="warning">
                        {surfaceText("Showing")} {section.visibleCount} {surfaceText("of")} {section.objectCount}
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
                          void onCopyVisibleKeys(sectionFeedbackId, section.copyKeys);
                        }}
                      >
                        {surfaceText("Copy keys")}
                      </ListActionButton>
                    )}
                    {renderSectionActions?.(section, sectionFeedbackId)}
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
                {renderSectionFeedback?.(section, sectionFeedbackId)}
                {displayLimitMessage && (
                  <BucketCompareFeedback tone="warning">
                    {displayLimitMessage}
                  </BucketCompareFeedback>
                )}
                <div className="grid gap-2 lg:grid-cols-2">
                  <div className="space-y-1">
                    <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {surfaceText("Source")}
                    </p>
                    <BucketCompareObjectDetails
                      rows={section.sourceDetails}
                      options={getSourceOptions?.(section, sectionFeedbackId)}
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {surfaceText("Target")}
                    </p>
                    <BucketCompareObjectDetails
                      rows={section.targetDetails}
                      options={getTargetOptions?.(section, sectionFeedbackId)}
                    />
                  </div>
                </div>
              </div>
            </BucketCompareSection>
          );
        })}
      </div>
    </BucketCompareSection>
  );
}

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
  const { text: surfaceText } = useSharedI18n();
  return (
    <ListToolbar
      variant="section"
      title={surfaceText("Comparison results")}
      countLabel={surfaceText(total === 1 ? "Showing {visible} / {total} result." : "Showing {visible} / {total} results.", {
        visible,
        total,
      })}
      search={
        <ToolbarSearchInput
          label={surfaceText("Filter comparison results")}
          value={search}
          onChange={onSearchChange}
          placeholder={surfaceText("Filter by source/target bucket or error")}
        />
      }
      filters={
        <>
          <UiSelect
            label={surfaceText("Status")}
            aria-label={surfaceText("Filter comparison status")}
            value={status}
            onChange={(event) => onStatusChange(event.target.value as BucketCompareRunFilters["status"])}
          >
            <option value="all">{surfaceText("All statuses")}</option>
            <option value="pending">{surfaceText("Pending")}</option>
            <option value="running">{surfaceText("Running")}</option>
            <option value="success">{surfaceText("Done")}</option>
            <option value="failed">{surfaceText("Failed")}</option>
            <option value="cancelled">{surfaceText("Cancelled")}</option>
          </UiSelect>
          <UiSelect
            label={surfaceText("Differences")}
            aria-label={surfaceText("Filter comparison differences")}
            value={differences}
            onChange={(event) => onDifferencesChange(event.target.value as BucketCompareRunFilters["differences"])}
          >
            <option value="all">{surfaceText("All diff states")}</option>
            <option value="with_diff">{surfaceText("With differences")}</option>
            <option value="no_diff">{surfaceText("No differences")}</option>
          </UiSelect>
        </>
      }
      actions={
        <ListActionButton
          variant="secondary"
          onClick={onReset}
          disabled={!search && status === "all" && differences === "all"}
        >
          {surfaceText("Reset filters")}</ListActionButton>
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
  const { text: surfaceText } = useSharedI18n();
  const progress = item.status === "running" ? null : item.status === "pending" ? 0 : 100;
  return (
    <UiDetails className="bucket-operation-result">
      <summary>
        <ChevronDownIcon aria-hidden="true" className="bucket-operation-result-chevron" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
            <p className="min-w-0 break-all font-medium text-[var(--ui-text)]">{item.sourceBucket} → {item.targetBucket}</p>
            <ListBadge tone={getRunStatusTone(item)}>{surfaceText(getRunStatusLabel(item))}</ListBadge>
            {content && (
              <InlineSummary items={[
                { label: surfaceText("Matched"), value: content.matched_count },
                { label: surfaceText("Different"), value: content.different_count },
                { label: surfaceText("Source only"), value: content.only_source_count },
                { label: surfaceText("Target only"), value: content.only_target_count },
                ...(content.ignored_after_cutoff_count ? [{
                  label: surfaceText("Ignored after cutoff"),
                  value: content.ignored_after_cutoff_count,
                }] : []),
              ]} />
            )}
          </div>
          <UiProgressBar
            value={progress}
            label={surfaceText("Comparison progress for {source} to {target}", {
              source: item.sourceBucket,
              target: item.targetBucket,
            })}
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
