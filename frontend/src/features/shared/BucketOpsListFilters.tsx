/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { BucketUiTagDefinition } from "../../api/bucketUiTags";
import { UiTagBadge } from "../../components/UiTagSettings";
import {
  toolbarCompactButtonClasses,
  toolbarMatchModeButtonClasses,
  toolbarCompactInputClasses,
  toolbarCompactSelectClasses,
} from "../../components/toolbarControlClasses";
import { cx } from "../../components/ui/styles";
import type { useBucketOpsFilterController } from "./useBucketOpsFilterController";

type FilterController = ReturnType<typeof useBucketOpsFilterController>;

type QuickFilterController = Pick<
  FilterController,
  | "quickFilterDraftForcesExact"
  | "quickFilterFieldState"
  | "quickFilterModeForDisplay"
  | "quickFilterPending"
  | "toggleQuickFilterMode"
  | "updateQuickFilterDraft"
>;

type TagFilterController = Pick<
  FilterController,
  | "addTagFilter"
  | "advancedFiltersApplied"
  | "openAdvancedFilterDrawer"
  | "removeTagFilter"
  | "showAdvancedFilter"
  | "updateTagFilterMode"
>;

export function BucketOpsQuickFilter({
  controller,
  value,
}: {
  controller: QuickFilterController;
  value: string;
}) {
  const {
    quickFilterDraftForcesExact,
    quickFilterFieldState,
    quickFilterModeForDisplay,
    quickFilterPending,
    toggleQuickFilterMode,
    updateQuickFilterDraft,
  } = controller;
  return (
    <div className="relative w-full min-w-[16rem] sm:w-72">
      <textarea
        aria-label="Quick filter"
        value={value}
        onChange={(event) => updateQuickFilterDraft(event.target.value)}
        onKeyDown={(event) => event.stopPropagation()}
        placeholder="Bucket name(s)"
        rows={1}
        className={cx(
          toolbarCompactInputClasses,
          "ui-list-search w-full resize-y",
          quickFilterFieldState.fieldClass ||
            "border-slate-200 dark:border-slate-700",
        )}
      />
      <button
        type="button"
        onClick={toggleQuickFilterMode}
        disabled={quickFilterDraftForcesExact}
        className={toolbarMatchModeButtonClasses(
          quickFilterModeForDisplay,
          quickFilterPending,
          quickFilterDraftForcesExact,
        )}
        title={
          quickFilterDraftForcesExact
            ? "Quick filter mode: exact (locked by list input)"
            : `Quick filter mode: ${quickFilterModeForDisplay === "contains" ? "contains" : "exact"}`
        }
        aria-label="Toggle quick filter match mode"
      >
        {quickFilterModeForDisplay === "contains" ? "~" : "="}
      </button>
    </div>
  );
}

const visibilityLabel = (tag: BucketUiTagDefinition) =>
  tag.visibility === "shared" ? "Shared" : "Private";

export function BucketOpsTagAndAdvancedFilters({
  availableUiTags,
  controller,
  tagFilterMode,
  tagFilters,
}: {
  availableUiTags: readonly BucketUiTagDefinition[];
  controller: TagFilterController;
  tagFilterMode: "any" | "all";
  tagFilters: readonly number[];
}) {
  const {
    addTagFilter,
    advancedFiltersApplied,
    openAdvancedFilterDrawer,
    removeTagFilter,
    showAdvancedFilter,
    updateTagFilterMode,
  } = controller;
  const selectedIds = new Set(tagFilters);
  const availableTagFilters = availableUiTags.filter(
    (tag) => !selectedIds.has(tag.id),
  );
  const showTagFilterBar = availableUiTags.length > 0 || tagFilters.length > 0;

  return (
    <>
      {showTagFilterBar ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {tagFilters.map((tagId) => {
              const tag = availableUiTags.find((item) => item.id === tagId);
              if (!tag) return null;
              const visibility = visibilityLabel(tag);
              return (
                <UiTagBadge
                  key={`filter:${tag.id}`}
                  label={tag.label}
                  colorKey={tag.color_key}
                  visibility={tag.visibility}
                  selectionState="selected"
                  className="text-xs"
                  ariaLabel={`Selected UI tag filter ${tag.label}, ${visibility}`}
                  title={`Selected UI tag filter: ${tag.label}, ${visibility}`}
                  onRemove={() => removeTagFilter(tag.id)}
                  removeAriaLabel={`Remove UI tag filter ${tag.label}, ${visibility}`}
                />
              );
            })}
            {availableTagFilters.map((tag) => {
              const visibility = visibilityLabel(tag);
              return (
                <UiTagBadge
                  key={`available:${tag.id}`}
                  label={tag.label}
                  colorKey={tag.color_key}
                  visibility={tag.visibility}
                  selectionState="available"
                  onClick={() => addTagFilter(tag.id)}
                  ariaLabel={`Add UI tag filter ${tag.label}, ${visibility}`}
                  title={`Available UI tag filter: ${tag.label}, ${visibility}. Click to add.`}
                />
              );
            })}
          </div>
          <select
            aria-label="UI tag filter match mode"
            value={tagFilterMode}
            onChange={(event) =>
              updateTagFilterMode(event.target.value as "any" | "all")
            }
            className={cx(
              toolbarCompactSelectClasses,
              "w-auto",
            )}
          >
            <option value="any">OR</option>
            <option value="all">AND</option>
          </select>
        </div>
      ) : null}
      <button
        type="button"
        onClick={openAdvancedFilterDrawer}
        className={cx(
          toolbarCompactButtonClasses,
          showAdvancedFilter || advancedFiltersApplied
            ? "ui-list-action-active"
            : "",
        )}
      >
        Advanced filter{advancedFiltersApplied ? " · Active" : ""}
      </button>
    </>
  );
}
