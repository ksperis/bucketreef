/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { DataTableColumn } from "../../../components/list/DataTableShell";
import { SettingsButton } from "../../../components/settings/SettingsControls";

type IndexedRow = {
  index: number;
};

type BucketFeatureManageColumnOptions = {
  label: string;
  editLabel: string;
  removeLabel: string;
  disabled: boolean;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void | Promise<void>;
};

export function createBucketFeatureManageColumn<Row extends IndexedRow>({
  label,
  editLabel,
  removeLabel,
  disabled,
  onEdit,
  onRemove,
}: BucketFeatureManageColumnOptions): DataTableColumn<Row> {
  return {
    id: "manage",
    label,
    mobileRole: "actions",
    headerClassName: "w-px whitespace-nowrap text-right",
    cellClassName: "w-px whitespace-nowrap",
    render: ({ index }) => (
      <div className="bucket-feature-row-actions">
        <SettingsButton
          type="button"
          variant="secondary"
          onClick={() => onEdit(index)}
          disabled={disabled}
        >
          {editLabel}
        </SettingsButton>
        <SettingsButton
          type="button"
          variant="danger"
          onClick={() => void onRemove(index)}
          disabled={disabled}
        >
          {removeLabel}
        </SettingsButton>
      </div>
    ),
  };
}
