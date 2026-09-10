/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo } from "react";
import ColumnVisibilityMenu from "../../components/ColumnVisibilityMenu";
import type { FeatureKey } from "./bucketOpsAdvancedFilterModel";
import {
  BUCKET_CORE_COLUMN_OPTIONS,
  BUCKET_QUOTA_COLUMN_GROUPS,
  FEATURE_DETAIL_COLUMN_OPTIONS,
  type ColumnId,
  type FeatureDetailColumnOption,
} from "./bucketOpsListState";

type FeatureColumnOption = {
  id: FeatureKey;
  label: string;
};

type BucketOpsColumnControlsProps = {
  defaultVisibleColumns: ColumnId[];
  featureColumnOptions: FeatureColumnOption[];
  isStorageOps: boolean;
  onReset: () => void;
  onToggle: (id: ColumnId) => void;
  visibleColumns: ColumnId[];
};

export default function BucketOpsColumnControls({
  defaultVisibleColumns,
  featureColumnOptions,
  isStorageOps,
  onReset,
  onToggle,
  visibleColumns,
}: BucketOpsColumnControlsProps) {
  const columnsCustomized = useMemo(() => {
    if (visibleColumns.length !== defaultVisibleColumns.length) return true;
    const visible = new Set(visibleColumns);
    return defaultVisibleColumns.some((column) => !visible.has(column));
  }, [defaultVisibleColumns, visibleColumns]);

  const featureDetailColumnsByFeature = useMemo(() => {
    const supported = new Set(featureColumnOptions.map((option) => option.id));
    const groups: Partial<Record<FeatureKey, FeatureDetailColumnOption[]>> = {};
    FEATURE_DETAIL_COLUMN_OPTIONS.forEach((option) => {
      if (!supported.has(option.feature)) return;
      const current = groups[option.feature] ?? [];
      groups[option.feature] = [...current, option];
    });
    return groups;
  }, [featureColumnOptions]);

  return (
    <ColumnVisibilityMenu
      selectedCount={visibleColumns.length}
      onReset={onReset}
      resetDisabled={!columnsCustomized}
      coreGroups={[
        {
          id: "core",
          label: "Core",
          options: BUCKET_CORE_COLUMN_OPTIONS.filter((option) =>
            isStorageOps
              ? true
              : option.id !== "context_name" &&
                option.id !== "context_kind" &&
                option.id !== "endpoint_name",
          ).map((option) => ({
            id: option.id,
            label: option.label,
            checked: visibleColumns.includes(option.id),
            onToggle: () => onToggle(option.id),
          })),
        },
      ]}
      detailGroups={BUCKET_QUOTA_COLUMN_GROUPS.map((group) => ({
        id: group.id,
        label: group.label,
        details: group.options.map((option) => ({
          id: option.id,
          label: option.label,
          checked: visibleColumns.includes(option.id),
          onToggle: () => onToggle(option.id),
        })),
      }))}
      featureGroups={featureColumnOptions.map((option) => ({
        id: option.id,
        label: option.label,
        checked: visibleColumns.includes(option.id),
        onToggle: () => onToggle(option.id),
        details: (featureDetailColumnsByFeature[option.id] ?? []).map(
          (detail) => ({
            id: detail.id,
            label: detail.label,
            checked: visibleColumns.includes(detail.id),
            onToggle: () => onToggle(detail.id),
          }),
        ),
      }))}
      footerNote="Feature checks and detail values are loaded only for enabled columns."
    />
  );
}
