/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import UiSelect from "../../components/ui/UiSelect";
import { ToolbarSearchTextarea } from "../../components/ToolbarSearchInput";
import { ToolbarAdvancedFilterButton, ToolbarMatchModeButton } from "../../components/ToolbarFilterControls";
import type { BucketUiTagDefinition } from "../../api/bucketUiTags";
import { UiTagBadge } from "../../components/UiTagSettings";
import type { useBucketOpsFilterController } from "./useBucketOpsFilterController";
import { useSharedI18n } from "./sharedI18n";

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
  const { text: surfaceText } = useSharedI18n();
  const {
    quickFilterDraftForcesExact,
    quickFilterFieldState,
    quickFilterModeForDisplay,
    quickFilterPending,
    toggleQuickFilterMode,
    updateQuickFilterDraft,
  } = controller;
  return (
    <ToolbarSearchTextarea
      label={surfaceText("Quick filter")}
      value={value}
      onChange={updateQuickFilterDraft}
      onKeyDown={(event) => event.stopPropagation()}
      placeholder={surfaceText("Bucket name(s)")}
      className="w-full min-w-[16rem] sm:w-72"
      inputClassName={quickFilterFieldState.fieldClass}
      trailingControl={
        <ToolbarMatchModeButton
          mode={quickFilterModeForDisplay}
          pending={quickFilterPending}
          locked={quickFilterDraftForcesExact}
          onClick={toggleQuickFilterMode}
          aria-label={surfaceText("Toggle quick filter match mode")}
        />
      }
    />
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
  const { text: surfaceText } = useSharedI18n();
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
          <div className="bucket-ops-ui-tags flex min-w-0 flex-wrap items-center gap-1">
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
                  ariaLabel={surfaceText("Selected UI tag filter {tag}, {visibility}", { tag: tag.label, visibility })}
                  title={surfaceText("Selected UI tag filter: {tag}, {visibility}", { tag: tag.label, visibility })}
                  onRemove={() => removeTagFilter(tag.id)}
                  removeAriaLabel={surfaceText("Remove UI tag filter {tag}, {visibility}", { tag: tag.label, visibility })}
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
                  ariaLabel={surfaceText("Add UI tag filter {tag}, {visibility}", { tag: tag.label, visibility })}
                  title={surfaceText("Available UI tag filter: {tag}, {visibility}. Click to add.", { tag: tag.label, visibility })}
                />
              );
            })}
          </div>
          <UiSelect label={surfaceText("Tags")} size="compact"
            aria-label={surfaceText("UI tag filter match mode")}
            value={tagFilterMode}
            onChange={(event) =>
              updateTagFilterMode(event.target.value as "any" | "all")
            }
          >
            <option value="any">{surfaceText("OR")}</option>
            <option value="all">{surfaceText("AND")}</option>
          </UiSelect>
        </div>
      ) : null}
      <ToolbarAdvancedFilterButton
        active={showAdvancedFilter || advancedFiltersApplied}
        onClick={openAdvancedFilterDrawer}
      >
        {surfaceText("Advanced filter")}{advancedFiltersApplied ? ` · ${surfaceText("Active")}` : ""}
      </ToolbarAdvancedFilterButton>
    </>
  );
}
