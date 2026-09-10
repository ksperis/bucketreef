/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import ListToolbar from "../../components/ListToolbar";
import ToolbarSearchInput from "../../components/ToolbarSearchInput";
import { ListActionButton } from "../../components/list/ListControls";
import type { ReactNode } from "react";

import UiButton from "../../components/ui/UiButton";
import { cx, uiCardMutedClass, uiMutedTextClass, uiTableContainerClass } from "../../components/ui/styles";

const adminAssociationAddPanelClass = cx(uiCardMutedClass, "space-y-2 px-3 py-2");
export const adminAssociationCheckboxClass = "h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary";
export const adminAssociationTableContainerClass = uiTableContainerClass;

export const adminAssociationOptionLabelClass = "flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200";
export const adminAssociationAccountOptionLabelClass =
  "flex min-w-48 items-center gap-2 ui-body text-slate-700 dark:text-slate-200";
export const adminAssociationOptionRowClass = (selected: boolean) =>
  `flex items-center justify-between rounded-md px-2 py-1 ${
    selected ? "bg-[var(--ui-selected-bg)]" : "hover:bg-[var(--ui-hover)]"
  }`;

export const adminAssociationAccountOptionRowClass = (selected: boolean) =>
  `flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1 ${
    selected ? "bg-[var(--ui-selected-bg)]" : "hover:bg-[var(--ui-hover)]"
  }`;

type AdminAssociationSectionHeaderProps = {
  title: ReactNode;
  countLabel: ReactNode;
  actionLabel: ReactNode;
  onAction: () => void;
};

export function AdminAssociationSectionHeader({
  title,
  countLabel,
  actionLabel,
  onAction,
}: AdminAssociationSectionHeaderProps) {
  return (
    <ListToolbar variant="section" title={title} countLabel={countLabel}
      headingActions={<ListActionButton onClick={onAction}>{actionLabel}</ListActionButton>} />
  );
}

type AdminAssociationLinkedTableProps = {
  title: ReactNode;
  countLabel: ReactNode;
  actionLabel: ReactNode;
  onAction: () => void;
  headers: Array<{ label: ReactNode; align?: "left" | "right" }>;
  hasItems: boolean;
  emptyLabel: ReactNode;
  rows: ReactNode;
  picker?: ReactNode;
};

export function AdminAssociationLinkedTable({
  title,
  countLabel,
  actionLabel,
  onAction,
  headers,
  hasItems,
  emptyLabel,
  rows,
  picker,
}: AdminAssociationLinkedTableProps) {
  return (
    <div className="space-y-3">
      <AdminAssociationSectionHeader
        title={title}
        countLabel={countLabel}
        actionLabel={actionLabel}
        onAction={onAction}
      />
      <div className={adminAssociationTableContainerClass}>
        <table className="ui-data-table">
          <thead>
            <tr>
              {headers.map((header, index) => (
                <th
                  key={index}
                  className={
                    header.align === "right"
                      ? "w-px whitespace-nowrap text-right"
                      : "text-left"
                  }
                >
                  {header.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hasItems ? (
              rows
            ) : (
              <tr>
                <td colSpan={headers.length} className="ui-table-secondary">
                  {emptyLabel}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {picker}
    </div>
  );
}

type AdminAssociationCheckboxOptionsProps<T extends { id: number }> = {
  options: readonly T[];
  selectedIds: readonly number[];
  onToggle: (id: number) => void;
  getLabel: (option: T) => ReactNode;
};

export function AdminAssociationCheckboxOptions<T extends { id: number }>({
  options,
  selectedIds,
  onToggle,
  getLabel,
}: AdminAssociationCheckboxOptionsProps<T>) {
  return (
    <>
      {options.map((option) => {
        const isSelected = selectedIds.includes(option.id);
        return (
          <div key={option.id} className={adminAssociationOptionRowClass(isSelected)}>
            <label className={adminAssociationOptionLabelClass}>
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => onToggle(option.id)}
                className={adminAssociationCheckboxClass}
              />
              <span>{getLabel(option)}</span>
            </label>
          </div>
        );
      })}
    </>
  );
}

type AdminAssociationPickerPanelProps = {
  title: ReactNode;
  hint?: ReactNode;
  search: string;
  onSearchChange: (value: string) => void;
  loading: boolean;
  availableCount: number;
  maxVisibleOptions: number;
  selectedCount: number;
  onCancel: () => void;
  onAdd: () => void;
  addDisabled: boolean;
  loadingLabel: ReactNode;
  searchAriaLabel?: string;
  emptyLabel?: ReactNode;
  addLabel?: ReactNode;
  children: ReactNode;
};

export function AdminAssociationPickerPanel({
  title,
  hint,
  search,
  onSearchChange,
  loading,
  availableCount,
  maxVisibleOptions,
  selectedCount,
  onCancel,
  onAdd,
  addDisabled,
  loadingLabel,
  searchAriaLabel,
  emptyLabel = "No results.",
  addLabel = "Add selected",
  children,
}: AdminAssociationPickerPanelProps) {
  return (
    <div className={adminAssociationAddPanelClass}>
      <ListToolbar variant="section" title={title} description={hint}
        search={<ToolbarSearchInput label={searchAriaLabel ?? "Search"} value={search} onChange={onSearchChange} placeholder="Search..." />}
      />
      <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
        {loading ? <p className={cx("ui-caption", uiMutedTextClass)}>{loadingLabel}</p> : null}
        {!loading && availableCount === 0 ? <p className={cx("ui-caption", uiMutedTextClass)}>{emptyLabel}</p> : null}
        {children}
        {availableCount > maxVisibleOptions ? (
          <p className={cx("ui-caption", uiMutedTextClass)}>
            Showing first {maxVisibleOptions} matches. Use the search box to narrow down the list.
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={cx("ui-caption", uiMutedTextClass)}>{selectedCount} selected</span>
        <div className="flex items-center gap-2">
          <UiButton variant="secondary" size="xs" onClick={onCancel}>
            Cancel
          </UiButton>
          <UiButton size="xs" disabled={addDisabled} onClick={onAdd}>
            {addLabel}
          </UiButton>
        </div>
      </div>
    </div>
  );
}
